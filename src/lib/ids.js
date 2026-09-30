'use strict';

const crypto = require('crypto');
const { customAlphabet } = require('nanoid');
const brand = require('../config/brand');

const LOWERCASE_NUM = '0123456789abcdefghijklmnopqrstuvwxyz';
const hexAlphabet = '0123456789abcdef';

const nano = customAlphabet(LOWERCASE_NUM, 20);
const nanoShort = customAlphabet(LOWERCASE_NUM, 8);
const nanoHex = customAlphabet(hexAlphabet, 12);

/** pay_xxxxxxxxxxxxxxxxxxxx */
const orderId = () => `${brand.orderIdPrefix}${nano()}`;

/** evt_xxxxxxxxxxxxxxxxxxxx */
const eventId = () => `${brand.eventIdPrefix}${nano()}`;

/** dev_xxxxxxxx */
const deviceId = () => `dev_${nanoShort()}`;

/** pk_live_<32 char> */
const apiKey = () => `${brand.apiKeyPrefix}${crypto.randomBytes(24).toString('base64url')}`;

/** Token acak untuk verifikasi email / reset password (URL-safe). */
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Kode OTP angka 6 digit. */
const numericCode = (length = 6) => {
  let out = '';
  for (let i = 0; i < length; i += 1) out += crypto.randomInt(0, 10);
  return out;
};

/** Kode unik random sesuai jumlah digit (1-3 digit). */
const uniqueCode = (digits = 2) => {
  const d = Math.min(3, Math.max(1, Number(digits) || 1));
  const min = 10 ** (d - 1);
  const max = 10 ** d - 1;
  return crypto.randomInt(min, max + 1);
};

/** Short id buat log / request id. */
const requestId = () => `req_${nanoHex()}`;

const secret = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

module.exports = {
  orderId,
  eventId,
  deviceId,
  apiKey,
  token,
  numericCode,
  uniqueCode,
  requestId,
  secret,
};
