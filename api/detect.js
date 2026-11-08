'use strict';

/**
 * Integrasi deteksi pembayaran (pengganti OrderKuota).
 *
 * Sumber pembayaran masuk:
 *  1. Webhook provider (Saweria/GoPay/DANA) → /webhook/:provider
 *  2. Malawali Listener (APK Android)       → /api/listener/push
 *  3. Cron sweeper order pending expired   → /cron/detect
 *
 * Setelah event diterima, cocokkan ke order pending (match by nominal +
 * window waktu + klaim sekali), tandai paid di store legacy, kirim
 * webhook merchant (best effort) + notifikasi Telegram (best effort).
 */

const express = require('express');
const crypto = require('crypto');
const dns = require('dns');

const store = require('./legacy/store');

const WEBHOOK_SECRET = String(process.env.LEGACY_WEBHOOK_SECRET || '').trim();
const ALLOWED_PROVIDERS = new Set(['saweria', 'gopay', 'dana']);

/* ── util keamanan ── */
const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

const PRIVATE_CIDRS = [
  { cidr: '0.0.0.0', mask: 8 }, { cidr: '10.0.0.0', mask: 8 },
  { cidr: '100.64.0.0', mask: 10 }, { cidr: '127.0.0.0', mask: 8 },
  { cidr: '169.254.0.0', mask: 16 }, { cidr: '172.16.0.0', mask: 12 },
  { cidr: '192.168.0.0', mask: 16 },
];

function ip4ToNum(ip) {
  return ip.split('.').reduce((n, o) => (n * 256n) + BigInt(o), 0n);
}

function isPrivateIp(ip) {
  if (ip === '::1' || ip === '::') return true;
  if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const ipNum = ip4ToNum(ip);
  for (const c of PRIVATE_CIDRS) {
    const netNum = ip4ToNum(c.cidr) & ~(2n ** BigInt(32 - c.mask) - 1n);
    if ((ipNum & netNum) === netNum) return true;
  }
  return false;
}

async function assertPublicHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const addrs = await dns.promises.lookup(host, { all: true });
  return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
}

