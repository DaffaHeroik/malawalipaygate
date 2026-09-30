'use strict';

const test = require('node:test');
const assert = require('node:assert');

const crypto = require('../src/services/crypto.service');

test('encrypt → decrypt mengembalikan teks asli', () => {
  const plain = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token-shopee';
  const enc = crypto.encrypt(plain);

  assert.ok(enc, 'harus menghasilkan ciphertext di mode development');
  assert.ok(crypto.isEncrypted(enc));
  assert.notStrictEqual(enc, plain);
  assert.strictEqual(crypto.decrypt(enc), plain);
});

test('ciphertext berbeda tiap kali (IV acak)', () => {
  const a = crypto.encrypt('nomor-rahasia');
  const b = crypto.encrypt('nomor-rahasia');
  assert.notStrictEqual(a, b);
  assert.strictEqual(crypto.decrypt(a), crypto.decrypt(b));
});

test('encryptJson / decryptJson bolak-balik objek', () => {
  const payload = { token: 'abc', phone: '08123456789', verified: true };
  const enc = crypto.encryptJson(payload);
  assert.deepStrictEqual(crypto.decryptJson(enc), payload);
});

test('ciphertext rusak / palsu tidak melempar dan return null', () => {
  assert.strictEqual(crypto.decrypt(''), null);
  assert.strictEqual(crypto.decrypt('plaintext-biasa'), null);
  assert.strictEqual(crypto.decrypt('v1:aa:bb:cc'), null);

  const enc = crypto.encrypt('data');
  const tampered = `${enc.slice(0, -2)}00`;
  assert.strictEqual(crypto.decrypt(tampered), null, 'GCM harus mendeteksi manipulasi');
});

test('preview aman untuk ditampilkan', () => {
  assert.strictEqual(crypto.preview('abcdefghijklmnop', 4), 'abcd...');
  assert.strictEqual(crypto.preview('ab', 4), 'ab');
  assert.strictEqual(crypto.preview(null), '');
});

test('encrypt nilai kosong mengembalikan null, bukan string kosong', () => {
  assert.strictEqual(crypto.encrypt(null), null);
  assert.strictEqual(crypto.encrypt(undefined), null);
});
