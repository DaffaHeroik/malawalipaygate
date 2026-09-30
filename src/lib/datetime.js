'use strict';

/**
 * Format tanggal/waktu konsisten id-ID.
 * Contoh yang ditiru dari sistem lama: "17/9/2026, 00.31.25"
 */

const pad2 = (n) => String(n).padStart(2, '0');

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** 17/9/2026, 00.31.25 */
const formatDateTime = (value) => {
  const d = toDate(value);
  if (!d) return '-';
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}, ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`;
};

/** 17/9/2026 */
const formatDate = (value) => {
  const d = toDate(value);
  if (!d) return '-';
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

/** 15 September 2026 */
const MONTHS_LONG = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const formatDateLong = (value) => {
  const d = toDate(value);
  if (!d) return '-';
  return `${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
};

/** 14 Sep */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const formatDayShort = (value) => {
  const d = toDate(value);
  if (!d) return '-';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
};

/** 00:31:25 */
const formatTime = (value) => {
  const d = toDate(value);
  if (!d) return '-';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/** mm:ss untuk countdown */
const formatCountdown = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
};

const addMinutes = (date, minutes) => new Date(new Date(date).getTime() + minutes * 60 * 1000);
const addDays = (date, days) => new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);

const isPast = (value) => {
  const d = toDate(value);
  return d ? d.getTime() < Date.now() : false;
};

/** "3 hari lalu" */
const timeAgo = (value) => {
  const d = toDate(value);
  if (!d) return '-';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'baru saja';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} bulan lalu`;
  return `${Math.floor(months / 12)} tahun lalu`;
};

/** ISO untuk atribut <time datetime=""> */
const toIso = (value) => {
  const d = toDate(value);
  return d ? d.toISOString() : '';
};

module.exports = {
  formatDateTime,
  formatDate,
  formatDateLong,
  formatDayShort,
  formatTime,
  formatCountdown,
  addMinutes,
  addDays,
  isPast,
  timeAgo,
  toIso,
  toDate,
};