/* fetch aman: wajib https, block target private/loopback/metadata (SSRF guard) */
async function safeFetch(url, opts = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !(await assertPublicHost(u.hostname))) {
    throw new Error('blocked: hanya https ke host publik');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ── matching: cari order pending yang nominalnya cocok & masih aktif ── */
async function matchPayment({ provider, providerTransactionId, amount, occurredAt = new Date(), raw = {}, userId = null }) {
  if (!provider || !providerTransactionId || !Number.isFinite(amount)) {
    return { matched: false, reason: 'invalid_payload' };
  }

  // klaim trans (unique) — pakai __claims__
  const claimKey = `${provider}:${providerTransactionId}`;
  const claimed = await store.getPath(`__claims__/${encodeURIComponent(claimKey)}`);
  if (claimed) return { matched: false, reason: 'already_claimed' };
  await store.setPath(`__claims__/${encodeURIComponent(claimKey)}`, { provider, providerTransactionId, at: occurredAt.toISOString() });

  const all = await store.pendingPayments();
  const now = occurredAt.getTime();
  const candidates = Object.values(all).filter(
    (p) =>
      p &&
      p.status === 'pending' &&
      Number(p.amount) === Math.round(amount) &&
      // order dibuat dgn provider routing (pay_provider) → wajib match,
      // order lama tanpa field → tetap bole (backward compat)
      (!p.pay_provider || p.pay_provider === provider) &&
      (!userId || p.apikey === userId)
  );

  for (const p of candidates) {
    const created = new Date(p.created_at).getTime();
    const expires = new Date(p.expires_at || created + 10 * 60 * 1000).getTime();
    if (now < created || now > expires) continue;

    // kreditkan saldo user — final_saldo = saldo sebelum + saldo_added
    let saldoBefore = 0;
    let finalSaldo = p.amount;
    if (p.apikey) {
      try {
        const u = (await store.getUser(p.apikey)) || {};
        saldoBefore = Number(u.saldo) || 0;
        finalSaldo = saldoBefore + p.amount;
        await store.patchUser(p.apikey, { saldo: finalSaldo });
      } catch (_) { /* saldo best-effort, jangan matikan matching */ }
    }

    const patch = {
      status: 'paid', credited: true, paid_at: occurredAt.toISOString(),
      payment_method: provider, sender_name: raw?.sender_name || null,
      bank_code: raw?.bank_code || null,
      provider_transaction_id: providerTransactionId,
      saldo_added: p.amount,
      final_saldo: finalSaldo,
    };
    await store.patchPayment(p.idtrx, patch);
    await store.delReservation(p.amount);
    // catat ke agregat bulanan admin SEBELUM data buyer bisa di-prune.
    // atomically: agregat bulan + flag stats_recorded ditulis ATOMIK
    // (ref().multi) — crash = dua-duanya belum ke-apply, aman re-record
    // tanpa double-count.
    try {
      const stats = require('./legacy/stats');
      await stats.recordTerminal({ ...p, ...patch, status: 'paid' }, { atomically: true });
    } catch (_) { /* stats best-effort, jangan matikan matching */ }
    // buang dari index pending per-apikey (kalau APIKEY-nya dikenal)
    if (p.apikey) {
      try {
        const ids = ((await store.getPendingByApikey(p.apikey)) || []).filter((x) => x !== p.idtrx);
        await store.setPendingByApikey(p.apikey, ids);
      } catch (_) { /* index best-effort */ }
    }

    await notifyMerchant(p, provider, providerTransactionId);
    await notifyTelegram(p, provider, providerTransactionId);

    return { matched: true, orderId: p.idtrx, providerTransactionId };
  }

  // ga ada order cocok → bebasin klaim supaya redelivery provider bisa nyoba lagi
  await store.setPath(`__claims__/${encodeURIComponent(claimKey)}`, null);
  return { matched: false, reason: 'no_matching_order' };
}

/* ── kirim webhook merchant (best effort) ── */
async function notifyMerchant(payment, provider, providerTransactionId) {
  try {
    const hooks = await store.getWebhooks(payment.apikey);
    for (const url of hooks) {
      if (!url || !/^https:\/\//.test(String(url).trim())) continue;
      try {
        await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'payment.paid',
            provider, provider_transaction_id: providerTransactionId,
            idtrx: payment.idtrx, amount: payment.amount,
            base_amount: payment.base_amount, paid_at: payment.paid_at,
          }),
        }).catch(() => {});
      } catch (_) { /* URL dip-block guard → skip */ }
    }
  } catch (_) { /* non-critical */ }
}

/* ── notifikasi Telegram owner (best effort) ── */
async function notifyTelegram(payment, provider, providerTransactionId) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chat) return;
  const text =
    `✅ Pembayaran diterima\n` +
    `Provider: ${provider}\n` +
    `TxRef: ${providerTransactionId}\n` +
    `IDTRX: ${payment.idtrx}\n` +
    `Nominal: Rp ${Number(payment.amount).toLocaleString('id-ID')}\n` +
    `APIKEY: ${String(payment.apikey).substring(0, 8)}…`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_notification: true }),
  }).catch(() => {});
}

