# PLAN — Rebuild PayKita (clone sistem sendiri)

> Status: **PLANNING** · Target: sistem full, setara `pay.digikita.id`
> Basis: `_recon/RECON.md` (hasil scan 2026-09-27)
> Lokasi project: `D:\paykita`

---

## 0. Ringkasan keputusan

| Hal | Keputusan | Sumber |
|---|---|---|
| Arsitektur | **Mirror original**: Express + server-side render (EJS), vanilla CSS/JS | pilihan user |
| Database | **MongoDB + Mongoose** | pilihan user |
| Urutan kerja | **UI dulu** (semua halaman + data dummy), backend belakangan | pilihan user |
| Bahasa | JavaScript (Node 22). Tanpa TypeScript, biar ringan & cepat | mirror original |
| Package manager | **npm** (default project, pnpm/bun tetap terpasang kalau mau ganti) | env |
| Nama/brand | **Malawali Payment** — semua teks brand lewat 1 config (`config/brand.js`, `APP_NAME`) | ✅ diputuskan |
| Referensi visual | `_recon/pages/*.html` + `_recon/shots/*.png` + `_recon/txt_*.txt` | sudah ada |

> **Catatan penting:** gateway Malawali lama (`pay.malawalipayment.web.id` /
> `restapi.malawalipayment.web.id`, SDK `malawali-payment-gateway`) sudah **dimatikan** dan
> **tidak ada hubungannya** dengan project ini. Yang dibangun adalah sistem **PayKita
> (`pay.digikita.id`) yang di-rebrand**, jadi:
> - Model dana: **tanpa saldo** (dana langsung ke QRIS merchant, sistem cuma mencocokkan).
> - Auth: **email + password** (+ verifikasi email, Google OAuth opsional, 2FA TOTP).
> - Desain: **clean corporate** (biru `#174d9b`, kartu putih, Inter + JetBrains Mono).
> - API key: tetap pakai prefix `pk_live_…` (netral, tidak mengandung nama brand).
> - Jangan membawa konsep `idtrx`, `saldo`, `mutasi-user`, atau `Authorization: Bearer`.

**Prinsip kerja:**
1. **Parity dulu, bukan inovasi.** Semua route, field, status, dan error code disamakan dengan
   `RECON.md`. Baru setelah parity 100% boleh nambah fitur.
2. **Nggak nge-block.** Fase UI tidak butuh MongoDB, Turnstile, SMTP, atau provider asli.
   Semua lewat adapter yang bisa di-mock (`DATA_SOURCE=mock`, `TURNSTILE_DISABLED=true`, dll).
3. **Aset dibuat sendiri.** CSS/JS/teks ditulis ulang, tidak menyalin file dari situs lama.
   Yang dipakai dari recon cuma *struktur*, *nama class/konsep*, dan *design token*.
4. **Uang selalu integer rupiah.** Tidak ada float di perhitungan nominal.
5. **Satu sumber kebenaran untuk konstanta** (`src/config/constants.js`): daftar provider,
   status order, error code, paket langganan, label sidebar.

---

## 1. Sasaran & non-sasaran

### Sasaran (harus sama dengan original)
- Autentikasi: register/login email + Google OAuth, verifikasi email, lupa password, 2FA TOTP.
- QRIS: simpan QRIS statis, deteksi provider dari string QRIS, satu QRIS aktif per akun,
  status standby/aktif.
- Order: 3 mode nominal (Fee / Kode Unik / **Hybrid**), TTL, status machine
  `pending → paid | expired | cancelled`.
- Checkout publik `/pay/:id`: QRIS dinamis + countdown + state PAID.
- Deteksi pembayaran: 3 tahap (match amount → window waktu → **klaim Transaction ID sekali**).
- Projects: banyak project per akun, API key per project, webhook per project.
- REST API: 5 endpoint + semua error code (`invalid_api_key`, `subscription_required`, dll).
- Webhook: HMAC-SHA256, `x-paykita-signature: v1=<hex>`, retry 3x, log delivery, tombol Kirim Test.
- Langganan: paket 1/2/3/5 bulan, aktivasi masa aktif, reminder email H-7/H-3/H-1.
- Pengaturan: Profil, API Key, Webhook, Password, 2FA.
- Halaman pendukung: Tutorial, Documentation, Kebijakan & Privasi, Landing, 404/500.
- Integrasi provider: Shopee (token), GoPay (nomor+OTP), Listener Android (Notification Access).
- Panel admin: override harga paket, enable/disable provider (`payment_provider_disabled`).

### Non-sasaran (fase awal)
- Bikin / menggabungkan QRIS sendiri (bukan aggregator; tetap butuh QRIS statis merchant).
- Menampung dana (dana langsung ke QRIS merchant; sistem cuma membaca).
- Aplikasi Android Listener versi produksi (fase awal cukup **API + mock device**, APK menyusul).
- Multi-currency, kartu kredit, VA, e-wallet redirect.

---

## 2. Arsitektur

```
                        ┌──────────────────────────────┐
  Browser ──HTTPS──►    │  nginx (opsional, produksi)  │
                        └──────────────┬───────────────┘
                                       ▼
                    ┌──────────────────────────────────┐
                    │  Express app (src/app.js)        │
                    │  helmet+nonce · session · csurf  │
                    │  rate limit · flash · error mw   │
                    └───┬───────────────┬──────────────┘
            ┌───────────┘               └────────────┐
            ▼                                        ▼
   ┌──────────────────┐                    ┌────────────────────┐
   │ Router web       │                    │ Router REST /api   │
   │ (EJS render)     │                    │ (JSON + x-api-key) │
   └────────┬─────────┘                    └─────────┬──────────┘
            └──────────────┬─────────────────────────┘
                           ▼
                 ┌────────────────────┐
                 │  Services (logika) │  amount · order · qris · matching
                 │                    │  webhook · apikey · subscription · totp
                 └─────────┬──────────┘
                           ▼
        ┌──────────────────┴───────────────────┐
        ▼                                      ▼
┌────────────────┐                  ┌──────────────────────┐
│ Mongoose models│                  │ Detector adapters    │
│ (MongoDB)      │                  │ shopee · gopay ·     │
└────────────────┘                  │ listener · mock      │
                                    └──────────┬───────────┘
                                               ▼
                                  API Shopee/GoPay & app Listener
```

