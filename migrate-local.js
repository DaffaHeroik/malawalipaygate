'use strict';
/* Migration stats lokal (VPS, lewat proxy privoxy) — jalanin chunk
 * sampai selesai. Pakai store project (mode firebase, REST+proxy). */
process.env.LEGACY_STORE_MODE = 'firebase';
process.env.HTTPS_PROXY = 'http://127.0.0.1:8118';
process.env.HTTP_PROXY = 'http://127.0.0.1:8118';

// store pakai admin SDK biasa (websocket) — tapi dari VPS Beijing ke
// RTDB asia-southeast1 perlu jalan via proxy. Kita patch getAdminDb
// lewat monkey-patch module cache: load store, paksa forceRest+proxy.
const fs = require('fs');
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = fs.readFileSync('/root/hero-secrets/malawali-firebase-sa.json', 'utf8');

const admin = require('firebase-admin');
const { getDatabase } = require('firebase-admin/database');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const _db = getDatabase(admin.initializeApp({
  credential: admin.cert(sa),
  databaseURL: 'https://heropayment-1328-default-rtdb.asia-southeast1.firebasedatabase.app',
  database: { forceRest: true },
}));

const store = require('/root/malawali-payment/api/legacy/store');
// paksa store pake instance db REST (bukan inisialisasi sendiri)
store.setAdminDbOverride && store.setAdminDbOverride(_db);

const retention = require('/root/malawali-payment/api/legacy/retention');
const stats = require('/root/malawali-payment/api/legacy/stats');

(async () => {
  const wipeFirst = process.argv[2] === 'wipe';
  let chunk = 0;
  let totalRecorded = 0;
  if (wipeFirst) {
    // reset penuh: hapus agregat + kursor (mulai dari nol)
    await store.setPath('meta/stats/months', null);
    await store.setPath('meta/retention_stats_cursor', '');
    await store.setPath('meta/withdraws_stats_done', null);
    console.log('wiped: meta/stats/months, retention_stats_cursor, withdraws_stats_done');
  }
  for (;;) {
    chunk++;
    const t0 = Date.now();
    // force=true di SEMUA chunk (re-record semua, angka rebuild)
    let r;
    try {
      r = await retention.migrateStats({ limit: 500, force: true });
    } catch (e) {
      console.log(`chunk ${chunk} gagal (${e.message}) — stop aman, jalankan ulang`);
      process.exit(2);
    }
    totalRecorded += r.recorded;
    console.log(`chunk ${chunk}: recorded=${r.recorded} ${((Date.now() - t0) / 1000).toFixed(1)}s cursor=${r.cursor}${r.finished ? ' [SELESAI]' : ''}`);
    if (r.finished) break;
    if (chunk > 120) throw new Error('terlalu banyak chunk, berhenti aman');
  }
  console.log('TOTAL recorded:', totalRecorded);
  const all = await stats.getMonthStats();
  console.log('=== HASIL ===');
  let totPaid = 0, totProfit = 0;
  for (const m of Object.keys(all).sort()) {
    const v = all[m];
    totPaid += v.paid_amount || 0; totProfit += v.profit || 0;
    console.log(`  ${m}: trx=${v.transactions} omzet=${v.paid_amount} profit=${v.profit} status=${JSON.stringify(v.status)} wds=${JSON.stringify(v.withdrawals || null)}`);
  }
  console.log(`TOTAL: omzet=${totPaid} profit=${totProfit}`);
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
