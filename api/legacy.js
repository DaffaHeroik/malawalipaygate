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
const rateLimit = require('express-rate-limit');

const store = require('./legacy/store');
const qrisGen = require('./legacy/qris-gen');
const { buildErrorResponse, buildCreateResponse, CREATOR, DEFAULT_INVOICE_ALIAS } = require('./legacy/response');

/* ── konstanta (sama dengan backend lama) ── */
const MIN_AMOUNT = 100;
const MAX_BASE_AMOUNT = 10000000;
const ACTUAL_FEE_ADMIN = 0;
// Unique-fee: angka acak 1-150 rupiah (crypto.randomInt, bukan pool tetap
// dan bukan kelipatan 50). Total bayar = nominal dasar + fee acak;
// final amount di-reservasi supaya tidak tabrakan antar payment pending
// dengan nominal dasar yang sama.
const UNIQUE_FEE_MIN = 1;
const UNIQUE_FEE_MAX = 150;
const UNIQUE_FEE_MAX_ATTEMPTS = 20;
const PAYMENT_EXPIRY_MS = 5 * 60 * 1000;
// (S3: CREATE_COOLDOWN_MS dihapus — dead code, tidak pernah dipakai;
//  pembatasan request kini ditangani express-rate-limit di bawah.)
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

/* ── hash password baru: PBKDF2-SHA512, 120k iter, 64B ──
   Format sama dengan verifyLegacyHash: "saltHex:hashHex" (salt = hex string).
   Dipakai register + password-reset — JANGAN simpan plaintext lagi. ── */
function hashPassword(password) {
  const saltHex = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), saltHex, 120000, 64, 'sha512');
  return `${saltHex}:${hash.toString('hex')}`;
}

/* ── OTP sungguhan via Resend ──
   Register + reset password mengirim kode 6 digit ke email merchant.
   - Kode dibuat dengan crypto.randomInt, yang disimpan HANYA hash SHA-256
     (+ expiry 10 menit + hitung percobaan, maks 5) di record user Firebase.
   - Kirim via POST https://api.resend.com/emails (fetch bawaan Node, tanpa
     dependensi baru), pengirim noreply@malawalipayment.web.id (domain
     terverifikasi di akun Resend daffaheroik2020@gmail.com).
   - Kunci dibaca dari env RESEND_API_KEY, fallback file
     /root/hero-secrets/resend-api-key.txt (chmod 600) — JANGAN hardcode
     ke kode/repo. Kunci ini restricted "hanya kirim email" (tidak bisa
     baca domain/log via API — itu memang disengaja, least privilege).
   - OTP_TEST_MODE=1 (hanya untuk tes lokal): respons start/resend ikut
     menyertakan result.debug_otp supaya tes bisa verifikasi tanpa baca
     inbox. JANGAN PERNAH set di proses produksi (VPS) — kode OTP tidak
     boleh bocor lewat respons API. ── */
const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = Number(process.env.OTP_EXPIRY_MS || 10 * 60 * 1000); // 10 menit (override env hanya untuk tes)
const OTP_MAX_ATTEMPTS = 5;
const OTP_FROM = 'Malawali Payment <noreply@malawalipayment.web.id>';
const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_KEY_FILE = '/root/hero-secrets/resend-api-key.txt';

let resendKeyCache = null; // null = belum dicoba; '' = tidak ada
function getResendKey() {
  if (resendKeyCache !== null) return resendKeyCache;
  if (process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim()) {
    resendKeyCache = String(process.env.RESEND_API_KEY).trim();
    return resendKeyCache;
  }
  try {
    resendKeyCache = require('fs').readFileSync(RESEND_KEY_FILE, 'utf8').trim();
  } catch (_) { resendKeyCache = ''; }
  return resendKeyCache;
}

function generateOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(OTP_LENGTH, '0');
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function otpCodeMatches(code, hash) {
  const a = Buffer.from(hashOtp(code), 'utf8');
  const b = Buffer.from(String(hash || ''), 'utf8');
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (_) { return false; }
}

