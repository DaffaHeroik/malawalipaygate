'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const qris = require('../src/services/qris.service');

const STATIC = '00020101021126610014COM.GO-JEK.WWW01189360091432191540810210G2191540810303UMI51440014ID.CO.QRIS.WWW0215ID10253911118910303UMI5204581553033605802ID5924JUAN Pria Sigma, Digital6006BLITAR61056615462070703A016304568D';

test('crc16 menghitung checksum QRIS statis', () => {
  assert.equal(qris.crc16(STATIC.slice(0, -4)), '568D');
});

test('validateCrc menerima payload valid dan menolak yang dirusak', () => {
  assert.equal(qris.validateCrc(STATIC).valid, true);
  assert.equal(qris.validateCrc(`${STATIC.slice(0, -1)}0`).valid, false);
});

test('parseTlv membalikkan string jadi field berurutan', () => {
  const fields = qris.parseTlv(STATIC);
  assert.equal(fields[0].tag, '00');
  assert.equal(fields[0].value, '01');
  assert.ok(fields.some((f) => f.tag === '59'));
});

test('inspectQris membaca merchant, kota, dan method', () => {
  const info = qris.inspectQris(STATIC);
  assert.equal(info.isStatic, true);
  assert.equal(info.merchantName, 'JUAN Pria Sigma, Digital');
  assert.equal(info.merchantCity, 'BLITAR');
  assert.equal(info.currency, '360');
  assert.equal(info.country, 'ID');
});

test('staticToDynamic menyisipkan nominal & CRC cocok dengan vector (C9BE)', () => {
  const dynamic = qris.staticToDynamic(STATIC, 5500);
  assert.ok(dynamic.includes('54045500'));
  assert.equal(dynamic.slice(-4), 'C9BE');
  assert.equal(qris.validateCrc(dynamic).valid, true);
  assert.equal(qris.inspectQris(dynamic).isDynamic, true);
});

test('staticToDynamic menolak nominal tidak valid', () => {
  assert.throws(() => qris.staticToDynamic(STATIC, 0), /invalid_base_amount|Nominal/);
});

test('staticToDynamic menolak QRIS yang sudah dinamis', () => {
  const dynamic = qris.staticToDynamic(STATIC, 10000);
  assert.throws(() => qris.staticToDynamic(dynamic, 10000), /statis|static/i);
});

test('detectProvider menebak provider dari isi payload', () => {
  assert.equal(qris.detectProvider(STATIC), 'gopay');
});
