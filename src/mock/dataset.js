'use strict';

const { addMinutes, addDays } = require('../lib/datetime');
const ids = require('../lib/ids');

/**
 * Dataset dummy untuk Fase UI (DATA_SOURCE=mock).
 * Deterministik: pakai LCG sederhana supaya angka nggak berubah tiap render.
 */

const makeRandom = (seed = 20260927) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const rand = makeRandom();

const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

const NOW = new Date();

/* ── User ─────────────────────────────────────────────────────────────── */
const user = {
  id: 'u_9f2c41ab7d3e',
  name: 'kizu',
  displayName: 'Kizu',
  email: 'kizu@malawalipayment.web.id',
  merchantName: 'Kizushop',
  initials: 'K',
  emailVerified: true,
  verified: true,
  role: 'user',
  twoFactorEnabled: false,
  joinedAt: addDays(NOW, -12),
  isBotTenant: false,
  avatarColor: '#174d9b',
  lastLoginAt: addMinutes(NOW, -35),
};

/* ── Pengaturan merchant (level akun) ─────────────────────────────────── */
const merchantSettings = {
  feePercent: 0.5,
  uniqueDigits: 2,
  shopeeFeeEnabled: false,
  shopeeUniqueEnabled: false,
  shopeeMode: 'hybrid',
  gopayFeeEnabled: false,
  gopayUniqueEnabled: false,
  gopayMode: 'hybrid',
  orderTtl: 600,
  notifyUrl: '',
  redirectUrl: '',
  webhookSecret: 'whsec_8f3ba41c9d2e70a5c1b6',
  webhookSecretRotatedAt: addDays(NOW, -11),
};

/* ── Projects ─────────────────────────────────────────────────────────── */
const projects = [
  {
    id: '66f1a2b3c4d5e6f708192a01',
    name: 'Project Utama',
    isDefault: true,
    apiKeyMasked: 'pk_live_••••••••••••4f2a',
    hasApiKey: true,
    webhookUrl: 'https://kizushop.id/webhook/malawali',
    apiKeyLastUsedAt: addMinutes(NOW, -42),
    apiKeyRotatedAt: addDays(NOW, -9),
    createdAt: addDays(NOW, -12),
    lastActivityAt: addMinutes(NOW, -18),
  },
  {
    id: '66f1a2b3c4d5e6f708192a02',
    name: 'Bot Telegram',
    isDefault: false,
    apiKeyMasked: 'pk_live_••••••••••••9b71',
    hasApiKey: true,
    webhookUrl: 'https://bot.kizushop.id/malawali/callback',
    apiKeyLastUsedAt: addDays(NOW, -1),
    apiKeyRotatedAt: addDays(NOW, -6),
    createdAt: addDays(NOW, -10),
    lastActivityAt: addDays(NOW, -1),
  },
  {
    id: '66f1a2b3c4d5e6f708192a03',
    name: 'Website Reseller',
    isDefault: false,
    apiKeyMasked: null,
    hasApiKey: false,
    webhookUrl: '',
    apiKeyLastUsedAt: null,
    apiKeyRotatedAt: null,
    createdAt: addDays(NOW, -4),
    lastActivityAt: null,
  },
];

/* ── QRIS ─────────────────────────────────────────────────────────────── */
const qrisAccounts = [
  {
    id: 'q_1',
    provider: 'shopee',
    qrisString: '00020101021126610014ID.CO.QRIS.WWW01189360052000000000000215ID12345678901230303UMI51440014ID.CO.QRIS.WWW0215ID12345678901230303UMI5204541153033605802ID5910KIZUSHOP6007BEKASI6105171406304A1B2',
    merchantName: 'KIZUSHOP',
    merchantCity: 'BEKASI',
    qrisType: 'static',
    status: 'active',
    imagePath: null,
    createdAt: addDays(NOW, -11),
  },
];

/* ── Koneksi provider ─────────────────────────────────────────────────── */
const providerConnections = [
  {
    provider: 'shopee',
    status: 'error',
    lastTestAt: addMinutes(NOW, -95),
    lastError: 'login timeout, please login again',
    hasCredential: true,
    tokenPreview: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    connectedAt: addDays(NOW, -10),
  },
  {
    provider: 'gopay',
    status: 'disconnected',
    lastTestAt: null,
    lastError: null,
    hasCredential: false,
    tokenPreview: null,
    merchantPhone: null,
    connectedAt: null,
  },
];

