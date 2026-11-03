'use strict';

/**
 * Generator QRIS EMVCo dinamis untuk backend legacy PayKita.
 *
 * Port logika `generateDynamicQris` + `crc16Ccitt` dari 9router-mibp-version
 * (ganti SDK obfuscated lama `QRIS.convert`). Beroperasi pada QRIS statis
 * (Point of Initiation 010211) → dinamis (010212) dengan tag 54 (amount)
 * dan recompute CRC16-CCITT (tag 6304).
 */

// QRIS statis default: merchant GoPay Bos ("MUHAMMAD DAFFA RAMADHAN",
// BIMA, gateway COM.GO-JEK.WWW). Payload asli sudah diverifikasi scanable.
// Merchant OrderKuota (COM.NOBUBANK.WWW, OK2296369) CLOSED sejak 2026-08-28
// — JANGAN dipakai lagi (mutasi kering, "QRIS MERCHANT DITUTUP").
// Bisa di-override via env MALAWALI_QRIS_BASE (payload QRIS statis tag 01=11).
const GOQIS_BASE =
  "00020101021126610014COM.GO-JEK.WWW01189360091437639275970210G7639275970303UMI51440014ID.CO.QRIS.WWW0215ID10265097903940303UMI5204899953033605802ID5924MUHAMMAD DAFFA RAMADHAN,6004BIMA61058411562070703A016304C0A9";

const QRIS_BASE = String(process.env.MALAWALI_QRIS_BASE || '').trim() || GOQIS_BASE;

// Routing nominal per provider:
//   Rp 1.000 – Rp 10.000 (base) → Saweria (default: QR URL halaman donasi
//   https://saweria.co/malawali — model A, scan di browser)
//   di bawah 1.000 / di atas 10.000 → QRIS GoPay
// Env override:
//   MALAWALI_SAWERIA_QRIS_BASE  — set ke payload QRIS EMVCo (000201...) kalau
//   lo punya QRIS merchant Saweria → scan e-wallet direct; set URL lain
//   (saweria.co/{user}) kalau halaman donasinya beda.
//   MALAWALI_SAWERIA_AMOUNT_PARAM — query param nominal (default "amount")
const SAWERIA_QRIS_BASE = String(process.env.MALAWALI_SAWERIA_QRIS_BASE || '').trim();

function pickProvider(baseAmount) {
  const n = Number(baseAmount);
  if (!Number.isFinite(n)) return { provider: 'gopay', base: QRIS_BASE, saweriaConfigured: false };
  if (n >= 1000 && n <= 10000) {
    const sawBase = SAWERIA_QRIS_BASE || SAWERIA_URL_DEFAULT;
    return { provider: 'saweria', base: sawBase, saweriaConfigured: true };
  }
  return { provider: 'gopay', base: QRIS_BASE, saweriaConfigured: false };
}

function crc16Ccitt(str) {
  let crc = 0xffff;
  const buf = Buffer.from(str, "ascii");
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Ubah QRIS statis jadi dinamis + sisipkan nominal.
 * @param {string} rawQris payload QRIS statis (tag 01 = 11)
 * @param {number} amount nominal rupiah (integer)
 * @returns {string} payload QRIS dinamis valid (termasuk CRC16)
 */
function generateDynamicQris(rawQris, amount) {
  const clean = String(rawQris || "").trim();
  if (!clean) throw new Error("QRIS statis tidak valid");

  // buang tag 63 CRC lama jika ada di akhir
  const lastTagIdx = clean.lastIndexOf("6304");
  let body = lastTagIdx !== -1 ? clean.slice(0, lastTagIdx) : clean;

  // statis → dinamis
  body = body.replace("010211", "010212");

  if (amount && amount > 0) {
    const amountStr = Math.round(Number(amount)).toString();
    const tagLen = amountStr.length.toString().padStart(2, "0");
    const tag54 = `54${tagLen}${amountStr}`;
    const tag58Idx = body.indexOf("5802ID");
    if (tag58Idx !== -1) body = body.slice(0, tag58Idx) + tag54 + body.slice(tag58Idx);
    else body += tag54;
  }

  return body + "6304" + crc16Ccitt(body + "6304");
}

/**
 * Ambil payload QRIS dinamis untuk nominal tertentu (routing per provider).
 *
 * Kalau payload base-nya QRIS EMVCo (mulai "000201") → tag 54 nominal di-sisipin,
 * hasilnya string EMVCo yang di-scan di e-wallet.
 *
 * Kalau base-nya URL (mulai "http") — mis. halaman donasi Saweria —
 * hasilnya string URL yang (opsional) ditambai query param nominal,
 * di-scan di browser. Env:
 *   MALAWALI_SAWERIA_QRIS_BASE   (default: https://saweria.co/malawali)
 *   MALAWALI_SAWERIA_AMOUNT_PARAM (default: "amount" → ?amount=1000)
 * @param {number} amount nominal final rupiah (integer)
 * @param {number} [baseAmount] nominal base — dipakai pilih provider
 * @returns {{provider:string, saweriaConfigured:boolean, text:string}}
 */
const SAWERIA_URL_DEFAULT = 'https://saweria.co/malawali';
const SAWERIA_URL = String(process.env.MALAWALI_SAWERIA_QRIS_BASE || SAWERIA_URL_DEFAULT).trim();
const SAWERIA_AMOUNT_PARAM = String(process.env.MALAWALI_SAWERIA_AMOUNT_PARAM || 'amount').trim();

function convert(amount, baseAmount) {
  const b = baseAmount !== undefined ? Number(baseAmount) : Number(amount);
  const { provider, base, saweriaConfigured } = pickProvider(b);
  if (provider === 'saweria') {
    // base QRIS EMVCo (000201...) → sisipin tag 54 nominal;
    // base URL (http...) → query param nominal (halaman donasi)
    if (/^000201/.test(base)) {
      return { provider: 'saweria', saweriaConfigured: true, text: generateDynamicQris(base, amount) };
    }
    const sep = base.includes('?') ? '&' : '?';
    const text = base + sep + SAWERIA_AMOUNT_PARAM + '=' + Math.round(Number(amount));
    return { provider: 'saweria', saweriaConfigured: true, text };
  }
  return { provider, saweriaConfigured, text: generateDynamicQris(base, amount) };
}

module.exports = { convert, generateDynamicQris, crc16Ccitt, QRIS_BASE, pickProvider };
