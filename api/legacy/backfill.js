'use strict';

/**
 * Backfill users/* di RTDB biar semua field yang dibaca SPA tersedia:
 *   - name        (fallback dari email)
 *   - created_at  (fallback: created_at payment tertua [query ringan, 2.5s],
 *                  kalau query gagal/kosong → now)
 *   - telegram    (fallback dari telegram_id)
 *
 * Vercel function timeout bikin backfill 85k+ user ga muat di satu request.
 * Cara kerjanya:
 *  - parallel pool (concurrency 25) biar RTDB call overlap
 *  - checkpoint `meta/backfill_users_done/{key}` — invocation berikutnya
 *    lanjut dari titik terakhir, key yg sudah diproses tidak diulang
 *  - `?limit=N` — stop setelah N key (setiap invocation bikin progres pasti)
 *
 * Idempotent: hanya MENAMBAH field yang kosong, ga ngubek field yg sudah ada.
 */

const store = require('./store');

const CHECKPOINT_PREFIX = 'meta/backfill_users_done/';
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

  if (Object.keys(patch).length) {
    await store.patchUser(key, patch);
  }
  await store.setPath(CHECKPOINT_PREFIX + encodeURIComponent(key), true);
  return patch;
}

async function backfillUsers({ maxSeconds = 180, limit = 0, concurrency = 25 } = {}) {
  const keys = await store.getApikeySet();
  const valid = Object.entries(keys)
    .filter(([, v]) => v === true || v === 'true')
    .map(([k]) => k)
    .filter((k) => !k.startsWith('meta/'))
    .sort();

  // checkpoint batch (parallel)
  const toCheck = valid;
  const remaining = await (async () => {
    const out = [];
    for (let i = 0; i < toCheck.length; i += concurrency) {
      const chunk = toCheck.slice(i, i + concurrency);
      const results = await Promise.all(
        chunk.map(async (k) => {
          const done = await store.getPath(CHECKPOINT_PREFIX + encodeURIComponent(k));
          return done !== true && done !== 'true' ? k : null;
        })
      );
      out.push(...results.filter(Boolean));
    }
    return out;
  })();

  const todo = limit > 0 ? remaining.slice(0, limit) : remaining;
  const report = {
    total: valid.length,
    remainingBefore: remaining.length,
    processedThisRun: 0,
    changed: 0,
    details: [],
    finished: false,
    nextHint: null,
  };

  const deadline = Date.now() + maxSeconds * 1000;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
    while (cursor < todo.length && Date.now() < deadline) {
      const idx = cursor++;
      const key = todo[idx];
      try {
        const patch = await processUser(key);
        report.processedThisRun++;
        if (Object.keys(patch).length) {
          report.changed++;
          if (report.details.length < 100) report.details.push({ apikey: key, fields: Object.keys(patch) });
        }
      } catch (e) {
        // satu key gagal gak bikin seluruh batch gagal (checkpoint belum di-set → diulang invocation berikutnya)
      }
    }
  });

  await Promise.all(workers);

  report.finished = report.processedThisRun >= remaining.length;
  if (!report.finished) {
    report.nextHint = `processed ${report.processedThisRun}/${remaining.length} — jalankan lagi /cron/backfill-users (checkpoint sudah disimpan)`;
  }
  return report;
}

/* Hapus semua checkpoint (setelah backfill benar-benar kelar total). */
async function clearBackfillCheckpoints() {
  await store.setPath('meta/backfill_users_done', null);
}

module.exports = { backfillUsers, clearBackfillCheckpoints };
