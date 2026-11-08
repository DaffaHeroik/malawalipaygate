'use strict';

/**
 * Backfill users/* di RTDB biar semua field yang dibaca SPA tersedia:
 *   - name        (fallback dari email)
 *   - created_at  (fallback: created_at payment tertua [query 2.5s timeout],
 *                  kalau query gagal/kosong → now)
 *   - telegram    (fallback dari telegram_id)
 *
 * DESAIN (Vercel function timeout-friendly):
 *  - TIDAK full-download apikeys/* (85k key = >60s sendiri, selalu 524).
 *  - Iterasi `users/` per-batch: orderByKey().startAt(cursor).limitToFirst(N).
 *  - Cursor = key terakhir yang diproses (string), disimpan di
 *    `meta/backfill_users_cursor`. Tiap invocation lanjut dari situ.
 *  - Idempotent: hanya MENAMBAH field yang kosong, ga ngubek yg sudah ada.
 */

const store = require('./store');

const CURSOR_PATH = 'meta/backfill_users_cursor';
const PAYMENT_QUERY_TIMEOUT_MS = 2500;

async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

async function processUser(key) {
  const u = (await store.getUser(key)) || {};
  const patch = {};

  if (!u.name && u.email) patch.name = String(u.email).split('@')[0].slice(0, 60);
  if (!u.created_at) {
    let times = [];
    try {
      const pays = await withTimeout(store.queryPaymentsByApikey(key), PAYMENT_QUERY_TIMEOUT_MS);
      times = Object.values(pays).map((p) => p && p.created_at).filter(Boolean);
    } catch (_) {
      // query gagal / lambat → pakai now (lebih baik ada daripada '-')
    }
    patch.created_at = times.sort()[0] || new Date().toISOString();
  }
  if (u.telegram_id && !u.telegram) patch.telegram = u.telegram_id;

  if (Object.keys(patch).length) await store.patchUser(key, patch);
  return patch;
}

async function backfillUsers({ limit = 300, concurrency = 10 } = {}) {
  const getRef = store.getAdminRefForBackfill;
  if (!getRef) throw new Error('backfill butuh mode firebase');
  const cursor = (await store.getPath(CURSOR_PATH)) || '';

  // chunk users/ mulai dari cursor (startAt inklusif — key pertama diulang,
  // idempotent jadi aman), ambil `limit` record.
  let q = getRef('users').orderByKey().limitToFirst(Number(limit));
  if (cursor) q = q.startAt(cursor);
  const snap = await q.once('value');
  const chunk = snap.val() || {};
  const keys = Object.keys(chunk).sort();

  const report = {
    keysInChunk: keys.length,
    processedThisRun: 0,
    changed: 0,
    details: [],
    cursor: cursor,
    hasMore: keys.length >= Number(limit),
    finished: false,
    nextHint: null,
  };

  // queue bersama, concurrency worker
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, keys.length) }, async () => {
    while (i < keys.length) {
      const key = keys[i++];
      try {
        const patch = await processUser(key);
        report.processedThisRun++;
        if (Object.keys(patch).length) {
          report.changed++;
          if (report.details.length < 100) report.details.push({ apikey: key, fields: Object.keys(patch) });
        }
      } catch (_) {
        // skip, invocation berikutnya diulang (idempotent)
      }
    }
  });
  await Promise.all(workers);

  // cursor = key terakhir di chunk; key yang gagal tetap diulang
  // (field-nya masih kosong → idempotent)
  const lastKey = keys.length ? keys[keys.length - 1] : cursor;
  if (keys.length) await store.setPath(CURSOR_PATH, lastKey);
  report.cursor = lastKey;
  report.finished = !report.hasMore;
  if (!report.finished) report.nextHint = 'ada lagi — jalankan ulang /cron/backfill-users (cursor tersimpan)';
  return report;
}

async function resetCursor() {
  await store.setPath(CURSOR_PATH, null);
  return true;
}

module.exports = { backfillUsers, resetCursor };