**Alur intake pembayaran (yang paling kritis):**
```
Detector (poll API provider / terima push dari Listener)
   -> Transaction { provider, provider_transaction_id, amount, occurred_at }
   -> MatchingService:
        1) cari Order pending dgn pay_amount == amount (provider sama)
        2) cek occurred_at di dalam [created_at, expires_at]
        3) atomic claim: updateOne({ _id, claimed_by_order_id: null },
                                  { claimed_by_order_id: order._id })
           -> kalau dapat hasil modifiedCount=1 berarti menang (anti dobel pakai)
   -> OrderService.markPaid(orderId)
   -> WebhookService.enqueue('order.paid')
```

---

## 3. Struktur folder lengkap

```
D:\paykita\
├─ PLAN.md                      (file ini)
├─ README.md                    cara jalanin
├─ package.json
├─ .env.example
├─ .gitignore
├─ .editorconfig
├─ _recon/                      referensi hasil scan (JANGAN di-serve publik)
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ DATA-MODEL.md
│  ├─ API.md                    spec REST + webhook
│  ├─ AMOUNT-MODES.md           Fee / Unique / Hybrid
│  └─ DETECTION.md              3 tahap matching
│
├─ src/
│  ├─ server.js                 entry: connect DB lalu listen
│  ├─ app.js                    rakit express
│  │
│  ├─ config/
│  │  ├─ index.js               baca + validasi env
│  │  ├─ constants.js           PROVIDERS, ORDER_STATUS, ERROR_CODES, PLANS, NAV
│  │  └─ brand.js               nama brand, logo path, link support
│  │
│  ├─ db/
│  │  ├─ connect.js
│  │  ├─ seed.js                data awal (user admin + settings)
│  │  └─ seed-dummy.js          data dummy buat fase UI
│  │
│  ├─ models/
│  │  ├─ User.js
│  │  ├─ MerchantSettings.js
│  │  ├─ Project.js
│  │  ├─ QrisAccount.js
│  │  ├─ ProviderConnection.js
│  │  ├─ ListenerDevice.js
│  │  ├─ Transaction.js
│  │  ├─ Order.js
│  │  ├─ WebhookDelivery.js
│  │  ├─ SubscriptionPayment.js
│  │  └─ AuditLog.js
│  │
│  ├─ middleware/
│  │  ├─ security.js            helmet + CSP nonce, HSTS, COOP/CORP
│  │  ├─ session.js             express-session + MongoStore
│  │  ├─ csrf.js                token hidden `_csrf`
│  │  ├─ turnstile.js           verify + bypass dev
│  │  ├─ auth.js                loadUser, requireAuth, requireVerified, requireAdmin
│  │  ├─ apiKey.js              x-api-key -> req.project (+ 401 invalid_api_key)
│  │  ├─ subscription.js        402 subscription_required
│  │  ├─ rateLimit.js
│  │  ├─ flash.js
│  │  ├─ locals.js              inject brand, user, nav, csrf ke semua view
│  │  ├─ notFound.js
│  │  └─ error.js               render 500 / JSON error sesuai content-type
│  │
│  ├─ services/
│  │  ├─ amount.service.js      hitungFee, kodeUnik, alokasi Hybrid (atomic)
│  │  ├─ order.service.js       create, findForProject, cancel, expire, markPaid
│  │  ├─ qris.service.js        decode/encode EMVCo TLV, CRC16, deteksi provider
│  │  ├─ matching.service.js    pencocokan 3 tahap + klaim transaksi
│  │  ├─ webhook.service.js     bangun signature, kirim, retry, log
│  │  ├─ apikey.service.js      generate pk_live_, hash, mask, rotate
│  │  ├─ subscription.service.js paket, aktivasi, sisa hari, reminder
│  │  ├─ totp.service.js        2FA
│  │  ├─ mail.service.js        verifikasi, reset, reminder
│  │  ├─ crypto.service.js      enkripsi kredensial provider
│  │  ├─ export.service.js      CSV dashboard
│  │  ├─ stats.service.js       metric + seri chart 14 hari
│  │  └─ provider/
│  │     ├─ index.js            registry + pilih adapter
│  │     ├─ shopee.js           tes koneksi via token portal
│  │     ├─ gopay.js            kirim OTP, verifikasi, baca transaksi
│  │     ├─ listener.js         intake dari app Android
│  │     └─ mock.js             adapter palsu buat dev & test
│  │
│  ├─ routes/
│  │  ├─ index.js
│  │  ├─ public.routes.js       /  /privasi  /pay/:id  /pay/:id/status
│  │  ├─ auth.routes.js
│  │  ├─ dashboard.routes.js    /dashboard  /dashboard/export.csv
│  │  ├─ orders.routes.js       /orders/:id
│  │  ├─ projects.routes.js
│  │  ├─ qris.routes.js         /qris  /qris-paykita
│  │  ├─ listener.routes.js
│  │  ├─ shopee.routes.js
│  │  ├─ gopay.routes.js
│  │  ├─ subscription.routes.js
│  │  ├─ settings.routes.js     profil · api-key · webhook · password · 2fa
│  │  ├─ tutorial.routes.js
│  │  ├─ documentation.routes.js
│  │  ├─ admin.routes.js
│  │  └─ api/
│  │     ├─ index.js
│  │     ├─ merchant.routes.js  /api/merchant/qris, /api/merchant/settings
│  │     ├─ orders.routes.js    /api/orders...
│  │     └─ listener.routes.js  endpoint app Android
│  │
│  ├─ lib/
│  │  ├─ ids.js                 pay_ · evt_ · pk_live_ · dev_
│  │  ├─ money.js               formatRupiah, parseRupiah, roundRupiah
│  │  ├─ datetime.js            format id-ID: "17/9/2026, 00.31.25"
│  │  ├─ validation.js          validator kecil (tanpa dependency berat)
│  │  ├─ hmac.js
│  │  └─ asyncHandler.js
│  │
│  ├─ mock/
│  │  ├─ users.js  projects.js  orders.js  qris.js
│  │  ├─ providers.js  subscriptions.js  stats.js
│  │  └─ index.js               getData(key) -> mock | db
│  │
│  └─ views/
│     ├─ layouts/
│     │  ├─ shell.ejs           sidebar + topbar + footer (halaman app)
│     │  ├─ auth.ejs            login/register/reset
│     │  ├─ public.ejs          landing/privasi
│     │  └─ checkout.ejs        /pay/:id
│     ├─ partials/
│     │  ├─ head.ejs            meta, font, css, theme bootstrap script
│     │  ├─ sidebar.ejs  topbar.ejs  mobile-header.ejs  theme-toggle.ejs
│     │  ├─ footer-support.ejs  flash.ejs  modal.ejs
│     │  ├─ metric-card.ejs  status-badge.ejs  provider-badge.ejs
│     │  ├─ pagination.ejs  tabs.ejs  empty-state.ejs
│     │  ├─ code-block.ejs      tab cURL/JS/PHP/Python + tombol Copy
│     │  ├─ accordion.ejs       FAQ / panduan
│     │  └─ confirm-password.ejs
│     └─ pages/
│        ├─ landing.ejs
│        ├─ auth/{login,register,forgot-password,reset-password}.ejs
│        ├─ public/{privasi,pay,pay-paid,pay-expired}.ejs
│        ├─ errors/{404,500}.ejs
│        └─ app/
│           ├─ dashboard.ejs
│           ├─ orders/show.ejs
│           ├─ projects/index.ejs
│           ├─ qris/index.ejs
│           ├─ qris-paykita.ejs
│           ├─ listener.ejs
│           ├─ shopee.ejs
│           ├─ gopay.ejs
│           ├─ subscription.ejs
│           ├─ tutorial.ejs
│           ├─ documentation.ejs
│           └─ settings/{index,profile,api-key,webhook,password,twofa}.ejs
│
├─ public/                      di-serve sebagai static
│  ├─ css/
│  │  ├─ tokens.css             CSS variables (warna, radius, spacing, shadow)
│  │  ├─ base.css               reset + tipografi
│  │  ├─ shell.css              app-shell, sidebar, topbar, mobile header
│  │  ├─ components.css         card, btn, badge, table, modal, tabs, form, toast
│  │  ├─ pages/*.css            per halaman
│  │  └─ themes.css             [data-theme="dark"]
│  ├─ js/
│  │  ├─ theme.js               toggle + localStorage + prefers-color-scheme
│  │  ├─ shell.js               burger sidebar, active nav, dropdown
│  │  ├─ modal.js  tabs.js  copy.js  toast.js
│  │  ├─ chart.js               SVG chart 14 hari (tanpa library)
│  │  ├─ qris-preview.js        hitung breakdown base/fee/kode unik/TOTAL
│  │  ├─ countdown.js           timer checkout
│  │  ├─ poll-status.js         polling status order di /pay/:id
│  │  └─ export-preview.js
│  └─ brand/                    logo.svg, logo-dark.svg, favicon.ico, favicon-64.png
│
├─ scripts/
│  ├─ dev.js                    jalankan + watch (nodemon)
│  ├─ fake-payment.js           simulasi pembayaran masuk buat ngetes matching
│  └─ make-favicons.js
│
└─ tests/
   ├─ amount.service.test.js
   ├─ qris.service.test.js
   ├─ matching.service.test.js
   ├─ webhook.signature.test.js
   └─ api.orders.test.js
```

