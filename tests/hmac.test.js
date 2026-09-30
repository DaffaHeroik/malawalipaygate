'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const hmac = require('../src/lib/hmac');

const SECRET = 'whsec_test_123';
const BODY = JSON.stringify({ event: 'order.paid', data: { id: 'pay_abc' } });

test('sign menghasilkan hex stabil', () => {
  const a = hmac.sign(SECRET, 1700000000, BODY);
  const b = hmac.sign(SECRET, 1700000000, BODY);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('format menambahkan prefix v1=', () => {
  const sig = hmac.format(hmac.sign(SECRET, 1700000000, BODY));
  assert.ok(sig.startsWith('v1='));
});

test('verify menerima signature benar dan menolak yang salah', () => {
  const timestamp = 1700000000;
  const signature = hmac.format(hmac.sign(SECRET, timestamp, BODY));
  assert.equal(hmac.verify({ secret: SECRET, timestamp, rawBody: BODY, signature }), true);
  assert.equal(hmac.verify({ secret: 'salah', timestamp, rawBody: BODY, signature }), false);
  assert.equal(hmac.verify({ secret: SECRET, timestamp, rawBody: `${BODY} `, signature }), false);
});

test('timestamp kedaluwarsa ditolak', () => {
  const old = Math.floor(Date.now() / 1000) - 4000;
  assert.equal(hmac.isFreshTimestamp(old, 300), false);
  assert.equal(hmac.isFreshTimestamp(hmac.nowSeconds(), 300), true);
});