/* ═══════════ ROUTER ═══════════ */
function buildRouter() {
  const r = express.Router();

  /* ── /webhook/:provider — pembayaran dari provider (Saweria/GoPay/DANA) ── */
  r.post('/webhook/:provider', async (req, res) => {
    const provider = String(req.params.provider || '').toLowerCase();
    if (!['saweria', 'gopay', 'dana'].includes(provider)) {
      return res.status(400).json({ ok: false, error: { code: 'unknown_provider', message: 'Provider tidak dikenal.' } });
    }
    const sig = String(req.get('x-signature') || req.get('x-webhook-signature') || '');
    if (WEBHOOK_SECRET) {
      // fail-closed: secret terpasang → signature WAJIB ada & valid
      // (HMAC-SHA256 LEGACY_WEBHOOK_SECRET atas JSON body, hex lowercase)
      if (!sig || !safeEqual(sig.toLowerCase(),
        crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(req.body || {})).digest('hex'))) {
        return res.status(401).json({ ok: false, error: { code: 'invalid_signature', message: 'Signature tidak valid.' } });
      }
    }

    const raw = req.body || {};
    // normalisasi antar-provider → { providerTransactionId, amount, occurredAt }
    const normalized = normalizeProviderPayload(provider, raw);
    if (!normalized.providerTransactionId || !Number.isFinite(normalized.amount)) {
      return res.status(400).json({ ok: false, error: { code: 'invalid_payload', message: 'Payload tidak bisa diproses.' } });
    }

    const result = await matchPayment({
      provider,
      providerTransactionId: normalized.providerTransactionId,
      amount: normalized.amount,
      occurredAt: normalized.occurredAt || new Date(),
      raw,
      userId: normalized.userId,
    });

    res.json({ ok: true, data: { matched: result.matched, order_id: result.orderId || null, reason: result.reason || null } });
  });

  /* ── /api/listener/push — pembayaran dari APK Malawali Listener ── */
  r.post('/api/listener/push', async (req, res) => {
    // Auth: APK wajib bawa LEGACY_LISTENER_TOKEN (header x-listener-token).
    // Kalau token belum dikonfigurasi, fallback ke require userId/apikey valid
    // di store (prevent credit injection anonim).
    const listenerToken = String(process.env.LEGACY_LISTENER_TOKEN || '').trim();
    const provided = String(req.get('x-listener-token') || req.get('x-api-key') || '').trim();
    if (listenerToken) {
      if (!safeEqual(provided, listenerToken)) {
        return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Listener token tidak valid.' } });
      }
    }

    const raw = req.body || {};
    const provider = String(raw.provider || raw.providerTransactionId || '').toLowerCase();
    if (!ALLOWED_PROVIDERS.has(provider)) {
      return res.status(400).json({ ok: false, error: { code: 'unknown_provider', message: 'Provider tidak dikenal.' } });
    }
    const providerTransactionId = String(raw.providerTransactionId || raw.provider_transaction_id || '').trim();
    const amount = Number(raw.amount);
    const userId = String(raw.apikey || raw.userId || raw.user_id || '').trim() || null;
    if (!provider || !providerTransactionId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: { code: 'invalid_payload', message: 'provider, providerTransactionId, amount wajib.' } });
    }
    // require apikey valid (jaga-jaga: ga boleh credit user yang ga ada)
    if (userId && !(await store.apikeyIsValid(userId))) {
      return res.status(404).json({ ok: false, error: { code: 'unknown_apikey', message: 'APIKEY tidak ditemukan.' } });
    }
    const result = await matchPayment({
      provider, providerTransactionId, amount,
      occurredAt: raw.occurredAt ? new Date(raw.occurredAt) : new Date(),
      raw, userId,
    });
    res.json({ ok: true, data: { matched: result.matched, order_id: result.orderId || null, reason: result.reason || null } });
  });

  /* ── /cron/detect — sweeper order pending yang sudah lewat TTL ── */
  /* ── /api/pending — daftar order pending (cache 10s) buat go-mutasi-poller ── */
  r.get('/api/pending', async (req, res) => {
    const listenerToken = String(process.env.LEGACY_LISTENER_TOKEN || '').trim();
    const provided = String(req.get('x-listener-token') || req.get('x-api-key') || '').trim();
    if (listenerToken) {
      if (!safeEqual(provided, listenerToken)) {
        return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Listener token tidak valid.' } });
      }
    }
    const ttl = Math.min(30000, Math.max(1000, Number(req.query.ttl_ms) || 10000));
    const items = await store.cachedPendingPayments(ttl);
    res.json({ ok: true, data: { pending: items, count: items.length, ts: new Date().toISOString() } });
  });

  r.get('/cron/detect', async (req, res) => {
    // fail-closed: secret WAJIB cocok (jika WEBHOOK_SECRET terpasang).
    const secret = String(req.query.secret || req.get('x-cron-secret') || '');
    if (!WEBHOOK_SECRET) {
      return res.status(503).json({ ok: false, error: { code: 'not_configured', message: 'Cron sweeper belum dikonfigurasi (set LEGACY_WEBHOOK_SECRET).' } });
    }
    if (!safeEqual(secret, WEBHOOK_SECRET)) {
      return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Secret salah.' } });
    }
    const now = new Date();
    let expired = 0;
    const all = await store.pendingPayments();
    for (const p of Object.values(all)) {
      if (!p || p.status !== 'pending') continue;
      const exp = new Date(p.expires_at || p.created_at || 0).getTime();
      if (exp && exp < now.getTime()) {
        await store.patchPayment(p.idtrx, { status: 'expired', expired_at: now.toISOString(), stats_recorded: true });
        await store.delReservation(p.amount);
        try { const stats = require('./legacy/stats'); await stats.recordTerminal(p); } catch (_) { /* best-effort */ }
        if (p.apikey) {
          try {
            const ids = ((await store.getPendingByApikey(p.apikey)) || []).filter((x) => x !== p.idtrx);
            await store.setPendingByApikey(p.apikey, ids);
          } catch (_) { /* index best-effort */ }
        }
        expired++;
      }
    }
    res.json({ ok: true, data: { expired_marked: expired, ts: now.toISOString() } });
  });

  /* ── /cron/backfill-users — isi field users/* yang kosong biar sinkron dengan
     field yang dibaca SPA (name/created_at/telegram). Auth sama persis dengan
     /cron/detect (secret = LEGACY_WEBHOOK_SECRET). Idempotent: cuma nambahin
     field kosong. */
  r.get('/cron/backfill-users', async (req, res) => {
    const secret = String(req.query.secret || req.get('x-cron-secret') || '');
    if (!WEBHOOK_SECRET) {
      return res.status(503).json({ ok: false, error: { code: 'not_configured', message: 'LEGACY_WEBHOOK_SECRET belum di-set.' } });
    }
    if (!safeEqual(secret, WEBHOOK_SECRET)) {
      return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Secret salah.' } });
    }
    const { backfillUsers, resetCursor } = require('./legacy/backfill');
    const action = String(req.query.action || 'run');
    if (action === 'probe') {
      const t0 = Date.now();
      const out = { mode: store.MODE, ms: 0, steps: {} };
      try {
        const cursor = (await store.getPath('meta/backfill_users_cursor')) || '';
        out.steps.cursor_ms = Date.now() - t0;
        const getRef = store.getAdminRefForBackfill();
        const snap = await getRef('users').limitToFirst(1).once('value');
        out.steps.users_limit1_ms = Date.now() - t0;
        out.usersHasData = Boolean(snap.val() && Object.keys(snap.val()).length);
        const snap2 = await getRef('users').orderByKey().limitToFirst(1).once('value');
        out.steps.orderby_ms = Date.now() - t0;
        out.cursor = cursor;
      } catch (e) {
        out.error = String(e.message || e).slice(0, 200);
      }
      return res.json({ ok: true, data: out });
    }
    if (action === 'reset') {
      await resetCursor();
      return res.json({ ok: true, data: { message: 'cursor balik ke 0, backfill dari awal' } });
    }
    if (action === 'set') {
      // set field spesifik user (whitelist — bukan input bebas):
      // ?apikey=KEY&telegram=123456  (kosongin: ?telegram=)
      const apikey = String(req.query.apikey || '').trim();
      const tg = String(req.query.telegram ?? '').trim();
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(apikey)) {
        return res.status(400).json({ ok: false, error: { code: 'invalid_apikey', message: 'apikey invalid.' } });
      }
      if (!(await store.verifyApiKey(apikey))) {
        return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'apikey tidak terdaftar.' } });
      }
      const partial = {};
      if (req.query.telegram !== undefined) partial.telegram = tg || null;
      if (Object.keys(partial).length) await store.patchUser(apikey, partial);
      const u = (await store.getUser(apikey)) || {};
      return res.json({ ok: true, data: { apikey, telegram: u.telegram || null } });
    }
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 300));
    const concurrency = Math.min(50, Math.max(1, Number(req.query.concurrency) || 25));
    const report = await backfillUsers({ limit, concurrency });
    res.json({ ok: true, data: report });
  });

  /* ── /cron/retention — retensi 30 hari buyer + agregat profit bulanan admin.
     Auth sama dengan /cron/detect (secret = LEGACY_WEBHOOK_SECRET).
       ?action=migrate (sekali jalan, chunked): record stats semua record lama
       yang belum ber-flag + agregasi riwayat withdraws lama
       ?action=run   (repetitif, tiap hari): hapus payments/withdraws terminal
       yang >30 hari (sudah di-guarantee tercatat stats lebih dulu) */
  r.get('/cron/retention', async (req, res) => {
    const secret = String(req.query.secret || req.get('x-cron-secret') || '');
    if (!WEBHOOK_SECRET) {
      return res.status(503).json({ ok: false, error: { code: 'not_configured', message: 'LEGACY_WEBHOOK_SECRET belum di-set.' } });
    }
    if (!safeEqual(secret, WEBHOOK_SECRET)) {
      return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Secret salah.' } });
    }
    const action = String(req.query.action || 'run');
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 500));
    const { migrateStats, prunePayments, pruneWithdraws } = require('./legacy/retention');
    if (action === 'migrate') {
      const report = await migrateStats({
        limit,
        force: req.query.force === '1' || req.query.force === 'true',
        wipe: req.query.wipe === '1' || req.query.wipe === 'true',
      });
      return res.json({ ok: true, data: report });
    }
    const [pays, wds] = await Promise.all([prunePayments({ limit }), pruneWithdraws({ limit: 200 })]);
    res.json({ ok: true, data: { payments: pays, withdraws: wds } });
  });

  /* ── /stats/months — baca agregat profit bulanan admin (semua bulan).
     Auth sama dengan /cron/detect. ?month=YYYY-MM buat satu bulan saja. */
  r.get('/stats/months', async (req, res) => {
    const secret = String(req.query.secret || req.get('x-cron-secret') || '');
    if (!WEBHOOK_SECRET) {
      return res.status(503).json({ ok: false, error: { code: 'not_configured', message: 'LEGACY_WEBHOOK_SECRET belum di-set.' } });
    }
    if (!safeEqual(secret, WEBHOOK_SECRET)) {
      return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Secret salah.' } });
    }
    const { getMonthStats, getMonthStatsOne } = require('./legacy/stats');
    const month = String(req.query.month || '').trim();
    const data = month ? await getMonthStatsOne(month) : await getMonthStats();
    res.json({ ok: true, data: data || (month ? null : {}) });
  });

  return r;
}

