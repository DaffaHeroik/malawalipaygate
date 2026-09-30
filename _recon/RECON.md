# RECON — PayKita (pay.digikita.id)

Hasil scan tanggal 2026-09-27. Semua data di bawah dikumpulkan dari:
- HTTP response header & HTML publik (`/`, `/login`, `/register`, `/forgot-password`, `/privasi`, `/pay/:id`)
- HTML + screenshot halaman dalam dashboard (login pakai akun yang dikasih user)
- Halaman `/documentation` (spec API resmi)
- Aset statis `/css/*.css` dan `/js/*.js`

> Catatan: temuan ini buat **rebuild sistem sendiri**, bukan untuk menyalin aset/CSS/teks orang lain.

---

## 1. Ringkasan produk

PayKita = payment gateway QRIS buatan sendiri (bukan aggregator resmi).
Alur intinya:

```
QRIS statis merchant (pribadi)  ->  PayKita simpan
        |
        v
Sistem klien panggil POST /api/orders  ->  PayKita bikin QRIS dinamis (nominal unik)
        |
        v
Customer bayar  ->  PayKita deteksi (API provider Shopee/GoPay, atau notifikasi Android
                     lewat app "PayKita Listener")  ->  cocokkan amount + window waktu
        |
        v
Status order jadi PAID  ->  kirim webhook HMAC-SHA256 ke server klien
```

Yang dijual: **langganan** (Rp10rb/bln dst) yang membuka **REST API + API Key per project**.
Payment tools (QRIS + test order) gratis supaya orang bisa nyoba dulu.

Brand: **PayKita** · "PayKita Fintech SaaS". Tenant terkait: **DigiKita** (bot/magazine) — ada
fitur "QRIS PayKita" khusus penyewa bot DigiKita.

---

## 2. Stack terdeteksi

| Layer | Terdeteksi | Bukti |
|---|---|---|
| Web server | nginx 1.18.0 (Ubuntu) reverse proxy | Header `Server` |
| App | Node.js + Express, server-side rendered | cookie `paykita.sid` (pola express-session), nonce CSP |
| Template | Server-rendered (EJS-like). HTML akhir penuh, nggak ada framework SPA | Nggak ada bundler/JSX, tiap halaman full HTML |
| Session | `express-session` + store, nama cookie `paykita.sid`, HttpOnly, Secure, SameSite=Lax, 7 hari | Set-Cookie |
| Security | `helmet` (CSP+nonce, COOP, CORP, XFO, HSTS, no-referrer) | Header lengkap |
| CSRF | Token `_csrf` hidden input di form | HTML login/register |
| Bot protection | Cloudflare Turnstile (sitekey `0x4AAAAAAEQU1c3GrQtSXftt`), mode `flexible`, action `login`/`register` | HTML + CSP `challenges.cloudflare.com` |
| Database | MongoDB (project id = ObjectId 24-hex) | `/documentation` contoh: `"id": "66abcdef1234567890abcdef"` |
| ID generator | `pay_` + nanoid, `evt_` + nanoid | format order/event id |
| 2FA | TOTP authenticator 6 digit | halaman Pengaturan → 2FA |
| Email | Verifikasi email + reset password + reminder langganan H-7/H-3/H-1 | halaman & teks |
| Webhook | HMAC-SHA256, header `x-paykita-signature: v1=<hex>`, `x-paykita-timestamp` | `/documentation` |
| Frontend | Vanilla CSS + JS. Font **Inter** + **JetBrains Mono**. Dark/light mode via `localStorage['paykita.theme']` | HTML |
| Client ekstra | App Android "PayKita Listener" v1.0-beta.2 (Android 7+, 6.6 MB) baca Notification Access | halaman Listener |
| Duit | Semua nominal integer rupiah | `/documentation` |

Aset statis yang dipakai:
```
/css/app.css              (~214 KB)
/css/elegant-ui.css       (~217 KB)
/css/digikita-theme.css   (~18 KB)
/css/digikita-shell-v2.css(~21 KB)
/css/payment-activity.css (~4 KB)
/css/ui-feedback.css      (~1.4 KB)
/js/theme.js  /js/ui-feedback.js  /js/payment-activity.js
```

---

## 3. Route map

