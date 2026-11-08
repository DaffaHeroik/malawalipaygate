'use strict';

/**
 * Backfill users/* di RTDB biar semua field yang dibaca SPA tersedia:
 *   - name        (fallback dari email)
 *   - created_at  (fallback: created_at payment tertua, kalau kosong → now)
 *   - telegram    (fallback dari telegram_id)
 *
 * Desain Vercel-function-friendly:
 *  - Chunk `users` query (orderByKey+limitToFirst) → snapshot SUDAH berisi
 *    data user, jadi ga perlu getUser ulang per key.
 *  - Per user HANYA 1 RTDB call (patchUser) kalau ada field kosong.
 *  - Query payments cuma dipanggil kalau created_at kosong.
 *  - Cursor di `meta/backfill_users_cursor` (key terakhir chunk) — invocation
 *    berikutnya lanjut dari situ. Kalau mati di tengah chunk, chunk diulang
 *    (idempotent — field yang sudah terisi ga di-patch ulang).
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

function neededPatch(u) {
  const patch = {};
  if (!u.name && u.email) patch.name = String(u.email).split('@')[0].slice(0, 60);
  if (!u.created_at) patch.__need_created_at__ = true;
  if (u.telegram_id && !u.telegram) patch.telegram = u.telegram_id;
  return patch;
}

async function backfillUsers({ limit = 300, concurrency = 20 } = {}) {
  const getRef = store.getAdminRefForBackfill();
  if (!getRef) throw new Error('backfill butuh mode firebase');
  const cursor = (await store.getPath(CURSOR_PATH)) || '';

  let q = getRef('users').orderByKey().limitToFirst(Number(limit));
  if (cursor) q = q.startAt(cursor);
  const snap = await q.once('value');
  const chunk = snap.val() || {};
  const keys = Object.keys(chunk).sort();

  const report = {
    keysInChunk: keys.length,
    processedThisRun: 0,
    patched: 0,
    details: [],
    cursor,
    hasMore: keys.length >= Number(limit),
    finished: false,
    nextHint: null,
  };

  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, keys.length) }, async () => {
    while (i < keys.length) {
      const key = keys[i++];
      const u = chunk[key] || {};
      const patch = neededPatch(u);
      if (!Object.keys(patch).length) {
        report.processedThisRun++;
        continue; // semua field sudah ada — nol RTDB call
      }
      if (patch.__need_created_at__) {
        delete patch.__need_created_at__;
        let times = [];
        try {
          const pays = await withTimeout(store.queryPaymentsByApikey(key), PAYMENT_QUERY_TIMEOUT_MS);
          times = Object.values(pays).map((p) => p && p.created_at).filter(Boolean);
        } catch (_) {
          // timeout → pakai now
        }
        patch.created_at = times.sort()[0] || new Date().toISOString();
      }
      try {
        await store.patchUser(key, patch);
        report.patched++;
        report.processedThisRun++;
        if (report.details.length < 100) report.details.push({ apikey: key, fields: Object.keys(patch) });
      } catch (_) {
        // gagal → chunk diulang invocation berikutnya
      }
    }
  });
  await Promise.all(workers);

  if (keys.length) {
    const lastKey = keys[keys.length - 1];
    await store.setPath(CURSOR_PATH, lastKey);
    report.cursor = lastKey;
  }
  report.finished = !report.hasMore;
  if (!report.finished) report.nextHint = `cursor=${report.cursor} — jalankan ulang /cron/backfill-users`;
  return report;
}

async function resetCursor() {
  await store.setPath(CURSOR_PATH, null);
  return true;
}

module.exports = { backfillUsers, resetCursor };
