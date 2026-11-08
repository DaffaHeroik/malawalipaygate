process.env.LEGACY_STORE_MODE = 'firebase';
process.env.HTTPS_PROXY = 'http://127.0.0.1:8118';
process.env.HTTP_PROXY = 'http://127.0.0.1:8118';
const fs = require('fs');
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = fs.readFileSync('/root/hero-secrets/malawali-firebase-sa.json','utf8');
const admin = require('firebase-admin');
const { getDatabase } = require('firebase-admin/database');
const app = admin.initializeApp({
  credential: admin.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  databaseURL: 'https://heropayment-1328-default-rtdb.asia-southeast1.firebasedatabase.app',
  // REST mode: jalanin api/ lewat HTTP (ngetur HTTPS_PROXY), bukan websocket
  database: { serverHost: 'heropayment-1328-default-rtdb.asia-southeast1.firebasedatabase.app', serverPort: 443, useEmulator: false, forceRest: true },
});
const db = getDatabase(app);
(async () => {
  const t = await db.ref('meta/stats/months').once('value');
  console.log('stats/months =', JSON.stringify(t.val()));
  const c = await db.ref('meta/retention_stats_cursor').once('value');
  console.log('cursor =', c.val());
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