### Publik
```
GET  /                     Landing (Home, Cara Kerja, Fitur, Harga, Dokumentasi)
GET  /login                Login (email+password | Google | Turnstile)
POST /login
GET  /register             Daftar (Turnstile, disabled sampai token OK)
POST /register
GET  /forgot-password
GET  /privasi              Ketentuan Layanan & Kebijakan Privasi
GET  /pay/:orderId         Halaman checkout publik (QRIS + countdown + status PAID)
GET  /brand/paykita-logo.png, /brand/favicon-64.png, /favicon.ico
```

### Auth
```
GET  /auth/google?intent=login      OAuth Google
GET  /auth/google?intent=register
GET  /logout
```

### Dashboard (semua butuh login)
```
GET  /dashboard                    Overview: 4 metric card + chart 14 hari + tabel order
GET  /dashboard?status=all|pending|paid|expired|cancelled
GET  /dashboard/export.csv?status=...   Export CSV
GET  /orders/:id                   Detail order (project, mode, sumber, harga, fee, kode unik, total, timeline, detail pembayaran, webhook log)
GET  /projects                     Manajemen project + modal Buat/Edit/Hapus
GET  /qris                         Langkah 1: QRIS & deteksi pembayaran. Langkah 2: buat order
GET  /qris-paykita                 QRIS siap pakai (khusus penyewa Bot DigiKita)
GET  /listener                     Status app Android: device, sumber app, cara connect, download APK
GET  /shopee                       Koneksi Shopee Partner (paste token)
GET  /gopay                        Koneksi GoPay Merchant (nomor + OTP)
GET  /subscription                 Paket langganan + riwayat pembayaran
GET  /tutorial                     Panduan operator (setup QRIS -> order PAID)
GET  /documentation                Dokumentasi API (base URL, endpoint, contoh cURL/JS/PHP/Python)
GET  /settings                     Tab: Profil, API Key, Webhook, Password & Keamanan, 2FA
```

### REST API (header `x-api-key: pk_live_...`)
```
POST /api/merchant/qris            Simpan QRIS statis merchant
POST /api/merchant/settings        Update fee, unique_digits, TTL, notify_url, redirect_url, dsb
POST /api/orders                   Buat order  -> 201
GET  /api/orders/:id               Cek status order
POST /api/orders/:id/cancel        Batalkan order (hanya status pending)
```
Probe: `GET /api` -> `401 {"ok":false,"error":{"code":"invalid_api_key",...}}`

### Halaman lain yang di-redirect (kemungkinan belum ada / butuh role)
`/docs /status /health /legal /terms /panduan /pricing /kontak /help /support /faq /changelog
/developer /admin /merchant /qris /shopee /orders /invoice /payment-links` -> semua 302 ke `/login`
(`/dashboard`, `/status`, `/health`, dst. bukan route publik; middleware auth global).

### Halaman/route yang kemungkinan ada tapi belum kelihatan (di luar dashboard)
- Admin panel (input harga paket "diambil langsung dari pengaturan PayKita", flag
  `payment_provider_disabled`). Kemungkinan panel admin terpisah / role `admin`.
- Endpoint internal buat App Listener (registrasi device, kirim notifikasi terdeteksi).
- `/forgot-password` -> kirim link reset (ada `/reset-password/:token` kemungkinan).

---

## 4. Data model (rekonstruksi)