---

## 4. Design system (dari token original)

```css
:root {
  /* warna */
  --bg-app:#f8f9fa;  --bg-app-alt:#f5f6f8;  --bg-card:#ffffff;
  --primary:#174d9b; --primary-hover:#123d7d; --primary-soft:rgba(49,95,174,.1);
  --text:#191c1d;  --text-strong:#30394a;  --text-muted:#4e5869;  --text-dim:#8a92a0;
  --border:#cfd4dd; --border-input:#cbd1dc; --border-soft:#d9dee6;
  --success:#1a7f4b; --warn:#a86a00; --danger:#b3261e;  --info:#174d9b;

  /* status order */
  --status-pending:#a86a00; --status-paid:#1a7f4b;
  --status-expired:#6b7280; --status-cancelled:#b3261e;

  /* bentuk */
  --radius-sm:9px; --radius:12px; --radius-lg:14px;
  --shadow-card:0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06);

  /* tipografi */
  --font-sans:'Inter',system-ui,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,monospace;

  /* spacing */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px; --sp-6:24px; --sp-8:32px;

  /* breakpoint (dipakai di media query, dokumentasi saja) */
  /* 390 / 520 / 760 / 1024 / 1280 */
}
[data-theme="dark"] { /* varian gelap: bg #0f1115, card #161a20, border #262c36, text #e6e8ec */ }
```

**Aturan UI:**
- Font dimuat dari Google Fonts (Inter 400–800, JetBrains Mono 400–600) + preconnect.
- Theme bootstrap inline di `<head>` (anti-flash):
  baca `localStorage['pk.theme']`, fallback `prefers-color-scheme`, set `data-theme` + `.dark`.
