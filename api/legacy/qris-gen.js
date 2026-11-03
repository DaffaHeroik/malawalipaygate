'use strict';

/**
 * Generator QRIS EMVCo dinamis untuk backend legacy PayKita.
 *
 * Port logika `generateDynamicQris` + `crc16Ccitt` dari 9router-mibp-version
 * (ganti SDK obfuscated lama `QRIS.convert`). Beroperasi pada QRIS statis
 * (Point of Initiation 010211) → dinamis (010212) dengan tag 54 (amount)
 * dan recompute CRC16-CCITT (tag 6304).
 */

// Default SEMUA nominal: merchant GoPay Bos — outlet sudah di-rename
// "MALAWALI" (tag 59), BIMA, gateway COM.GO-JEK.WWW. Tag 59 diganti dari
// "MUHAMMAD DAFFA RAMADHAN," → "MALAWALI" + recompute CRC (6B88, TLV valid).
// Bisa di-override env MALAWALI_QRIS_BASE (payload QRIS statis tag 01=11).
const GOQIS_BASE =
  "00020101021126610014COM.GO-JEK.WWW01189360091437639275970210G7639275970303UMI51440014ID.CO.QRIS.WWW0215ID10265097903940303UMI5204899953033605802ID5908MALAWALI6004BIMA61058411562070703A0163046B88";

const QRIS_BASE = String(process.env.MALAWALI_QRIS_BASE || '').trim() || GOQIS_BASE;

// Routing nominal per provider (default SEMUA → GoPay):
//   band Rp 1.000 – 10.000 → Saweria HANYA kalau env MALAWALI_SAWERIA_QRIS_BASE
//   (payload QRIS EMVCo 000201...) sudah di-set. Nominal lainnya → GoPay.
const SAWERIA_QRIS_BASE = String(process.env.MALAWALI_SAWERIA_QRIS_BASE || '').trim();
const HAS_SAWERIA_QRIS = /^000201/.test(SAWERIA_QRIS_BASE);

function pickProvider(baseAmount) {
  const n = Number(baseAmount);
  if (Number.isFinite(n) && n >= 1000 && n <= 10000 && HAS_SAWERIA_QRIS) {
    return { provider: 'saweria', base: SAWERIA_QRIS_BASE };
  }
  return { provider: 'gopay', base: QRIS_BASE };
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

// Env MALAWALI_QRIS_MODE (default "static"):
//   static  — payload QR DANA/GoPay ASLI dari dashboard, tanpa modifikasi.
//             SATU-SATUNYA mode yang terbukti bisa dibayar (acquirer DANA
//             nolak tag 54 prefill di 01=11, dan nolak 01=12 juga — kedua-
//            anya error "ada kendala pada proses ini"). User scan → ngetik
//             nominal unique-fee yang tampil di UI API kita → match exact.
//   prefill — 01=11 + tag 54 (DANA tolak, jelek).
//   dynamic — 01=12 + tag 54 (DANA tolak, jelek).
const QRIS_MODE = (function (m) {
  const v = String(process.env.MALAWALI_QRIS_MODE || 'static').toLowerCase();
  return ['dynamic', 'static', 'prefill'].includes(v) ? v : 'static';
})();

/**
 * Ubah QRIS statis jadi dinamis + sisipkan nominal.
 * @param {string} rawQris payload QRIS statis (tag 01 = 11)
 * @param {number} amount nominal rupiah (integer)
 * @returns {string} payload QRIS dinamis valid (termasuk CRC16)
 */
function generateDynamicQris(rawQris, amount) {
  const clean = String(rawQris || "").trim();
  if (!clean) throw new Error("QRIS statis tidak valid");

  if (QRIS_MODE === 'static') {
    // payload asli mentah (tag 01=11, customer isi nominal saat scan)
    return clean;
  }

  // buang tag 63 CRC lama jika ada di akhir
  const lastTagIdx = clean.lastIndexOf("6304");
  let body = lastTagIdx !== -1 ? clean.slice(0, lastTagIdx) : clean;

  if (QRIS_MODE === 'dynamic') {
    // statis → dinamis penuh (01=12, nominal strict-lock)
    body = body.replace("010211", "010212");
  }
  // prefill: tag 01 tetep 11 (merchant statis), nominal di-pre-fill via tag 54

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
 * Hasil selalu QRIS EMVCo (tag 54 nominal) — provider = provider yang
 * benar-benar dipakai generate QR (bisa 'gopay' walau base-nya band saweria,
 * kalau payload Saweria belum di-set).
 * @param {number} amount nominal final rupiah (integer)
 * @param {number} [baseAmount] nominal base — dipakai pilih provider
 * @returns {{provider:string, text:string}}
 */
function convert(amount, baseAmount) {
  const b = baseAmount !== undefined ? Number(baseAmount) : Number(amount);
  const { provider, base } = pickProvider(b);
  return { provider, text: generateDynamicQris(base, amount) };
}

module.exports = { convert, generateDynamicQris, crc16Ccitt, QRIS_BASE, pickProvider };
