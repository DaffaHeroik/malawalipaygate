'use strict';

/**
 * Backfill users/* di RTDB biar semua field yang dibaca SPA tersedia:
 *   - name        (fallback dari email)
 *   - created_at  (fallback: created_at payment tertua, kalau kosong → now)
 *   - telegram    (fallback dari telegram_id)
 *
 * Hanya MENAMBAH field yang kosong — tidak mengubek field yang sudah ada.
 * Dipakai oleh endpoint maintenance `/admin/backfill-users` (jalankan di
 * Vercel karena VPS gak bisa akses RTDB langsung).
 */

const store = require('./store');

const APPLY = process.env.BACKFILL_APPLY !== '0';

async function backfillUsers() {
  const keys = await store.getApikeySet();
  const valid = Object.entries(keys).filter(([, v]) => v === true || v === 'true').map(([k]) => k);

  const report = { total: valid.length, changed: 0, details: [] };

  for (const key of valid) {
    const u = (await store.getUser(key)) || {};
    const patch = {};

    if (!u.name && u.email) patch.name = String(u.email).split('@')[0].slice(0, 60);
    if (!u.created_at) {
      const pays = await store.queryPaymentsByApikey(key);
      const times = Object.values(pays).map((p) => p && p.created_at).filter(Boolean);
      patch.created_at = times.sort()[0] || new Date().toISOString();
    }
    if (u.telegram_id && !u.telegram) patch.telegram = u.telegram_id;

    if (Object.keys(patch).length) {
      report.changed += 1;
      report.details.push({ apikey: key, fields: Object.keys(patch) });
      if (APPLY) await store.patchUser(key, patch);
    }
  }
  return report;
}

module.exports = { backfillUsers };
