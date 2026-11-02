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

const store = require('./legacy/store');

const WEBHOOK_SECRET = String(process.env.LEGACY_WEBHOOK_SECRET || '').trim();

/* ── matching: cari order pending yang nominalnya cocok & masih aktif ── */
async function matchPayment({ provider, providerTransactionId, amount, occurredAt = new Date(), raw = {}, userId = null }) {
  if (!provider || !providerTransactionId || !Number.isFinite(amount)) {
    return { matched: false, reason: 'invalid_payload' };
  }

  // klaim trans (unique) — pakai logs/payments
  const claimKey = `${provider}:${providerTransactionId}`;
  const claimed = await store.getPath(`__claims__/${encodeURIComponent(claimKey)}`);
  if (claimed) return { matched: false, reason: 'already_claimed' };
  await store.setPath(`__claims__/${encodeURIComponent(claimKey)}`, { provider, providerTransactionId, at: occurredAt.toISOString() });

  const all = await store.allPayments();
  const now = occurredAt.getTime();
  const candidates = Object.values(all).filter(
    (p) =>
      p &&
      p.status === 'pending' &&
      Number(p.amount) === Math.round(amount) &&
      (!userId || p.apikey === userId)
  );

  for (const p of candidates) {
    const created = new Date(p.created_at).getTime();
    const expires = new Date(p.expires_at || created + 10 * 60 * 1000).getTime();
    if (now < created || now > expires) continue;

    const patch = {
      status: 'paid', credited: true, paid_at: occurredAt.toISOString(),
      payment_method: provider, sender_name: raw?.sender_name || null,
      bank_code: raw?.bank_code || null,
      provider_transaction_id: providerTransactionId,
      saldo_added: p.amount,
    };
    await store.patchPayment(p.idtrx, patch);
    await store.delReservation(p.amount);

    await notifyMerchant(p, provider, providerTransactionId);
    await notifyTelegram(p, provider, providerTransactionId);

    return { matched: true, orderId: p.idtrx, providerTransactionId };
  }

  return { matched: false, reason: 'no_matching_order' };
}

/* ── kirim webhook merchant (best effort) ── */
async function notifyMerchant(payment, provider, providerTransactionId) {
  try {
    const hooks = await store.getWebhooks(payment.apikey);
    for (const url of hooks) {
      if (!url || !/^https?:\/\//.test(url)) continue;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'payment.paid',
          provider, provider_transaction_id: providerTransactionId,
          idtrx: payment.idtrx, amount: payment.amount,
          base_amount: payment.base_amount, paid_at: payment.paid_at,
        }),
      }).catch(() => {});
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
    // signature check (best effort, tergantung provider)
    const sig = String(req.get('x-signature') || req.get('x-webhook-signature') || '');
    if (WEBHOOK_SECRET && sig) {
      const hash = crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(req.body || {})).digest('hex');
      if (hash !== sig.toLowerCase()) {
        return res.status(401).json({ ok: false, error: { code: 'invalid_signature', message: 'Signature tidak cocok.' } });
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
    const raw = req.body || {};
    const provider = String(raw.provider || raw.providerTransactionId || '').toLowerCase();
    const providerTransactionId = String(raw.providerTransactionId || raw.provider_transaction_id || '').trim();
    const amount = Number(raw.amount);
    const userId = String(raw.apikey || raw.userId || raw.user_id || '').trim() || null;
    if (!provider || !providerTransactionId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: { code: 'invalid_payload', message: 'provider, providerTransactionId, amount wajib.' } });
    }
    const result = await matchPayment({
      provider, providerTransactionId, amount,
      occurredAt: raw.occurredAt ? new Date(raw.occurredAt) : new Date(),
      raw, userId,
    });
    res.json({ ok: true, data: { matched: result.matched, order_id: result.orderId || null, reason: result.reason || null } });
  });

  /* ── /cron/detect — sweeper order pending yang sudah lewat TTL ── */
  r.get('/cron/detect', async (req, res) => {
    const secret = String(req.query.secret || '');
    if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Secret salah.' } });
    }
    const now = new Date();
    let expired = 0;
    const all = await store.allPayments();
    for (const p of Object.values(all)) {
      if (!p || p.status !== 'pending') continue;
      const exp = new Date(p.expires_at || p.created_at || 0).getTime();
      if (exp && exp < now.getTime()) {
        await store.patchPayment(p.idtrx, { status: 'expired', expired_at: now.toISOString() });
        await store.delReservation(p.amount);
        expired++;
      }
    }
    res.json({ ok: true, data: { expired_marked: expired, ts: now.toISOString() } });
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
      // GoPay merchant notify: { orderCode/merchantOrderId, gwpRef, amount, status }
      const statusOk = ['SUCCESS', 'PAID', 'SETTLED'].includes(String(raw.status || '').toUpperCase());
      if (!statusOk) return { providerTransactionId: null, amount: NaN };
      return {
        providerTransactionId: String(raw.orderCode || raw.merchantOrderId || raw.gwpRef || ''),
        amount: Number(raw.amount),
        occurredAt: raw.timestamp ? new Date(raw.timestamp) : new Date(),
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
