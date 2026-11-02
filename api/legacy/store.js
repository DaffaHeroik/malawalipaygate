'use strict';

/**
 * Klien storage lapisan backend legacy (adapter kontrak PayKita).
 *
 * Backend:
 *  - `memory`  → in-memory (dev lokal / test, tanpa Firebase)
 *  - `firebase`→ Firebase RTDB via REST (FIREBASE_URL + opsional
 *               FIREBASE_SERVICE_ACCOUNT_JSON untuk access token admin).
 *
 * Skema path identik dengan backend lama (malawali-gw-server):
 *  apikeys/{key}=true, users/{apikey}, payments/{idtrx},
 *  payments/__amount_reservations__/{amount}, locks/{key},
 *  meta/payment_queue_cursor, logs/*.
 */

const crypto = require('crypto');

const FIREBASE_URL = String(process.env.FIREBASE_URL || 'https://heropayment-1328-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');
const MODE = process.env.LEGACY_STORE_MODE === 'memory' ? 'memory' : 'firebase';

/* ─────────────────────────── memori ─────────────────────────── */
const mem = {
  apikeys: {}, users: {}, payments: {}, reservations: {}, locks: {}, meta: {}, webhooks: {}, withdraws: {}, logs: {},
};

function pathGet(root, p) {
  let node = root;
  for (const part of p) {
    if (node === undefined || node === null) return undefined;
    node = node[part];
  }
  return node;
}

function pathSet(root, p, value) {
  if (p.length === 0) return;
  let node = root;
  for (let i = 0; i < p.length - 1; i++) {
    if (typeof node[p[i]] !== 'object' || node[p[i]] === null) node[p[i]] = {};
    node = node[p[i]];
  }
  node[p[p.length - 1]] = value;
}

const fire = {
  mode: MODE,
  firebaseReady: MODE === 'firebase',

  /* GET path (dot-separated) → value|null (undefined = tidak ada) */
  async get(path) {
    if (MODE === 'memory') return pathGet(mem, path.split('/')) ?? null;
    return firebaseRest('GET', path);
  },

  /* SET path → value (null menghapus) */
  async set(path, value) {
    if (MODE === 'memory') {
      pathSet(mem, path.split('/'), value === null ? undefined : value);
      return;
    }
    await firebaseRest(value === null ? 'DELETE' : 'PUT', path, value === null ? undefined : JSON.stringify(value));
  },

  /* PATCH path → object partial */
  async patch(path, partial) {
    if (MODE === 'memory') {
      const cur = pathGet(mem, path.split('/')) || {};
      pathSet(mem, path.split('/'), { ...cur, ...partial });
      return;
    }
    await firebaseRest('PATCH', path, JSON.stringify(partial));
  },

  /* Ambil koleksi penuh */
  async collection(name) {
    const v = await this.get(name);
    return v && typeof v === 'object' ? v : {};
  },
};

/* ─────────────────── firebase REST (+ service account) ─────────────────── */
let saToken = null;
let saTokenExp = 0;

async function getAccessToken() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!sa) return null;
  if (saToken && Date.now() < saTokenExp - 60000) return saToken;
  const svc = JSON.parse(sa);
  // JWT RS256 → exchange ke OAuth2 access token Firebase.
  const b64url = (b) => Buffer.from(b).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    iss: svc.client_email, scope: 'https://www.googleapis.com/auth/firebase.database',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = b64url(crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(svc.private_key));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${payload}.${sig}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Gagal ambil access token Firebase: ' + data.error_description);
  saToken = data.access_token;
  saTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return saToken;
}

async function firebaseRest(method, path, body) {
  const encodedPath = String(path)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const url = `${FIREBASE_URL}/${encodedPath}.json`;
  const token = await getAccessToken();
  const res = await fetch(token ? `${url}?access_token=${token}` : url, {
    method,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body,
    timeout: 8000,
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    const e = new Error(`Firebase ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : (await res.text());
}

/* ─────────────────────────── API publik ─────────────────────────── */

const keyPath = (k) => `apikeys/${encodeURIComponent(String(k).trim())}`;

module.exports = {
  MODE,
  FIREBASE_URL,

  async verifyApiKey(apikey) {
    const v = await fire.get(keyPath(apikey));
    return v === true || v === 'true';
  },

  async setApiKey(apikey, valid = true) { await fire.set(keyPath(apikey), valid); },

  /* akses path umum (dipakai deteksi/claim): path pakai pemisah '/' */
  async getPath(p) {
    const v = await fire.get(String(p));
    return v === undefined ? null : v;
  },
  async setPath(p, value) {
    await fire.set(String(p), value === undefined ? null : value);
  },

  async apikeyIsValid(apikey) { return this.verifyApiKey(apikey); },

  async getUser(apikey) {
    const u = await fire.get(`users/${encodeURIComponent(String(apikey).trim())}`);
    return u || null;
  },

  async saveUser(apikey, obj) { await fire.set(`users/${encodeURIComponent(String(apikey).trim())}`, obj); },
  async patchUser(apikey, partial) { await fire.patch(`users/${encodeURIComponent(String(apikey).trim())}`, partial); },

  async getApikeySet() { return fire.collection('apikeys'); },

  async getPayment(idtrx) {
    const p = await fire.get(`payments/${encodeURIComponent(String(idtrx).trim())}`);
    return p || null;
  },
  async savePayment(idtrx, obj) { await fire.set(`payments/${encodeURIComponent(String(idtrx).trim())}`, obj); },
  async patchPayment(idtrx, partial) { await fire.patch(`payments/${encodeURIComponent(String(idtrx).trim())}`, partial); },
  async allPayments() {
    const c = await fire.collection('payments');
    const out = {};
    for (const [k, v] of Object.entries(c)) if (!k.startsWith('__')) out[k] = v;
    return out;
  },

  async getReservation(amount) { return fire.get(`payments/__amount_reservations__/${amount}`) || null; },
  async setReservation(amount, obj) { await fire.set(`payments/__amount_reservations__/${amount}`, obj); },
  async delReservation(amount) { await fire.set(`payments/__amount_reservations__/${amount}`, null); },

  async getLock(key) { return fire.get(`locks/${key}`) || null; },
  async setLock(key, obj) { await fire.set(`locks/${key}`, obj); },
  async delLock(key) { await fire.set(`locks/${key}`, null); },

  async getQueueCursor() {
    const v = await fire.get('meta/payment_queue_cursor');
    const n = Number(v);
    return Number.isInteger(n) ? n : 0;
  },
  async setQueueCursor(n) { await fire.set('meta/payment_queue_cursor', n); },

  async getWebhooks(apikey) {
    const v = await fire.get(`webhooks/${encodeURIComponent(String(apikey).trim())}`);
    if (Array.isArray(v)) return v;
    return [];
  },
  async setWebhooks(apikey, list) { await fire.set(`webhooks/${encodeURIComponent(String(apikey).trim())}`, list || []); },

  async getWithdraws(apikey) {
    const v = await fire.get(`withdraws/${encodeURIComponent(String(apikey).trim())}`);
    return Array.isArray(v) ? v : (v ? [v] : []);
  },

  async log(kind, obj) {
    // push via meta (menghindari push() REST) — pakai counter
    const c = Number(await fire.get(`meta/counter_${kind}`)) || 0;
    await fire.set(`logs/${kind}/${c}`, obj);
    await fire.set(`meta/counter_${kind}`, c + 1);
  },
};
