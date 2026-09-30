'use strict';

const config = require('../config');

/**
 * Verifikasi Cloudflare Turnstile di sisi server.
 *
 * - Kalau `TURNSTILE_DISABLED=true` atau secret belum diisi → middleware lewat
 *   (mode dev).
 * - Token diambil dari field `cf-turnstile-response` (bawaan widget Cloudflare)
 *   atau `turnstile_token` (fallback manual).
 * - Gagal → flash + redirect, tidak pernah melempar error.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESPONSE_FIELD = 'cf-turnstile-response';

const isEnabled = () => !config.turnstile.disabled && Boolean(config.turnstile.secretKey);

const readToken = (req) =>
  String(
    req.body?.[RESPONSE_FIELD] || req.body?.turnstile_token || req.get?.('cf-turnstile-response') || ''
  ).trim();

/** Panggil endpoint siteverify. Return { success, codes, raw }. */
const verifyToken = async (token, { ip = null, timeoutMs = 8000 } = {}) => {
  if (!token) return { success: false, codes: ['missing-input-response'] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = new URLSearchParams({
      secret: config.turnstile.secretKey,
      response: token,
    });
    if (ip) body.set('remoteip', String(ip));

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    const json = await response.json().catch(() => ({}));
    return {
      success: Boolean(json.success),
      codes: json['error-codes'] || [],
      raw: json,
    };
  } catch (error) {
    return { success: false, codes: ['internal-error'], error: error.message };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Middleware guard.
 * @param {string|Function} redirectTo path redirect saat gagal (atau fungsi (req)=>path)
 */
const guard = (redirectTo = '/login') => async (req, res, next) => {
  if (!isEnabled()) return next();

  const to = typeof redirectTo === 'function' ? redirectTo(req) : redirectTo;
  const token = readToken(req);

  if (!token) {
    req.flash('danger', 'Selesaikan verifikasi keamanan (Turnstile) terlebih dahulu.');
    return res.redirect(to);
  }

  const result = await verifyToken(token, { ip: req.ip });
  if (!result.success) {
    req.flash('danger', 'Verifikasi keamanan gagal atau kedaluwarsa. Coba lagi.');
    return res.redirect(to);
  }

  return next();
};

module.exports = { isEnabled, readToken, verifyToken, guard };