- Ikon: **SVG inline** (stroke 1.7, 24×24), bukan icon font.
- Mobile: max-width 760px sidebar jadi drawer (`#pk-sidebar`), ada `.mobile-header` dengan burger.
- Semua tombol `min-height:44px` (target sentuh). Aksen keyboard `:focus-visible` jelas.
- Tabel di mobile: horizontal scroll + sticky kolom ID.

**Komponen wajib (dibangun sekali, dipakai di semua halaman):**
`card`, `card-header`, `btn` (primary/secondary/ghost/danger), `badge` (status/provider/utama),
`field` (label+hint+error), `input/select/textarea/file`, `metric-card`, `tabs`, `modal`,
`toast`, `alert`, `table`, `pagination`, `chip-filter`, `code-block`, `accordion`,
`empty-state`, `stepper`, `kv-list`, `skeleton`.

---

## 5. Peta halaman & isi (fase UI)

Semua halaman fase UI pakai data dari `src/mock/`. Nggak ada DB, nggak ada jaringan keluar.

| # | Route | File view | Isi yang harus ada |
|---|---|---|---|
| 1 | `/` | `landing.ejs` | Nav (Home, Cara Kerja, Fitur, Harga, Dokumentasi, Masuk, Daftar), hero + 3 chip, blok alur 3 langkah animasi, statistik agregat (Volume PAID, Sukses Hari Ini, Total Sukses, Merchant Terdaftar), grid fitur, tabel harga, CTA, footer |
| 2 | `/login` | `auth/login.ejs` | Logo + "Merchant Dashboard", judul "Masuk", tombol Google, divider, form email+password, slot Turnstile, submit, link Lupa Password & Daftar, footer copyright |
| 3 | `/register` | `auth/register.ejs` | Versi register, tombol submit disabled sampai Turnstile sukses (teks "Daftar & Kirim Kode"), pesan sukses kirim kode |
| 4 | `/forgot-password` | `auth/forgot-password.ejs` | Form email + state "link terkirim" |
| 5 | `/reset-password/:token` | `auth/reset-password.ejs` | Password baru + konfirmasi |
| 6 | `/privasi` | `public/privasi.ejs` | Ketentuan Layanan & Kebijakan Privasi, daftar pasal, anchor nav |
| 7 | `/dashboard` | `app/dashboard.ejs` | 4 metric + baris status (Langganan/Shopee/GoPay/QRIS), filter status, Export CSV, chart 14 hari **2 seri** (Total Order, Paid) dengan tooltip, tabel order (badge provider di kolom ID, Waktu, Nominal, Checkout Via, Ref ID, Status, Detail), paginasi, kartu "Pengingat Keamanan QRIS" + tombol "Saya sudah baca" (persist localStorage) |
| 8 | `/orders/:id` | `app/orders/show.ejs` | Breadcrumb `← Project Utama`, ID + badge status besar, grid Detail (Project, Mode, Sumber Pembayaran, Harga, Fee %, Kode unik, **Total bayar**, Dibuat, Expired, Paid, Checkout URL), blok QRIS dinamis, panel "Detail Pembayaran" (transaksi cocok / empty state), panel Webhook (log / empty state), aksi Cancel kalau masih pending |
| 9 | `/projects` | `app/projects/index.ejs` | 4 stat, tombol `+ Buat Project`, grid kartu project (badge UTAMA, aktivitas terakhir, TRANSAKSI/PAID/PENDING/VOLUME PAID, menu Edit Nama / Buka Project / Hapus), 3 modal: Buat, Edit, Hapus (konfirmasi password + warning API key dicabut + riwayat pindah ke Project Utama) |
| 10 | `/qris` | `app/qris/index.ejs` | **Langkah 1**: kartu QRIS aktif (nama merchant, provider, kota), panel DETEKSI PEMBAYARAN (status + koneksi merchant + listener), tombol Hapus QRIS, form Pasang/Ganti (dropdown provider 12 opsi + upload gambar + paste string), setting Fee %, Digit Kode (radio 1/2/3), Aktif (menit), Mode Nominal (Fee/Kode Unik/Hybrid), Redirect URL, tombol Simpan. **Langkah 2**: form Buat Order (project, nominal, reference, aktif-menit), preview breakdown live (base / fee / kode unik / **TOTAL**), banner peringatan kalau detektor belum siap |
| 11 | `/qris-paykita` | `app/qris-paykita.ejs` | Kartu gated: khusus penyewa Bot DigiKita aktif, ilustrasi, tombol Kembali ke Dashboard. Varian "aktif" (QRIS siap pakai) direncanakan tampil saat flag on |
| 12 | `/listener` | `app/listener.ejs` | 4 status card (Status Listener, Perangkat, QRIS Aktif, Mode Deteksi, Sumber APK), kartu tips "Nggak mau pakai HP?", langkah koneksi (5 stepper), kartu download APK (versi/basis/size), status per provider, daftar device terhubung / empty state |
| 13 | `/shopee` | `app/shopee.ejs` | Badge status, banner "Wajib Baca Tutorial" + "Baca Risiko", form token + Simpan & Tes Koneksi, tombol Tes/Uputuskan, panel Status Integrasi (koneksi + terakhir tes), last error |
| 14 | `/gopay` | `app/gopay.ejs` | Badge status, banner rekomendasi khusus, form nomor + Kirim OTP, field OTP + Verifikasi & Hubungkan, Tes/Putuskan, panel status (nomor merchant, terakhir tes) |
| 15 | `/subscription` | `app/subscription.ejs` | Kartu status langganan (aktif sampai tanggal + info reminder email), tab Paket / Riwayat, 4 kartu paket (harga, per-bulan, checklist, badge "Paling Hemat", tombol Beli Sekarang), tabel riwayat (Paket, Harga, Total Checkout, Status, Dibuat, Aksi) |
| 16 | `/tutorial` | `app/tutorial.ejs` | Header panduan + CTA, tab: Sebelum Mulai, Setup Wajib, Shopee, GoPay, GoPay Recommendation, Listener Provider, Projects, API & Webhook, FAQ. Stepper, alert wajib-baca, accordion FAQ |
| 17 | `/documentation` | `app/documentation.ejs` | Sidebar anchor sticky, bagian: Mulai Integrasi, Base URL & Autentikasi, Project, API Key, Daftar Endpoint (tabel), Setup QRIS, Settings (tabel field), Mode Hybrid (tabel contoh order A/B/C), Buat Order (tabel field + response), Cek Status, Cancel, Status Order, Webhook (payload + tabel signature), Error (tabel code), Contact Support. Tiap snippet pakai `code-block.ejs` (tab cURL/JS/PHP/Python + Copy) |
| 18 | `/settings` | `app/settings/*.ejs` | Tab: **Profil** (avatar inisial, nama QRIS/merchant, status akun, tanggal gabung, email + verifikasi, nama tampilan + Simpan), **API Key** (base URL + Salin, kartu per project: badge UTAMA, project ID, status, key masked + Salin + Buat Ulang, terakhir dipakai, diperbarui, Buka Project; stepper 3 langkah), **Webhook** (Webhook Secret akun + Salin/Buat Ulang, per project: URL + Simpan + Kirim Test, stepper), **Password** (lama/baru/konfirmasi), **2FA** (status + Aktifkan/Nonaktifkan, tampil QR + kode manual saat setup) |
| 19 | `/pay/:id` | `public/pay.ejs` | Header "QRIS PAYMENT" + "BAYAR KE <merchant>", nominal besar, id + badge provider, gambar QR, tombol Download QRIS, panel "Berlaku mm:ss" countdown, 3 langkah instruksi, state sukses (Status PAID / Nominal / Order / Merchant / tombol Kembali), footer trust |
| 20 | `404/500` | `errors/*.ejs` | Ilustrasi + pesan + tombol kembali |

