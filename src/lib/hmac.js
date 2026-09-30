'use strict';

const crypto = require('crypto');

/**
 * Data yang ditandatangani: timestamp + "." + raw request body
 * Algoritma: HMAC-SHA256, dikirim sebagai "v1=<hex>"
 */

const SIGNATURE_HEADER = 'x-malawali-signature';
const TIMESTAMP_HEADER = 'x-malawali-timestamp';
const EVENT_HEADER = 'x-malawali-event';

const sign = (secret, timestamp, rawBody) =>
  crypto
    .createHmac('sha256', String(secret))
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

const format = (hex) => `v1=${hex}`;

const parse = (headerValue) => String(headerValue || '').replace(/^v1=/, '');

/** Perbandingan waktu-konstan. */
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const verify = ({ secret, timestamp, rawBody, signature }) => {
  const received = parse(signature);
  if (!received) return false;
  const expected = sign(secret, timestamp, rawBody);
  return safeEqual(expected, received);
};

/** Toleransi waktu (detik) biar webhook lama tidak bisa di-replay selamanya. */
const isFreshTimestamp = (timestamp, toleranceSeconds = 300) => {
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(Math.floor(Date.now() / 1000) - ts) <= toleranceSeconds;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

module.exports = {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  EVENT_HEADER,
  sign,
  format,
  parse,
  verify,
  safeEqual,
  isFreshTimestamp,
  nowSeconds,
};
