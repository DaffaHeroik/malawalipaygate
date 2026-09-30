'use strict';

const crypto = require('crypto');

const config = require('../config');

/**
 * Enkripsi kredensial provider (token Shopee, sesi GoPay, dsb).
 *
 * - Algoritma: AES-256-GCM (authenticated encryption)
 * - Kunci: `CREDENTIAL_ENC_KEY` (hex 64 char / utf8 32 byte / apa pun → di-sha256)
 * - Format simpan: `v1:<iv hex>:<tag hex>:<cipher hex>`
 *
 * Tanpa `CREDENTIAL_ENC_KEY` di development, kunci diturunkan dari nilai dev
 * supaya alur tetap jalan; di produksi `encrypt` menolak (return null) agar
 * kredensial tidak pernah tersimpan sebagai plaintext.
 */

const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit nonce untuk GCM
const DEV_FALLBACK = 'malawali-dev-credential-key-do-not-use-in-prod';

let cachedKey = null;

const deriveKey = () => {
  if (cachedKey) return cachedKey;

  const raw = config.crypto.credentialEncKey;

  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    cachedKey = Buffer.from(raw, 'hex');
    return cachedKey;
  }

  if (raw && Buffer.byteLength(raw, 'utf8') === 32) {
    cachedKey = Buffer.from(raw, 'utf8');
    return cachedKey;
  }

  const source = raw || (config.isProd ? '' : DEV_FALLBACK);
  if (!source) {
    cachedKey = null;
    return null;
  }

  // Nilai apa pun yang tidak pas → turunkan kunci 32 byte lewat sha256.
  cachedKey = crypto.createHash('sha256').update(source).digest();
  return cachedKey;
};

const hasKey = () => Boolean(deriveKey());

/** Enkripsi nilai apa pun menjadi string `v1:…`. Return null bila tanpa kunci. */
const encrypt = (plain) => {
  if (plain === undefined || plain === null) return null;

  const key = deriveKey();
  if (!key) return null;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('hex'), tag.toString('hex'), ciphertext.toString('hex')].join(':');
};

/** Dekripsi string `v1:…`. Return null bila tidak valid / tanpa kunci. */
const decrypt = (enc) => {
  const value = String(enc || '');
  if (!value.startsWith(`${VERSION}:`)) return null;

  const key = deriveKey();
  if (!key) return null;

  const parts = value.split(':');
  if (parts.length !== 4) return null;

  try {
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return plain.toString('utf8');
  } catch (_) {
    // Kunci salah / data rusak → jangan lempar ke pemanggil.
    return null;
  }
};

/** Enkripsi objek (JSON). */
const encryptJson = (obj) => encrypt(JSON.stringify(obj ?? {}));

/** Dekripsi objek (JSON). Return null bila gagal. */
const decryptJson = (enc) => {
  const raw = decrypt(enc);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

/** Preview aman untuk ditampilkan (mis. 8 karakter awal). */
const preview = (plain, length = 8) => {
  const value = String(plain || '');
  if (value.length <= length) return value;
  return `${value.slice(0, length)}...`;
};

/** Deteksi apakah string adalah ciphertext versi ini. */
const isEncrypted = (value) => String(value || '').startsWith(`${VERSION}:`);

module.exports = {
  VERSION,
  hasKey,
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  preview,
  isEncrypted,
};