async function sendOtpEmail(to, code, purpose) {
  const key = getResendKey();
  if (!key) return { ok: false, error: 'EMAIL_NOT_CONFIGURED' };
  const isReset = purpose === 'reset';
  const subject = isReset
    ? 'Kode reset password Malawali Payment'
    : 'Kode verifikasi Malawali Payment';
  const text =
    `Kode ${isReset ? 'reset password' : 'verifikasi'} Malawali Payment Anda: ${code}\n\n` +
    'Kode berlaku 10 menit. Jangan berikan kode ini kepada siapa pun, termasuk yang mengaku dari Malawali Payment.';
  const html =
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">` +
    `<h2 style="margin:0 0 8px">Malawali Payment</h2>` +
    `<p>Kode ${isReset ? 'reset password' : 'verifikasi'} Anda:</p>` +
    `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:8px 0">${code}</p>` +
    `<p style="color:#555">Kode berlaku 10 menit. Jangan berikan kode ini kepada siapa pun.</p>` +
    `</div>`;
  try {
    const resp = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: OTP_FROM, to: [to], subject, html, text }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('[otp] Resend error', resp.status, (data && (data.message || data.name)) || '');
      return { ok: false, error: 'EMAIL_SEND_FAILED' };
    }
    return { ok: true, emailId: data && data.id ? String(data.id) : null };
  } catch (e) {
    console.error('[otp] Resend fetch error', (e && e.message) || e);
    return { ok: false, error: 'EMAIL_SEND_FAILED' };
  }
}

/* Buat + simpan OTP baru untuk user (hash + expiry + reset percobaan).
   Mengembalikan kode plaintext — pemanggil WAJIB hanya memakainya untuk
   dikirim via email (atau result.debug_otp saat OTP_TEST_MODE), jangan
   pernah me-log atau menyimpannya. */
async function issueOtp(apikey, purpose) {
  const code = generateOtpCode();
  const now = Date.now();
  await store.patchUser(apikey, {
    otp_hash: hashOtp(code),
    otp_expires_at: new Date(now + OTP_EXPIRY_MS).toISOString(),
    otp_attempts: 0,
    otp_purpose: purpose,
    otp_issued_at: new Date(now).toISOString(),
  });
  return code;
}

async function clearOtp(apikey) {
  await store.patchUser(apikey, {
    otp_hash: null, otp_expires_at: null, otp_attempts: null,
    otp_purpose: null, otp_issued_at: null,
  });
}

/* Cek kode OTP user. Setiap percobaan salah menambah otp_attempts.
   Return {ok:true} atau {ok:false, code, message}. */
