# Deteksi pembayaran

## Sumber deteksi

| Sumber | Provider | Cara |
|---|---|---|
| API merchant | Shopee Partner, GoPay Merchant | Poll transaksi dari sesi portal merchant |
| Malawali Listener | DANA, BCA, OrderKuota, BRI, OCTO, BNI, BYOND, JakOne, Bukalapak, Livin | Notifikasi Android dari HP merchant |

Satu QRIS aktif hanya boleh punya satu sumber deteksi yang relevan. Status "detektor siap"
muncul bila koneksi merchant `connected` **atau** ada Listener device dengan
`notificationAccess = true` dan `enabledSources` memuat provider QRIS aktif.

Order LIVE ditolak (`409 detector_not_ready`) selama detektor belum siap.

## Pencocokan 3 tahap

`src/services/matching.service.js`:

1. **Nominal persis** — cari order `pending` dengan `provider` sama dan
   `payAmount === amount`.
2. **Window waktu** — pembayaran harus berada di antara `createdAt` dan `expiresAt` order.
3. **Klaim sekali** — `providerTransactionId` disimpan di `transactions` dengan unique index;
   order yang cocok menandai `claimedByOrderId`. Satu bukti bayar tidak bisa dipakai dua kali.

Kandidat diproses dari yang paling lama. Bila order sudah tidak pending (race), klaim
dilepas dan kandidat berikutnya dicoba.

> Bila `userId` diketahui (push dari Listener), pencarian order dibatasi ke merchant
> tersebut supaya pembayaran tidak salah cocok antar tenant.

## Simulasi (tanpa provider asli)

```bash
node scripts/fake-payment.js --order pay_xxxx
node scripts/fake-payment.js --provider shopee --amount 25000 --tx TRX-1
```

`node scripts/smoke.js` menjalankan alur penuh: API key → QRIS → order → bayar → webhook
dengan verifikasi signature.

## Intake dari Malawali Listener (sudah jalan)

`src/routes/listener-api.routes.js` + `src/services/listener.service.js`:

1. `POST /api/listener/register` (header `x-api-key`, Project Utama) → server
   mengembalikan `device_token` (`dev_live_…`) yang **hanya tampil sekali**;
   yang disimpan cuma hash-nya di `listenerdevices.tokenHash`.
2. `POST /api/listener/push` (header `x-device-token`) dengan
   `{ provider, provider_transaction_id, amount, occurred_at }` → masuk ke
   `matching.service.processPayment()` dengan `userId` pemilik perangkat.
3. `GET /api/listener/me` untuk heartbeat; `POST /api/listener/devices/:id/revoke`
   untuk mencabut perangkat (token langsung tidak berlaku).

Push dengan provider yang tidak ada di `enabledSources` perangkat → `409 source_not_enabled`.

## Provider asli (sebagian)

- `shopee` — token disimpan **terenkripsi** (`credentialsEnc`) + tes koneksi; polling transaksi asli menyusul.
- `gopay` — alur nomor + OTP, sesi terenkripsi; polling transaksi asli menyusul.

Kredensial disimpan di `providerconnections.credentialsEnc` (AES-256-GCM, key dari
`CREDENTIAL_ENC_KEY`, lihat `src/services/crypto.service.js`).
