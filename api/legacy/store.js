'use strict';

/**
 * Klien storage lapisan backend legacy (adapter kontrak PayKita).
 *
 * Backend:
 *  - `memory`  → in-memory (dev lokal / test, tanpa Firebase)
 *  - `firebase`→ Firebase RTDB via firebase-admin SDK (butuh
 *               FIREBASE_SERVICE_ACCOUNT_JSON; admin SDK bypass security
 *               rules — jalur REST publik `access_token` tetap kena rules 401).
 *
 * Skema path identik dengan backend lama (malawali-gw-server):
 *  apikeys/{key}=true, users/{apikey}, payments/{idtrx},
 *  payments/__amount_reservations__/{amount}, locks/{key},
 *  meta/payment_queue_cursor, logs/*.
 */

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

/* ─────────────────── firebase (admin SDK) ─────────────────── */
const FIREBASE_URL = String(process.env.FIREBASE_URL || 'https://heropayment-1328-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');
const MODE = process.env.LEGACY_STORE_MODE === 'memory' ? 'memory' : 'firebase';

let adminDb = null;
function getAdminDb() {
  if (adminDb) return adminDb;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!sa) {
    throw new Error('FIREBASE_STORE: set FIREBASE_SERVICE_ACCOUNT_JSON (service account heropayment-1328)');
  }
  const admin = require('firebase-admin');
  const { getDatabase } = require('firebase-admin/database');
  const app = admin.initializeApp({
    credential: admin.cert(JSON.parse(sa)),
    databaseURL: FIREBASE_URL,
  });
  adminDb = getDatabase(app);
  return adminDb;
}
const fire = {
  mode: MODE,

  /* GET path (dot-separated) → value|null (undefined = tidak ada) */
  async get(path) {
    if (MODE === 'memory') return pathGet(mem, path.split('/')) ?? null;
    const snap = await getAdminDb().ref(String(path)).once('value');
    return snap.val() ?? null;
  },

  /* SET path → value (null menghapus) */
  async set(path, value) {
    const ref = getAdminDb().ref(String(path));
    if (MODE === 'memory') {
      pathSet(mem, path.split('/'), value === null ? undefined : value);
      return;
    }
    if (value === null || value === undefined) await ref.remove();
    else await ref.set(value);
  },

  /* PATCH path → object partial */
  async patch(path, partial) {
    if (MODE === 'memory') {
      const cur = pathGet(mem, path.split('/')) || {};
      pathSet(mem, path.split('/'), { ...cur, ...partial });
      return;
    }
    await getAdminDb().ref(String(path)).update(partial);
  },

  /* Ambil koleksi penuh */
  async collection(name) {
    const v = await this.get(name);
    return v && typeof v === 'object' ? v : {};
  },
};

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

  /* Query terfilter (hemat payload — full download 16k records ≈ 60s, ga kepake di hot path).
   * Memory mode: filter di memori. */
  async queryPaymentsByApikey(apikey) {
    const key = String(apikey).trim();
    if (MODE === 'memory') {
      const out = {};
      for (const [k, v] of Object.entries(mem.payments)) {
        if (!k.startsWith('__') && v && v.apikey === key) out[k] = v;
      }
      return out;
    }
    const snap = await getAdminDb()
      .ref('payments')
      .orderByChild('apikey')
      .equalTo(String(apikey).trim())
      .once('value');
    return snap.val() || {};
  },
  async pendingPayments() {
    if (MODE === 'memory') {
      const out = {};
      for (const [k, v] of Object.entries(mem.payments)) {
        if (!k.startsWith('__') && v && v.status === 'pending') out[k] = v;
      }
      return out;
    }
    const snap = await getAdminDb()
      .ref('payments')
      .orderByChild('status')
      .equalTo('pending')
      .once('value');
    return snap.val() || {};
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
