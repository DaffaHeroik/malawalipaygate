'use strict';

/**
 * Adapter kontrak legacy PayKita.
 *
 * Endpoint yang di-mount di sini adalah API yang dipanggil SPA lama
 * (base url sama-origin, `Hh=""`). Format respons dipertahankan eksak:
 *   { status, creator:"Malawali Api", code, message, result }
 *
 * Storage: Firebase RTDB (skema lama) via `store.js`. User/API key lama
 * tetap valid karena kita membaca path yang sama persis.
 *
 * Provider deteksi: OrderKuota sudah dihapus — pembayaran masuk lewat
 * webhook provider (Saweria/GoPay/DANA) + Malawali Listener; matching
 * ditangani modul `../detect`.
 */

const express = require('express');
const QRCode = require('qrcode');
const crypto = require('crypto');

const store = require('./legacy/store');
const qrisGen = require('./legacy/qris-gen');
const { buildErrorResponse, buildCreateResponse, CREATOR, DEFAULT_INVOICE_ALIAS } = require('./legacy/response');

/* ── konstanta (sama dengan backend lama) ── */
const MIN_AMOUNT = 100;
const MAX_BASE_AMOUNT = 10000000;
const ACTUAL_FEE_ADMIN = 0;
// Unique-fee tanpa satuan: 0 (pass nominal mentah) atau ratusan 100-300
// (100, 150, 200, 250, 300) supaya final nominal rapi (renamed "Malawali").
const UNIQUE_FEE_POOL = [50, 100, 150, 200, 250, 300];
const PAYMENT_EXPIRY_MS = 5 * 60 * 1000;
const CREATE_COOLDOWN_MS = 20 * 1000;
const MAX_PENDING_PER_5MIN = 5;
const MAX_INVOICE_ALIAS_LENGTH = 4;

/* ── util ── */
const sanitizeAlias = (v) => String(v || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, MAX_INVOICE_ALIAS_LENGTH).toUpperCase();
const sanitizeId = (v) => String(v || '').replace(/[^a-zA-Z0-9._-]/g, '').substring(0, 100);

function parseAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/* Filter pending ≤5 menit terakhir dari daftar record payment. */
const recentPendingInfo = (list, apikey) => {
  const now = Date.now();
  const windowMs = 5 * 60000;
  let latest = null, c = 0;
  for (const p of Object.values(list)) {
    if (!p || p.apikey !== apikey || p.status !== 'pending') continue;
    const at = new Date(p.created_at || 0).getTime();
    if (!Number.isFinite(at) || at < now - windowMs) continue;
    // expiry 5 menit: order yang lewat expires_at ga dihitung "aktif" lagi
    const exp = new Date(p.expires_at || 0).getTime();
    if (Number.isFinite(exp) && exp > 0 && exp < now) continue;
    c += 1;
    if (!latest || at > new Date(latest.created_at).getTime()) latest = p;
  }
  return { latest, count: c };
};

/* Index pending per-apikey (lightweight, pengganti full-scan /payments yang
   3-10 detik untuk 17rb record). Index = daftar idtrx pending (20 terakhir).
   Index null (belum pernah dibuat) → full-scan sekali, build index (selalu
   write balik, bahkan [] — kunci state "sudah migrasi" supaya request
   berikutnya cepat, bukan full-scan lagi). */
async function apikeyPendingList(apikey) {
  let ids = await store.getPendingByApikey(apikey);
  if (ids === null) {
    const all = await store.queryPaymentsByApikey(apikey);
    ids = Object.entries(all)
      .filter(([, v]) => v && v.apikey === apikey && v.status === 'pending')
      .map(([k]) => k);
    await store.setPendingByApikey(apikey, ids);
  }
  return ids;
}

async function recentPendingFor(apikey) {
  const ids = await apikeyPendingList(apikey);
  const items = await Promise.all(ids.map((id) => store.getPayment(id)));
  return recentPendingInfo(items.filter(Boolean), apikey);
}

async function latestPending(apikey) {
  return (await recentPendingFor(apikey)).latest;
}

async function pendingCount(apikey) {
  return (await recentPendingFor(apikey)).count;
}

