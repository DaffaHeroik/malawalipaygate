# REST API

Base URL: `{BASE_URL}/api` · Auth: header `x-api-key: pk_live_…`
Format: JSON. Sukses `{ "ok": true, "data": … }`, gagal `{ "ok": false, "error": { "code", "message" } }`.

## POST /api/merchant/qris

Simpan/perbarui QRIS statis. **Hanya API key Project Utama.**

```json
{ "provider": "shopee", "qris": "000201010211…6304568D", "set_active": true }
```

- `400 invalid_qris` — string tidak valid / CRC salah
- `400 static_qris_required` — bukan QRIS statis (tag 01 ≠ 11)
- `400 qris_provider_required` — provider kosong
- `403 default_project_key_required`

## POST /api/merchant/settings

Semua field opsional.

```json
{
  "fee_percent": 0.5,
  "unique_digits": 2,
  "order_ttl": 900,
  "notify_url": "https://app.example.com/hook",
  "redirect_url": "https://app.example.com/selesai",
  "shopee_mode": "hybrid",
  "gopay_mode": "hybrid"
}
```

`shopee_mode`/`gopay_mode` ∈ `fee | unique | hybrid`.

## POST /api/orders

```json
{ "base_amount": 25000, "ttl_seconds": 900, "reference_id": "INV-1", "notify_url": "https://…" }
```

Response `201`:

```json
{
  "ok": true,
  "data": {
    "id": "pay_…", "status": "pending", "provider": "shopee",
    "base_amount": 25000, "fee_amount": 0, "unique_code": 0, "pay_amount": 25000,
    "qris": "000201010212…540525000…6304XXXX",
    "checkout_url": "https://…/pay/pay_…",
    "reference_id": "INV-1", "expires_at": "…", "created_at": "…"
  }
}
```

- `400 invalid_base_amount`, `400 invalid_ttl`, `400 invalid_request`
- `409 qris_not_configured`, `409 detector_not_ready`
- `503 payment_provider_disabled`

## GET /api/orders/:id

Status order milik project ini. Project lain → `404 order_not_found`.

## POST /api/orders/:id/cancel

Batalkan order. Non-pending → `409 order_not_pending`.

## Tabel error

| HTTP | Kode | Arti |
|---|---|---|
| 400 | `invalid_request` | Body/parameter tidak valid |
| 400 | `invalid_base_amount` | `base_amount` bukan integer > 0 |
| 400 | `invalid_ttl` | `ttl_seconds` di luar 60–86400 |
| 400 | `invalid_qris` | String QRIS tidak valid |
| 400 | `static_qris_required` | Harus QRIS statis |
| 400 | `qris_provider_required` | Provider belum diisi |
| 401 | `invalid_api_key` | API key tidak valid |
| 402 | `subscription_required` | Langganan tidak aktif |
| 403 | `live_key_required` | Bukan key `pk_live_…` |
| 403 | `default_project_key_required` | Harus key Project Utama |
| 404 | `order_not_found` | Order tidak ditemukan |
| 409 | `qris_not_configured` | QRIS LIVE belum diset |
| 409 | `detector_not_ready` | Deteksi pembayaran belum siap |
| 409 | `order_not_pending` | Order sudah tidak pending |
| 503 | `payment_provider_disabled` | Provider dinonaktifkan admin |

## Webhook

Header: `x-malawali-timestamp`, `x-malawali-signature: v1=<hex>`, `x-malawali-event`.
Tanda tangan: `HMAC-SHA256(secret, timestamp + "." + raw_body)`.

```json
{ "event": "order.paid", "created_at": "…", "data": { "id": "pay_…", "status": "paid", "pay_amount": 25000, "paid_at": "…" } }
```

Event: `order.paid`, `webhook.test`. Timeout 10s, retry maks 3×.

---

# Listener API

Base: `{BASE_URL}/api/listener` — dipakai aplikasi Android **Malawali Listener**.

## POST /api/listener/register

Auth: `x-api-key` (harus API key **Project Utama**, langganan aktif).

```json
{
  "device_id": "ABC123XYZ",
  "name": "HP Kasir",
  "model": "Redmi Note 12",
  "android_version": "13",
  "app_version": "1.0-beta.2",
  "notification_access": true,
  "enabled_sources": ["shopee", "gopay"]
}
```

Response `201`:

```json
{
  "ok": true,
  "data": {
    "device": {
      "id": "…", "deviceId": "ABC123XYZ", "name": "HP Kasir",
      "enabledSources": ["shopee", "gopay"], "notificationAccess": true
    },
    "device_token": "dev_live_…",
    "token_preview": "dev_live_••••••abcd",
    "token_issued": true
  }
}
```

> `device_token` **hanya ditampilkan sekali**. Perangkat yang sudah terdaftar akan
> mempertahankan token lama (`token_issued: false`).

## GET /api/listener/devices

Daftar perangkat milik akun.

## POST /api/listener/devices/:deviceId/revoke

Cabut perangkat → device token langsung tidak berlaku.

## GET /api/listener/me

Auth: `x-device-token`. Heartbeat; memperbarui `lastSeenAt`.

## POST /api/listener/push

Auth: `x-device-token`. Mengirim bukti pembayaran untuk dicocokkan.

```json
{ "provider": "shopee", "provider_transaction_id": "TRX-1", "amount": 25000, "occurred_at": "2026-09-27T10:00:00Z" }
```

Response:

```json
{ "ok": true, "data": { "matched": true, "order_id": "pay_…", "reason": null } }
```

- `reason`: `no_matching_order`, `already_claimed`, `invalid_payload`
- `409 source_not_enabled` — provider tidak ada di `enabled_sources` perangkat
- `503 payment_provider_disabled` — provider dinonaktifkan admin
- `401 invalid_device_token` — token salah / sudah dicabut

Ketika `matched: true`, order otomatis `paid` dan webhook `order.paid` dikirim.
Pencocokan dibatasi ke merchant pemilik perangkat.
