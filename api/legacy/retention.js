'use strict';

/**
 * Retensi 30 hari (buyer) + agregat profit bulanan (admin).
 *
 * Prinsip: angka admin (meta/stats/months) TIDAK pernah dihapus —
 * data buyer (payments/withdraws) yang di-prune. Jadi sebelum hapus,
 * record yang belum tercatat pasti di-record dulu (flag stats_recorded).
 *
 * Dua mode (endpoint /cron/retention?secret=):
 *  - action=migrate : satu kali — record ulang SEMUA record lama yang
 *    belum ber-flag (chunked, cursor meta/retention_stats_cursor) +
 *    agregasi riwayat withdraws lama (flag meta/withdraws_stats_done).
 *  - action=run     : repetitif — hapus record terminal >30 hari
 *    (cursor meta/retention_prune_cursor) + prune list withdraws >30 hari
 *    (cursor meta/retention_withdraws_cursor).
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

/* ── action=migrate ─────────────────────────────────────────────── */

async function migrateStats({ limit = 500 } = {}) {
  const getRef = store.getAdminRefForBackfill();
  if (!getRef) throw new Error('migrate butuh mode firebase');

  const report = { scanned: 0, recorded: 0, cursor: null, hasMore: true, finished: false };

  const cursor = (await store.getPath('meta/retention_stats_cursor')) || '';
  let q = getRef('payments').orderByKey().limitToFirst(Number(limit));
  if (cursor) q = q.startAt(cursor);
  const snap = await q.once('value');
  const chunk = snap.val() || {};
  const keys = Object.keys(chunk);

  let i = 0;
  const workers = Array.from({ length: Math.min(10, keys.length) }, async () => {
    while (i < keys.length) {
      const key = keys[i++];
      if (key.startsWith('__')) continue; // __pending_by_apikey__, __amount_reservations__
      const p = chunk[key];
      if (!p || !p.idtrx || !isTerminal(p) || p.stats_recorded) continue;
      try {
        await stats.recordTerminal(p);
        await store.patchPayment(key, { stats_recorded: true });
        report.recorded++;
      } catch (_) { /* lanjut; invocation berikutnya ulang (idempotent) */ }
      report.scanned++;
    }
  });
  await Promise.all(workers);

  report.cursor = keys.length ? keys[keys.length - 1] : cursor;
  report.hasMore = keys.length >= Number(limit);
  report.finished = !report.hasMore;

  if (keys.length) await store.setPath('meta/retention_stats_cursor', report.cursor);

  // agregasi riwayat withdraws lama (sekali jalan, flag)
  const wdone = await store.getPath('meta/withdraws_stats_done');
  if (!wdone) {
    const allW = await store.getPath('withdraws');
    const wroot = allW && typeof allW === 'object' ? allW : {};
    for (const apikey of Object.keys(wroot)) {
      const items = Array.isArray(wroot[apikey]) ? wroot[apikey] : [];
      for (const it of items) {
        if (!it || !it.created_at) continue;
        const m = stats.monthKeyOf(it.created_at);
        if (!m) continue;
        const amount = Number(it.nominal ?? it.total_potong ?? 0) || 0;
        await store.updateMonthStats(m, (cur) => {
          const s = (cur && typeof cur === 'object' ? { ...cur } : {}) || {};
          s.withdrawals = {
            count: (s.withdrawals?.count || 0) + 1,
            amount: (s.withdrawals?.amount || 0) + amount,
          };
          return s;
        });
      }
    }
    await store.setPath('meta/withdraws_stats_done', new Date().toISOString());
    report.withdrawsAggregated = true;
  } else {
    report.withdrawsAggregated = false; // sudah di-migration sebelumnya
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
  const report = { scanned: 0, deleted: 0, cursor: null, hasMore: true, finished: false };

  const cursor = (await store.getPath('meta/retention_prune_cursor')) || '';
  let q = getRef('payments').orderByKey().limitToFirst(Number(limit));
  if (cursor) q = q.startAt(cursor);
  const snap = await q.once('value');
  const chunk = snap.val() || {};
  const keys = Object.keys(chunk);

  for (const key of keys) {
    if (key.startsWith('__')) continue;
    const p = chunk[key];
    if (!p || !p.idtrx) continue;
    report.scanned++;
    // record yang masih terminal-tapi-belum-dicatat: record dulu baru hapus
    if (isTerminal(p) && !p.stats_recorded) {
      try {
        await stats.recordTerminal(p);
        await store.patchPayment(key, { stats_recorded: true });
      } catch (_) { /* gapapa, data stats lebih penting dari kecepatan prune */ }
    }
    if (isTerminal(p) && isOld(p, cutoffMs)) {
      await store.removePayment(key);
      // bersihin dari index pending per-apikey (record lama biasanya udah dibuang,
      // tapi amankan) — hanya kalau record itu masih pending index-nya
      if (p.apikey) {
        try {
          const ids = ((await store.getPendingByApikey(p.apikey)) || []).filter((x) => x !== key);
          if (ids.length || true) await store.setPendingByApikey(p.apikey, ids);
        } catch (_) { /* best-effort */ }
      }
      report.deleted++;
    }
  }

  // cursor: kunci terakhir yang BUKAN meta (chunk selalu memuat semua jenis
  // kunci; iterasi lanjut dari sini, idempotent)
  const lastKey = keys.length ? keys[keys.length - 1] : cursor;
  report.hasMore = keys.length >= Number(limit);
  report.finished = !report.hasMore;
  if (report.finished) {
    // loop ulang dari awal? TIDAK — kalau sudah selesai satu putaran,
    // balik ke 0 supaya run berikutnya nge-prune record baru yang >30 hari.
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

/* catat satu item withdrawal baru ke agregat bulan (dipanggil writer
   withdrawal ke depannya — sekarang belum ada, tapi layer-nya ready) */
async function recordWithdraw(apikey, item) {
  const m = stats.monthKeyOf(item?.created_at || new Date().toISOString());
  if (!m) return;
  const amount = Number(item?.nominal ?? item?.total_potong ?? 0) || 0;
  await store.updateMonthStats(m, (cur) => {
    const s = (cur && typeof cur === 'object' ? { ...cur } : {}) || {};
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