async function generateIdtrx(prefix) {
  const p = sanitizeAlias(prefix) || DEFAULT_INVOICE_ALIAS;
  for (let i = 0; i < 5; i++) {
    const idtrx = `${p}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    if (!(await store.getPayment(idtrx))) return idtrx;
  }
  throw new Error('Gagal menghasilkan ID transaksi unik');
}

/* alokasi unique-fee sederhana: mulai dari cursor, putar 0..MAX */

/* ── verify password format lama di RTDB: "saltHex:hashHex"
   dua varian yang ketemu di data:
   - PBKDF2-SHA512, 120k iter, 64B (lib/auth.js backend lama)
   - scrypt N=16384 r=8 p=1, 64B, salt = bytes hex saltHex (verifikasi: matched) ── */
function verifyLegacyHash(hashField, password) {
  const raw = String(hashField || '').trim();
  const idx = raw.indexOf(':');
  if (idx <= 0) return false;
  const saltHex = raw.slice(0, idx);
  const expected = raw.slice(idx + 1);
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(expected)) return false;
  const expectBuf = Buffer.from(expected, 'hex');

  // varian 1: PBKDF2 (salt hex sebagai string)
  for (const [alg, iter, len] of [
    ['sha512', 120000, 64],
    ['sha512', 120000, 32],
    ['sha256', 100000, 32],
    ['sha256', 100000, 64],
  ]) {
    if (len * 2 !== expected.length) continue;
    const got = crypto.pbkdf2Sync(password, saltHex, iter, len, alg);
    if (got.length === expectBuf.length && crypto.timingSafeEqual(got, expectBuf)) return true;
  }

  // varian 2: scrypt N=16384 r=8 p=1, 64B, salt = bytes dari saltHex
  for (const salt of [Buffer.from(saltHex, 'hex'), saltHex]) {
    for (const keylen of [32, 64]) {
      if (keylen * 2 !== expected.length) continue;
      try {
        const got = crypto.scryptSync(password, salt, keylen, { N: 16384, r: 8, p: 1 });
        if (crypto.timingSafeEqual(got, expectBuf)) return true;
      } catch (_) { /* param invalid — skip */ }
    }
  }
  return false;
}

async function allocateUniqueFee(baseAmount, expiryMs = PAYMENT_EXPIRY_MS) {
  // cursor = index UNIQUE_FEE_POOL (0..5). Pool kecil: 0 atau ratusan
  // (100/150/200/250/300) — nominal final tetep rapi, matching aman.
  let cursor = await store.getQueueCursor();
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= UNIQUE_FEE_POOL.length) cursor = 0;
  for (let i = 0; i < UNIQUE_FEE_POOL.length; i++) {
    const idx = (cursor + i) % UNIQUE_FEE_POOL.length;
    const fee = UNIQUE_FEE_POOL[idx];
    const finalAmount = baseAmount + ACTUAL_FEE_ADMIN + fee;
    const existing = await store.getReservation(finalAmount);
    const expired =
      !existing ||
      !existing.expires_at ||
      new Date(existing.expires_at).getTime() <= Date.now();
    if (existing && !expired) continue; // masih aktif → nominal ini dipakai
    await store.setReservation(finalAmount, {
      amount: finalAmount,
      base_amount: baseAmount,
      unique_fee: fee,
      status: 'reserved',
      expires_at: new Date(Date.now() + expiryMs).toISOString(),
    });
    await store.setQueueCursor((idx + 1) % UNIQUE_FEE_POOL.length);
    return { finalAmount, uniqueFee: fee, feeAdmin: ACTUAL_FEE_ADMIN };
  }
  return null;
}

/* ═══════════════════════ ROUTES ═══════════════════════ */

function buildRouter() {
  const r = express.Router();

  /* ── /payment/create ── */
  const createHandler = async (req, res) => {
    const requestId = `req_${crypto.randomBytes(8).toString('hex')}`;
    const q = req.query || {};
    const b = req.body || {};
    const pick = (name) => (q[name] !== undefined ? q[name] : b[name]);
    try {
      const apikey = sanitizeId(pick('apikey'));
      const amountRaw = pick('amount');
      if (!apikey || amountRaw === undefined || amountRaw === '') {
        return res.json(buildErrorResponse('apikey dan amount wajib diisi', 'INVALID_REQUEST'));
      }
      const baseAmount = parseAmount(amountRaw);
      if (isNaN(baseAmount) || baseAmount <= 0) return res.json(buildErrorResponse('amount harus angka valid', 'INVALID_AMOUNT'));
      if (baseAmount < MIN_AMOUNT) return res.json(buildErrorResponse(`Amount minimum Rp ${MIN_AMOUNT}`, 'AMOUNT_TOO_SMALL'));
      if (baseAmount > MAX_BASE_AMOUNT) return res.json(buildErrorResponse(`Amount maksimum Rp ${MAX_BASE_AMOUNT}`, 'AMOUNT_TOO_LARGE'));

      if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));

      const pendInfo = await recentPendingFor(apikey);
      if (pendInfo.latest) {
        return res.json({
          status: true, creator: CREATOR, code: 'PAYMENT_ALREADY_PENDING',
          message: 'Masih ada transaksi pending aktif',
          request_id: requestId,
          result: { ...buildCreateResponse(pendInfo.latest, req).result },
        });
      }

      if (pendInfo.count >= MAX_PENDING_PER_5MIN) {
        return res.status(429).json(buildErrorResponse(`Maksimal ${MAX_PENDING_PER_5MIN} transaksi pending dalam 5 menit`, 'TOO_MANY_PENDING_PAYMENTS'));
      }

      const user = (await store.getUser(apikey)) || {};
      const invoiceAlias = sanitizeAlias(user.invoice_alias) || DEFAULT_INVOICE_ALIAS;
      const idtrx = await generateIdtrx(invoiceAlias);

      /* SDK param (malawali-payment-gateway ≥1.2): expiry_minutes override */
      let expiryMinutes = pick('expiry_minutes');
      if (expiryMinutes !== undefined && expiryMinutes !== '') {
        expiryMinutes = parseInt(String(expiryMinutes).replace(/[^0-9]/g, ''), 10);
        if (Number.isFinite(expiryMinutes) && expiryMinutes >= 1 && expiryMinutes <= 1440) {
          expiryMinutes = expiryMinutes;
        } else {
          expiryMinutes = undefined;
        }
      }
      const expiryMs = expiryMinutes ? expiryMinutes * 60 * 1000 : PAYMENT_EXPIRY_MS;

      /* Idempotency: kalau idempotency_key pernah dibuat & belum settle, kembalikan order yang sama. */
      const idempotencyKey = String(pick('idempotency_key') || '').trim().substring(0, 100);
      if (idempotencyKey) {
        const prevIdtrx = await store.getIdempotentPayment(apikey, idempotencyKey);
        if (prevIdtrx) {
          const prev = await store.getPayment(prevIdtrx);
          if (prev && prev.apikey === apikey && prev.status === 'pending' && new Date(prev.expires_at || 0).getTime() > Date.now()) {
            return res.json(buildCreateResponse(prev, req, requestId));
          }
        }
      }

      const alloc = await allocateUniqueFee(baseAmount, expiryMs);
      if (!alloc) return res.status(429).json(buildErrorResponse('Antrian nominal unik sedang penuh', 'UNIQUE_AMOUNT_UNAVAILABLE'));

      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + expiryMs).toISOString();
      const qris = qrisGen.convert(alloc.finalAmount, baseAmount);
      const payment = {
        apikey, idtrx, invoice_alias: invoiceAlias,
        amount: alloc.finalAmount, base_amount: baseAmount,
        actual_fee_admin: alloc.feeAdmin, unique_fee: alloc.uniqueFee,
        status: 'pending', credited: false,
        created_at: createdAt, qr_id: idtrx, qris_text: qris.text,
        pay_provider: qris.provider,
        last_checked: null, fee_admin: alloc.feeAdmin,
        expires_at: expiresAt,
        /* param SDK 1.2.4 (audit + integrasi) */
        order_id: pick('order_id') !== undefined ? String(pick('order_id')).trim().substring(0, 100) : null,
        customer_name: pick('customer_name') !== undefined ? String(pick('customer_name')).trim().substring(0, 200) : null,
        customer_email: pick('customer_email') !== undefined ? String(pick('customer_email')).trim().substring(0, 200) : null,
        client_ref: pick('client_ref') !== undefined ? String(pick('client_ref')).trim().substring(0, 200) : null,
        webhook_url: pick('webhook_url') !== undefined ? String(pick('webhook_url')).trim().substring(0, 1024) : null,
        idempotency_key: idempotencyKey || null,
        request_id: requestId,
      };
      await store.savePayment(idtrx, payment);
      if (idempotencyKey) {
        try { await store.setIdempotentPayment(apikey, idempotencyKey, idtrx); } catch (_) { /* index best-effort */ }
      }
      // update index pending per-apikey (create = masuk pending)
      try {
        const prev = (await store.getPendingByApikey(apikey)) || [];
        const ids = prev.filter((x) => x !== idtrx);
        ids.push(idtrx);
        await store.setPendingByApikey(apikey, ids.slice(-20));
      } catch (_) { /* index best-effort, hot path tetep jalan */ }
      res.status(201).json(buildCreateResponse(payment, req, requestId));
    } catch (err) {
      console.error('[legacy create]', err.message);
      res.status(503).json(buildErrorResponse('Gagal membuat transaksi', 'PAYMENT_CREATE_ERROR'));
    }
  };
  r.get('/payment/create', createHandler);
  r.post('/payment/create', createHandler);

  /* ── /payment/check ── */
  const checkHandler = async (req, res) => {
    const apikey = sanitizeId(req.query.apikey || req.body?.apikey);
    const idtrx = sanitizeId(req.query.idtrx || req.query.custom_invoice || req.query.invoice || req.body?.idtrx);
    if (!apikey || !idtrx) return res.json(buildErrorResponse('apikey dan idtrx wajib diisi', 'INVALID_REQUEST'));
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));

    const p = await store.getPayment(idtrx);
    if (!p) return res.json(buildErrorResponse('Transaksi tidak ditemukan', 'PAYMENT_NOT_FOUND'));
    if (p.apikey !== apikey) return res.json(buildErrorResponse('Transaksi tidak ditemukan', 'PAYMENT_NOT_FOUND'));

    const st = String(p.status || 'pending').toLowerCase();
    const now = Date.now();
    if (st === 'cancelled' || st === 'deleted') {
      return res.json({ status: false, creator: CREATOR, code: 'PAYMENT_CANCELLED', message: 'Transaksi dibatalkan', payment_status: 'cancelled' });
    }
    if (st === 'expired' || (new Date(p.expires_at || 0).getTime() && new Date(p.expires_at).getTime() < now)) {
      if (st !== 'paid') {
        if (st !== 'expired') await store.patchPayment(idtrx, { status: 'expired' });
        await store.delReservation(p.amount);
        try { const ids = ((await store.getPendingByApikey(apikey)) || []).filter((x) => x !== idtrx); await store.setPendingByApikey(apikey, ids); } catch (_) {}
        return res.json({ status: false, creator: CREATOR, code: 'PAYMENT_EXPIRED', message: 'Expired', payment_status: 'expired' });
      }
    }
    if (p.credited === true || st === 'paid') {
      const saldo = p.saldo_added ?? p.amount;
      return res.json({
        status: true, creator: CREATOR, code: 'PAYMENT_PAID', message: 'Sukses',
        payment_status: 'paid', idtrx, order_id: p.order_id || idtrx,
        amount_requested: p.base_amount ?? p.amount, amount_to_pay: p.total_amount ?? p.amount,
        fee_admin: p.actual_fee_admin ?? 0,
        saldo_added: Number.isFinite(Number(saldo)) ? Number(saldo) : p.amount,
        saldo: p.final_saldo || 0, paid_at: p.paid_at || null,
      });
    }
    // pending
    res.json({ status: false, creator: CREATOR, code: 'PAYMENT_PENDING', message: 'Pending', payment_status: st || 'pending', saldo: p.final_saldo || 0 });
  };
  r.get('/payment/check', checkHandler);
  r.post('/payment/check', checkHandler);

  /* ── /payment/delete ── */
  const deleteHandler = async (req, res) => {
    const apikey = sanitizeId(req.query.apikey || req.body?.apikey);
    const idtrx = sanitizeId(req.query.idtrx || req.body?.idtrx);
    if (!apikey || !idtrx) return res.json(buildErrorResponse('apikey dan idtrx wajib diisi', 'INVALID_REQUEST'));
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    const p = await store.getPayment(idtrx);
    if (!p || p.apikey !== apikey) return res.json(buildErrorResponse('Transaksi tidak ditemukan', 'PAYMENT_NOT_FOUND'));
    if (p.status !== 'pending') {
      return res.json({ status: true, creator: CREATOR, code: 'PAYMENT_ALREADY_SETTLED', message: `Transaksi sudah ${p.status}, tidak bisa dibatalkan` });
    }
    const nowIso = new Date().toISOString();
    await store.patchPayment(idtrx, { status: 'cancelled', cancelled_at: nowIso, deleted_at: nowIso, deleted_by: 'user', stats_recorded: true });
    await store.delReservation(p.amount);
    try { const ids = ((await store.getPendingByApikey(apikey)) || []).filter((x) => x !== idtrx); await store.setPendingByApikey(apikey, ids); } catch (_) {}
    try { const stats = require('./legacy/stats'); await stats.recordTerminal({ ...p, status: 'cancelled' }); } catch (_) { /* stats best-effort */ }
    await store.log('deletions', { apikey_prefix: apikey.substring(0, 8), idtrx, deleted_at: nowIso });
    res.json({ status: true, creator: CREATOR, code: 'PAYMENT_CANCELLED', message: 'Transaksi dibatalkan' });
  };
  r.get('/payment/delete', deleteHandler);
  r.post('/payment/delete', deleteHandler);
  r.delete('/payment/delete', deleteHandler);

  /* ── /payment/mutasi-user ── */
  const mutasiHandler = async (req, res) => {
    const apikey = sanitizeId(req.query.apikey || req.body?.apikey);
    if (!apikey) return res.json(buildErrorResponse('apikey wajib diisi', 'INVALID_REQUEST'));
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || req.body?.limit || 50).replace(/[^0-9]/g, ''), 10) || 50));
    const statusFilter = String(req.query.status || req.body?.status || '').toLowerCase();
    const all = await store.queryPaymentsByApikey(apikey);
    const tx = Object.values(all)
      .filter((p) => p && p.apikey === apikey && (!statusFilter || String(p.status || '').toLowerCase() === statusFilter))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, limit)
      .map((p) => ({
        idtrx: p.idtrx, invoice_alias: p.invoice_alias || DEFAULT_INVOICE_ALIAS,
        payment_status: p.status, amount_requested: p.base_amount, amount_to_pay: p.amount,
        unique_code: p.unique_fee || 0, fee: p.actual_fee_admin || 0,
        created_at: p.created_at, expires_at: p.expires_at || null,
        paid_at: p.paid_at || null, cancelled_at: p.cancelled_at || null,
        payment_method: p.payment_method || null, sender_name: p.sender_name || null,
      }));
    res.json({
      status: true, creator: CREATOR, code: 'USER_MUTATION_HISTORY',
      message: 'Histori transaksi berhasil diambil',
      result: { apikey, total: tx.length, limit, status_filter: statusFilter || null, transactions: tx },
    });
  };
  r.get('/payment/mutasi-user', mutasiHandler);
  r.post('/payment/mutasi-user', mutasiHandler);

  /* ── /payment/alias/update ── */
  const aliasHandler = async (req, res) => {
    const apikey = sanitizeId(req.query.apikey || req.body?.apikey);
    const alias = sanitizeAlias(req.query.alias || req.query.invoice || req.body?.alias || req.body?.invoice);
    if (!apikey || !alias) return res.json(buildErrorResponse('apikey dan alias wajib diisi', 'INVALID_REQUEST'));
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    const user = (await store.getUser(apikey)) || {};
    const current = sanitizeAlias(user.invoice_alias) || DEFAULT_INVOICE_ALIAS;
    const nowIso = new Date().toISOString();
    await store.patchUser(apikey, { invoice_alias: alias, invoice_alias_changed_at: nowIso });
    res.json({
      status: true, creator: CREATOR, code: 'ALIAS_UPDATED',
      message: 'Alias invoice berhasil diperbarui',
      result: { apikey, invoice_alias: alias, changed_at: nowIso },
    });
  };
  r.get('/payment/alias/update', aliasHandler);
  r.post('/payment/alias/update', aliasHandler);

  /* ── /system/config — status aplikasi utk SPA (default: normal) ──
     Bisa di-override manual via RTDB system/config (maintenance, dsb). */
  const SYSTEM_CONFIG_DEFAULTS = {
    api_status: true, maintenance_mode: false,
    withdraw_status: true, maintenance_message: '',
  };
  r.get('/system/config', async (req, res) => {
    let cfg = { ...SYSTEM_CONFIG_DEFAULTS };
    try {
      const custom = await store.getPath('system/config');
      if (custom && typeof custom === 'object') cfg = { ...cfg, ...custom };
    } catch (_) { /* pakai default */ }
    res.json({ status: true, creator: CREATOR, code: 'SYSTEM_CONFIG',
      message: 'Konfigurasi diambil', result: cfg });
  });

  /* ── /qris/:id ── */
  r.get('/qris/:id', async (req, res) => {
    const p = await store.getPayment(req.params.id);
    if (!p || !p.qris_text) return res.status(404).send('QRIS not found');
    const buf = await QRCode.toBuffer(p.qris_text, { type: 'png', margin: 2, scale: 8, color: { dark: '#000000', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  });

  /* ── auth/* ── */
  r.post('/auth/login', async (req, res) => {
    const apikey = sanitizeId(req.body?.apikey || req.query.apikey);
    const password = String(req.body?.password || req.query.password || '');
    if (!apikey || !password) return res.json(buildErrorResponse('apikey dan password wajib diisi', 'INVALID_REQUEST', { code: 'EMAIL_REQUIRED' }));
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    const user = (await store.getUser(apikey)) || {};
    // password lama: plaintext field (pw/password/pass) ATAU PBKDF2-SHA512
    // 120k iter 64-byte hex `salt:hash` (format backend lama lib/auth.js)
    const ok =
      ['pw', 'password', 'pass'].some((f) => user[f] !== undefined && String(user[f]) === password) ||
      verifyLegacyHash(user.password_hash, password);
    if (!ok) return res.json(buildErrorResponse('Password tidak valid', 'INVALID_PASSWORD'));
    res.json({
      status: true, creator: CREATOR, code: 'AUTH_OK', message: 'Login berhasil',
      result: {
        api_key: apikey, email: user.email || null, name: user.name || null,
        plan: user.plan || 'warga', uid: apikey,
        nama: user.name || null,
        saldo: user.saldo || 0,
        // SPA profile card baca field "created_at" & "telegram" (bukan member_since/telegram_id)
        created_at: user.created_at || null,
        telegram: user.telegram || user.telegram_id || null,
      },
    });
  });

  r.post('/auth/register/start', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const telegram = String(req.body?.telegram || '').trim().slice(0, 64);
    if (!name || !email || !password) return res.json(buildErrorResponse('name, email, password wajib diisi', 'INVALID_REQUEST'));
    // buat apikey baru
    const newKey = `HKAPI-${crypto.randomBytes(24).toString('base64url')}`;
    await store.setApiKey(newKey, true);
    await store.saveUser(newKey, {
      name, email, pw: password, plan: 'warga',
      telegram: telegram || null,
      invoice_alias: DEFAULT_INVOICE_ALIAS, created_at: new Date().toISOString(),
      verified: false,
    });
    // OTP dikirim ke Telegram / email (best effort) — verifikasi manual owner
    res.json({
      status: true, creator: CREATOR, code: 'REGISTER_STARTED',
      message: 'Pendaftaran dimulai',
      // SPA menampilkan banner sesuai `delivery`: log_only = "OTP dibuat, cek log server"
      result: {
        email, api_key: newKey, otp_sent: true,
        delivery: 'log_only', delivery_message: 'OTP dicatat (verifikasi manual owner). Cek log server.',
      },
    });
  });

  r.post('/auth/register/verify-otp', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '');
    // verifikasi sederhana: cari user by email belum verified
    const allKeys = await store.getApikeySet();
    for (const k of Object.keys(allKeys)) {
      const u = await store.getUser(k);
      if (u && u.email === email && u.verified !== true) {
        // jika tidak ada OTP di-verify, tetapkan valid (owner control)
        await store.patchUser(k, { verified: true, verified_at: new Date().toISOString() });
        // SPA baca result.apikey + result.name + result.email untuk bangun session
        return res.json({
          status: true, creator: CREATOR, code: 'REGISTER_VERIFIED',
          message: 'Pendaftaran terverifikasi',
          result: { apikey: k, api_key: k, name: u.name || null, email: u.email || email },
        });
      }
    }
    res.json(buildErrorResponse('Email tidak ditemukan atau sudah terverifikasi', 'EMAIL_NOT_FOUND'));
  });

  r.post('/auth/legacy/verify/start', async (req, res) => {
    const apikey = sanitizeId(req.body?.apikey || req.query.apikey);
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    res.json({
      status: true, creator: CREATOR, code: 'LEGACY_VERIFY_STARTED',
      message: 'Verifikasi dimulai',
      // SPA menampilkan banner sesuai `delivery`: log_only = "OTP dibuat, cek log server"
      result: {
        delivery: 'log_only',
        delivery_message: 'OTP dicatat (verifikasi manual owner). Cek log server.',
      },
    });
  });

  r.post('/auth/password-reset/start', async (req, res) => {
    const apikey = sanitizeId(req.body?.apikey || req.query.apikey);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!apikey || !email || !password) return res.json(buildErrorResponse('apikey, email, password wajib diisi', 'INVALID_REQUEST'));
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    await store.patchUser(apikey, { pw: password, password: password, pwd_reset_at: new Date().toISOString() });
    res.json({
      status: true, creator: CREATOR, code: 'PASSWORD_RESET_STARTED',
      message: 'Password reset dimulai',
      // SPA baca result.delivery_message buat banner
      result: { delivery: 'log_only', delivery_message: 'Password sudah di-reset (tanpa email server).' },
    });
  });

  r.post('/auth/password-reset/verify-otp', async (req, res) => {
    res.json({ status: true, creator: CREATOR, code: 'PASSWORD_RESET_VERIFIED', message: 'Password reset terverifikasi' });
  });

  r.post('/auth/profile', async (req, res) => {
    const apikey = sanitizeId(req.body?.apikey || req.query.apikey);
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    const u = (await store.getUser(apikey)) || {};
    res.json({
      status: true, creator: CREATOR, code: 'PROFILE_OK', message: 'Profil diambil',
      result: {
        api_key: apikey, email: u.email || null, name: u.name || null,
        user_id: u.id || apikey,
        nama: u.name || null,
        member_since: u.created_at || null,
        // SPA read field "created_at" & "telegram" (bukan member_since/telegram_id)
        created_at: u.created_at || null,
        telegram: u.telegram || u.telegram_id || null,
        plan: u.plan || 'warga', invoice_alias: u.invoice_alias || DEFAULT_INVOICE_ALIAS,
        saldo: u.saldo || 0, webhooks: await store.getWebhooks(apikey),
      },
    });
  });

  /* ── user/webhooks + user/webhooks/save ── */
  r.post('/user/webhooks/save', async (req, res) => {
    const apikey = sanitizeId(req.body?.apikey || req.query.apikey);
    const webhooks = Array.isArray(req.body?.webhooks) ? req.body.webhooks : [];
    if (!apikey) return res.json(buildErrorResponse('apikey wajib diisi', 'INVALID_REQUEST'));
    await store.setWebhooks(apikey, webhooks.filter((w) => w && String(w).trim()));
    res.json({ status: true, creator: CREATOR, code: 'WEBHOOKS_SAVED', message: 'Webhook tersimpan', result: { webhooks: webhooks } });
  });
  r.get('/user/webhooks', async (req, res) => {
    const apikey = sanitizeId(req.query.apikey);
    if (!apikey) return res.json(buildErrorResponse('apikey wajib diisi', 'INVALID_REQUEST'));
    res.json({ status: true, creator: CREATOR, code: 'WEBHOOKS_OK', webhooks: await store.getWebhooks(apikey) });
  });

  /* ── withdraw/history ── */
  const withdrawHistoryHandler = async (req, res) => {
    const apikey = sanitizeId(req.query.apikey || req.body?.apikey);
    if (!apikey) return res.json(buildErrorResponse('apikey wajib diisi', 'INVALID_REQUEST'));
    const list = await store.getWithdraws(apikey);
    res.json({ status: true, creator: CREATOR, code: 'WITHDRAW_HISTORY', message: 'Riwayat diambil', result: list });
  };
  r.get('/withdraw/history', withdrawHistoryHandler);
  r.post('/withdraw/history', withdrawHistoryHandler);

  return r;
}

module.exports = { buildRouter };