/* ── Listener ─────────────────────────────────────────────────────────── */
const listenerDevices = [
  {
    deviceId: 'dev_7ac41f09',
    name: 'Redmi Note 12',
    model: '23021RAAEG',
    androidVersion: '13',
    appVersion: '1.0-beta.2',
    notificationAccess: true,
    enabledSources: ['shopee', 'dana'],
    lastSeenAt: addMinutes(NOW, -3),
  },
  {
    deviceId: 'dev_2b8e6d11',
    name: 'Infinix Hot 30',
    model: 'X6833B',
    androidVersion: '12',
    appVersion: '1.0-beta.1',
    notificationAccess: false,
    enabledSources: ['shopee'],
    lastSeenAt: addDays(NOW, -3),
  },
];

const listenerApp = {
  version: '1.0-beta.2',
  minAndroid: 'Android 7+',
  sizeMb: 6.6,
  fileName: 'malawali-listener-1.0-beta.2.apk',
};

/* ── Order ────────────────────────────────────────────────────────────── */
const STATUS_POOL = [
  'expired', 'paid', 'pending', 'expired', 'paid', 'expired', 'cancelled',
  'paid', 'expired', 'pending', 'paid', 'expired', 'expired', 'cancelled',
  'paid', 'expired', 'pending', 'paid', 'expired', 'paid', 'expired',
  'pending', 'paid', 'expired', 'paid', 'expired',
];

const buildOrders = () => {
  const list = [];
  const total = STATUS_POOL.length;

  for (let i = 0; i < total; i += 1) {
    // sebar 14 hari ke belakang, terbaru di index 0
    const daysAgo = Math.floor((i / total) * 13);
    const createdAt = addDays(NOW, -daysAgo);
    createdAt.setHours(between(0, 23), between(0, 59), between(0, 59), 0);

    const status = STATUS_POOL[i];
    const project = i % 3 === 2 && rand() > 0.6 ? projects[1] : projects[0];
    const provider = rand() > 0.35 ? 'shopee' : 'gopay';
    const baseAmount = pick([100, 1000, 5000, 10000, 15000, 25000, 50000, 75000, 100000]);
    const feePercent = merchantSettings.feePercent;
    const feeAmount = Math.round((baseAmount * feePercent) / 100);
    const uniqueCode = status === 'expired' || status === 'cancelled'
      ? between(1, 99)
      : 0;
    const payAmount = baseAmount + feeAmount + uniqueCode;

    const createdAtIso = createdAt.toISOString();
    const expiresAt = addMinutes(createdAt, 10).toISOString();

    list.push({
      id: `pay_${(1000000 + i * 7919).toString(36)}${i.toString(36)}a${(i * 3 + 7).toString(36)}`,
      project: { id: project.id, name: project.name },
      projectId: project.id,
      reference: rand() > 0.45 ? `INV-${1000 + i}` : null,
      redirectUrl: 'https://kizushop.id/pembayaran-selesai',
      webhookUrl: i % 4 === 0 ? 'https://bot.kizushop.id/malawali/callback' : null,
      mode: 'live',
      provider,
      baseAmount,
      feePercent,
      feeAmount,
      uniqueCode,
      payAmount,
      status,
      qris: qrisAccounts[0].qrisString,
      checkoutUrl: `/pay/placeholder-${i}`,
      ttlSeconds: 600,
      createdAt: createdAtIso,
      expiresAt,
      paidAt: status === 'paid' ? addMinutes(createdAt, between(1, 9)).toISOString() : null,
      cancelledAt: status === 'cancelled' ? addMinutes(createdAt, between(1, 5)).toISOString() : null,
      matchedTransaction: status === 'paid'
        ? {
            providerTransactionId: `TRX${between(100000, 999999)}`,
            amount: payAmount,
            occurredAt: addMinutes(createdAt, between(1, 9)).toISOString(),
            claimedAt: addMinutes(createdAt, between(1, 9)).toISOString(),
          }
        : null,
      webhookDeliveries: status === 'paid'
        ? [
            {
              id: `evt_${(2000000 + i * 6151).toString(36)}x${i.toString(36)}`,
              event: 'order.paid',
              attempts: i % 5 === 0 ? 2 : 1,
              responseStatus: i % 5 === 0 ? 200 : 200,
              deliveredAt: addMinutes(createdAt, between(2, 10)).toISOString(),
              lastError: null,
            },
          ]
        : [],
    });
  }

  // urutkan terbaru dulu
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
};