```
User
  _id, email (unik), password_hash, google_id?, name, display_name,
  merchant_name            // "Nama QRIS / Merchant" (contoh Kizushop)
  email_verified, verified,
  totp_secret?, totp_enabled,
  role: 'user'|'admin',
  subscription_until: Date|null,
  is_digikita_bot_tenant: bool,   // buka /qris-paykita
  created_at, updated_at

MerchantSettings (1:1 User)
  user_id, fee_percent, unique_digits (1-3),
  shopee_fee_enabled, shopee_unique_enabled,   // default true
  gopay_fee_enabled, gopay_unique_enabled,     // default false
  order_ttl (60-86400), notify_url, redirect_url,
  webhook_secret

Project
  _id(ObjectId), user_id, name, is_default (Project Utama),
  api_key_hash, api_key_masked, api_key_last_used_at, api_key_rotated_at,
  webhook_url, created_at, updated_at

QrisAccount
  user_id, provider (shopee|gopay|dana|bca|bri|bni|octo|byond|jakone|bukalapak|orderkuota|livin),
  qris_string, merchant_name, merchant_city, image_path,
  qris_type: 'static',
  status: 'active'|'standby',   // satu akun = satu QRIS aktif
  created_at

ProviderConnection
  user_id, provider, credentials_encrypted, status ('connected'|'error'|'disconnected'),
  last_test_at, last_error, meta

ListenerDevice
  user_id, device_id, name, model, android_version,
  notification_access: bool, enabled_sources: [provider],
  last_seen_at, app_version

Transaction            // bukti pembayaran dari provider
  user_id, provider, provider_transaction_id (UNIQUE — diklaim sekali),
  amount, occurred_at, raw_payload,
  claimed_by_order_id?, claimed_at

Order
  _id / id = 'pay_' + nanoid,
  user_id, project_id,
  reference (maks 120), redirect_url, webhook_url (override, maks 2048, HTTPS),
  mode: 'live',
  provider,     // = provider QRIS aktif saat order dibuat
  base_amount, fee_percent, fee_amount, unique_code, pay_amount,
  status: 'pending'|'paid'|'expired'|'cancelled',
  qris (string QRIS dinamis), checkout_url,
  ttl_seconds,
  created_at, expires_at, paid_at, cancelled_at

WebhookEvent / Delivery
  id = 'evt_' + nanoid, order_id, project_id, event ('order.paid'|'webhook.test'),
  payload, attempts (<=3), timeout ~10s, response_status, delivered_at,
  signature

SubscriptionPayment
  user_id, plan_months (1|2|3|5), price, total_checkout,
  status, order_id?, created_at, paid_at

AuditLog / SecurityLog   // "Riwayat Order" + aksi settings
```

---

## 5. Logika bisnis penting

### 5.1 Perhitungan nominal
```
fee_amount  = round(base_amount * fee_percent / 100)
pay_amount  = base_amount + fee_amount + unique_code
```

### 5.2 Tiga mode nominal
| Mode | Perilaku |
|---|---|
| **Fee** | `fee_amount > 0`, kode unik random OFF |
| **Kode Unik random** | `unique_code` random sesuai `unique_digits` (1-3 digit) |
| **Hybrid** (default & direkomendasikan) | `fee_amount = 0`, `unique_code = 0`. Kalau `pay_amount` bentrok dengan order PENDING lain -> cari tambahan minimum `+1, +2, +3, ...` |

Contoh Hybrid:
```
Order A: base Rp10.000 -> pay Rp10.000
Order B (A masih PENDING): -> pay Rp10.001
Order C (A+B masih PENDING): -> pay Rp10.002
A selesai -> nominal Rp10.000 bisa dipakai lagi
```
Hybrid bukan biaya. Angka +1/+2 cuma penyesuaian supaya nominal unik antar order aktif.

### 5.3 Pencocokan pembayaran (3 tahap)
1. Cari transaksi provider dengan nominal **persis** `pay_amount`
2. Pastikan `occurred_at` masih di dalam window order (`created_at` .. `expires_at`)
3. **Klaim** `provider_transaction_id` satu kali -> satu bukti nggak bisa dipakai 2 order

### 5.4 Order lifecycle
```
pending --(pembayaran cocok)--> paid
pending --(lewat expires_at)--> expired
pending --(cancel)--> cancelled
paid/expired/cancelled -> final (nggak bisa cancel)
```

### 5.5 Prioritas webhook
```
webhook_url pada order  ->  webhook_url Project  ->  notify_url akun (legacy)
```
- Timeout ~10 detik, retry max 3x kalau bukan 2xx.
- Response yang diharapkan: HTTP 200-299 (body bebas, contoh `{"ok":true}`).
- Signature: `HMAC-SHA256(webhook_secret, timestamp + "." + raw_body)` -> `v1=<hex>`.
  Wajib pakai **raw body**, jangan re-stringify JSON.

### 5.6 Paket langganan
| Paket | Harga | Per bulan |
|---|---|---|
| 1 bulan | Rp10.000 | Rp10.000 |
| 2 bulan | Rp20.000 | Rp10.000 |
| 3 bulan | Rp30.000 | Rp10.000 |
| 5 bulan | Rp50.000? (ditampilkan Rp40.000, hemat Rp10.000) | Rp8.000 |

Isi paket: API Key per Project, REST API, integrasi bot/web/app, akses sesuai masa aktif,
dokumentasi, dashboard monitoring. Reminder email H-7, H-3, H-1, dan saat berakhir.
Langganan habis => API key tetap ada tapi REST API kena `402 subscription_required`.