**Navigasi sidebar (persis, 4 grup):**
```
Utama       : Dashboard, Projects
Pembayaran  : QRIS, QRIS PayKita, PayKita Listener, Shopee Partner, GoPay Merchant, Langganan
Bantuan     : Tutorial, Kebijakan & Privasi, Documentation
Akun        : Pengaturan
Footer      : Contact Support -> Telegram   (+ kartu profil + tombol Keluar)
```

---

## 6. Data model (Mongoose)

Ringkas — detail di `docs/DATA-MODEL.md`.

| Model | Field kunci | Index penting |
|---|---|---|
| `User` | email, passwordHash, googleId, name, displayName, `merchantName`, emailVerified, verified, totpSecret, totpEnabled, role, `subscriptionUntil`, `isBotTenant`, createdAt | `email` unique |
| `MerchantSettings` | userId, feePercent, uniqueDigits, shopeeFeeEnabled, shopeeUniqueEnabled, gopayFeeEnabled, gopayUniqueEnabled, orderTtl, notifyUrl, redirectUrl, webhookSecret | `userId` unique |
| `Project` | userId, name, isDefault, apiKeyHash, apiKeyMasked, apiKeyLastUsedAt, apiKeyRotatedAt, webhookUrl | `userId+name`, `apiKeyHash` |
| `QrisAccount` | userId, provider, qrisString, merchantName, merchantCity, imagePath, qrisType, status(`active`\|`standby`) | `userId+status` |
| `ProviderConnection` | userId, provider, credentialsEnc(encrypted), status, lastTestAt, lastError, meta | `userId+provider` unique |
| `ListenerDevice` | userId, deviceId, name, model, androidVersion, notificationAccess, enabledSources[], lastSeenAt, appVersion | `deviceId` unique |
| `Transaction` | userId, provider, `providerTransactionId` unique, amount, occurredAt, raw, claimedByOrderId, claimedAt | `provider+providerTransactionId` **unique**, `userId+amount+occurredAt` |
| `Order` | id(`pay_…`), userId, projectId, reference, redirectUrl, webhookUrl, mode, provider, baseAmount, feePercent, feeAmount, uniqueCode, payAmount, status, qris, checkoutUrl, ttlSeconds, createdAt, expiresAt, paidAt, cancelledAt | `payAmount+status`, `projectId+createdAt`, `status+expiresAt` |
| `WebhookDelivery` | id(`evt_…`), orderId, projectId, event, payload, secretVersion, attempts, responseStatus, lastError, deliveredAt | `orderId`, `status+nextRetryAt` |
| `SubscriptionPayment` | userId, planMonths, price, totalCheckout, status, orderId, createdAt, paidAt | `userId+createdAt` |
| `Settings` (singleton/admin) | key, pricing `{1:10000,2:20000,3:30000,5:40000}`, disabledProviders[], announcement | `key` unique |
| `AuditLog` | userId, action, targetType, targetId, ip, ua, meta, createdAt | `userId+createdAt` |

**Aturan integritas:**
- `pay_amount` unik hanya di antara order `pending` **per user+provider** (dijamin di level aplikasi
  dengan pola find-then-insert + unique index parsial di `Order`).
- `Transaction.providerTransactionId` unique → jamin satu bukti bayar cuma bisa mengklaim 1 order.
- `Order.id` = `pay_` + nanoid(20). `WebhookDelivery.id` = `evt_` + nanoid.
- API key: simpan **hash** (sha256) + versi masked (`pk_live_••••abcd`); full key hanya tampil
  sekali saat dibuat/dirotasi.

---

## 7. Kontrak REST API (wajib parity)

Base: `/api` · Auth: `x-api-key: pk_live_…`

