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

/** Ambil payload QRIS dinamis untuk nominal tertentu. */
function convert(amount) {
  return generateDynamicQris(QRIS_BASE, amount);
}

module.exports = { convert, generateDynamicQris, crc16Ccitt, QRIS_BASE };
