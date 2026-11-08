'use strict';
process.env.LEGACY_STORE_MODE = 'firebase';
process.env.HTTPS_PROXY = 'http://127.0.0.1:8118';
const fs = require('fs');
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = fs.readFileSync('/root/hero-secrets/malawali-firebase-sa.json', 'utf8');
const admin = require('firebase-admin');
const { getDatabase } = require('firebase-admin/database');
const _db = getDatabase(admin.initializeApp({
  credential: admin.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  databaseURL: 'https://heropayment-1328-default-rtdb.asia-southeast1.firebasedatabase.app',
  database: { forceRest: true },
}));
const store = require('/root/malawali-payment/api/legacy/store');
store.setAdminDbOverride(_db);
const retention = require('/root/malawali-payment/api/legacy/retention');
(async () => {
  let totalDel = 0, totalRec = 0, chunk = 0;
  for (;;) {
    chunk++;
    const [pays, wds] = [await retention.prunePayments({ limit: 500 }), await retention.pruneWithdraws({ limit: 200 })];
    totalDel += pays.deleted; totalRec += pays.recorded;
    console.log(`chunk ${chunk}: deleted=${pays.deleted} recorded=${pays.recorded} wds_purged=${wds.purgedItems}${pays.finished ? ' [SELESAI]' : ''}`);
    if (pays.finished) break;
    if (chunk > 60) throw new Error('terlalu banyak chunk');
  }
  // sisa: loop sekali lagi dari cursor kosong (putaran baru sudah ke-0)
  console.log('TOTAL deleted:', totalDel, '| recorded:', totalRec);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