| Method | Path | Guna | Aturan khusus |
|---|---|---|---|
| POST | `/api/merchant/qris` | Simpan QRIS statis | Hanya key Project Utama → else `403 default_project_key_required`. HARUS statis → else `400 static_qris_required` |
| POST | `/api/merchant/settings` | Update setting akun | Field opsional semua; balas juga `shopee_mode`/`gopay_mode` |
| POST | `/api/orders` | Buat order | `201`, balas `pay_amount`, `qris`, `checkout_url` |
| GET | `/api/orders/:id` | Cek status | Key project lain → `404 order_not_found` |
| POST | `/api/orders/:id/cancel` | Batalkan | Non-pending → `409 order_not_pending` |

**Error codes (semua harus ada):**
`invalid_request` 400 · `invalid_base_amount` 400 · `invalid_ttl` 400 · `invalid_qris` 400 ·
`static_qris_required` 400 · `qris_provider_required` 400 · `invalid_api_key` 401 ·
`subscription_required` 402 · `live_key_required` 403 · `default_project_key_required` 403 ·
`order_not_found` 404 · `qris_not_configured` 409 · `*_detector_not_ready` 409 ·
`order_not_pending` 409 · `payment_provider_disabled` 503

**Webhook keluar:**
- Header: `content-type: application/json`, `x-paykita-timestamp` (epoch detik),
  `x-paykita-signature: v1=<hex>`
- Tanda tangan: `HMAC-SHA256(secret, timestamp + "." + raw_body)`
- Timeout ~10s, retry maks **3x**, sukses = HTTP 2xx
- Event: `order.paid`, `webhook.test`
- Prioritas tujuan: `order.webhookUrl` → `project.webhookUrl` → `settings.notifyUrl`

---

## 8. Logika nominal (paling gampang salah, harus ada test)

```
feeAmount  = Math.round(baseAmount * feePercent / 100)
kodeUnik   = (mode unique) ? random(10^(digits-1), 10^digits - 1) : 0
payAmount  = baseAmount + feeAmount + kodeUnik
```
**Hybrid allocator** (mulai `+0`, cari yang belum dipakai order pending lain):
```
mode hybrid -> feeAmount = 0, kodeUnik = 0
loop offset = 0,1,2,3,...:
    candidate = baseAmount + offset
    kalau tidak ada Order(status=pending, userId, provider, payAmount=candidate)
        -> pakai candidate
```
Dijalankan dalam transaksi Mongo (`session.withTransaction`) supaya dua request paralel dengan
nominal sama nggak dapat `pay_amount` yang kembar.

Test wajib: `base 10000` + fee 0.5% → fee 50; hybrid order A/B/C → 10000/10001/10002;
A selesai → 10000 bisa dipakai lagi.

---

## 9. Roadmap fase

Legenda: `[ ]` belum · `[x]` selesai · `[~]` sebagian (stub jujur, tercatat)

> **Status per 2026-09-27:** Fase 0–16 **selesai** untuk inti yang direncanakan.
> Yang masih `[~]` hanya integrasi yang butuh kredensial pihak ketiga / APK:
> polling transaksi Shopee & GoPay asli dan aplikasi Android Listener (APK).
> Detail ada di masing-masing fase di bawah.

### BAGIAN A — UI DULU (tanpa DB)

**Fase 0 — Scaffold & tooling**
- [ ] `git init`, `.gitignore`, `.editorconfig`, `README.md`
- [ ] `package.json` (scripts: `dev`, `start`, `seed`, `test`)
- [ ] Express + EJS + static + view engine + layout helper
- [ ] `config/index.js` + `.env.example`
- [ ] `config/brand.js` (nama brand, logo, link support) — semua teks brand lewat sini
- [ ] `mock/` provider data dummy (`DATA_SOURCE=mock`)
- [ ] Skeleton route + `404`/`500`
- **DoD:** `npm run dev` → semua route yang direncanakan balas 200 dengan placeholder.

**Fase 1 — Design system & shell**
- [ ] `tokens.css`, `base.css`, `themes.css` (light+dark)
- [ ] `theme.js` + inline bootstrap anti-flash
- [ ] `shell.css` + `layouts/shell.ejs` + partials: head, sidebar (4 grup + semua ikon SVG),
      mobile-header, topbar, footer-support, theme-toggle
- [ ] `shell.js` (drawer mobile, nav aktif, scroll restore)
- [ ] `components.css` + partials: card, btn, badge, field, table, modal, tabs, pagination,
      toast, alert, accordion, code-block, metric-card, empty-state, stepper, kv-list
- [ ] Halaman demo `/dev/kitchen-sink` buat lihat semua komponen
- **DoD:** shell identik strukturnya dengan original, dark mode jalan, responsive di 390/760/1024/1440.

**Fase 2 — Publik & auth (7 halaman)**
- [ ] `/` landing, `/login`, `/register`, `/forgot-password`, `/reset-password/:token`,
      `/privasi`, `404`, `500`
- [ ] Turnstile widget + state tombol (reuse di login/register)
- [ ] `countdown.js` belum dipakai, siap
- **DoD:** semua halaman pixel-rapi, form tervalidasi di klien, submit masih dummy.

**Fase 3 — Dashboard & detail order**
- [ ] `/dashboard`: 4 metric, status bar, filter status, export CSV (tombol), chart 14 hari (SVG),
      tabel order, paginasi, kartu pengingat keamanan (persist)
- [ ] `chart.js` (SVG 2 seri + tooltip, tanpa library)
- [ ] `/orders/:id`: semua panel + state pending/paid/expired/cancelled + empty state
- **DoD:** bentuk & isi sama dengan `_recon/txt_dashboard.txt` & `txt_orders_*.txt`.

**Fase 4 — Projects**
- [ ] Grid kartu + 4 stat, 3 modal (buat/edit/hapus) + konfirmasi password
- [ ] Guard: project dengan order pending nggak bisa dihapus (UI state)
- **DoD:** CRUD jalan di UI (state in-memory), warning hapus tampil.

