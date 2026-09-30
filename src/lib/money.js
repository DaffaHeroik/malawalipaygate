'use strict';

/**
 * Semua nominal di sistem ini integer rupiah. Nggak ada float di perhitungan.
 */

/** 10000 -> "Rp 10.000" */
const formatRupiah = (value) => `Rp ${Number(value || 0).toLocaleString('id-ID')}`;

/** 10000 -> "10.000" (tanpa prefix) */
const formatNumber = (value) => Number(value || 0).toLocaleString('id-ID');

/** "Rp 10.000" / "10.000" -> 10000 */
const parseRupiah = (input) => {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : 0;
  const digits = String(input ?? '').replace(/[^\d-]/g, '');
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
};

/** Pembulatan ke rupiah terdekat (banker's tidak dipakai; half-up). */
const roundRupiah = (value) => Math.round(Number(value) || 0);

/** Integer rupiah > 0? */
const isValidAmount = (value) =>
  Number.isInteger(value) && value > 0;

/** Fee dari base amount dan persentase (0-100). */
const calcFeeAmount = (baseAmount, feePercent) =>
  roundRupiah((Number(baseAmount) || 0) * (Number(feePercent) || 0) / 100);

/** Total bayar = base + fee + kode unik. */
const calcPayAmount = ({ baseAmount, feeAmount = 0, uniqueCode = 0 }) =>
  (Number(baseAmount) || 0) + (Number(feeAmount) || 0) + (Number(uniqueCode) || 0);

/** Breakdown lengkap buat ditampilkan di UI. */
const buildBreakdown = ({ baseAmount, feePercent = 0, feeAmount, uniqueCode = 0, mode = 'hybrid' }) => {
  const fee = feeAmount === undefined ? calcFeeAmount(baseAmount, feePercent) : feeAmount;
  const code = Number(uniqueCode) || 0;
  return {
    baseAmount: Number(baseAmount) || 0,
    feePercent: Number(feePercent) || 0,
    feeAmount: fee,
    uniqueCode: code,
    payAmount: calcPayAmount({ baseAmount, feeAmount: fee, uniqueCode: code }),
    mode,
  };
};

module.exports = {
  formatRupiah,
  formatNumber,
  parseRupiah,
  roundRupiah,
  isValidAmount,
  calcFeeAmount,
  calcPayAmount,
  buildBreakdown,
};
