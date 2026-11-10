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
let adminDbOverride = null; // dipakai script lokal (proxy/REST)
function getAdminDb() {
  if (adminDbOverride) return adminDbOverride;
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
    if (MODE === 'memory') {
      pathSet(mem, path.split('/'), value === null ? undefined : value);
      return;
    }
    const ref = getAdminDb().ref(String(path));
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
  setAdminDbOverride(db) { adminDbOverride = db || null; },

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

  /* Ref admin Firebase (untuk query ter-chunk di backfill/retention).
     Mode memory → wrapper query ringan di atas memori (orderByKey+limit
     +startAt) supaya logic chunked sama di dua mode. */
  getAdminRefForBackfill() {
    if (MODE === 'firebase') return (p) => getAdminDb().ref(String(p));
    // memory: chunk sederhana — ambil semua key, slice sesuai cursor
    return (p) => ({
      orderByKey: () => this._memChunk(p),
    });
  },
  _memChunk(path) {
    let obj = pathGet(mem, String(path).split('/'));
    obj = obj && typeof obj === 'object' ? obj : {};
    const keys = Object.keys(obj).sort();
    return {
      startAt(from) { this._memFrom = from; this._memIncl = true; return this; },
      startAfter(from) { this._memFrom = from; this._memIncl = false; return this; },
      limitToFirst(n) { this._memLimit = n; return this; },
      once() {
        const from = this._memFrom || '';
        const lim = this._memLimit || keys.length;
        // startAfter = strictly greater; startAt = >=
        const slice = keys.filter((k) => (from ? (this._memIncl === false ? k > from : k >= from) : true)).slice(0, lim);
        const sub = {};
        for (const k of slice) sub[k] = obj[k];
        return Promise.resolve({ val: () => sub });
      },
    };
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
  /* Hapus record payment (retensi 30 hari) — juga buang dari index pending. */
  async removePayment(idtrx) {
    await fire.set(`payments/${encodeURIComponent(String(idtrx).trim())}`, null);
  },
  async allPayments() {
    const c = await fire.collection('payments');
    const out = {};
    for (const [k, v] of Object.entries(c)) if (!k.startsWith('__')) out[k] = v;
    return out;
  },

  /* Cache ringan pending (TTL default 10 detik) — buat endpoint /api/pending
     yang di-poll go-mutasi-poller tiap 10s. 1 query per TTL, bukan per request. */
  _pendingCache: null,
  async cachedPendingPayments(ttlMs = 10000) {
    const now = Date.now();
    if (this._pendingCache && now - this._pendingCache.ts < ttlMs) return this._pendingCache.items;
    const all = await this.pendingPayments();
    const items = Object.values(all)
      .filter((p) => p && p.status === 'pending')
      .map((p) => ({
        idtrx: p.idtrx,
        apikey: p.apikey || null,
        amount: Number(p.amount) || 0,
        created_at: p.created_at || null,
        expires_at: p.expires_at || null,
        pay_provider: p.pay_provider || null,
      }));
    this._pendingCache = { ts: now, items };
    return items;
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

  /* Pending khusus APIKEY (index ringan per-user, buat create fast +
     sweeper). Path: payments/__pending_by_apikey__/{apikey}.
     null = index belum ada (migrasi full-scan sekali).
     SENTINEL_EMPTY = ['~']: node di RTDB TIDAK boleh disimpan kosong
     (set([]) menghapus node → baca balik null → dianggap belum migrasi
     → full-scan berulang. '~' tidak akan pernah jadi idtrx valid, jadi
     aman sebagai placeholder; buang saat di-consume). */
  async getPendingByApikey(apikey) {
    const v = await fire.get(`payments/__pending_by_apikey__/${encodeURIComponent(String(apikey).trim())}`);
    if (Array.isArray(v)) return v.filter((x) => x !== '~');
    if (v && typeof v === 'object') {
      const keys = Object.keys(v).filter((k) => k !== '~');
      return keys.length ? keys.map((k) => v[k]) : [];
    }
    return null;
  },
  async setPendingByApikey(apikey, ids) {
    const clean = (ids || []).filter((x) => x && x !== '~');
    await fire.set(`payments/__pending_by_apikey__/${encodeURIComponent(String(apikey).trim())}`,
      clean.length ? clean : ['~']);
  },

  async getReservation(amount) { return fire.get(`payments/__amount_reservations__/${amount}`) || null; },
  async setReservation(amount, obj) { await fire.set(`payments/__amount_reservations__/${amount}`, obj); },
  async delReservation(amount) { await fire.set(`payments/__amount_reservations__/${amount}`, null); },

  async getLock(key) { return fire.get(`locks/${key}`) || null; },
  async setLock(key, obj) { await fire.set(`locks/${key}`, obj); },
  async delLock(key) { await fire.set(`locks/${key}`, null); },

  /* Idempotency index: idempotency_key → idtrx (per apikey). */
  async getIdempotentPayment(apikey, idempotencyKey) {
    const v = await fire.get(`payments/__idempotent__/${encodeURIComponent(String(apikey).trim())}/${encodeURIComponent(String(idempotencyKey).trim())}`);
    return v || null;
  },
  async setIdempotentPayment(apikey, idempotencyKey, idtrx) {
    await fire.set(`payments/__idempotent__/${encodeURIComponent(String(apikey).trim())}/${encodeURIComponent(String(idempotencyKey).trim())}`, idtrx);
  },

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

  /* Agregat bulanan admin (meta/stats/months/{YYYY-MM}).
   * fn(current) → new value. `extra` (opsional) = path root-→value
   * tambahan yang ikut ter-apply ATOMIK di server (mis. flag
   * stats_recorded di record payment).
   * - firebase : ref().multi({ pathBulan: next, ...extra })
   *   — read-then-write + atomic batch. Crash di tengah = dua-duanya
   *   belum ter-apply → migration ulang aman, TIDAK double-count.
   * - memory   : set berurutan. */
  async updateMonthStats(monthKey, fn, extra = null) {
    const p = `meta/stats/months/${String(monthKey)}`;
    if (MODE === 'memory') {
      const curV = await fire.get(p);
      const next = fn(curV && typeof curV === 'object' ? curV : null) ?? null;
      await fire.set(p, next);
      if (extra) for (const [ep, ev] of Object.entries(extra)) await fire.set(ep, ev);
      return next;
    }
    const curV = await fire.get(p); // read terakhir (nilai bulan)
    const next = fn(curV && typeof curV === 'object' ? curV : null) ?? null;
    const ops = { [p]: next };
    if (extra) Object.assign(ops, extra);
    await this.multiSet(ops); // ATOMIK di server (ref().multi)
    return next;
  },

  /* Satu update atomik multi-path — `db.ref().update(ops)` = atomic
   * multi-location update di server (semua ops ter-apply atau tidak ada
   * yang ter-apply). `ops` = { 'path/a': v, ... } */
  async multiSet(ops) {
    if (!ops || !Object.keys(ops).length) return;
    if (MODE === 'memory') {
      for (const [p, v] of Object.entries(ops)) await fire.set(p, v);
      return;
    }
    await getAdminDb().ref().update(ops);
  },
};