**Fase 5 — QRIS (2 langkah)**
- [ ] Langkah 1: kartu QRIS aktif, panel deteksi, form pasang/ganti (dropdown 12 provider +
      upload + paste string), setting fee/digit/TTL/mode/redirect
- [ ] Langkah 2: form buat order + `qris-preview.js` breakdown live
- [ ] Banner "detektor belum siap" + disabled state
- `/qris-paykita` (gated on/off)
- **DoD:** preview nominal cocok dengan rumus di §8 (dites manual: 10000 + 0.5% → 10050).

**Fase 6 — Provider & Listener**
- [ ] `/shopee` (form token, tes, status, banner risiko)
- [ ] `/gopay` (nomor + OTP flow UI, status)
- [ ] `/listener` (5 status card, stepper 5 langkah, kartu APK, daftar device)
- **DoD:** semua state (belum terhubung / error / terhubung) bisa dilihat via mock switch.

**Fase 7 — Settings (5 tab)**
- [ ] Profil, API Key, Webhook, Password, 2FA (+ modal QR TOTP)
- **DoD:** tab routing via `?tab=`, form + modal + toast lengkap.

**Fase 8 — Langganan, Tutorial, Documentation**
- [ ] `/subscription` (status, 4 paket, riwayat)
- [ ] `/tutorial` (9 tab + accordion FAQ)
- [ ] `/documentation` (anchor sidebar, semua bagian, code-block 4 bahasa + Copy)
- **DoD:** isi dokumentasi sama persis dengan spec di §7 & §8.

**Fase 9 — Checkout publik**
- [ ] `/pay/:id` + state pending/paid/expired, countdown, tombol Download QRIS,
      `poll-status.js`
- **DoD:** halaman jalan tanpa login, ketiga state bisa dipreview via query `?state=`.

> **Gate A → B:** seluruh 20 halaman selesai, responsive, dark mode, tanpa error console,
> dan sudah direview user.

### BAGIAN B — BACKEND

**Fase 10 — Fondasi data & auth**
- [ ] `db/connect.js`, semua model + index, `seed.js`
- [ ] Lokal Mongo: `mongodb-memory-server` (dev) atau install MongoDB Community
- [ ] Session + MongoStore, CSRF, helmet+nonce, rate limit
- [ ] Register + verifikasi email + login + logout + Google OAuth
- [ ] Forgot/reset password, ganti password
- [ ] 2FA TOTP (setup QR, verifikasi, disable)
- [ ] Ganti `DATA_SOURCE=db`, mock dilepas bertahap
- **DoD:** bisa daftar → verifikasi → login → logout → reset, session persist, CSRF nolak POST tanpa token.

**Fase 11 — Merchant settings, Project, API key**
- [ ] `MerchantSettings` CRUD, halaman Profil nyambung DB
- [ ] Projects CRUD + guard hapus (order pending) + pindah riwayat ke Project Utama
- [ ] `apikey.service.js`: generate `pk_live_`, hash, mask, rotate (wajib password), usage tracking
- [ ] Halaman API Key + Webhook nyambung DB
- **DoD:** bikin project → API key muncul sekali → rotate → key lama 401.

**Fase 12 — QRIS & order inti**
- [ ] `qris.service.js`: decode TLV EMVCo, validasi CRC16, ekstrak merchant name/city,
      deteksi provider, encode QRIS dinamis dengan nominal
- [ ] Upload/paste QRIS, status aktif/standby, hapus, validasi "harus statis"
- [ ] `amount.service.js` + Hybrid allocator atomic
- [ ] `order.service.js`: create (TTL), status machine, job expire berkala
- [ ] `/pay/:id` nyambung DB + Ganti ke real QRIS
- **DoD:** buat order dari dashboard → QRIS dinamis bisa discan → nomor & nominal benar.

**Fase 13 — REST API + webhook**
- [ ] Middleware `x-api-key` + `subscription` + semua error code
- [ ] 5 endpoint sesuai §7 (validasi ketat, balasan identik spec)
- [ ] `webhook.service.js`: HMAC, kirim, retry 3x + backoff, log delivery
- [ ] Tombol Kirim Test Webhook + halaman log
- [ ] Job expire order + worker retry webhook
- **DoD:** Postman/cURL lolos semua skenario error, signature webhook bisa diverifikasi
  pakai contoh Node.js di dokumentasi original.

**Fase 14 — Deteksi pembayaran**
- [x] `matching.service.js` 3 tahap + atomic claim (+ scope per-user untuk push Listener)
- [x] adapter mock + `scripts/fake-payment.js` buat ngetes end-to-end tanpa provider asli
- [~] `shopee.js`: koneksi token **terenkripsi AES-256-GCM** + tes koneksi; polling transaksi asli menyusul
- [~] `gopay.js`: alur nomor + OTP (sesi terenkripsi); polling transaksi asli menyusul
- [x] Listener API: registrasi device (`POST /api/listener/register`) + push
      (`POST /api/listener/push`) → `matching.service`; APK Android menyusul
- [x] Status "detektor siap" (`getDetectionForUser`) + guard order LIVE (`detector_not_ready`)
- **DoD:** simulasi bayar → order otomatis `paid` → webhook terkirim dengan signature valid. ✅
  (terverifikasi di `npm test` + `node scripts/smoke.js`)

**Fase 15 — Langganan & admin**
- [ ] Paket, bikin order billing, aktivasi masa aktif, riwayat pembayaran
- [ ] Gate `402 subscription_required`, reminder email H-7/H-3/H-1 (job harian)
- [ ] Panel admin: override harga, enable/disable provider, lihat merchant & order
- **DoD:** langganan aktif → REST API kebuka; habis → 402 tapi payment tools tetap jalan.

