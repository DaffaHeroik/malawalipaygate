'use strict';

const crypto = require('crypto');

const config = require('../config');
const ids = require('../lib/ids');

/** pk_live_••••••••••••abcd */
const maskKey = (fullKey) => {
  const value = String(fullKey || '');
  if (value.length < 12) return value;
  return `${value.slice(0, 8)}${'•'.repeat(12)}${value.slice(-4)}`;
};

/** Simpan hash, bukan key mentah. */
const hashKey = (fullKey) =>
  crypto
    .createHash('sha256')
    .update(`${config.crypto.apiKeyPepper}:${String(fullKey || '')}`)
    .digest('hex');

/** Buat key baru + bentuk turunannya siap simpan. */
const generateKey = () => {
  const fullKey = ids.apiKey();
  return {
    fullKey,
    apiKeyHash: hashKey(fullKey),
    apiKeyMasked: maskKey(fullKey),
  };
};

const isLiveKey = (value) => String(value || '').startsWith('pk_live_');

module.exports = { maskKey, hashKey, generateKey, isLiveKey };
