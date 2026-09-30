'use strict';

const config = require('../config');
const ids = require('../lib/ids');

/**
 * Google OAuth 2.0 (Authorization Code) — tanpa dependency tambahan.
 *
 * Nonaktif secara default (`GOOGLE_ENABLED=false`). Aktifkan dengan mengisi
 * `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` dan redirect URI:
 *   {BASE_URL}/auth/google/callback
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

const isEnabled = () =>
  config.google.enabled && Boolean(config.google.clientId) && Boolean(config.google.clientSecret);

const redirectUri = () => `${config.baseUrl}/auth/google/callback`;

const createState = () => ids.token(24);

const buildAuthUrl = (state) => {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params.toString()}`;
};

const exchangeCode = async (code, { timeoutMs = 10000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
      signal: controller.signal,
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.access_token) {
      return { ok: false, error: json.error_description || json.error || `HTTP ${response.status}` };
    }
    return { ok: true, tokens: json };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
};

const fetchProfile = async (accessToken, { timeoutMs = 10000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.email) return null;
    return {
      sub: json.sub || null,
      email: json.email,
      emailVerified: Boolean(json.email_verified),
      name: json.name || '',
      picture: json.picture || null,
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { isEnabled, redirectUri, createState, buildAuthUrl, exchangeCode, fetchProfile };