**Fase 16 — Hardening & deploy**
- [x] Test: amount, qris, hmac, crypto, listener, **integrasi** (error code API, order,
      Listener push, webhook retry, audit) → total **61 test hijau**
- [x] Rate limit per endpoint, **AuditLog** (`services/audit.service.js`) terpasang di auth,
      settings, provider, dan aksi admin; validasi input menyeluruh
- [x] EJS escaping rapi, tidak ada XSS; CSP nonce nyambung ke semua script
- [x] **Turnstile server-side** (`middleware/turnstile.js`) di login/register/forgot-password
- [x] Google OAuth 2.0 (Authorization Code) — aktif bila `GOOGLE_ENABLED=true` +
      `GOOGLE_CLIENT_ID`/`SECRET` diisi; nonaktif secara default
- [x] Panduan deploy VPS + contoh config nginx/PM2 (`docs/DEPLOY.md`)
- **DoD:** `npm test` hijau (61/61), bisa di-deploy ke VPS baru. ✅

---

## 10. Konfigurasi & environment

`.env.example`:
```env
NODE_ENV=development
PORT=3000
BASE_URL=http://localhost:3000
APP_NAME=Malawali Payment
SUPPORT_URL=https://t.me/...

MONGODB_URI=mongodb://127.0.0.1:27017/paykita
SESSION_SECRET=change-me
DATA_SOURCE=mock            # mock | db

TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
TURNSTILE_DISABLED=true     # true = lewati (dev)

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

SMTP_HOST= SMTP_PORT= SMTP_USER= SMTP_PASS= MAIL_FROM=

CREDENTIAL_ENC_KEY=32-byte-hex     # AES buat kredensial provider
WEBHOOK_TIMEOUT_MS=10000
WEBHOOK_MAX_ATTEMPTS=3
ORDER_EXPIRE_SWEEP_SECONDS=30
```

**MongoDB buat dev (belum ada mongod & Docker):**
1. **Rekomendasi dev:** `mongodb-memory-server` → nol install, nyala otomatis saat `npm run dev`,
   data hilang saat restart (aman buat fase UI).
2. **Rekomendasi lanjut:** MongoDB Atlas free tier → connection string ke `MONGODB_URI`.
3. Alternatif: install MongoDB Community Server lokal (butuh download manual).
> Keputusan ini perlu dipilih user di Fase 10.

**Dev bypass yang wajib ada biar UI nggak nge-block:**
`DATA_SOURCE=mock`, `TURNSTILE_DISABLED=true`, `MAIL_TRANSPORT=console`,
`PROVIDER_ADAPTER=mock`.

---

## 11. Konvensi kode

- 2 spasi, tanpa titik koma? → **pakai titik koma** (default eslint `semi: always`), string pakai
  kutip tunggal. (bisa disesuaikan)
- Nama file: `kebab-case`. Nama model: `PascalCase`. Service: `*.service.js`.
- Route tipis, logika di `services/`. Controller = fungsi async dibungkus `asyncHandler`.
- Semua nominal integer rupiah, konversi hanya di view.
- Format tanggal & uang lewat `lib/datetime.js` + `lib/money.js` (id-ID), jangan format manual.
- EJS: `<%= %>` untuk semua output user. `<%- %>` hanya untuk partial & HTML aman.
- Tiap route punya `title`, dan partial `head.ejs` yang set `<title>`.
- Tidak ada dependency front-end (nggak ada jQuery/Chart.js). Chart digambar manual SVG.
- Dependency backend fase awal: `express`, `ejs`, `express-session`, `connect-mongo`, `mongoose`,
  `helmet`, `csurf`, `dotenv`, `nodemailer`, `otplib`, `qrcode`, `multer`, `nanoid`, `express-rate-limit`, `nodemon` (dev).

---

## 12. Keputusan akhir (sudah dikunci)

| # | Keputusan | Hasil |
|---|---|---|
| 1 | **Target rebuild** | Sistem **PayKita (pay.digikita.id)** — dashboard merchant QRIS |
| 2 | **Brand** | **Malawali Payment** |
| 3 | **Malawali gateway lama** | Sudah di-off, **tidak dipakai** (jangan bawa `idtrx`/`saldo`/`mutasi`/`Bearer`) |
| 4 | **Desain** | Clean corporate PayKita (biru `#174d9b`, Inter + JetBrains Mono) |
| 5 | **Auth** | Email + password + verifikasi email + 2FA TOTP (+ Google OAuth opsional) |
| 6 | **Model dana** | Tanpa saldo |
| 7 | **MongoDB dev** | `mongodb-memory-server` |
| 8 | **Provider asli** | Diimplement apa adanya di Fase 14 (Shopee token, GoPay OTP) |
| 9 | **Ritme kerja** | Lanjut terus sampai **Gate A** (Fase 0–9, seluruh UI) selesai, baru review |
| 10 | Google OAuth & Turnstile | Skip dulu (bypass dev), pasang di Fase 16 |
| 11 | SMTP | Log ke console dulu, SMTP nyata di Fase 16 |
| 12 | APK Listener | API + model device selesai (`/api/listener/*`); APK menyusul |
| 13 | Panel admin | Path `/admin` + role `admin` |

---

## 13. Riwayat dokumen

| Tanggal | Perubahan |
|---|---|
| 2026-09-27 | Plan awal dibuat dari hasil recon (`_recon/RECON.md`) |
| 2026-09-27 | Keputusan dikunci: brand **Malawali Payment**, target = rebuild PayKita, desain clean corporate, auth password+2FA, tanpa saldo, Mongo `mongodb-memory-server`, provider asli, kerja lanjut sampai Gate A |
| 2026-09-27 | Fase 10–16 selesai: DB+auth, project/API key, QRIS/order, REST API+webhook, matching, admin/langganan. Ditambah: Listener API, enkripsi AES-256-GCM kredensial, Turnstile server-side, AuditLog, test integrasi |
