'use strict';

/**
 * Test integrasi (butuh MongoDB in-memory):
 *   - seluruh error code REST API
 *   - alur order (buat → cek → cancel)
 *   - Listener API (registrasi device → push pembayaran → matched)
 *   - webhook retry 3x + signature
 *   - audit log
 *
 * Jalankan: node --test tests/integration.test.js
 */

process.env.DATA_SOURCE = 'db';
process.env.DEVELOPMENT_MONGO_MEMORY = 'true';
process.env.TURNSTILE_DISABLED = 'true';
process.env.NODE_ENV = 'development';
process.env.WEBHOOK_TIMEOUT_MS = '3000';
process.env.SESSION_DRIVER = 'memory';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const API_PORT = 3997;
const HOOK_PORT = 3996;

let server;
let receiver;
let models;
let user;
let secret;
let session;
const received = [];

const api = async (method, path, { body, key, deviceToken } = {}) => {
  const response = await fetch(`http://localhost:${API_PORT}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'x-api-key': key } : {}),
      ...(deviceToken ? { 'x-device-token': deviceToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    /* bukan json */
  }
  return { status: response.status, json, text };
};

const errCode = (res) => res.json?.error?.code;

let flakyHits = 0;

test.before(async () => {
  const hmac = require('../src/lib/hmac');
  const { connect } = require('../src/db/connect');
  const { seed, DEMO_EMAIL, DEV_DEFAULT_KEY } = require('../src/db/seed');
  const createApp = require('../src/app');

  await connect();
  await seed({ force: true });

  models = require('../src/models');
  user = await models.User.findOne({ email: DEMO_EMAIL });
  const settings = await models.MerchantSettings.findOne({ userId: user._id });
  secret = settings.webhookSecret;

  // Arahkan webhook ke receiver lokal supaya pengiriman cepat & terverifikasi.
  await models.Project.updateMany({}, { $set: { webhookUrl: `http://localhost:${HOOK_PORT}/hook` } });

  receiver = http.createServer((req, res) => {
    if (req.url === '/flaky') {
      flakyHits += 1;
      if (flakyHits <= 2) {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end('{"ok":false}');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const valid = hmac.verify({
        secret,
        timestamp: req.headers[hmac.TIMESTAMP_HEADER],
        rawBody: raw,
        signature: req.headers[hmac.SIGNATURE_HEADER],
      });
      received.push({ event: req.headers[hmac.EVENT_HEADER], valid, raw });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => receiver.listen(HOOK_PORT, resolve));

  const app = createApp();
  server = app.listen(API_PORT);
  await new Promise((resolve) => server.once('listening', resolve));

  // Expose key buat test lain.
  session = { defaultKey: DEV_DEFAULT_KEY, botKey: 'pk_live_seed_bot_telegram' };
});

test.after(async () => {
  // Tutup paksa koneksi keep-alive supaya proses tidak menggantung.
  if (server) {
    server.closeAllConnections?.();
    server.close();
  }
  if (receiver) {
    receiver.closeAllConnections?.();
    receiver.close();
  }
  const { disconnect } = require('../src/db/connect');
  await disconnect();
});

/* ══════════════════════ Error code REST API ══════════════════════ */

test('tanpa API key → invalid_api_key', async () => {
  const res = await api('POST', '/api/orders', { body: { base_amount: 10000 } });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(errCode(res), 'invalid_api_key');
});

test('API key salah → invalid_api_key', async () => {
  const res = await api('POST', '/api/orders', { body: { base_amount: 10000 }, key: 'pk_live_salah' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(errCode(res), 'invalid_api_key');
});

test('API key non-live → live_key_required', async () => {
  const res = await api('POST', '/api/orders', { body: { base_amount: 10000 }, key: 'test_123' });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(errCode(res), 'live_key_required');
});

test('base_amount 0 → invalid_base_amount', async () => {
  const res = await api('POST', '/api/orders', { body: { base_amount: 0 }, key: session.defaultKey });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(errCode(res), 'invalid_base_amount');
});

test('ttl_seconds di luar rentang → invalid_ttl', async () => {
  const res = await api('POST', '/api/orders', {
    body: { base_amount: 10000, ttl_seconds: 5 },
    key: session.defaultKey,
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(errCode(res), 'invalid_ttl');
});

test('notify_url bukan HTTPS → invalid_request', async () => {
  const res = await api('POST', '/api/orders', {
    body: { base_amount: 10000, notify_url: 'http://insecure.example.com' },
    key: session.defaultKey,
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(errCode(res), 'invalid_request');
});

test('endpoint pengaturan dengan key non-utama → default_project_key_required', async () => {
  const res = await api('POST', '/api/merchant/qris', {
    body: { provider: 'shopee', qris: require('../src/db/seed').QRIS_STRING },
    key: session.botKey,
  });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(errCode(res), 'default_project_key_required');
});

test('provider QRIS kosong → qris_provider_required', async () => {
  const res = await api('POST', '/api/merchant/qris', {
    body: { qris: require('../src/db/seed').QRIS_STRING },
    key: session.defaultKey,
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(errCode(res), 'qris_provider_required');
});

test('string QRIS ngawur → invalid_qris', async () => {
  const res = await api('POST', '/api/merchant/qris', {
    body: { provider: 'shopee', qris: 'ini-bukan-qris' },
    key: session.defaultKey,
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(errCode(res), 'invalid_qris');
});

test('QRIS dinamis dikirim sebagai statis → static_qris_required', async () => {
  const qrisSvc = require('../src/services/qris.service');
  const { QRIS_STRING } = require('../src/db/seed');
  const dynamic = qrisSvc.staticToDynamic(QRIS_STRING, 5000);

  const res = await api('POST', '/api/merchant/qris', {
    body: { provider: 'shopee', qris: dynamic },
    key: session.defaultKey,
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(errCode(res), 'static_qris_required');
});

test('fee_percent tidak valid → invalid_request', async () => {
  const res = await api('POST', '/api/merchant/settings', {
    body: { fee_percent: 500 },
    key: session.defaultKey,
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(errCode(res), 'invalid_request');
});

test('QRIS belum aktif → qris_not_configured', async () => {
  await models.QrisAccount.updateMany({}, { $set: { status: 'standby' } });
  const res = await api('POST', '/api/orders', { body: { base_amount: 10000 }, key: session.defaultKey });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(errCode(res), 'qris_not_configured');
});

test('POST /merchant/qris valid → 200 & QRIS aktif kembali', async () => {
  const res = await api('POST', '/api/merchant/qris', {
    body: { provider: 'shopee', qris: require('../src/db/seed').QRIS_STRING, set_active: true },
    key: session.defaultKey,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json?.data?.status, 'active');

  const active = await models.QrisAccount.findOne({ userId: user._id, status: 'active' });
  assert.ok(active);
});

test('provider dinonaktifkan admin → payment_provider_disabled', async () => {
  await models.AppSetting.updateOne({ key: 'global' }, { $set: { disabledProviders: ['shopee'] } }, { upsert: true });
  const res = await api('POST', '/api/orders', { body: { base_amount: 12000 }, key: session.defaultKey });
  assert.strictEqual(res.status, 503);
  assert.strictEqual(errCode(res), 'payment_provider_disabled');

  await models.AppSetting.updateOne({ key: 'global' }, { $set: { disabledProviders: [] } });
});

test('detektor belum siap → detector_not_ready', async () => {
  await models.ListenerDevice.updateMany({}, { $set: { notificationAccess: false } });
  await models.ProviderConnection.updateMany({ userId: user._id, provider: 'shopee' }, { $set: { status: 'error' } });

  const res = await api('POST', '/api/orders', { body: { base_amount: 13000 }, key: session.defaultKey });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(errCode(res), 'detector_not_ready');

  await models.ListenerDevice.updateMany({}, { $set: { notificationAccess: true } });
});

/* ══════════════════════ Order & settings ══════════════════════ */

test('POST /merchant/settings → 200', async () => {
  const res = await api('POST', '/api/merchant/settings', {
    body: { fee_percent: 0.5, order_ttl: 900, shopee_mode: 'hybrid' },
    key: session.defaultKey,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json?.data?.order_ttl, 900);
});

test('POST /orders → 201 dengan pay_amount, qris, checkout_url', async () => {
  const res = await api('POST', '/api/orders', {
    body: { base_amount: 25000, ttl_seconds: 900, reference_id: 'IT-1' },
    key: session.defaultKey,
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));

  const order = res.json?.data;
  assert.ok(order?.id);
  assert.ok(Number.isInteger(order.pay_amount) && order.pay_amount >= 25000);
  assert.ok(order.qris && order.qris.length > 40);
  assert.ok(order.checkout_url.includes(order.id));

  session.orderId = order.id;
  session.payAmount = order.pay_amount;
  session.provider = order.provider;
});

test('GET /orders/:id → 200', async () => {
  const res = await api('GET', `/api/orders/${session.orderId}`, { key: session.defaultKey });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json?.data?.status, 'pending');
});

test('GET order yang tidak ada → order_not_found', async () => {
  const res = await api('GET', '/api/orders/pay_tidakada', { key: session.defaultKey });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(errCode(res), 'order_not_found');
});

test('cancel order pending → 200, cancel ulang → order_not_pending', async () => {
  const first = await api('POST', `/api/orders/${session.orderId}/cancel`, { key: session.defaultKey });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.json?.data?.status, 'cancelled');

  const second = await api('POST', `/api/orders/${session.orderId}/cancel`, { key: session.defaultKey });
  assert.strictEqual(second.status, 409);
  assert.strictEqual(errCode(second), 'order_not_pending');
});

/* ══════════════════════ Listener API ══════════════════════ */

test('registrasi device Listener → 201 + device_token', async () => {
  const res = await api('POST', '/api/listener/register', {
    key: session.defaultKey,
    body: {
      device_id: 'IT-DEVICE-01',
      name: 'HP Test',
      model: 'Pixel',
      android_version: '14',
      enabled_sources: ['shopee'],
    },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.ok(res.json?.data?.device_token?.startsWith('dev_live_'));
  assert.strictEqual(res.json?.data?.token_issued, true);

  session.deviceToken = res.json.data.device_token;
});

test('heartbeat tanpa device token → invalid_device_token', async () => {
  const res = await api('GET', '/api/listener/me');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(errCode(res), 'invalid_device_token');
});

test('heartbeat dengan device token → 200', async () => {
  const res = await api('GET', '/api/listener/me', { deviceToken: session.deviceToken });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json?.data?.device?.deviceId, 'IT-DEVICE-01');
});

test('push sumber yang tidak diaktifkan → source_not_enabled', async () => {
  const res = await api('POST', '/api/listener/push', {
    deviceToken: session.deviceToken,
    body: { provider: 'gopay', provider_transaction_id: 'X-1', amount: 1000 },
  });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(errCode(res), 'source_not_enabled');
});

test('push pembayaran yang cocok → matched & order jadi paid', async () => {
  const created = await api('POST', '/api/orders', {
    body: { base_amount: 41000, ttl_seconds: 900, reference_id: 'IT-LISTENER' },
    key: session.defaultKey,
  });
  assert.strictEqual(created.status, 201);
  const order = created.json.data;

  const push = await api('POST', '/api/listener/push', {
    deviceToken: session.deviceToken,
    body: {
      provider: order.provider,
      provider_transaction_id: 'IT-TRX-LISTENER-1',
      amount: order.pay_amount,
    },
  });
  assert.strictEqual(push.status, 200, JSON.stringify(push.json));
  assert.strictEqual(push.json?.data?.matched, true);
  assert.strictEqual(push.json?.data?.order_id, order.id);

  const status = await api('GET', `/api/orders/${order.id}`, { key: session.defaultKey });
  assert.strictEqual(status.json?.data?.status, 'paid');
});

test('push bukti bayar yang sama diulang → already_claimed', async () => {
  const created = await api('POST', '/api/orders', {
    body: { base_amount: 42000, ttl_seconds: 900 },
    key: session.defaultKey,
  });
  const order = created.json.data;

  await api('POST', '/api/listener/push', {
    deviceToken: session.deviceToken,
    body: { provider: order.provider, provider_transaction_id: 'IT-TRX-DUP', amount: order.pay_amount },
  });

  const again = await api('POST', '/api/listener/push', {
    deviceToken: session.deviceToken,
    body: { provider: order.provider, provider_transaction_id: 'IT-TRX-DUP', amount: order.pay_amount },
  });
  assert.strictEqual(again.json?.data?.matched, false);
  assert.strictEqual(again.json?.data?.reason, 'already_claimed');
});

test('push nominal tanpa order → no_matching_order', async () => {
  const res = await api('POST', '/api/listener/push', {
    deviceToken: session.deviceToken,
    body: { provider: 'shopee', provider_transaction_id: 'IT-TRX-NOMATCH', amount: 987654 },
  });
  assert.strictEqual(res.json?.data?.matched, false);
  assert.strictEqual(res.json?.data?.reason, 'no_matching_order');
});

test('revoke device → token lama ditolak', async () => {
  const res = await api('POST', '/api/listener/devices/IT-DEVICE-01/revoke', { key: session.defaultKey });
  assert.strictEqual(res.status, 200);

  const after = await api('GET', '/api/listener/me', { deviceToken: session.deviceToken });
  assert.strictEqual(after.status, 401);
  assert.strictEqual(errCode(after), 'invalid_device_token');
});

/* ══════════════════════ Webhook ══════════════════════ */

test('webhook yang sempat gagal dicoba ulang sampai sukses (retry)', async () => {
  const webhookSvc = require('../src/services/webhook.service');

  const before = flakyHits;
  const result = await webhookSvc.deliver({
    event: 'webhook.test',
    order: { id: 'pay_retry', projectId: null, webhookUrl: `http://localhost:${HOOK_PORT}/flaky` },
    userId: user._id,
    secret,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(flakyHits - before, 3, 'harus 3 percobaan (2 gagal + 1 sukses)');

  const delivery = await models.WebhookDelivery.findOne({ deliveryId: result.deliveryId });
  assert.strictEqual(delivery.attempts, 3);
  assert.strictEqual(delivery.status, 'success');
});

test('webhook order.paid terkirim dengan signature valid', async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const paid = received.filter((r) => r.event === 'order.paid');
  assert.ok(paid.length > 0, 'harus ada minimal satu event order.paid');
  assert.ok(paid.every((r) => r.valid), 'semua signature harus valid');
});

/* ══════════════════════ Audit log ══════════════════════ */

test('audit log tercatat', async () => {
  const audit = require('../src/services/audit.service');
  await audit.record('test.suite', { userId: user._id, targetType: 'test', meta: { ok: true } });

  const doc = await models.AuditLog.findOne({ action: 'test.suite' });
  assert.ok(doc, 'log harus tersimpan');
  assert.strictEqual(String(doc.userId), String(user._id));
  assert.strictEqual(doc.meta.ok, true);
});
