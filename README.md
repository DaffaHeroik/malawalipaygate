# Malawali Payment

Payment gateway QRIS Indonesia — dashboard merchant + REST API. Rebuild dari sistem
PayKita, direbrand jadi **Malawali Payment**.

- **Stack**: Node.js + Express (server-side render EJS), vanilla CSS/JS, MongoDB + Mongoose.
- **UI**: light/dark mode, responsive, tanpa framework frontend.
- **Inti**: QRIS statis merchant → QRIS dinamis (nominal tetap) → deteksi pembayaran →
  webhook HMAC-SHA256 ke server merchant.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000  (DATA_SOURCE default = mock)
```

`DATA_SOURCE=mock` → seluruh dashboard jalan dengan data dummy, tanpa MongoDB.

### Mode database

```bash
# Development: MongoDB in-memory (otomatis, data hilang saat restart)
DATA_SOURCE=db DEVELOPMENT_MONGO_MEMORY=true npm run dev

# Produksi / lokal: arahkan ke MongoDB sendiri
DATA_SOURCE=db MONGODB_URI="mongodb://127.0.0.1:27017/malawali" npm run dev
```

Saat boot development dengan DB kosong, data contoh otomatis di-seed.

### Akun demo (hasil seed)

| Peran | Email | Password |
|---|---|---|
| Merchant | `kizu@malawalipayment.web.id` | `restukizu1` |
| Admin | `admin@malawalipayment.web.id` | `adminrestu1` |

API key development hasil seed:

```
Project Utama : pk_live_seed_default_project   (endpoint /api/merchant/*)
Bot Telegram  : pk_live_seed_bot_telegram
```

## Script

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Jalankan dengan nodemon |
| `npm start` | Jalankan biasa |
| `npm run seed` | Isi data contoh (`--fresh` untuk reset) |
| `npm test` | Semua test (unit + integrasi REST API/Listener/webhook) |

## Verifikasi end-to-end

```bash
npm test                       # unit + integrasi (QRIS, amount, HMAC, API, Listener, webhook)
node scripts/smoke.js          # API key → order → payment → webhook (14 langkah)
node scripts/fake-payment.js --order pay_xxxx   # simulasi pembayaran masuk
```

## REST API

Base: `http://localhost:3000/api` · Header: `x-api-key: pk_live_…`

| Method | Path | Guna |
|---|---|---|
| POST | `/api/merchant/qris` | Simpan QRIS statis (Project Utama) |
| POST | `/api/merchant/settings` | Update mode nominal & TTL |
| POST | `/api/orders` | Buat order (QRIS dinamis + nominal) |
| GET | `/api/orders/:id` | Cek status |
| POST | `/api/orders/:id/cancel` | Batalkan order pending |

Detail lengkap + contoh 4 bahasa ada di halaman `/documentation` setelah login.

## Listener API (APK Android)

Base: `/api/listener` — dipakai aplikasi pendanting untuk mengenali notifikasi pembayaran.

| Method | Path | Auth | Guna |
|---|---|---|---|
| POST | `/api/listener/register` | `x-api-key` (Project Utama) | Daftarkan perangkat → balasan `device_token` (tampil sekali) |
| GET | `/api/listener/devices` | `x-api-key` | Daftar perangkat akun |
| POST | `/api/listener/devices/:deviceId/revoke` | `x-api-key` | Cabut perangkat |
| GET | `/api/listener/me` | `x-device-token` | Heartbeat + info perangkat |
| POST | `/api/listener/push` | `x-device-token` | Kirim pembayaran → pencocokan order |

Contoh push:

```bash
curl -X POST http://localhost:3000/api/listener/push \
  -H "x-device-token: dev_live_…" -H "content-type: application/json" \
  -d '{"provider":"shopee","provider_transaction_id":"TRX-1","amount":25000}'
```

Balasan: `{ "ok": true, "data": { "matched": true, "order_id": "pay_…" } }`.
Pembayaran yang cocok otomatis menandai order `paid` dan mengirim webhook `order.paid`.

### Webhook keluar

- Header: `x-malawali-timestamp`, `x-malawali-signature: v1=<hex>`, `x-malawali-event`
- Tanda tangan: `HMAC-SHA256(secret, timestamp + "." + raw_body)`
- Timeout 10s, retry maksimal 3×
- Prioritas URL: `order.webhookUrl` → `project.webhookUrl` → `settings.notifyUrl`

## Struktur

```
src/
  config/        brand, constants (ikon/nav/provider/status/error), env
  lib/           money, datetime, validation, hmac, qr, password, mail, context
  middleware/    security, session, csrf, flash, locals, auth, apiKey, rateLimit
  models/        Mongoose schemas (user, project, qris, order, webhook, dll)
  services/      qris (TLV/CRC16), amount, order, webhook, matching, apikey
  data/          facade mock | db  (route selalu lewat sini)
  routes/        public, auth, dashboard, orders, projects, qris, provider,
                 subscription, settings, tutorial, documentation, api, admin
  views/         EJS: layouts, partials, pages
public/          css (tokens/themes/base/shell/components/pages), js, brand
tests/           unit test
scripts/         smoke.js, fake-payment.js
docs/            ARCHITECTURE, DATA-MODEL, API, AMOUNT-MODES, DETECTION, DEPLOY
```

## Keamanan

- Password: `scrypt` bawaan Node (tanpa dependency bcrypt).
- API key & device token Listener disimpan sebagai hash SHA-256 + pepper, hanya tampil sekali.
- CSRF token untuk semua form; endpoint `/api/*` memakai API key (tanpa cookie).
- Helmet + CSP nonce, rate limit per endpoint.
- 2FA TOTP (otplib) opsional per akun.
- Kredensial provider (token Shopee / sesi GoPay) disimpan **terenkripsi AES-256-GCM**
  (`CREDENTIAL_ENC_KEY`).
- Turnstile diverifikasi di server (`TURNSTILE_DISABLED=true` untuk dev).
- Google OAuth 2.0 siap pakai (aktif via `GOOGLE_ENABLED=true` + client id/secret).
- Jejak audit (AuditLog) untuk login, register, reset password, rotasi key/secret,
  koneksi provider, dan aksi admin.

## Lisensi

Internal / private.
