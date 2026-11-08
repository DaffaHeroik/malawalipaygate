'use strict';

/**
 * Backfill users/* di RTDB biar semua field yang dibaca SPA tersedia:
 *   - name        (fallback dari email)
 *   - created_at  (fallback: created_at payment tertua [query 2.5s timeout],
 *                  kalau query gagal/kosong → now)
 *   - telegram    (fallback dari telegram_id)
 *
 * Cara kerja (Vercel function timeout-friendly):
 *  - Kunci di-sorted → urutannya stabil antar-invocation
 *  - Cursor index di `meta/backfill_users_cursor` — tiap invocation mulai
 *    dari situ, proses ?limit=N key, simpan cursor baru. Gak ada scan
 *    85k checkpoint tiap run.
 *  - `?action=reset` = balik cursor ke 0
 *
 * Idempotent: hanya MENAMBAH field yang kosong, ga ngubek field yg sudah ada.
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

async function backfillUsers({ maxSeconds = 180, limit = 0, concurrency = 10 } = {}) {
  const keys = await store.getApikeySet();
  const valid = Object.entries(keys)
    .filter(([, v]) => v === true || v === 'true')
    .map(([k]) => k)
    .filter((k) => !k.startsWith('meta/'))
    .sort();

  const cursorRaw = await store.getPath(CURSOR_PATH);
  const start = Math.max(0, Math.min(Number(cursorRaw) || 0, valid.length));

  const count = limit > 0 ? Math.min(limit, valid.length - start) : valid.length - start;
  const slice = valid.slice(start, start + count);

  const report = {
    total: valid.length,
    startedAt: start,
    processedThisRun: 0,
    changed: 0,
    details: [],
    cursor: start,
    finished: false,
    nextHint: null,
  };

  const deadline = Date.now() + maxSeconds * 1000;
  let i = 0;

  // pool: tiap worker ambil key dari slice (atomic via ++), checkpoint cursor
  // disimpan SETELAH batch kecil biar progres tidak banyak yang hilang saat 524.
  const workers = Array.from({ length: Math.min(concurrency, slice.length) }, async () => {
    while (i < slice.length && Date.now() < deadline) {
      const idx = i++;
      const key = slice[idx];
      try {
        const patch = await processUser(key);
        report.processedThisRun++;
        if (Object.keys(patch).length) {
          report.changed++;
          if (report.details.length < 100) report.details.push({ apikey: key, fields: Object.keys(patch) });
        }
      } catch (_) {
        // key gagal: tetap lanjut (field kosong bukan blocker), tidak dicekpoint
      }
      // checkpoint tiap 50 key — kalau function mati, max 50 x concurrency hilang
      if (report.processedThisRun % 50 === 0) {
        await store.setPath(CURSOR_PATH, start + report.processedThisRun);
        report.cursor = start + report.processedThisRun;
      }
    }
  });
  await Promise.all(workers);

  const advanced = report.processedThisRun;
  await store.setPath(CURSOR_PATH, start + advanced);
  report.cursor = start + advanced;
  report.finished = start + advanced >= valid.length;
  if (!report.finished) {
    report.nextHint = `cursor=${start + advanced}/${valid.length} — jalankan lagi /cron/backfill-users`;
  }
  return report;
}

async function resetCursor() {
  await store.setPath(CURSOR_PATH, 0);
  return true;
}

module.exports = { backfillUsers, resetCursor };
