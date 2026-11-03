'use strict';

/**
 * Generator QRIS EMVCo dinamis untuk backend legacy PayKita.
 *
 * Port logika `generateDynamicQris` + `crc16Ccitt` dari 9router-mibp-version
 * (ganti SDK obfuscated lama `QRIS.convert`). Beroperasi pada QRIS statis
 * (Point of Initiation 010211) → dinamis (010212) dengan tag 54 (amount)
 * dan recompute CRC16-CCITT (tag 6304).
 */

// Default (fallback semua band): merchant DANA Bisnis "Heroikzre",
// Kab. Bima, gateway ID.DANA.WWW. Payload asli diverifikasi (CRC match).
const DANA_QRIS_BASE =
  "00020101021126570011ID.DANA.WWW011893600915300191307702090019130770303UMI51440014ID.CO.QRIS.WWW0215ID10264914785370303UMI5204737253033605802ID5909Heroikzre6009Kab. Bima6105841136304B738";

// QRIS GoPay (merchant "MUHAMMAD DAFFA RAMADHAN") masih bisa di-override
// via env MALAWALI_QRIS_BASE (payload QRIS statis tag 01=11) — dipakai hanya
// sebagai fallback band 1k-10k kalau payload Saweria belum di-set.
const GOQIS_BASE =
  "00020101021126610014COM.GO-JEK.WWW01189360091437639275970210G7639275970303UMI51440014ID.CO.QRIS.WWW0215ID10265097903940303UMI5204899953033605802ID5924MUHAMMAD DAFFA RAMADHAN,6004BIMA61058411562070703A016304C0A9";

const QRIS_BASE = String(process.env.MALAWALI_QRIS_BASE || '').trim() || GOQIS_BASE;

// Routing nominal per provider (DANA default semua):
//   Rp 1.000 – Rp 10.000 (base) → Saweria, KALAU env MALAWALI_SAWERIA_QRIS_BASE
//   udah di-set payload QRIS EMVCo (mulai "000201"). Kalau belum → DANA.
//   nominal lainnya (<1.000 / >10.000) → DANA Bisnis.
// QRIS GoPay (env MALAWALI_QRIS_BASE) ga dipakai routing default — hanya
// tersedia buat override manual. User JANGAN PERNAH di-alamin ke halaman
// donasi — QRIS direct, gw ngecek.
const SAWERIA_QRIS_BASE = String(process.env.MALAWALI_SAWERIA_QRIS_BASE || '').trim();
const HAS_SAWERIA_QRIS = /^000201/.test(SAWERIA_QRIS_BASE);

function pickProvider(baseAmount) {
  const n = Number(baseAmount);
  if (!Number.isFinite(n)) return { provider: 'dana', base: DANA_QRIS_BASE };
  if (n >= 1000 && n <= 10000 && HAS_SAWERIA_QRIS) {
    return { provider: 'saweria', base: SAWERIA_QRIS_BASE };
  }
  return { provider: 'dana', base: DANA_QRIS_BASE };
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

// Env MALAWALI_QRIS_MODE (default "prefill"):
//   prefill — tag 01 dibiarkan 11 (statis) + tag 54 nominal di-pre-fill.
//             Legal QRIS: merchant statis tetep diterima scanner, nominal
//             sudah terisi di app (bisa di-edit user, tapi default-nya
//             persis unique-fee kita). INI mode buat merchant DANA/GoPay
//             retail — QR dinamis penuh (01=12) DITOLAK acquirer ("ada
//             kendala pada proses ini").
//   dynamic — flip 01→12 + tag 54 (nominal strict-lock). Cuma buat
//             merchant beneran dynamic-capable (acquirer ngijinin).
//   static  — payload mentah tanpa tag 54 (user ngetik nominal sendiri).
const QRIS_MODE = (function (m) {
  const v = String(process.env.MALAWALI_QRIS_MODE || 'prefill').toLowerCase();
  return v === 'dynamic' || v === 'static' ? v : 'prefill';
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
