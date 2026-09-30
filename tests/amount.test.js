'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const amount = require('../src/services/amount.service');

test('mode fee: fee 0.5% dari 10000 = 50', () => {
  const result = amount.resolveAmount.simple({ mode: 'fee', baseAmount: 10000, feePercent: 0.5 });
  assert.equal(result.feeAmount, 50);
  assert.equal(result.uniqueCode, 0);
  assert.equal(result.payAmount, 10050);
});

test('mode unique: kode unik sesuai jumlah digit', () => {
  const result = amount.resolveAmount.simple({ mode: 'unique', baseAmount: 10000, uniqueDigits: 2 });
  assert.equal(result.feeAmount, 0);
  assert.ok(result.uniqueCode >= 10 && result.uniqueCode <= 99);
  assert.equal(result.payAmount, 10000 + result.uniqueCode);
});

test('mode fallback dari feeEnabled/uniqueEnabled', () => {
  assert.equal(amount.normalizeMode({ feeEnabled: true }), 'fee');
  assert.equal(amount.normalizeMode({ uniqueEnabled: true }), 'unique');
  assert.equal(amount.normalizeMode({}), 'hybrid');
});

test('hybrid: order A/B/C dapat 10000/10001/10002', async () => {
  const taken = new Set();
  const allocate = () =>
    amount.resolveAmount.hybrid({ baseAmount: 10000 }, async (candidate) => taken.has(candidate));

  const a = await allocate();
  taken.add(a.payAmount);
  const b = await allocate();
  taken.add(b.payAmount);
  const c = await allocate();

  assert.deepEqual([a.payAmount, b.payAmount, c.payAmount], [10000, 10001, 10002]);
});

test('hybrid: nominal bisa dipakai lagi setelah order sebelumnya selesai', async () => {
  const taken = new Set([10000, 10001]);
  const next = await amount.resolveAmount.hybrid({ baseAmount: 10000 }, async (candidate) => taken.has(candidate));
  assert.equal(next.payAmount, 10002);

  taken.delete(10000); // order A selesai
  const reuse = await amount.resolveAmount.hybrid({ baseAmount: 10000 }, async (candidate) => taken.has(candidate));
  assert.equal(reuse.payAmount, 10000);
});

test('modeForProvider membaca setting per provider', () => {
  const settings = { shopeeMode: 'fee', shopeeFeeEnabled: true, shopeeUniqueEnabled: false, gopayMode: 'hybrid' };
  assert.equal(amount.modeForProvider(settings, 'shopee').mode, 'fee');
  assert.equal(amount.modeForProvider(settings, 'gopay').mode, 'hybrid');
  assert.equal(amount.modeForProvider(settings, 'dana').mode, 'hybrid');
});
