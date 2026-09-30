'use strict';

const crypto = require('crypto');

const config = require('../config');
const ids = require('../lib/ids');

/**
 * Autentikasi & identitas perangkat Malawali Listener (APK Android).
 *
 * Alur:
 *   1. Merchant mendaftarkan perangkat lewat `POST /api/listener/register`
 *      memakai API key Project Utama → server mengembalikan **device token**
 *      (hanya tampil sekali, yang disimpan cuma hash-nya).
 *   2. APK mengirim notifikasi pembayaran ke `POST /api/listener/push`
 *      dengan header `x-device-token`.
 */

const TOKEN_PREFIX = 'dev_live_';

const pepper = () => config.crypto.apiKeyPepper || 'dev-listener-pepper';

/** Simpan hash, bukan token mentah. */
const hashToken = (token) =>
  crypto
    .createHash('sha256')
    .update(`${pepper()}:${String(token || '')}`)
    .digest('hex');

/** dev_live_<base64url 32 byte> */
const generateToken = () => `${TOKEN_PREFIX}${ids.token(24)}`;

const isDeviceToken = (value) => String(value || '').startsWith(TOKEN_PREFIX);

/** dev_live_••••••abcd */
const maskToken = (token) => {
  const value = String(token || '');
  if (value.length < 16) return value;
  return `${value.slice(0, 12)}${'•'.repeat(10)}${value.slice(-4)}`;
};

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_.:-]{6,64}$/;

/** Normalisasi payload registrasi dari APK. */
const normalizeRegistration = (body = {}) => {
  const rawId = String(body.device_id || body.deviceId || '').trim();
  const enabledSources = Array.isArray(body.enabled_sources)
    ? body.enabled_sources
    : Array.isArray(body.sources)
      ? body.sources
      : [];

  return {
    deviceId: DEVICE_ID_PATTERN.test(rawId) ? rawId : ids.deviceId(),
    name: String(body.name || body.device_name || 'Perangkat Android').slice(0, 80),
    model: String(body.model || '').slice(0, 80),
    androidVersion: String(body.android_version || body.androidVersion || '').slice(0, 20),
    appVersion: String(body.app_version || body.appVersion || '').slice(0, 20),
    notificationAccess: body.notification_access !== false,
    enabledSources: enabledSources
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20),
  };
};

/** Normalisasi payload push pembayaran dari APK. */
const normalizePayment = (body = {}) => {
  const amount = Math.round(Number(body.amount));
  const provider = String(body.provider || '').trim().toLowerCase();
  const providerTransactionId = String(
    body.provider_transaction_id || body.transaction_id || body.reference || ''
  ).trim();
  const occurredAtRaw = body.occurred_at || body.occurredAt || body.time;
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date();

  return {
    provider,
    providerTransactionId: providerTransactionId.slice(0, 128),
    amount: Number.isFinite(amount) ? amount : NaN,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    raw: body,
  };
};

module.exports = {
  TOKEN_PREFIX,
  hashToken,
  generateToken,
  isDeviceToken,
  maskToken,
  normalizeRegistration,
  normalizePayment,
};
