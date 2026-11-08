'use strict';

/**
 * Retensi 30 hari (buyer) + agregat profit bulanan (admin).
 *
 * Prinsip: angka admin (meta/stats/months) TIDAK pernah dihapus —
 * data buyer (payments/withdraws) yang di-prune. Sebelum hapus, record
 * yang belum tercatat WAJIB di-record dulu. Tulis agregat + flag
 * ATOMIK (satu ref().multi, all-or-nothing) → crash = aman re-record.
 *
 * Endpoint /cron/retention?secret=
 *   action=migrate (chunked, cursor meta/retention_stats_cursor):
 *     - record semua record lama terminal yang belum ber-flag
 *       (batch per bulan: 1 read + 1 multi-write per bulan — cepat)
 *     - &force=1 : mulai ulang dari awal + ulang record ber-flag
 *       (rebuild agregat dari nol — set dulu meta/stats/months=null)
 *     - &wipe=1  : set meta/stats/months=null diawal (reset agregat)
 *     - agregasi riwayat withdraws (flag meta/withdraws_stats_done)
 *   action=run (repetitif, cursor terpisah): hapus record terminal
 *     >30 hari (record dulu, atomik) + prune list withdraws >30 hari.
 */

const store = require('./store');
const stats = require('./stats');

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const TERMINAL = new Set(['paid', 'expired', 'cancelled', 'deleted']);

function isTerminal(p) {
  return p && TERMINAL.has(String(p.status || '').toLowerCase());
}

function isOld(p, cutoffMs) {
  const t = new Date(p.created_at || 0).getTime();
  return Number.isFinite(t) && t < cutoffMs;
}

function groupByMonth(pays) {
  const byMonth = {};
  for (const p of pays) {
    if (!p.created_at) continue;
    const m = stats.monthKeyOf(p.created_at);
    if (!m) continue;
    (byMonth[m] = byMonth[m] || []).push(p);
  }
  return byMonth;
}

/* ── action=migrate ─────────────────────────────────────────────── */

async function migrateStats({ limit = 500, force = false, wipe = false } = {}) {
  const getRef = store.getAdminRefForBackfill();
  if (!getRef) throw new Error('migrate butuh mode firebase');

  const report = { scanned: 0, recorded: 0, cursor: null, hasMore: true, finished: false, force };

  if (wipe) {
    await store.setPath('meta/stats/months', null);
    if (force) await store.setPath('meta/withdraws_stats_done', null);
    report.wiped = true;
  }

  // force hanya bikin record ber-flag di-record ulang — cursor tetap
  // lanjut (bukan reset), biar chunk-nya bergerak.
  const cursor = (await store.getPath('meta/retention_stats_cursor')) || '';
  let q = getRef('payments').orderByKey().limitToFirst(Number(limit));
  if (cursor) q = q.startAfter(cursor); // strict: record sebelumnya SKIP
  const snap = await q.once('value');
  const chunk = snap.val() || {};
  const keys = Object.keys(chunk);

  // kumpulkan record target per bulan → 1 write batch per bulan
  const byMonth = {};
  let targetCount = 0;
  for (const key of keys) {
    if (key.startsWith('__')) continue; // index, bukan record
    const p = chunk[key];
    if (!p || !p.idtrx || !isTerminal(p)) continue;
    if (!force && p.stats_recorded) continue; // sudah tercatat (non-force)
    report.scanned++;
    const m = stats.monthKeyOf(p.created_at);
    if (!m) continue;
    (byMonth[m] = byMonth[m] || []).push(p);
    targetCount++;
  }

  // flags per-bulan: record + flag ATOMIK dalam multi-write bulan itu
  const flagsPerMonth = {};
  for (const [m, list] of Object.entries(byMonth)) {
    flagsPerMonth[m] = {};
    for (const p of list) flagsPerMonth[m][`payments/${encodeURIComponent(String(p.idtrx).trim())}/stats_recorded`] = true;
  }

  // batch: 1 read + 1 write per bulan, flags atomik
  await stats.recordBatch(byMonth, flagsPerMonth);
  report.recorded = targetCount;
  report.recordedMonths = Object.keys(byMonth).length;

  report.cursor = keys.length ? keys[keys.length - 1] : cursor;
  report.hasMore = keys.length >= Number(limit);
  report.finished = !report.hasMore;

  // cursor lanjut (bukan reset) kecuali force bikin awal baru
  if (keys.length) await store.setPath('meta/retention_stats_cursor', report.cursor);

  // agregasi riwayat withdraws lama (sekali jalan, flag)
  const wdone = await store.getPath('meta/withdraws_stats_done');
  if (!wdone) {
    const allW = await store.getPath('withdraws');
    const wroot = allW && typeof allW === 'object' ? allW : {};
    const wByMonth = {};
    for (const apikey of Object.keys(wroot)) {
      const items = Array.isArray(wroot[apikey]) ? wroot[apikey] : [];
      for (const it of items) {
        if (!it || !it.created_at) continue;
        const m = stats.monthKeyOf(it.created_at);
        if (!m) continue;
        (wByMonth[m] = wByMonth[m] || []).push({ created_at: it.created_at, nominal: it.nominal ?? it.total_potong ?? 0, apikey });
      }
    }
    // pakai path sendiri: agregasi withdraws
    for (const [m, items] of Object.entries(wByMonth)) {
      await store.updateMonthStats(m, (cur) => {
        const s = (cur && typeof cur === 'object' ? { ...cur } : {});
        s.withdrawals = s.withdrawals || { count: 0, amount: 0 };
        for (const it of items) {
          s.withdrawals.count += 1;
          s.withdrawals.amount += Number(it.nominal ?? it.total_potong ?? 0) || 0;
        }
        return s;
      });
    }
    await store.setPath('meta/withdraws_stats_done', new Date().toISOString());
    report.withdrawsAggregated = true;
    report.withdrawsItems = Object.values(wByMonth).reduce((a, b) => a + b.length, 0);
  } else {
    report.withdrawsAggregated = false;
  }

  if (!report.finished) {
    report.nextHint = `cursor=${report.cursor} — jalankan ulang /cron/retention?action=migrate`;
  }
  return report;
}