---

## 6. API spec (dari /documentation)

Base: `https://pay.digikita.id/api` · Auth: header `x-api-key: pk_live_xxxxxxxxxxxxx`

### POST /api/merchant/qris
```json
{ "qris": "00020101021126...6304ABCD" }
```
Response 200:
```json
{ "ok": true, "data": { "merchant_name": "TOKO CONTOH", "merchant_city": "JAKARTA",
  "qris_type": "static", "qris_valid": true } }
```
Hanya boleh pakai API key **Project Utama**. QRIS harus statis.

### POST /api/merchant/settings
Semua field opsional:
`fee_percent, unique_digits, shopee_fee_enabled, shopee_unique_enabled, gopay_fee_enabled,
gopay_unique_enabled, order_ttl, notify_url, redirect_url`
Response menambah `shopee_mode` / `gopay_mode` (`unique`|`hybrid`).

### POST /api/orders
Request:
```json
{ "base_amount": 10000, "reference": "INV-001",
  "redirect_url": "https://toko-anda.com/selesai",
  "webhook_url": "https://bot-anda.com/webhook/paykita",
  "ttl_seconds": 600 }
```
Response 201:
```json
{ "ok": true, "data": {
  "id": "pay_msiabc123def456",
  "project": { "id": "66abcdef1234567890abcdef", "name": "KiosDigi" },
  "reference": "INV-001",
  "redirect_url": "...", "webhook_url": "...",
  "mode": "live",
  "base_amount": 10000, "fee_percent": 0.5, "fee_amount": 50,
  "unique_code": 37, "pay_amount": 10087,
  "status": "pending",
  "qris": "000201010212...",
  "checkout_url": "https://pay.digikita.id/pay/pay_msiabc123def456",
  "created_at": "...", "expires_at": "...", "paid_at": null, "cancelled_at": null } }
```

### GET /api/orders/:id
Response sama; `status` jadi `paid` dan `paid_at` terisi.

### POST /api/orders/:id/cancel
Hanya `pending`.

### Webhook payload
```json
{ "id": "evt_msiabc_abcd1234", "event": "order.paid",
  "data": { "order_id": "pay_msiabc123def456",
    "project": { "id": "...", "name": "KiosDigi" },
    "reference": "INV-001", "mode": "live", "provider": "shopee",
    "amount": 10087, "status": "paid", "paid_at": "..." } }
```
Header kirim: `content-type`, `x-paykita-timestamp`, `x-paykita-signature`.
Test event: `event: "webhook.test"` dengan `data.message` + `data.sent_at`.

### Error format
```json
{ "ok": false, "error": { "code": "invalid_base_amount",
  "message": "base_amount harus bilangan bulat rupiah > 0" } }
```
| HTTP | Code |
|---|---|
| 400 | invalid_request |
| 400 | invalid_base_amount |
| 400 | invalid_ttl |
| 400 | invalid_qris |
| 400 | static_qris_required |
| 400 | qris_provider_required |
| 401 | invalid_api_key |
| 402 | subscription_required |
| 403 | live_key_required |
| 403 | default_project_key_required |
| 404 | order_not_found |
| 409 | qris_not_configured |
| 409 | *_detector_not_ready |
| 409 | order_not_pending |
| 503 | payment_provider_disabled |

---

## 7. Integrasi provider

| Provider | Metode koneksi | Keterangan |
|---|---|---|
| **Shopee Partner** | Paste token cookie `__shopee_partner_website_x_token_live` dari `partner.shopee.co.id` (F12 → Application → Cookies, biasanya mulai `eyJ`) | Sesi portal, bukan API resmi. Token bisa expired -> tes koneksi gagal -> ambil token baru. Credential disimpan terenkripsi, nggak ditampilkan lagi |
| **GoPay Merchant/GoBiz** | Nomor terdaftar + **OTP** (Kirim OTP → Verifikasi & Hubungkan) | Simpan sesi terenkripsi |
| **Listener-only** | App Android "PayKita Listener" (Notification Access + Background Service) | DANA, BCA, Livin, BRI, OCTO, BNI, BYOND BSI, JakOne, Bukalapak, OrderKuota |
| **Lain** | QRIS statis upload/paste manual | Provider dideteksi otomatis dari string QRIS, atau dipilih manual. Kalau hasil deteksi beda dengan pilihan manual -> QRIS ditolak |