async function checkOtp(apikey, code, purpose) {
  const u = (await store.getUser(apikey)) || {};
  if (!u.otp_hash || !u.otp_expires_at) {
    return { ok: false, code: 'NO_OTP', message: 'Tidak ada kode OTP yang aktif — minta kode baru' };
  }
  if (u.otp_purpose && u.otp_purpose !== purpose) {
    return { ok: false, code: 'NO_OTP', message: 'Kode OTP tidak berlaku untuk alur ini — minta kode baru' };
  }
  if ((u.otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    return { ok: false, code: 'OTP_TOO_MANY_ATTEMPTS', message: 'Terlalu banyak percobaan salah — minta kode baru' };
  }
  if (new Date(u.otp_expires_at).getTime() <= Date.now()) {
    return { ok: false, code: 'OTP_EXPIRED', message: 'Kode OTP sudah kedaluwarsa — minta kode baru' };
  }
  if (!otpCodeMatches(code, u.otp_hash)) {
    const attempts = (u.otp_attempts || 0) + 1;
    await store.patchUser(apikey, { otp_attempts: attempts });
    const left = OTP_MAX_ATTEMPTS - attempts;
    return {
      ok: false, code: 'INVALID_OTP',
      message: left > 0
        ? `Kode OTP salah — ${left} percobaan tersisa`
        : 'Kode OTP salah — terlalu banyak percobaan, minta kode baru',
    };
  }
  return { ok: true };
}

/* Cari apikey user berdasarkan email (dipakai verify-otp register yang
   hanya menerima email + otp, sesuai panggilan SPA). */
async function findApikeyByEmail(email) {
  const allKeys = await store.getApikeySet();
  for (const k of Object.keys(allKeys)) {
    const u = await store.getUser(k);
    if (u && u.email && String(u.email).toLowerCase() === email) return k;
  }
  return null;
}

async function allocateUniqueFee(baseAmount, expiryMs = PAYMENT_EXPIRY_MS) {
  // Fee acak 1-150 (crypto.randomInt, batas atas eksklusif → +1).
  // Kalau final amount sudah ter-reservasi dan masih aktif, acak ulang
  // sampai max percobaan; kalau tetap tidak dapat → null (429
  // UNIQUE_AMOUNT_UNAVAILABLE di pemanggil).
  for (let attempt = 0; attempt < UNIQUE_FEE_MAX_ATTEMPTS; attempt++) {
    const fee = crypto.randomInt(UNIQUE_FEE_MIN, UNIQUE_FEE_MAX + 1);
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
    return { finalAmount, uniqueFee: fee, feeAdmin: ACTUAL_FEE_ADMIN };
  }
  return null;
}

/* ═══════════════════════ ROUTES ═══════════════════════ */

function buildRouter() {
  const r = express.Router();

  /* ── S3: rate limit (express-rate-limit sudah terinstall sejak lama tapi
     tidak pernah dipakai di rute mana pun). Diterapkan HANYA ke rute auth
     sensitif + /payment/create — webhook masuk (/webhook/:provider,
     /api/listener/push, /api/pending) ada di router detect dan TIDAK ikut
     ter-limit, begitu juga go-mutasi-poller. `trust proxy` sudah 1 di
     vercel/entry.js (Cloudflare Tunnel), jadi req.ip = IP klien asli.
     Counter in-memory per proses (malawali-gw 1 proses → batas efektif
     20/menit/IP untuk auth, 30/menit/IP untuk create). ── */
  const rateLimitHandler = (req, res) => res.status(429).json(
    buildErrorResponse('Terlalu banyak permintaan, coba lagi sebentar', 'TOO_MANY_REQUESTS'));
  // Kunci limiter: IP klien ASLI, bukan IP edge Cloudflare. `trust proxy` di
  // entry.js = 1, tapi rantai ke :3100 ada 2 hop (edge Cloudflare →
  // cloudflared → app), sehingga req.ip jatuh ke IP edge — semua klien yang
  // lewat satu edge berbagi satu budget, dan satu penyerang bisa dapat
  // budget per edge. cloudflared meneruskan CF-Connecting-IP yang di-set
  // edge Cloudflare (tidak bisa di-spoof lewat tunnel — edge menimpanya
  // dengan IP koneksi asli), jadi itu kunci yang benar; fallback req.ip
  // kalau header tidak ada (mis. akses langsung / Vercel).
  const clientIpKey = (req) => {
    const cf = String(req.get('cf-connecting-ip') || '').trim();
    if (/^[0-9a-fA-F:.]+$/.test(cf)) return `cf:${cf}`;
    return req.ip;
  };
  const authLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 20,
    standardHeaders: 'draft-7', legacyHeaders: false,
    handler: rateLimitHandler, keyGenerator: clientIpKey,
  });
  const createLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 30,
    standardHeaders: 'draft-7', legacyHeaders: false,
    handler: rateLimitHandler, keyGenerator: clientIpKey,
  });

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
  r.get('/payment/create', createLimiter, createHandler);
  r.post('/payment/create', createLimiter, createHandler);

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
        order_id: p.order_id || null, client_ref: p.client_ref || null,
        customer_name: p.customer_name || null, customer_email: p.customer_email || null,
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
  // S3: /auth/profile TIDAK di-limit (baca dashboard, sudah butuh apikey
  // valid); yang di-limit hanya rute sensitif (login/register/reset).
  r.post('/auth/login', authLimiter, async (req, res) => {
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
    // Migrasi oportunistik: user lama yang masih simpan plaintext (pw/password/pass)
    // di-hash sekarang + plaintext dihapus, supaya makin lama makin bersih.
    // Login sudah berhasil (password cocok), jadi hash ini pasti benar.
    if (['pw', 'password', 'pass'].some((f) => user[f] !== undefined && user[f] !== null)) {
      try {
        await store.patchUser(apikey, { password_hash: hashPassword(password), pw: null, password: null, pass: null });
      } catch (_) { /* migrasi best-effort; login tetap berhasil */ }
    }
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

  r.post('/auth/register/start', authLimiter, async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const telegram = String(req.body?.telegram || '').trim().slice(0, 64);
    if (!name || !email || !password) return res.json(buildErrorResponse('name, email, password wajib diisi', 'INVALID_REQUEST'));
    // buat apikey baru
    const newKey = `HKAPI-${crypto.randomBytes(24).toString('base64url')}`;
    await store.setApiKey(newKey, true);
    // OTP sungguhan via Resend: akun dibuat BELUM terverifikasi; kode 6
    // digit dikirim ke email merchant (hash + expiry 10 mnt + maks 5
    // percobaan disimpan di record user). Akun baru aktif (verified:true)
    // setelah kode benar di /auth/register/verify-otp.
    await store.saveUser(newKey, {
      name, email, password_hash: hashPassword(password), plan: 'warga',
      telegram: telegram || null,
      invoice_alias: DEFAULT_INVOICE_ALIAS, created_at: new Date().toISOString(),
      verified: false,
    });
    const otpCode = await issueOtp(newKey, 'register');
    const sent = await sendOtpEmail(email, otpCode, 'register');
    if (!sent.ok) {
      // Akun sudah dibuat (belum terverifikasi) — user bisa minta kirim
      // ulang via /auth/register/resend-otp. SPA menampilkan pesan error.
      return res.json(buildErrorResponse(
        sent.error === 'EMAIL_NOT_CONFIGURED'
          ? 'Email server belum dikonfigurasi — hubungi owner'
          : 'Gagal mengirim kode OTP ke email — coba kirim ulang',
        sent.error,
        { result: { email, api_key: newKey, otp_sent: false, delivery: 'failed' } },
      ));
    }
    res.json({
      status: true, creator: CREATOR, code: 'REGISTER_STARTED',
      message: 'Pendaftaran dimulai',
      // SPA menampilkan banner sesuai `delivery` + `delivery_message`,
      // lalu pindah ke layar OTP. 'email' → banner sukses.
      result: {
        email, api_key: newKey, otp_sent: true,
        delivery: 'email',
        delivery_message: 'Kode OTP sudah dikirim ke email Anda (berlaku 10 menit).',
        email_id: sent.emailId || null,
        // HANYA saat OTP_TEST_MODE=1 (tes lokal): sertakan kode supaya tes
        // bisa verifikasi tanpa baca inbox. TIDAK PERNAH di produksi.
        ...(process.env.OTP_TEST_MODE === '1' ? { debug_otp: otpCode } : {}),
      },
    });
  });

  r.post('/auth/register/verify-otp', authLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    // OTP sungguhan: kode dicocokkan dengan hash yang disimpan saat
    // register/start (kedaluwarsa 10 mnt, maks 5 percobaan salah). Akun
    // baru verified:true setelah kode benar. Sudah terverifikasi →
    // kembalikan session (idempotent, mis. submit ganda).
    if (!email || !otp) return res.json(buildErrorResponse('email dan otp wajib diisi', 'INVALID_REQUEST'));
    const apikey = await findApikeyByEmail(email);
    if (!apikey) return res.json(buildErrorResponse('Email tidak ditemukan', 'EMAIL_NOT_FOUND'));
    const u = (await store.getUser(apikey)) || {};
    if (u.verified === true) {
      // SPA baca result.apikey + result.name + result.email untuk bangun session
      return res.json({
        status: true, creator: CREATOR, code: 'REGISTER_VERIFIED',
        message: 'Pendaftaran terverifikasi',
        result: { apikey, api_key: apikey, name: u.name || null, email: u.email || email },
      });
    }
    const check = await checkOtp(apikey, otp, 'register');
    if (!check.ok) return res.json(buildErrorResponse(check.message, check.code));
    await store.patchUser(apikey, {
      verified: true, verified_at: new Date().toISOString(), verified_by: 'otp-email',
    });
    await clearOtp(apikey);
    // SPA baca result.apikey + result.name + result.email untuk bangun session
    res.json({
      status: true, creator: CREATOR, code: 'REGISTER_VERIFIED',
      message: 'Pendaftaran terverifikasi',
      result: { apikey, api_key: apikey, name: u.name || null, email: u.email || email },
    });
  });

  // Kirim ulang kode OTP register (mis. email telat / salah ketik alamat
  // sudah tidak bisa — email terikat ke akun; endpoint ini untuk akun yang
  // belum terverifikasi). Ikut ter-limit authLimiter (20/mnt/IP).
  r.post('/auth/register/resend-otp', authLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.json(buildErrorResponse('email wajib diisi', 'INVALID_REQUEST'));
    const apikey = await findApikeyByEmail(email);
    if (!apikey) return res.json(buildErrorResponse('Email tidak ditemukan', 'EMAIL_NOT_FOUND'));
    const u = (await store.getUser(apikey)) || {};
    if (u.verified === true) {
      return res.json(buildErrorResponse('Akun sudah terverifikasi', 'ALREADY_VERIFIED'));
    }
    const otpCode = await issueOtp(apikey, 'register');
    const sent = await sendOtpEmail(email, otpCode, 'register');
    if (!sent.ok) {
      return res.json(buildErrorResponse(
        sent.error === 'EMAIL_NOT_CONFIGURED'
          ? 'Email server belum dikonfigurasi — hubungi owner'
          : 'Gagal mengirim kode OTP ke email — coba lagi sebentar',
        sent.error,
        { result: { email, otp_sent: false, delivery: 'failed' } },
      ));
    }
    res.json({
      status: true, creator: CREATOR, code: 'OTP_RESENT',
      message: 'Kode OTP dikirim ulang',
      result: {
        email, otp_sent: true, delivery: 'email',
        delivery_message: 'Kode OTP baru sudah dikirim ke email Anda (berlaku 10 menit).',
        email_id: sent.emailId || null,
        ...(process.env.OTP_TEST_MODE === '1' ? { debug_otp: otpCode } : {}),
      },
    });
  });

  r.post('/auth/legacy/verify/start', authLimiter, async (req, res) => {
    const apikey = sanitizeId(req.body?.apikey || req.query.apikey);
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    res.json({
      status: true, creator: CREATOR, code: 'LEGACY_VERIFY_STARTED',
      message: 'Verifikasi dimulai',
      // S1: tidak ada OTP — banner jujur (bukan klaim OTP).
      result: {
        delivery: 'none',
        delivery_message: 'Verifikasi manual oleh owner (tidak ada OTP).',
      },
    });
  });

  r.post('/auth/password-reset/start', authLimiter, async (req, res) => {
    const apikey = sanitizeId(req.body?.apikey || req.query.apikey);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const oldPassword = String(req.body?.old_password || req.body?.oldPassword || '');
    const password = String(req.body?.password || '');
    if (!apikey || !email || !oldPassword || !password) return res.json(buildErrorResponse('apikey, email, password lama dan password baru wajib diisi', 'INVALID_REQUEST'));
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    const user = (await store.getUser(apikey)) || {};
    // S2: email harus cocok dengan akun (dulu tidak dicek sama sekali).
    if (user.email && String(user.email).toLowerCase() !== email) {
      return res.json(buildErrorResponse('Email tidak cocok dengan akun ini', 'EMAIL_MISMATCH'));
    }
    // S2: WAJIB password lama — tanpa ini, siapa pun yang tahu apikey +
    // email bisa mengambil alih password dashboard merchant. Logika cek sama
    // dengan login (plaintext lama ATAU PBKDF2/scrypt `salt:hash`).
    // KONSEKUENSI: alur "Lupa Password" SPA (yang tidak punya field password
    // lama) tidak lagi bisa reset mandiri — kasus benar-benar lupa password
    // harus reset manual oleh owner. SPA perlu field password lama / halaman
    // "Ganti Password" terpisah (source SPA tidak ada di repo ini).
    const oldOk =
      ['pw', 'password', 'pass'].some((f) => user[f] !== undefined && String(user[f]) === oldPassword) ||
      verifyLegacyHash(user.password_hash, oldPassword);
    if (!oldOk) return res.json(buildErrorResponse('Password lama tidak valid', 'INVALID_OLD_PASSWORD'));
    // OTP reset: password BARU disimpan sebagai pending (hash) dan BARU
    // diterapkan setelah kode OTP benar di /password-reset/verify-otp.
    // Password lama tetap berlaku sampai verifikasi berhasil.
    await store.patchUser(apikey, {
      pending_password_hash: hashPassword(password),
      pwd_reset_requested_at: new Date().toISOString(),
    });
    const otpCode = await issueOtp(apikey, 'reset');
    const sent = await sendOtpEmail(email, otpCode, 'reset');
    if (!sent.ok) {
      await store.patchUser(apikey, { pending_password_hash: null, pwd_reset_requested_at: null });
      await clearOtp(apikey);
      return res.json(buildErrorResponse(
        sent.error === 'EMAIL_NOT_CONFIGURED'
          ? 'Email server belum dikonfigurasi — hubungi owner'
          : 'Gagal mengirim kode OTP ke email — coba lagi sebentar',
        sent.error,
        { result: { delivery: 'failed' } },
      ));
    }
    res.json({
      status: true, creator: CREATOR, code: 'PASSWORD_RESET_STARTED',
      message: 'Password reset dimulai',
      // SPA baca result.delivery_message buat banner, lalu pindah ke layar OTP.
      result: {
        otp_sent: true, delivery: 'email',
        delivery_message: 'Kode OTP reset password sudah dikirim ke email Anda (berlaku 10 menit).',
        email_id: sent.emailId || null,
        ...(process.env.OTP_TEST_MODE === '1' ? { debug_otp: otpCode } : {}),
      },
    });
  });

  r.post('/auth/password-reset/verify-otp', authLimiter, async (req, res) => {
    const apikey = sanitizeId(req.body?.apikey || req.query.apikey);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    // OTP sungguhan: kode dicocokkan dengan hash dari /password-reset/start
    // (kedaluwarsa 10 mnt, maks 5 percobaan). Baru setelah kode benar,
    // password pending diterapkan — password lama tetap berlaku sampai sini.
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    const u = (await store.getUser(apikey)) || {};
    if (!u || (email && u.email && String(u.email).toLowerCase() !== email)) {
      return res.json(buildErrorResponse('Akun tidak ditemukan', 'EMAIL_NOT_FOUND'));
    }
    if (!u.pending_password_hash) {
      return res.json(buildErrorResponse('Tidak ada reset password yang sedang berjalan', 'NO_RESET_IN_PROGRESS'));
    }
    if (!otp) return res.json(buildErrorResponse('otp wajib diisi', 'INVALID_REQUEST'));
    const check = await checkOtp(apikey, otp, 'reset');
    if (!check.ok) return res.json(buildErrorResponse(check.message, check.code));
    await store.patchUser(apikey, {
      password_hash: u.pending_password_hash,
      pw: null, password: null, pass: null,
      pending_password_hash: null,
      pwd_reset_at: new Date().toISOString(),
    });
    await clearOtp(apikey);
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
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    await store.setWebhooks(apikey, webhooks.filter((w) => w && String(w).trim()));
    res.json({ status: true, creator: CREATOR, code: 'WEBHOOKS_SAVED', message: 'Webhook tersimpan', result: { webhooks: webhooks } });
  });
  r.get('/user/webhooks', async (req, res) => {
    const apikey = sanitizeId(req.query.apikey);
    if (!apikey) return res.json(buildErrorResponse('apikey wajib diisi', 'INVALID_REQUEST'));
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    res.json({ status: true, creator: CREATOR, code: 'WEBHOOKS_OK', webhooks: await store.getWebhooks(apikey) });
  });

  /* ── withdraw/history ── */
  const withdrawHistoryHandler = async (req, res) => {
    const apikey = sanitizeId(req.query.apikey || req.body?.apikey);
    if (!apikey) return res.json(buildErrorResponse('apikey wajib diisi', 'INVALID_REQUEST'));
    if (!(await store.verifyApiKey(apikey))) return res.json(buildErrorResponse('APIKEY tidak valid', 'INVALID_APIKEY'));
    const list = await store.getWithdraws(apikey);
    res.json({ status: true, creator: CREATOR, code: 'WITHDRAW_HISTORY', message: 'Riwayat diambil', result: list });
  };
  r.get('/withdraw/history', withdrawHistoryHandler);
  r.post('/withdraw/history', withdrawHistoryHandler);

  return r;
}

module.exports = { buildRouter };
