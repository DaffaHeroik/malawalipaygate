# Arsitektur

## Alur request

```
Browser ──► Express (app.js)
             ├─ security (helmet + CSP nonce)
             ├─ session (MemoryStore di mock, MongoStore di db)
             ├─ flash
             ├─ csrf (kecuali /api/*)
             ├─ locals  (brand, constants, helpers, icons)
             ├─ loadUser (session → AsyncLocalStorage context)
             └─ routes
                  └─ data/*  (facade: mock | db)
                       └─ services/*  (qris, amount, webhook, matching)
                            └─ models/* (Mongoose)
```

## Lapisan data (facade)

Semua route memakai `require('../data')` dan **tidak pernah** memanggil `mock/` atau
`models/` langsung. `src/data/index.js` memilih implementasi dari `DATA_SOURCE`:

| Nilai | Modul | Catatan |
|---|---|---|
| `mock` | `src/mock/store.js` | data dummy in-memory, tanpa DB |
| `db` | `src/data/db.js` | MongoDB + Mongoose |

Karena route tidak berubah antara mock dan db, migrasi UI→DB tidak menyentuh view.

## Konteks user (AsyncLocalStorage)

Route memanggil `data.listProjects()` tanpa argumen userId (kontrak yang sama sejak fase
mock). Di mode db, `middleware/auth.js` membungkus sisa request dengan
`context.runWithContext({ userId })`, dan `data/db.js` membaca userId dari situ.
Ini menghindari state global yang bisa bocor antar request paralel.

Method berakhiran `*ForUser(userId, …)` dipakai oleh REST API yang tidak punya session.

## Service

| Service | Tanggung jawab |
|---|---|
| `qris.service` | parse/build TLV, CRC16-CCITT, validate, inspect, static→dynamic, deteksi provider |
| `amount.service` | fee, kode unik, hybrid allocator, mode per provider |
| `order.service` | sweep order expired |
| `webhook.service` | kirim HMAC + retry + log `WebhookDelivery` |
| `matching.service` | cocokkan pembayaran 3 tahap + klaim sekali |
| `apikey.service` | generate `pk_live_`, hash (SHA-256+pepper), mask |

## Kegagalan &idempotensi

- `Transaction` punya unique index `provider + providerTransactionId` → bukti bayar hanya
  bisa mengklaim satu order.
- `Order` punya partial unique index `userId + provider + payAmount` (khusus `pending`) →
  dua request paralel tidak bisa mendapat `pay_amount` kembar.
- Webhook bersifat best-effort; kegagalan dicatat di `WebhookDelivery` (status, attempts,
  responseStatus, lastError).