Dua jalur deteksi bisa dipakai paralel: API provider **dan** Listener.
Deteksi hanya siap kalau "Koneksi merchant terhubung" **atau** "PayKita Listener siap".
Kalau belum siap -> order LIVE diblok, error `*_detector_not_ready`.

Peringatan keamanan yang ditampilkan produk (penting buat parity):
- Rekomendasi **Mode Hybrid** (Fee OFF, Kode Unik OFF) di semua provider karena
  pola fee/kode unik berulang bisa kena flag risiko provider.
- Spesifik GoPay: Fee & Nominal Unik direkomendasikan OFF (risiko pembatasan/banned).
- Notifikasi dari provider yang bukan QRIS aktif -> `ignored`.
- Dana masuk langsung ke QRIS merchant, PayKita cuma baca (nggak nampung dana).

---

## 8. Halaman & UI (struktur terlihat)

Shell dashboard:
```
Sidebar kiri, grup:
  Utama        : Dashboard, Projects
  Pembayaran   : QRIS, QRIS PayKita, PayKita Listener, Shopee Partner, GoPay Merchant, Langganan
  Bantuan      : Tutorial, Kebijakan & Privasi, Documentation
  Akun         : Pengaturan
Topbar: avatar inisial, nama, email, toggle "Mode terang", tombol "Keluar"
Footer: "Contact Support -> Telegram"
```

Isi tiap halaman (ringkas):
- **Dashboard** — 4 metric (Total Order / Paid / Pending / Revenue), filter status, Export CSV,
  chart "Order Performance" 14 hari (2 seri: Total Order & Paid), tabel riwayat order
  (ID + badge provider, Waktu, Nominal, Checkout Via, Ref ID, Status, Detail), paginasi,
  panel "Pengingat Keamanan QRIS" dengan tombol "Saya sudah baca".
- **Projects** — 4 stat agregat, list kartu project (badge UTAMA, aktivitas terakhir,
  TRANSAKSI/PAID/PENDING/VOLUME PAID), modal Buat Project, modal Edit Nama,
  modal Hapus Project (konfirmasi password; project dengan order PENDING nggak bisa dihapus;
  riwayat selesai dipindah ke Project Utama).
- **QRIS** — kartu QRIS aktif (nama merchant + provider + kota), panel DETEKSI PEMBAYARAN
  (status siap/belum siap, koneksi merchant, listener), tombol Hapus QRIS Aktif,
  form upload/paste QRIS (provider dropdown 12 opsi), setting Fee %, Digit Kode (1/2/3),
  Aktif (menit), mode nominal Shopee (Fee / Kode Unik / Hybrid), Redirect URL,
  Langkah 2 form Buat Order dengan preview breakdown base/fee/kode unik/TOTAL.
- **Listener** — 4 status card (status listener, perangkat, QRIS aktif, mode deteksi, sumber APK),
  daftar 5 langkah, kartu download APK + versi/minimum/size, status per provider, daftar device.
- **Shopee** — status badge, banner tutorial & risiko, form token + Simpan & Tes Koneksi /
  Tes Koneksi / Putuskan, panel status integrasi (koneksi + terakhir tes).
- **GoPay** — status badge, rekomendasi khusus, form nomor + Kirim OTP + kode OTP +
  Verifikasi & Hubungkan, Tes/Putuskan, status integrasi.
- **Langganan** — kartu status langganan (aktif sampai tanggal + info reminder email),
  tab Paket Langganan / Riwayat Pembayaran, 4 paket, tabel riwayat (Paket, Harga,
  Total Checkout, Status, Dibuat, Aksi).
- **Tutorial** — tab: Sebelum Mulai, Setup Wajib, Shopee, GoPay, GoPay Recommendation,
  Listener Provider, Projects, API & Webhook, FAQ (accordion).
- **Pengaturan** — tab: Profil (avatar, nama QRIS/merchant, status akun, tanggal gabung,
  email + verifikasi, nama tampilan), API Key (base URL, kartu per project: ID, status,
  api key masked, Salin, Buat Ulang + konfirmasi password, terakhir dipakai, diperbarui),
  Webhook (Webhook Secret akun: Salin/Buat Ulang; Webhook URL per project + Simpan + Kirim Test),
  Password (lama/baru/konfirmasi), 2FA (Enable/Disable).