const orders = buildOrders();

// pastikan id-nya unik & konsisten
orders.forEach((order, index) => {
  order.id = `pay_${ids.orderId().replace('pay_', '')}`;
  order.checkoutUrl = `/pay/${order.id}`;
  if (index === 0) order.status = order.status === 'pending' ? 'pending' : order.status;
});

/* ── Seri chart 14 hari ───────────────────────────────────────────────── */
const buildSeries = () => {
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const date = addDays(NOW, -i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayOrders = orders.filter((o) => {
      const d = new Date(o.createdAt);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === key;
    });
    days.push({
      key,
      date: date.toISOString(),
      total: dayOrders.length,
      paid: dayOrders.filter((o) => o.status === 'paid').length,
    });
  }
  return days;
};

/* ── Langganan ────────────────────────────────────────────────────────── */
const subscription = {
  active: true,
  until: addDays(NOW, 49),
  startedAt: addDays(NOW, -11),
  lastPaymentAt: addDays(NOW, -11),
  months: 2,
};

const subscriptionPayments = [
  {
    id: 'sub_1a2b3c4d',
    planMonths: 2,
    price: 10000,
    totalCheckout: 10000,
    status: 'paid',
    orderId: orders[orders.length - 1].id,
    createdAt: addDays(NOW, -11).toISOString(),
    paidAt: addDays(NOW, -11).toISOString(),
  },
  {
    id: 'sub_5e6f7a8b',
    planMonths: 1,
    price: 10000,
    totalCheckout: 10050,
    status: 'expired',
    orderId: orders[orders.length - 3].id,
    createdAt: addDays(NOW, -13).toISOString(),
    paidAt: null,
  },
];

/* ── Statistik agregat landing ────────────────────────────────────────── */
const publicStats = {
  paidVolume: 139839827,
  successToday: 20,
  successTotal: 6528,
  merchants: 249,
};

const buildDashboardStats = () => {
  const total = orders.length;
  const paid = orders.filter((o) => o.status === 'paid').length;
  const pending = orders.filter((o) => o.status === 'pending').length;
  const revenue = orders
    .filter((o) => o.status === 'paid')
    .reduce((sum, o) => sum + o.payAmount, 0);
  return { total, paid, pending, revenue };
};

/* ── Deteksi pembayaran ───────────────────────────────────────────────── */
const buildDetection = () => {
  const shopee = providerConnections.find((c) => c.provider === 'shopee');
  const gopay = providerConnections.find((c) => c.provider === 'gopay');
  const active = qrisAccounts.find((q) => q.status === 'active');
  const provider = active ? active.provider : null;

  const connection = provider === 'shopee' ? shopee : provider === 'gopay' ? gopay : null;
  const merchantConnected = connection?.status === 'connected';
  const listenerReady = listenerDevices.some(
    (d) => d.notificationAccess && provider && d.enabledSources.includes(provider)
  );

  return {
    provider,
    providerLabel: provider === 'shopee' ? 'Shopee Partner' : provider === 'gopay' ? 'GoPay Merchant' : null,
    merchantConnected,
    connectionStatus: connection?.status ?? 'disconnected',
    listenerReady,
    ready: merchantConnected || listenerReady,
    note:
      !merchantConnected && !listenerReady
        ? 'QRIS sudah tersimpan, tetapi deteksi pembayaran belum siap. Hubungkan akun merchant atau aktifkan Shopee Partner di aplikasi Malawali Listener.'
        : null,
  };
};

module.exports = {
  build: () => ({
    user,
    merchantSettings,
    projects,
    qrisAccounts,
    providerConnections,
    listenerDevices,
    listenerApp,
    orders,
    subscription,
    subscriptionPayments,
    series: buildSeries(),
    publicStats,
    dashboardStats: buildDashboardStats(),
    detection: buildDetection(),
    settingsPanel: { disabledProviders: [], pricing: null },
  }),
  NOW,
};
