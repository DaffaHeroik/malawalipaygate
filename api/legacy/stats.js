'use strict';

/**
 * Agregat bulanan untuk admin (profit gateway), tersimpan di
 * `meta/stats/months/{YYYY-MM}` di RTDB.
 *
 * Ini LAYER DOKUMENTASI — data buyer (payments/withdraws) boleh di-prune
 * 30 hari, tapi angka di sini TIDAK dihapus:
 *
 *   {
 *     transactions: N,
 *     status: { paid, expired, cancelled, deleted },
 *     paid_amount,   // omzet bulan
 *     profit,       // unique_fee + actual_fee_admin dari order paid
 *     by_provider: { gopay: {count, amount, profit}, ... },
 *     by_user:     { APIKEY: {count, amount, profit}, ... }
 *   }
 *
 * Idempotent-per-payment: caller (detect/retention) set flag
 * `stats_recorded: true` di record payment saat pertama tercatat;
 * prune hanya mencatat ulang untuk record lama yang belum ber-flag.
 */

const store = require('./store');

function monthKeyOf(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  // pakai UTC biar konsisten, label: {YYYY-MM}
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* Catat satu payment yang baru jadi terminal state (paid/expired/cancelled/deleted).
   Dipakai di path live (detect, delete) — record WAJIB sudah di-patch
   status + stats_recorded oleh caller. */
async function recordTerminal(payment) {
  if (!payment || !payment.created_at) return;
  const m = monthKeyOf(payment.created_at);
  if (!m) return;

  const status = String(payment.status || 'unknown');
  const provider = String(payment.pay_provider || payment.payment_method || 'unknown');
  const amt = status === 'paid' ? Number(payment.amount) || 0 : 0;
  const profit = status === 'paid' ? (Number(payment.unique_fee) || 0) + (Number(payment.actual_fee_admin) || 0) : 0;
  const apikey = payment.apikey || null;

  await store.updateMonthStats(m, (cur) => {
    const s = cur && typeof cur === 'object' ? { ...cur } : {};
    s.transactions = (s.transactions || 0) + 1;
    s.status = s.status || {};
    s.status[status] = (s.status[status] || 0) + 1;
    if (status === 'paid') {
      s.paid_amount = (s.paid_amount || 0) + amt;
      s.profit = (s.profit || 0) + profit;
      s.by_provider = s.by_provider || {};
      const bp = (s.by_provider[provider] = s.by_provider[provider] || { count: 0, amount: 0, profit: 0 });
      bp.count += 1; bp.amount += amt; bp.profit += profit;
      if (apikey) {
        s.by_user = s.by_user || {};
        const bu = (s.by_user[apikey] = s.by_user[apikey] || { count: 0, amount: 0, profit: 0 });
        bu.count += 1; bu.amount += amt; bu.profit += profit;
      }
    }
    return s;
  });
}

/* Baca semua agregat bulanan (meta/stats/months). */
async function getMonthStats() {
  return (await store.getPath('meta/stats/months')) || {};
}

/* Satu bulan saja. */
async function getMonthStatsOne(monthKey) {
  const all = await getMonthStats();
  return all[monthKey] || null;
}

module.exports = { monthKeyOf, recordTerminal, getMonthStats, getMonthStatsOne };