/* ── normalisasi payload antar-provider ── */
function normalizeProviderPayload(provider, raw) {
  switch (provider) {
    case 'saweria': {
      // Saweria: { amount, reference/transaction_id, ... }
      return {
        providerTransactionId: String(raw.reference || raw.transaction_id || raw.payment_reference || ''),
        amount: Number(raw.amount),
        occurredAt: raw.created_at ? new Date(raw.created_at) : new Date(),
        userId: raw.user_id || null,
        raw,
      };
    }
    case 'gopay': {
      // GoPay merchant notify (QRIS merchant): { orderCode/merchantOrderId/
      // orderId, gwpRef, amount/paymentAmount, status/paymentStatus }
      const statusOk = ['SUCCESS', 'PAID', 'SETTLED'].includes(String(raw.status || raw.paymentStatus || '').toUpperCase());
      if (!statusOk) return { providerTransactionId: null, amount: NaN };
      return {
        providerTransactionId: String(raw.orderCode || raw.merchantOrderId || raw.orderId || raw.gwpRef || ''),
        amount: Number(raw.amount ?? raw.paymentAmount ?? raw.orderAmount),
        occurredAt: raw.timestamp ? new Date(raw.timestamp) : (raw.payTime ? new Date(raw.payTime) : new Date()),
        userId: raw.merchantId || null,
        raw,
      };
    }
    case 'dana': {
      // DANA: { tradeNo, orderAmount/amount, payStatus }
      const statusOk = ['SUCCESS', 'PAID'].includes(String(raw.payStatus || raw.status || '').toUpperCase());
      if (!statusOk) return { providerTransactionId: null, amount: NaN };
      return {
        providerTransactionId: String(raw.tradeNo || raw.orderNo || ''),
        amount: Number(raw.amount ?? raw.orderAmount),
        occurredAt: raw.payTime ? new Date(raw.payTime) : new Date(),
        userId: raw.openId || null,
        raw,
      };
    }
    default:
      return { providerTransactionId: null, amount: NaN };
  }
}

module.exports = { buildRouter, matchPayment, normalizeProviderPayload };
