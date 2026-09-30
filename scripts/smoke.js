'use strict';

/**
 * Smoke test end-to-end (tanpa provider asli):
 *   1. nyalakan MongoDB in-memory + seed
 *   2. jalankan app + receiver webhook lokal
 *   3. buat order lewat REST API, bayar via matching service
 *   4. pastikan order jadi PAID dan webhook terkirim dengan signature valid
 *
 * Jalankan: node scripts/smoke.js
 */

process.env.DATA_SOURCE = 'db';
process.env.DEVELOPMENT_MONGO_MEMORY = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const http = require('http');

const config = require('../src/config');
const hmac = require('../src/lib/hmac');
const { DEV_DEFAULT_KEY, QRIS_STRING } = require('../src/db/seed');

const API_PORT = 3999;
const HOOK_PORT = 3998;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const request = async (method, path, { body, key } = {}) => {
  const response = await fetch(`http://localhost:${API_PORT}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'x-api-key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) { /* bukan json */ }
  return { status: response.status, json, text };
};

const main = async () => {
  const { connect, disconnect } = require('../src/db/connect');
  await connect();

  const { seed } = require('../src/db/seed');
  await seed({ force: true });

  const models = require('../src/models');
  const createApp = require('../src/app');
  const { processPayment } = require('../src/services/matching.service');

  const user = await models.User.findOne({});
  const settings = await models.MerchantSettings.findOne({ userId: user._id });
  const secret = settings.webhookSecret;

  /* ── Receiver webhook ── */
  const received = [];
  const receiver = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const timestamp = req.headers[hmac.TIMESTAMP_HEADER];
      const signature = req.headers[hmac.SIGNATURE_HEADER];
      const valid = hmac.verify({ secret, timestamp, rawBody: raw, signature });
      received.push({ event: req.headers[hmac.EVENT_HEADER], valid, body: raw });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => receiver.listen(HOOK_PORT, resolve));

  /* ── App ── */
  const app = createApp();
  const server = app.listen(API_PORT);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    /* Auth: key salah & tanpa key */
    const noKey = await request('POST', '/api/orders', { body: { base_amount: 10000 } });
    check('tanpa API key → invalid_api_key', noKey.status === 401 && noKey.json?.error?.code === 'invalid_api_key');

    const badKey = await request('POST', '/api/orders', { body: { base_amount: 10000 }, key: 'pk_live_salah' });
    check('API key salah → invalid_api_key', badKey.status === 401 && badKey.json?.error?.code === 'invalid_api_key');

    /* Validasi nominal & TTL */
    const badAmount = await request('POST', '/api/orders', { body: { base_amount: 0 }, key: DEV_DEFAULT_KEY });
    check('base_amount 0 → invalid_base_amount', badAmount.status === 400 && badAmount.json?.error?.code === 'invalid_base_amount');

    const badTtl = await request('POST', '/api/orders', { body: { base_amount: 10000, ttl_seconds: 5 }, key: DEV_DEFAULT_KEY });
    check('ttl 5 → invalid_ttl', badTtl.status === 400 && badTtl.json?.error?.code === 'invalid_ttl');

    /* QRIS statis via API (Project Utama) */
    const qrisRes = await request('POST', '/api/merchant/qris', {
      body: { provider: 'shopee', qris: QRIS_STRING, set_active: true },
      key: DEV_DEFAULT_KEY,
    });
    check('POST /merchant/qris valid → 200', qrisRes.status === 200 && qrisRes.json?.ok === true, JSON.stringify(qrisRes.json?.error || {}));

    /* Settings */
    const settingsRes = await request('POST', '/api/merchant/settings', {
      body: { fee_percent: 0.5, order_ttl: 900, shopee_mode: 'hybrid' },
      key: DEV_DEFAULT_KEY,
    });
    check('POST /merchant/settings → 200', settingsRes.status === 200 && settingsRes.json?.data?.order_ttl === 900);

    /* Buat order */
    const created = await request('POST', '/api/orders', {
      body: { base_amount: 25000, ttl_seconds: 900, reference_id: 'SMOKE-1' },
      key: DEV_DEFAULT_KEY,
    });
    check('POST /orders → 201', created.status === 201, JSON.stringify(created.json?.error || {}));

    const order = created.json?.data;
    check('order punya pay_amount', Boolean(order?.pay_amount), `pay_amount=${order?.pay_amount}`);
    check('order QRIS dinamis (tag 54 = nominal)', String(order?.qris).includes(`54${String(String(order?.pay_amount).length).padStart(2, '0')}${order?.pay_amount}`));

    /* Arahkan webhook project ke receiver lokal */
    await models.Project.findByIdAndUpdate(order ? (await models.Order.findOne({ orderId: order.id })).projectId : null, {
      $set: { webhookUrl: `http://localhost:${HOOK_PORT}/hook` },
    });

    /* Simulasi pembayaran */
    const paidResult = await processPayment({
      provider: order.provider,
      providerTransactionId: 'SMOKE-TRX-1',
      amount: order.pay_amount,
      occurredAt: new Date(),
    });
    check('matching menemukan order', paidResult.matched === true, JSON.stringify(paidResult));

    const reused = await processPayment({
      provider: order.provider,
      providerTransactionId: 'SMOKE-TRX-1',
      amount: order.pay_amount,
      occurredAt: new Date(),
    });
    check('bukti bayar tidak bisa dipakai ulang', reused.matched === false && reused.reason === 'already_claimed');

    await new Promise((resolve) => setTimeout(resolve, 400));

    const statusRes = await request('GET', `/api/orders/${order.id}`, { key: DEV_DEFAULT_KEY });
    check('GET /orders/:id → paid', statusRes.json?.data?.status === 'paid', statusRes.json?.data?.status);

    check('webhook order.paid diterima', received.some((r) => r.event === 'order.paid' && r.valid), JSON.stringify(received.map((r) => r.event)));

    const cancelRes = await request('POST', `/api/orders/${order.id}/cancel`, { key: DEV_DEFAULT_KEY });
    check('cancel order yang sudah paid → order_not_pending', cancelRes.status === 409 && cancelRes.json?.error?.code === 'order_not_pending');
  } finally {
    server.close();
    receiver.close();
    await disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} langkah lolos.`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((error) => {
  console.error('[smoke] error:', error);
  process.exit(1);
});
