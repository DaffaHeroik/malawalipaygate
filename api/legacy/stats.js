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
 * Idempotent-per-payment: flag `stats_recorded` di record payment;
 * tulis agregat + flag ATOMIK (satu ref().multi(), all-or-nothing).
 */

const store = require('./store');

function monthKeyOf(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  // pakai UTC biar konsisten, label: {YYYY-MM}
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* Mutasi murni agregat bulan (tidak I/O) — dipakai recordTerminal
   dan batch migration. p = record payment (status terminal). */
function incrementStats(s, p) {
  const status = String(p.status || 'unknown');
  const provider = String(p.pay_provider || p.payment_method || 'unknown');
  s.transactions = (s.transactions || 0) + 1;
  s.status = s.status || {};
  s.status[status] = (s.status[status] || 0) + 1;
  if (status === 'paid') {
    const amt = Number(p.amount) || 0;
    const profit = (Number(p.unique_fee) || 0) + (Number(p.actual_fee_admin) || 0);
    s.paid_amount = (s.paid_amount || 0) + amt;
    s.profit = (s.profit || 0) + profit;
    s.by_provider = s.by_provider || {};
    const bp = (s.by_provider[provider] = s.by_provider[provider] || { count: 0, amount: 0, profit: 0 });
    bp.count += 1; bp.amount += amt; bp.profit += profit;
    if (p.apikey) {
      s.by_user = s.by_user || {};
      const bu = (s.by_user[p.apikey] = s.by_user[p.apikey] || { count: 0, amount: 0, profit: 0 });
      bu.count += 1; bu.amount += amt; bu.profit += profit;
    }
  }
  return s;
}

/* Catat satu payment terminal. atomically=true → flag stats_recorded
   ikut ter-apply dalam satu ref().multi() bareng agregat (all-or-nothing:
   crash = dua-duanya belum ter-apply → invocation berikutnya aman
   re-record, tak double-count). */
async function recordTerminal(payment, { atomically = false } = {}) {
  if (!payment || !payment.created_at) return;
  const m = monthKeyOf(payment.created_at);
  if (!m) return;

  const extra = atomically && payment.idtrx
    ? { [`payments/${encodeURIComponent(String(payment.idtrx).trim())}/stats_recorded`]: true }
    : null;

  await store.updateMonthStats(m, (cur) => incrementStats(cur && typeof cur === 'object' ? { ...cur } : {}, payment), extra);
}

/* Batch: N record sekaligus, 1 read + multi-write ter-slice (≤100 ops
   per multi — aman batas operasi RTDB). State bulan di-akumulasikan
   lokal antar-slice (carry forward) sehingga hasil sama dgn 1 write.
   `flagsPerMonth` (opsional) = { 'YYYY-MM': { 'payments/X/stats_recorded': true } }
   months: { 'YYYY-MM': [p1, p2, ...] } */
async function recordBatch(months, flagsPerMonth = null) {
  const SLICE = 100;
  for (const [m, pays] of Object.entries(months || {})) {
    if (!pays || !pays.length) continue;
    const path = `meta/stats/months/${m}`;
    const base = (await store.getPath(path)) || {};
    const s = base && typeof base === 'object' ? { ...base } : {};
    const monthFlags = (flagsPerMonth && flagsPerMonth[m]) || {};
    let offset = 0;
    while (offset < pays.length) {
      const part = pays.slice(offset, offset + SLICE);
      const cum = { ...s };
      for (const p of part) incrementStats(cum, p);
      // flag hanya di-slice PERTAMA (biar semua masuk 1 set ops, tapi
      // tetap per-slice di sini — atomik per slice)
      const ops = { [path]: cum };
      if (offset === 0) Object.assign(ops, monthFlags);
      await store.multiSet(ops);
      s = cum; // carry forward
      offset += SLICE;
    }
  }
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

module.exports = { monthKeyOf, incrementStats, recordTerminal, recordBatch, getMonthStats, getMonthStatsOne };