/* ── action=run (prune repetitif) ──────────────────────────────── */

async function prunePayments({ limit = 500 } = {}) {
  const getRef = store.getAdminRefForBackfill();
  if (!getRef) throw new Error('prune butuh mode firebase');

  const cutoffMs = Date.now() - RETENTION_DAYS * DAY_MS;
  const report = { scanned: 0, deleted: 0, recorded: 0, cursor: null, hasMore: true, finished: false };

  const cursor = (await store.getPath('meta/retention_prune_cursor')) || '';
  let q = getRef('payments').orderByKey().limitToFirst(Number(limit));
  if (cursor) q = q.startAt(cursor);
  const snap = await q.once('value');
  const chunk = snap.val() || {};
  const keys = Object.keys(chunk);

  // record dulu (batch per bulan, atomik) record terminal yang belum di-flag
  const pendingRecord = [];
  for (const key of keys) {
    if (key.startsWith('__')) continue;
    const p = chunk[key];
    if (!p || !p.idtrx) continue;
    report.scanned++;
    if (isTerminal(p) && !p.stats_recorded) pendingRecord.push(p);
  }
  if (pendingRecord.length) {
    const byMonth = groupByMonth(pendingRecord);
    const flags = {};
    for (const p of pendingRecord) flags[`payments/${encodeURIComponent(String(p.idtrx).trim())}/stats_recorded`] = true;
    await stats.recordBatch(byMonth, flags);
    report.recorded = pendingRecord.length;
  }

  // hapus record terminal >30 hari (yang sudah di-record)
  for (const key of keys) {
    if (key.startsWith('__')) continue;
    const p = chunk[key];
    if (!p || !p.idtrx) continue;
    if (isTerminal(p) && isOld(p, cutoffMs)) {
      await store.removePayment(key);
      if (p.apikey) {
        try {
          const ids = ((await store.getPendingByApikey(p.apikey)) || []).filter((x) => x !== key);
          await store.setPendingByApikey(p.apikey, ids);
        } catch (_) { /* best-effort */ }
      }
      report.deleted++;
    }
  }

  const lastKey = keys.length ? keys[keys.length - 1] : cursor;
  report.hasMore = keys.length >= Number(limit);
  report.finished = !report.hasMore;
  if (report.finished) {
    // selesai satu putaran → balik ke 0 untuk putaran berikutnya
    await store.setPath('meta/retention_prune_cursor', '');
    report.cursor = '';
  } else {
    report.cursor = lastKey;
    await store.setPath('meta/retention_prune_cursor', lastKey);
  }
  if (!report.finished) report.nextHint = `cursor=${report.cursor} — jalankan ulang /cron/retention?action=run`;
  return report;
}

async function pruneWithdraws({ limit = 200 } = {}) {
  const getRef = store.getAdminRefForBackfill();
  if (!getRef) throw new Error('prune withdraws butuh mode firebase');

  const cutoffMs = Date.now() - RETENTION_DAYS * DAY_MS;
  const report = { scanned: 0, purgedItems: 0, cursor: null, hasMore: true, finished: false };

  const cursor = (await store.getPath('meta/retention_withdraws_cursor')) || '';
  let q = getRef('withdraws').orderByKey().limitToFirst(Number(limit));
  if (cursor) q = q.startAt(cursor);
  const snap = await q.once('value');
  const chunk = snap.val() || {};

  for (const apikey of Object.keys(chunk)) {
    report.scanned++;
    const items = Array.isArray(chunk[apikey]) ? chunk[apikey] : [];
    const kept = items.filter((it) => !it || !isOld(it, cutoffMs));
    const purged = items.length - kept.length;
    if (purged > 0) {
      await store.setPath(`withdraws/${encodeURIComponent(apikey)}`, kept.length ? kept : null);
      report.purgedItems += purged;
    }
  }

  const keys = Object.keys(chunk);
  const lastKey = keys.length ? keys[keys.length - 1] : cursor;
  report.hasMore = keys.length >= Number(limit);
  report.finished = !report.hasMore;
  if (report.finished) {
    report.cursor = '';
    await store.setPath('meta/retention_withdraws_cursor', '');
  } else {
    report.cursor = lastKey;
    await store.setPath('meta/retention_withdraws_cursor', lastKey);
  }
  return report;
}

/* catat satu item withdrawal baru ke agregat bulan (layer siap,
   dipanggil writer withdrawal ke depannya) */
async function recordWithdraw(apikey, item) {
  const m = stats.monthKeyOf(item?.created_at || new Date().toISOString());
  if (!m) return;
  const amount = Number(item?.nominal ?? item?.total_potong ?? 0) || 0;
  await store.updateMonthStats(m, (cur) => {
    const s = (cur && typeof cur === 'object' ? { ...cur } : {});
    s.withdrawals = {
      count: (s.withdrawals?.count || 0) + 1,
      amount: (s.withdrawals?.amount || 0) + amount,
    };
    return s;
  });
}

module.exports = {
  RETENTION_DAYS,
  migrateStats,
  prunePayments,
  pruneWithdraws,
  recordWithdraw,
  isTerminal,
};
