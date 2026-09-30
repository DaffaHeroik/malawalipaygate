'use strict';

const test = require('node:test');
const assert = require('node:assert');

const listener = require('../src/services/listener.service');

test('generateToken berprefix dev_live_ dan unik', () => {
  const a = listener.generateToken();
  const b = listener.generateToken();
  assert.ok(listener.isDeviceToken(a));
  assert.ok(a.startsWith('dev_live_'));
  assert.notStrictEqual(a, b);
});

test('isDeviceToken menolak token asing', () => {
  assert.strictEqual(listener.isDeviceToken('pk_live_abc'), false);
  assert.strictEqual(listener.isDeviceToken(''), false);
  assert.strictEqual(listener.isDeviceToken('dev_live_x'), true);
});

test('hashToken deterministik & tidak menyimpan token mentah', () => {
  const token = listener.generateToken();
  const hash = listener.hashToken(token);
  assert.strictEqual(hash, listener.hashToken(token));
  assert.strictEqual(hash.length, 64);
  assert.ok(!hash.includes(token));
});

test('maskToken menyembunyikan bagian tengah', () => {
  const token = listener.generateToken();
  const masked = listener.maskToken(token);
  assert.ok(masked.includes('•'));
  assert.ok(masked.endsWith(token.slice(-4)));
});

test('normalizeRegistration memberi deviceId default bila tidak valid', () => {
  const out = listener.normalizeRegistration({ name: 'HP Kasir', enabled_sources: ['Shopee', 'gopay'] });
  assert.ok(out.deviceId.startsWith('dev_'));
  assert.deepStrictEqual(out.enabledSources, ['shopee', 'gopay']);
  assert.strictEqual(out.notificationAccess, true);

  const withId = listener.normalizeRegistration({ device_id: 'ABC123XYZ', notification_access: false });
  assert.strictEqual(withId.deviceId, 'ABC123XYZ');
  assert.strictEqual(withId.notificationAccess, false);
});

test('normalizePayment membulatkan amount & memvalidasi', () => {
  const ok = listener.normalizePayment({
    provider: 'Shopee',
    provider_transaction_id: 'TRX-1',
    amount: '25000',
  });
  assert.strictEqual(ok.provider, 'shopee');
  assert.strictEqual(ok.amount, 25000);
  assert.strictEqual(ok.providerTransactionId, 'TRX-1');
  assert.ok(ok.occurredAt instanceof Date);

  const bad = listener.normalizePayment({ provider: 'shopee', amount: 'bukan-angka' });
  assert.ok(Number.isNaN(bad.amount));
});