- **Documentation** — sidebar anchor: Base URL & Autentikasi, Project, API Key,
  Daftar Endpoint, Setup QRIS, Settings, Mode Hybrid, Buat Order, Cek Status, Cancel,
  Status, Webhook, Error. Contoh kode dalam tab cURL/JS/PHP/Python + tombol Copy.
- **/pay/:id** — header "QRIS PAYMENT", "BAYAR KE <merchant>", Nominal besar, id + provider,
  gambar QR, tombol Download QRIS, countdown "Berlaku mm:ss", 3 langkah bayar,
  state sukses (Status PAID, Nominal, Order, Merchant), footer trust.
- **Landing** — nav (Home, Cara Kerja, Fitur, Harga, Dokumentasi, Masuk, Daftar),
  hero, alur 3 langkah animasi, statistik agregat (Volume PAID, Sukses Hari Ini,
  Total Sukses, Merchant Terdaftar), fitur, harga, CTA.

Design token (dibaca dari CSS):
```
Font   : Inter (400-800), JetBrains Mono (400-600)
Primary: #174d9b   (biru)
BG app : #f8f9fa / #f5f6f8
Teks   : #191c1d / #30394a, muted #4e5869 / #566174 / #8a92a0
Border : #cfd4dd / #cbd1dc / #d9dee6
Radius : 9-14px
Theme  : light + dark, disimpan di localStorage['paykita.theme'],
         sinkron ke <html data-theme> + class .dark + color-scheme
```

---

## 9. Auth & keamanan

- Register: email + password + Turnstile (tombol disabled sampai token OK), kirim kode/link verifikasi email.
- Login: email+password atau Google OAuth; Turnstile `data-action="login"`; ada 2FA TOTP opsional
  (kalau aktif -> butuh password + kode 6 digit).
- Verifikasi email wajib sebelum API key bisa ditampilkan/dibuat ulang.
- Rotasi API key & hapus project butuh konfirmasi password akun.
- Webhook Secret bisa dirotasi; satu secret akun untuk semua project.
- CSP ketat + nonce, `X-Frame-Options: SAMEORIGIN`, HSTS 1 tahun, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, COOP/CORP same-origin.
- Kredensial provider (token Shopee, sesi GoPay) disimpan terenkripsi dan tidak ditampilkan lagi.

---

## 10. Rencana rebuild (usulan fase)

**Fase 1 — Fondasi**
- Skeleton Express + template engine + session + CSRF + helmet + theme light/dark
- Model: User, MerchantSettings, Project, Order
- Auth: register/login/logout + verifikasi email + reset password

**Fase 2 — Core payment**
- QRIS account (upload/paste + deteksi provider + status aktif/standby)
- Buat order + 3 mode nominal (fee / unique / hybrid) + TTL + status machine
- Halaman checkout publik `/pay/:id` + QRIS dinamis (encode/decode EMVCo TLV)
- Simulasi/mock detektor pembayaran (biar bisa diuji tanpa provider asli)

**Fase 3 — API & webhook**
- API key per project (`pk_live_`) + middleware auth + semua error code
- 5 endpoint REST + validasi persis seperti spec
- Webhook HMAC-SHA256 + retry + log delivery + tombol Kirim Test

**Fase 4 — Provider & listener**
- Koneksi Shopee (token) & GoPay (OTP), status + tes koneksi
- Model listener device + endpoint untuk app Android + aturan matching 3 tahap
- Rekomendasi/peringatan keamanan (Mode Hybrid)

**Fase 5 — Komersial & UI**
- Projects (CRUD + hapus dengan konfirmasi password)
- Langganan (paket, order billing, aktivasi masa aktif, reminder email)
- Settings lengkap (profil, API key, webhook, password, 2FA)
- Dashboard (metric, chart 14 hari, filter, export CSV), Tutorial, Documentation, Privasi, Landing
- Panel admin + override harga paket

---

## 11. File di folder ini
```
_recon/pages/*.html          HTML mentah tiap halaman dashboard
_recon/shots/*.png           Screenshot full page
_recon/txt_*.txt             Versi teks (enak dibaca)
_recon/assets/*              CSS & JS publik yang di-download
_recon/links.json            Daftar link internal yang ditemukan
_recon/login-and-scan.js     Script puppeteer login + scan ulang (pakai PK_EMAIL / PK_PASS)
_recon/html2txt.js           Helper HTML -> text
```
