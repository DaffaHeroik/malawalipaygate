'use strict';

/**
 * QRIS / EMVCo (merchant-presented mode) helper.
 *
 * Payload QRIS = rangkaian TLV: [tag 2 digit][panjang 2 digit][isi].
 * Referensi algoritma: EMVCo QR Code Specification — static→dynamic:
 *   1. parse TLV
 *   2. tag 01: 11 (static) → 12 (dynamic)
 *   3. buang 54 (nominal) & 55/56/57 (fee) lama
 *   4. sisip 54 (nominal bulat IDR) sebelum tag 58 (negara)
 *   5. opsional sisip fee 55+56 / 55+57
 *   6. tambah 6304 lalu hitung CRC16-CCITT dari seluruh string termasuk "6304"
 */

const TAG = {
  PAYLOAD_FORMAT: '00',
  POINT_OF_INITIATION: '01',
  MERCHANT_ACCOUNT: ['26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50', '51'],
  MERCHANT_CATEGORY: '52',
  CURRENCY: '53',
  AMOUNT: '54',
  TIP_INDICATOR: '55',
  FEE_PERCENT: '56',
  FEE_FIXED: '57',
  COUNTRY: '58',
  MERCHANT_NAME: '59',
  MERCHANT_CITY: '60',
  POSTAL_CODE: '61',
  ADDITIONAL_DATA: '62',
  CRC: '63',
};

class QrisError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'QrisError';
    this.code = code;
  }
}

