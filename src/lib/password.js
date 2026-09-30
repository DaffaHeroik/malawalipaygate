'use strict';

const crypto = require('crypto');

/**
 * Hash password memakai scrypt bawaan Node (tanpa dependency tambahan).
 * Format simpan: scrypt$N$r$p$<saltHex>$<hashHex>
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

const scrypt = (password, salt, keylen) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, keylen, { N, r: R, p: P }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
};

const verifyPassword = async (password, stored) => {
  const value = String(stored || '');
  const parts = value.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(
      String(password),
      salt,
      expected.length,
      { N: Number(nRaw), r: Number(rRaw), p: Number(pRaw) },
      (error, out) => (error ? reject(error) : resolve(out))
    );
  });

  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
};

/** Token acak untuk verifikasi email / reset password. */
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

/** Hash token (disimpan di DB, bukan token mentah). */
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { hashPassword, verifyPassword, randomToken, hashToken };
