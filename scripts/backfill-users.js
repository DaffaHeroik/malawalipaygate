'use strict';

/**
 * Backfill users/* biar field yang dibaca SPA tersedia di RTDB:
 *   - nama            (fallback dari email)
 *   - created_at      (fallback: created_at payment tertua, kalau ga ada → now)
 *   - telegram        (fallback dari telegram_id)
 *
 * Hanya MENAMBAH field yang kosong — ga ngubek field yang udah ada.
 *
 * Pakai:
 *   node scripts/backfill-users.js            # dry-run (cuma laporan)
 *   APPLY=1 node scripts/backfill-users.js    # tulis ke RTDB
 */

process.env.LEGACY_STORE_MODE = process.env.LEGACY_STORE_MODE || 'firebase';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON =
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
  require('fs').readFileSync('/root/hero-secrets/malawali-firebase-sa.json', 'utf8');

const store = require('../api/legacy/store');
const APPLY = process.env.APPLY === '1';

(async () => {
  const keys = await store.getApikeySet();
  const valid = Object.entries(keys).filter(([, v]) => v === true || v === 'true').map(([k]) => k);
  console.log(`apikey valid: ${valid.length} (APPLY=${APPLY ? 'YA' : 'dry-run'})`);

  let changed = 0;
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
      changed += 1;
      console.log(`• ${key}: +${Object.keys(patch).join(', ')}`, APPLY ? '' : '(dry)');
      if (APPLY) await store.patchUser(key, patch);
    }
  }
  console.log(APPLY ? `selesai, ${changed} user di-update` : `selesai (dry), ${changed} user perlu di-update — jalankan dengan APPLY=1`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