/* ── CRC16-CCITT (poly 0x1021, init 0xFFFF, no final XOR) ── */
const crc16 = (str) => {
  let crc = 0xffff;
  const value = String(str);
  for (let i = 0; i < value.length; i += 1) {
    crc ^= value.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
};

const isNumeric = (value) => /^\d+$/.test(String(value));

/** Parse payload menjadi list { tag, value, raw }. Throw kalau struktur rusak. */
const parseTlv = (payload) => {
  const value = String(payload || '');
  if (!value) throw new QrisError('invalid_qris', 'Payload QRIS kosong.');

  const fields = [];
  let index = 0;

  while (index < value.length) {
    if (index + 4 > value.length) throw new QrisError('invalid_qris', 'Struktur TLV tidak lengkap.');

    const tag = value.slice(index, index + 2);
    const lengthRaw = value.slice(index + 2, index + 4);
    if (!isNumeric(tag) || !isNumeric(lengthRaw)) {
      throw new QrisError('invalid_qris', `Tag/panjang tidak valid di posisi ${index}.`);
    }

    const length = Number.parseInt(lengthRaw, 10);
    const start = index + 4;
    const end = start + length;
    if (end > value.length) throw new QrisError('invalid_qris', `Isi tag ${tag} terpotong.`);

    fields.push({ tag, value: value.slice(start, end), raw: value.slice(index, end) });
    index = end;
  }

  return fields;
};

/** Bangun string TLV dari { tag, value } (panjang dihitung otomatis). */
const buildTlv = (fields) =>
  fields
    .map(({ tag, value }) => {
      const content = String(value ?? '');
      return `${String(tag).padStart(2, '0')}${String(content.length).padStart(2, '0')}${content}`;
    })
    .join('');

const getTag = (fields, tag) => fields.find((f) => f.tag === tag)?.value ?? null;

/** Hitung ulang CRC dari body TLV (tanpa tag 63) lalu kembalikan payload final. */
const appendCrc = (bodyWithoutCrc) => {
  const body = `${bodyWithoutCrc}6304`;
  return `${body}${crc16(body)}`;
};

/** Cek keutuhan CRC. */
const validateCrc = (payload) => {
  const value = String(payload || '');
  const marker = value.slice(-8, -4);
  const given = value.slice(-4);
  const expected = crc16(value.slice(0, -4));
  return { valid: marker === '6304' && expected === given, expected, given };
};

/** Ringkasan isi QRIS. */
const inspectQris = (payload) => {
  let fields;
  try {
    fields = parseTlv(payload);
  } catch (error) {
    return { valid: false, error: error.message };
  }

  const accountTags = fields.filter((f) => TAG.MERCHANT_ACCOUNT.includes(f.tag));
  return {
    valid: validateCrc(payload).valid,
    format: getTag(fields, TAG.PAYLOAD_FORMAT),
    method: getTag(fields, TAG.POINT_OF_INITIATION),
    isStatic: getTag(fields, TAG.POINT_OF_INITIATION) === '11',
    isDynamic: getTag(fields, TAG.POINT_OF_INITIATION) === '12',
    amount: getTag(fields, TAG.AMOUNT),
    currency: getTag(fields, TAG.CURRENCY),
    country: getTag(fields, TAG.COUNTRY),
    merchantName: getTag(fields, TAG.MERCHANT_NAME),
    merchantCity: getTag(fields, TAG.MERCHANT_CITY),
    postalCode: getTag(fields, TAG.POSTAL_CODE),
    merchantAccounts: accountTags.map((f) => f.value),
    fields,
  };
};

const isStaticQris = (payload) => inspectQris(payload).isStatic === true;

/* ── Deteksi provider dari isi tag merchant account / domain acquirer ── */
const PROVIDER_SIGNATURES = [
  { key: 'shopee', patterns: [/SHOPEE/i, /SHOPEEPAY/i] },
  { key: 'gopay', patterns: [/GO-?JEK/i, /GOPAY/i, /GOJEK/i] },
  { key: 'dana', patterns: [/DANA/i] },
  { key: 'bca', patterns: [/BCA/i, /BANK CENTRAL ASIA/i] },
  { key: 'livin', patterns: [/LIVIN/i, /MANDIRI/i] },
  { key: 'bri', patterns: [/BRI\b/i, /BANK RAKYAT/i] },
  { key: 'octo', patterns: [/OCTO/i, /CIMB/i] },
  { key: 'bni', patterns: [/BNI\b/i, /BANK NEGARA INDONESIA/i] },
  { key: 'byond', patterns: [/BYOND/i, /\bBSI\b/i] },
  { key: 'jakone', patterns: [/JAKONE/i, /JAKARTA/i] },
  { key: 'bukalapak', patterns: [/BUKALAPAK/i] },
  { key: 'orderkuota', patterns: [/ORDERKUOTA/i, /ORDER KUOTA/i] },
];

const detectProvider = (payload) => {
  const inspected = inspectQris(payload);
  if (!inspected.valid && inspected.error) return null;
  const haystack = [
    ...(inspected.merchantAccounts || []),
    inspected.merchantName || '',
    String(payload),
  ].join(' ');

  const found = PROVIDER_SIGNATURES.find((sig) => sig.patterns.some((re) => re.test(haystack)));
  return found ? found.key : null;
};

/* ── Static → Dynamic ── */
const normalizeAmount = (amount) => {
  const value = Math.round(Number(amount) || 0);
  if (!Number.isInteger(value) || value <= 0) {
    throw new QrisError('invalid_base_amount', 'Nominal harus bilangan bulat rupiah > 0.');
  }
  return value;
};

const buildFee = (fee) => {
  if (!fee || !fee.value) return [];
  if (fee.type === 'percentage') return [{ tag: TAG.TIP_INDICATOR, value: '03' }, { tag: TAG.FEE_PERCENT, value: String(fee.value) }];
  if (fee.type === 'fixed') return [{ tag: TAG.TIP_INDICATOR, value: '03' }, { tag: TAG.FEE_FIXED, value: String(Math.round(fee.value)) }];
  return [];
};

/**
 * Ubah QRIS statis jadi dinamis dengan nominal tetap.
 * @param {string} staticPayload
 * @param {number} amount nominal IDR bulat
 * @param {{ fee?: { type: 'percentage'|'fixed', value: number } }} [options]
 */
const staticToDynamic = (staticPayload, amount, options = {}) => {
  const fields = parseTlv(staticPayload);
  const inspected = inspectQris(staticPayload);

  if (!inspected.isStatic) {
    throw new QrisError('static_qris_required', 'QRIS harus berstatus statis (tag 01 = 11).');
  }
  if (!inspected.valid) {
    throw new QrisError('invalid_qris', 'CRC QRIS statis tidak valid.');
  }

  const value = normalizeAmount(amount);
  const drop = new Set([TAG.AMOUNT, TAG.TIP_INDICATOR, TAG.FEE_PERCENT, TAG.FEE_FIXED, TAG.CRC]);

  const rebuilt = [];
  for (const field of fields) {
    if (drop.has(field.tag)) continue;

    if (field.tag === TAG.POINT_OF_INITIATION) {
      rebuilt.push({ tag: field.tag, value: '12' });
      continue;
    }

    // sisipkan nominal + fee tepat sebelum tag negara (58)
    if (field.tag === TAG.COUNTRY) {
      rebuilt.push({ tag: TAG.AMOUNT, value: String(value) });
      rebuilt.push(...buildFee(options.fee));
    }

    rebuilt.push({ tag: field.tag, value: field.value });
  }

  return appendCrc(buildTlv(rebuilt));
};

module.exports = {
  TAG,
  QrisError,
  crc16,
  parseTlv,
  buildTlv,
  appendCrc,
  validateCrc,
  inspectQris,
  isStaticQris,
  detectProvider,
  staticToDynamic,
  normalizeAmount,
};
