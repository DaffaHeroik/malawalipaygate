process.env.LEGACY_STORE_MODE = 'firebase';
process.env.HTTPS_PROXY = 'http://127.0.0.1:8118';
const fs = require('fs');
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = fs.readFileSync('/root/hero-secrets/malawali-firebase-sa.json','utf8');
const admin = require('firebase-admin');
const { getDatabase } = require('firebase-admin/database');
const app = admin.initializeApp({
  credential: admin.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  databaseURL: 'https://heropayment-1328-default-rtdb.asia-southeast1.firebasedatabase.app',
  database: { forceRest: true },
});
const db = getDatabase(app);
(async () => {
  const w = (await db.ref('withdraws').once('value')).val() || {};
  let total = 0, users = 0;
  for (const k of Object.keys(w)) { total += (Array.isArray(w[k]) ? w[k].length : 1); users++; }
  console.log('withdraws: users=', users, 'total items=', total);
  const p = (await db.ref('payments').once('value')).val() || {};
  const pkeys = Object.keys(p).filter(k => !k.startsWith('__'));
  console.log('payments: total records=', pkeys.length);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
