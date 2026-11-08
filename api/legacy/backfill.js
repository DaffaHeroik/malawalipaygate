'use strict';

/**
 * Backfill users/* di RTDB biar semua field yang dibaca SPA tersedia:
 *   - name        (fallback dari email)
 *   - created_at  (fallback: created_at payment tertua, kalau kosong → now)
 *   - telegram    (fallback dari telegram_id)
 *
 * Hanya MENAMBAH field yang kosong — tidak mengubek field yang sudah ada.
 *
 * Vercel function timeout 60-300s → backfill 17rb user ga bisa dalam satu
 * request. Dipakai checkpoint di RTDB (`meta/backfill_users_done/{key}`)
 * supaya invocation berikutnya lanjut dari titik terakhir. Idempotent:
 * key yang udah diproses tidak diproses ulang.
 */

const store = require('./store');

const CHECKPOINT_PREFIX = 'meta/backfill_users_done/';
const BATCH_QUERY_TIMEOUT_MS = 20000;

async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

async function backfillUsers({ maxSeconds = 180, batch = 20 } = {}) {
  const keys = await store.getApikeySet();
  const valid = Object.entries(keys)
    .filter(([, v]) => v === true || v === 'true')
    .map(([k]) => k)
    .filter((k) => !k.startsWith('meta/'));
  valid.sort();

  const report = { total: valid.length, processed: 0, changed: 0, details: [], finished: false, nextHint: null };

  const deadline = Date.now() + maxSeconds * 1000;
  let i = 0;

  while (i < valid.length) {
    // ambil batch key
    const batchKeys = valid.slice(i, i + batch);

    // skip key yang sudah di-checkpoint
    const pending = [];
    for (const k of batchKeys) {
      const done = await store.getPath(CHECKPOINT_PREFIX + encodeURIComponent(k));
      if (done !== true && done !== 'true') pending.push(k);
    }
    report.processed += batchKeys.length - pending.length;

    for (const key of pending) {
      const u = (await store.getUser(key)) || {};
      const patch = {};

      if (!u.name && u.email) patch.name = String(u.email).split('@')[0].slice(0, 60);
      if (!u.created_at) {
        let times = [];
        try {
          const pays = await withTimeout(store.queryPaymentsByApikey(key), BATCH_QUERY_TIMEOUT_MS);
          times = Object.values(pays).map((p) => p && p.created_at).filter(Boolean);
        } catch (_) {
          // query melampaui timeout → pakai now (lebih baik ada daripada '-')
        }
        patch.created_at = times.sort()[0] || new Date().toISOString();
      }
      if (u.telegram_id && !u.telegram) patch.telegram = u.telegram_id;

      if (Object.keys(patch).length) {
        report.changed += 1;
        report.details.push({ apikey: key, fields: Object.keys(patch) });
        await store.patchUser(key, patch);
      }
      await store.setPath(CHECKPOINT_PREFIX + encodeURIComponent(key), true);
    }

    i += batch;
    if (Date.now() >= deadline) {
      report.nextHint = `lanjut dari index ${i}/${valid.length}`;
      break;
    }
  }
  if (i >= valid.length) report.finished = true;
  return report;
}

/* Hapus checkpoint (setelah backfill selesai total). */
async function clearBackfillCheckpoints() {
  await store.setPath('meta/backfill_users_done', null);
}

module.exports = { backfillUsers, clearBackfillCheckpoints };
