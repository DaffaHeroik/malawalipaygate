'use strict';

const money = require('../lib/money');
const ids = require('../lib/ids');

/**
 * Menentukan fee, kode unik, dan pay_amount sesuai mode nominal provider.
 *
 * Aturan (harus sama dengan preview di public/js/qris-preview.js):
 *   feeAmount   = round(baseAmount * feePercent / 100)
 *   kodeUnik    = (mode unique) ? random(10^(digits-1) .. 10^digits - 1) : 0
 *   payAmount   = baseAmount + feeAmount + kodeUnik
 *
 * Mode hybrid: fee & kode unik 0; hanya ditambah minimum bila nominal sudah
 * dipakai order pending lain (offset 0,1,2,3,...).
 */

const normalizeMode = ({ mode, feeEnabled, uniqueEnabled }) => {
  if (mode === 'fee' || mode === 'unique' || mode === 'hybrid') return mode;
  if (feeEnabled) return 'fee';
  if (uniqueEnabled) return 'unique';
  return 'hybrid';
};

/**
 * @param {object} params
 * @param {'fee'|'unique'|'hybrid'} params.mode
 * @param {number} params.baseAmount
 * @param {number} [params.feePercent]
 * @param {number} [params.uniqueDigits]
 * @param {boolean} [params.feeEnabled]
 * @param {boolean} [params.uniqueEnabled]
 * @param {Iterable<number>} [params.taken] nominal yang sudah dipakai (khusus hybrid)
 */
const resolveAmount = {
  /**
   * Versi sinkron untuk fee & unique (tanpa cek bentrok).
   * Hybrid perlu `findFree` karena butuh melihat order pending lain.
   */
  simple({ mode, baseAmount, feePercent = 0, uniqueDigits = 2, feeEnabled, uniqueEnabled }) {
    const base = Math.round(Number(baseAmount) || 0);
    const effective = normalizeMode({ mode, feeEnabled, uniqueEnabled });

    let feeAmount = 0;
    let uniqueCode = 0;

    if (effective === 'fee') feeAmount = money.calcFeeAmount(base, feePercent);
    else if (effective === 'unique') uniqueCode = ids.uniqueCode(uniqueDigits);

    return {
      mode: effective,
      baseAmount: base,
      feePercent: Number(feePercent) || 0,
      feeAmount,
      uniqueCode,
      payAmount: money.calcPayAmount({ baseAmount: base, feeAmount, uniqueCode }),
    };
  },

  /**
   * Versi async untuk hybrid: cari offset terkecil yang belum dipakai.
   * @param {(candidate:number)=>Promise<boolean>} isTaken true bila sudah dipakai
   */
  async hybrid({ baseAmount, feePercent = 0, maxOffset = 1000 }, isTaken) {
    const base = Math.round(Number(baseAmount) || 0);
    const feeAmount = 0;

    for (let offset = 0; offset < maxOffset; offset += 1) {
      const candidate = base + feeAmount + offset;
      // eslint-disable-next-line no-await-in-loop
      const taken = await isTaken(candidate);
      if (!taken) {
        return {
          mode: 'hybrid',
          baseAmount: base,
          feePercent: Number(feePercent) || 0,
          feeAmount,
          uniqueCode: offset,
          payAmount: candidate,
        };
      }
    }

    return null;
  },
};

/** Ambil mode nominal yang berlaku untuk provider tertentu dari settings. */
const modeForProvider = (settings, provider) => {
  if (provider === 'shopee') {
    return {
      mode: settings.shopeeMode,
      feeEnabled: settings.shopeeFeeEnabled,
      uniqueEnabled: settings.shopeeUniqueEnabled,
    };
  }
  if (provider === 'gopay') {
    return {
      mode: settings.gopayMode,
      feeEnabled: settings.gopayFeeEnabled,
      uniqueEnabled: settings.gopayUniqueEnabled,
    };
  }
  return { mode: 'hybrid', feeEnabled: false, uniqueEnabled: false };
};

module.exports = { resolveAmount, modeForProvider, normalizeMode };
