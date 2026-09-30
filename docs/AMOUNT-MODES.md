# Mode nominal

Dua order berbeda tidak boleh punya `pay_amount` yang sama selama keduanya `pending`,
karena pencocokan pembayaran berbasis nominal.

```
feeAmount  = Math.round(baseAmount * feePercent / 100)
kodeUnik   = (mode unique) ? random(10^(digits-1) .. 10^digits - 1) : 0
payAmount  = baseAmount + feeAmount + kodeUnik
```

Rumus di `public/js/qris-preview.js` harus sama dengan `src/services/amount.service.js`.

## Tiga mode

| Mode | feeAmount | uniqueCode | Catatan |
|---|---|---|---|
| `fee` | dihitung dari `feePercent` | 0 | Nominal naik konstan oleh fee |
| `unique` | 0 | random 1–3 digit | Kode unik tiap order |
| `hybrid` | 0 | 0, lalu +1/+2/+3… | Fee & unik OFF; tambahan hanya bila bentrok |

## Hybrid allocator

```
offset = 0
loop:
  candidate = baseAmount + offset
  kalau tidak ada order (pending, user, provider) dengan pay_amount = candidate:
      pakai candidate
  offset += 1
```

Dijalankan dalam `createOrderForUser` dengan retry saat unique index menolak (dua request
paralel). Nominal otomatis tersedia kembali setelah order sebelumnya PAID/EXPIRED/CANCELLED
(karena index unik hanya berlaku untuk status `pending`).

## Contoh

| Order | Kondisi | Nominal |
|---|---|---|
| A | base Rp10.000 | Rp10.000 |
| B | A masih pending | Rp10.001 |
| C | A+B masih pending | Rp10.002 |
| D | A sudah selesai | Rp10.000 (bisa dipakai lagi) |

## Rekomendasi GoPay

Fee dan kode unik sebaiknya tetap OFF (mode Hybrid) untuk mengurangi pola transaksi yang
bisa dianggap tidak wajar. Risiko tetap tanggung jawab merchant.
