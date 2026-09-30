'use strict';

const config = require('./index');

/* ══════════════════════════════════════════════════════════════════════════
   Ikon SVG inline. Semua pakai stroke currentColor, jadi otomatis ikut tema.
   ══════════════════════════════════════════════════════════════════════════ */
const ICONS = {
  dashboard: {
    viewBox: '0 0 24 24',
    body: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  },
  projects: {
    viewBox: '0 0 24 24',
    body: '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M8 4.5V3M16 4.5V3M3.5 9.5h17M8 13.5h3M13 13.5h3M8 17h3"/>',
  },
  qris: {
    viewBox: '0 0 24 24',
    body: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM18.5 18.5h2.5v2.5h-2.5z"/>',
  },
  qrisWallet: {
    viewBox: '0 0 24 24',
    body: '<rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 10.5h19M7 15h4"/><circle cx="17" cy="15" r="1.2"/>',
  },
  broadcast: {
    viewBox: '0 0 24 24',
    body: '<path d="M4.5 12a7.5 7.5 0 0 1 15 0"/><path d="M7.5 12a4.5 4.5 0 0 1 9 0"/><path d="M10.5 12a1.5 1.5 0 0 1 3 0"/><circle cx="12" cy="16.5" r="1.5"/>',
  },
  shopee: {
    viewBox: '0 0 24 24',
    body: '<path d="M4.5 8.5h15l-1.5 11a1.5 1.5 0 0 1-1.5 1.3H7.5A1.5 1.5 0 0 1 6 19.5z"/><path d="M8.5 8.5V6.8a3.5 3.5 0 0 1 7 0v1.7"/>',
  },
  gopay: {
    viewBox: '0 0 24 24',
    body: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><path d="M16.5 14.5h2"/>',
  },
  subscription: {
    viewBox: '0 0 24 24',
    body: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 14.5h4"/>',
  },
  tutorial: {
    viewBox: '0 0 24 24',
    body: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M8 3v18M11.5 8h4M11.5 12h4"/>',
  },
  shield: {
    viewBox: '0 0 24 24',
    body: '<path d="M12 3l7.5 3v5.5c0 4.4-3 8.2-7.5 9.5-4.5-1.3-7.5-5.1-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  },
  code: {
    viewBox: '0 0 24 24',
    body: '<path d="M9 7.5 4.5 12 9 16.5M15 7.5 19.5 12 15 16.5"/>',
  },
  gear: {
    viewBox: '0 0 24 24',
    body: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.5l2 1.2M17.5 15.3l2 1.2M4.5 16.5l2-1.2M17.5 8.7l2-1.2"/>',
  },
  logout: {
    viewBox: '0 0 24 24',
    body: '<path d="M14 4.5H6.5A2 2 0 0 0 4.5 6.5v11a2 2 0 0 0 2 2H14"/><path d="M12 12h8M17 8.5 20.5 12 17 15.5"/>',
  },
  sun: {
    viewBox: '0 0 24 24',
    body: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  },
  moon: {
    viewBox: '0 0 24 24',
    body: '<path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8 8 0 1 0 20 15.2Z"/>',
  },
  menu: {
    viewBox: '0 0 24 24',
    body: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  },
  close: {
    viewBox: '0 0 24 24',
    body: '<path d="M6 6l12 12M18 6 6 18"/>',
  },
  chevronDown: {
    viewBox: '0 0 24 24',
    body: '<path d="m6 9.5 6 6 6-6"/>',
  },
  chevronRight: {
    viewBox: '0 0 24 24',
    body: '<path d="m9.5 6 6 6-6 6"/>',
  },
  arrowLeft: {
    viewBox: '0 0 24 24',
    body: '<path d="M19 12H5M10 6.5 4.5 12 10 17.5"/>',
  },
  arrowRight: {
    viewBox: '0 0 24 24',
    body: '<path d="M5 12h14M14 6.5 19.5 12 14 17.5"/>',
  },
  copy: {
    viewBox: '0 0 24 24',
    body: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5.5A1.5 1.5 0 0 1 4 13.5v-9A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5V5"/>',
  },
  check: {
    viewBox: '0 0 24 24',
    body: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  },
  alert: {
    viewBox: '0 0 24 24',
    body: '<path d="M12 3.5 21 19.5H3z"/><path d="M12 9.5v4.5M12 16.8h.01"/>',
  },
  info: {
    viewBox: '0 0 24 24',
    body: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8.2h.01"/>',
  },
  plus: {
    viewBox: '0 0 24 24',
    body: '<path d="M12 5v14M5 12h14"/>',
  },
  pencil: {
    viewBox: '0 0 24 24',
    body: '<path d="M4 20h4l10.5-10.5a1.8 1.8 0 0 0 0-2.5l-1.5-1.5a1.8 1.8 0 0 0-2.5 0L4 16z"/><path d="m14 6.5 3.5 3.5"/>',
  },
  trash: {
    viewBox: '0 0 24 24',
    body: '<path d="M4.5 7h15M9 7V5h6v2M6.5 7l1 12.5h9L17.5 7"/>',
  },
  download: {
    viewBox: '0 0 24 24',
    body: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  },
  external: {
    viewBox: '0 0 24 24',
    body: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14.5v4.5H5V6h4.5"/>',
  },
  key: {
    viewBox: '0 0 24 24',
    body: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20M17 12v3M14.5 12v2.2"/>',
  },
  webhook: {
    viewBox: '0 0 24 24',
    body: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><circle cx="12" cy="6" r="2.5"/><path d="M10.5 8.2 7.8 15M13.5 8.2 16.2 15M9 17.5h6"/>',
  },
  lock: {
    viewBox: '0 0 24 24',
    body: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  },
  user: {
    viewBox: '0 0 24 24',
    body: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20c1-3.6 3.9-5.5 7.2-5.5s6.2 1.9 7.2 5.5"/>',
  },
  mail: {
    viewBox: '0 0 24 24',
    body: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  },
  phone: {
    viewBox: '0 0 24 24',
    body: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 5h3M10.5 18.5h3"/>',
  },
  refresh: {
    viewBox: '0 0 24 24',
    body: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5V10h-5.5"/>',
  },
  eye: {
    viewBox: '0 0 24 24',
    body: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/>',
  },
  eyeOff: {
    viewBox: '0 0 24 24',
    body: '<path d="M4 4l16 16"/><path d="M9.5 9.6A2.8 2.8 0 0 0 12 14.8c.7 0 1.3-.2 1.9-.6"/><path d="M6.3 6.5C3.9 8.1 2.5 12 2.5 12s3.5 6 9.5 6c1.4 0 2.7-.3 3.8-.8"/><path d="M18.4 15.2c1.9-1.6 3.1-3.2 3.1-3.2s-3.5-6-9.5-6c-.7 0-1.4.1-2 .3"/>',
  },
  clock: {
    viewBox: '0 0 24 24',
    body: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  },
  chart: {
    viewBox: '0 0 24 24',
    body: '<path d="M4 19.5h16"/><path d="M7 19.5v-6M12 19.5V6M17 19.5v-9"/>',
  },
  list: {
    viewBox: '0 0 24 24',
    body: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>',
  },
  filter: {
    viewBox: '0 0 24 24',
    body: '<path d="M3.5 5.5h17l-6.5 8v5.5l-4 1.5v-7z"/>',
  },
  search: {
    viewBox: '0 0 24 24',
    body: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4.5 4.5"/>',
  },
  telegram: {
    viewBox: '0 0 24 24',
    body: '<path d="M21 4.5 3.5 11.2l4.6 1.6 1.6 5 2.4-3.2 4.4 3.3z"/><path d="m8.1 12.8 9-6.1-4.9 7.4"/>',
  },
  sparkle: {
    viewBox: '0 0 24 24',
    body: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>',
  },
  bulb: {
    viewBox: '0 0 24 24',
    body: '<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3.5a5.5 5.5 0 0 0-3 10.1V17h6v-3.4a5.5 5.5 0 0 0-3-10.1Z"/>',
  },
  bolt: {
    viewBox: '0 0 24 24',
    body: '<path d="M13 2.5 5.5 13.5H11l-1 8 7.5-11H12z"/>',
  },
  warningCircle: {
    viewBox: '0 0 24 24',
    body: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 15.6h.01"/>',
  },
  checkCircle: {
    viewBox: '0 0 24 24',
    body: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  },
  dot: {
    viewBox: '0 0 24 24',
    body: '<circle cx="12" cy="12" r="4"/>',
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   Navigasi sidebar
   ══════════════════════════════════════════════════════════════════════════ */
const NAV = [
  {
    heading: 'Utama',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
      { label: 'Projects', href: '/projects', icon: 'projects' },
    ],
  },
  {
    heading: 'Pembayaran',
    items: [
      { label: 'QRIS', href: '/qris', icon: 'qris' },
      { label: 'QRIS Malawali', href: '/qris-paykita', icon: 'qrisWallet' },
      { label: 'Malawali Listener', href: '/listener', icon: 'broadcast' },
      { label: 'Shopee Partner', href: '/shopee', icon: 'shopee' },
      { label: 'GoPay Merchant', href: '/gopay', icon: 'gopay' },
      { label: 'Langganan', href: '/subscription', icon: 'subscription' },
    ],
  },
  {
    heading: 'Bantuan',
    items: [
      { label: 'Tutorial', href: '/tutorial', icon: 'tutorial' },
      { label: 'Kebijakan & Privasi', href: '/privasi', icon: 'shield' },
      { label: 'Documentation', href: '/documentation', icon: 'code' },
    ],
  },
  {
    heading: 'Akun',
    items: [{ label: 'Pengaturan', href: '/settings', icon: 'gear' }],
  },
];

/* ══════════════════════════════════════════════════════════════════════════
   Provider QRIS
   ══════════════════════════════════════════════════════════════════════════ */
const PROVIDERS = [
  { key: 'auto', label: 'Otomatis dari QRIS (disarankan)', group: 'auto' },
  { key: 'shopee', label: 'Shopee Partner', group: 'api' },
  { key: 'gopay', label: 'GoPay Merchant', group: 'api' },
  { key: 'dana', label: 'DANA Bisnis', group: 'listener' },
  { key: 'orderkuota', label: 'Order Kuota', group: 'listener' },
  { key: 'bca', label: 'BCA Merchant', group: 'listener' },
  { key: 'livin', label: 'Livin Merchant by Mandiri', group: 'listener' },
  { key: 'bri', label: 'BRI Merchant', group: 'listener' },
  { key: 'octo', label: 'OCTO Merchant', group: 'listener' },
  { key: 'bni', label: 'BNI Merchant', group: 'listener' },
  { key: 'byond', label: 'BYOND Merchant by BSI', group: 'listener' },
  { key: 'jakone', label: 'JakOne Merchant', group: 'listener' },
  { key: 'bukalapak', label: 'Bukalapak', group: 'listener' },
];

const PROVIDER_LABEL = Object.fromEntries(PROVIDERS.map((p) => [p.key, p.label]));

/** Provider yang didukung adapter API (koneksi akun), sisanya lewat Listener. */
const PROVIDER_GROUPS = {
  api: ['shopee', 'gopay'],
  listener: PROVIDERS.filter((p) => p.group === 'listener').map((p) => p.key),
};

/* ══════════════════════════════════════════════════════════════════════════
   Status & mode
   ══════════════════════════════════════════════════════════════════════════ */
const ORDER_STATUS = {
  pending: { key: 'pending', label: 'Pending', tone: 'warn' },
  paid: { key: 'paid', label: 'Paid', tone: 'success' },
  expired: { key: 'expired', label: 'Expired', tone: 'muted' },
  cancelled: { key: 'cancelled', label: 'Cancelled', tone: 'danger' },
};

const ORDER_STATUS_LIST = Object.keys(ORDER_STATUS);

/** Mode nominal per provider. */
const AMOUNT_MODES = [
  { key: 'fee', label: 'Gunakan Fee' },
  { key: 'unique', label: 'Gunakan Kode Unik random' },
  { key: 'hybrid', label: 'Mode Hybrid' },
];

const ORDER_MODES = {
  live: { key: 'live', label: 'LIVE' },
};

const QRIS_STATUS = {
  active: { key: 'active', label: 'AKTIF', tone: 'success' },
  standby: { key: 'standby', label: 'STANDBY', tone: 'muted' },
};

const CONNECTION_STATUS = {
  connected: { key: 'connected', label: 'Terhubung', tone: 'success' },
  error: { key: 'error', label: 'Error', tone: 'danger' },
  disconnected: { key: 'disconnected', label: 'Belum Terhubung', tone: 'muted' },
};

const DETECTOR_STATUS = {
  ready: { key: 'ready', label: 'Siap', tone: 'success' },
  not_ready: { key: 'not_ready', label: 'Belum siap', tone: 'warn' },
};

/* ══════════════════════════════════════════════════════════════════════════
   Paket langganan
   ══════════════════════════════════════════════════════════════════════════ */
const PLAN_FEATURES = [
  'API Key per Project',
  'REST API Malawali',
  'Integrasi bot, web & aplikasi',
  'Dokumentasi API',
  'Dashboard monitoring',
];

const PLAN_DESCRIPTIONS = {
  1: 'Cocok untuk mulai mencoba integrasi API.',
  2: 'Pas untuk penggunaan rutin jangka pendek.',
  3: 'Lebih nyaman untuk operasional berkelanjutan.',
  5: 'Periode lebih panjang dengan biaya bulanan lebih hemat.',
};

const buildPlans = () =>
  [1, 2, 3, 5].map((months) => {
    const price = config.planPrices[months];
    return {
      months,
      price,
      label: `${months} Bulan`,
      perMonth: Math.round(price / months),
      description: PLAN_DESCRIPTIONS[months],
      highlight: months === 5,
      saving: months === 5 ? config.planPrices[1] * 5 - price : 0,
      features: [...PLAN_FEATURES, `Masa aktif ${months} Bulan`, 'Pembayaran satu kali'],
    };
  });

const PLANS = buildPlans();

/* ══════════════════════════════════════════════════════════════════════════
   Error code REST API
   ══════════════════════════════════════════════════════════════════════════ */
const API_ERRORS = {
  invalid_request: { status: 400, message: 'Body atau parameter request tidak valid.' },
  invalid_base_amount: { status: 400, message: 'base_amount harus bilangan bulat rupiah > 0' },
  invalid_ttl: { status: 400, message: 'ttl_seconds di luar rentang 60-86400 detik.' },
  invalid_qris: { status: 400, message: 'String QRIS tidak valid.' },
  static_qris_required: { status: 400, message: 'Setup QRIS harus menggunakan QRIS statis.' },
  qris_provider_required: { status: 400, message: 'Isi provider QRIS terlebih dahulu.' },
  invalid_api_key: { status: 401, message: 'API key tidak valid' },
  subscription_required: { status: 402, message: 'Langganan merchant tidak aktif sehingga REST API dikunci sementara.' },
  live_key_required: { status: 403, message: 'Endpoint hanya dapat memakai pk_live_...' },
  default_project_key_required: { status: 403, message: 'Endpoint pengaturan akun harus memakai API key Project Utama.' },
  order_not_found: { status: 404, message: 'Order tidak ditemukan untuk project ini.' },
  qris_not_configured: { status: 409, message: 'QRIS merchant belum diset untuk transaksi LIVE.' },
  detector_not_ready: { status: 409, message: 'Deteksi pembayaran belum siap untuk sumber aktif.' },
  order_not_pending: { status: 409, message: 'Order sudah tidak berstatus pending.' },
  payment_provider_disabled: { status: 503, message: 'Koneksi pembayaran terkait sedang dinonaktifkan administrator.' },
};

/* ══════════════════════════════════════════════════════════════════════════
   Label bantuan
   ══════════════════════════════════════════════════════════════════════════ */
const CURRENCY = 'IDR';
const TIMEZONE = 'Asia/Jakarta';

module.exports = {
  ICONS,
  NAV,
  PROVIDERS,
  PROVIDER_LABEL,
  PROVIDER_GROUPS,
  ORDER_STATUS,
  ORDER_STATUS_LIST,
  AMOUNT_MODES,
  ORDER_MODES,
  QRIS_STATUS,
  CONNECTION_STATUS,
  DETECTOR_STATUS,
  PLANS,
  PLAN_FEATURES,
  API_ERRORS,
  CURRENCY,
  TIMEZONE,
};
