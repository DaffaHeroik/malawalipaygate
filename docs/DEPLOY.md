# Deploy

## Environment wajib (produksi)

```env
NODE_ENV=production
PORT=3000
BASE_URL=https://pay.contoh.id

DATA_SOURCE=db
MONGODB_URI=mongodb://127.0.0.1:27017/malawali

SESSION_SECRET=<string acak panjang>
SESSION_NAME=malawali.sid

TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
TURNSTILE_DISABLED=false

CREDENTIAL_ENC_KEY=<32-byte hex, 64 karakter>
API_KEY_PEPPER=<32-byte hex>

SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASS=...
MAIL_FROM=Malawali Payment <no-reply@contoh.id>

WEBHOOK_TIMEOUT_MS=10000
WEBHOOK_MAX_ATTEMPTS=3
```

Catatan: saat `NODE_ENV=production`, auto-seed **tidak** jalan. Jalankan
`npm run seed` sekali bila perlu data awal.

## Langkah

```bash
npm ci --omit=dev
npm test
NODE_ENV=production npm start
```

Gunakan process manager (PM2/systemd) atau Docker. Contoh PM2:

```bash
pm2 start src/server.js --name malawali -i 2
pm2 save
```

## Reverse proxy (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name pay.contoh.id;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /uploads/ {
    proxy_pass http://127.0.0.1:3000;
    expires 7d;
  }
}
```

## Checklist

- [ ] `SESSION_SECRET`, `CREDENTIAL_ENC_KEY`, `API_KEY_PEPPER` diisi acak.
- [ ] `TURNSTILE_DISABLED=false` dan site/secret key valid.
- [ ] `DATA_SOURCE=db`, MongoDB punya index (otomatis saat `autoIndex` dev; produksi
      jalankan migrasi index sekali).
- [ ] Backup harian MongoDB.
- [ ] Webhook URL merchant HTTPS (divalidasi di aplikasi).
- [ ] CSP nonce aktif (helmet di `middleware/security.js`).
- [ ] Rencanakan retensi `auditlogs` (indeks `userId + createdAt` sudah ada).
- [ ] Verifikasi email produksi: `MAIL_TRANSPORT=smtp` + `SMTP_*` (dev memakai `console`).
- [ ] `SESSION_DRIVER` biarkan default (`mongo`) di produksi.
