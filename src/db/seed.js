'use strict';

const config = require('../config');
const models = require('../models');
const ids = require('../lib/ids');
const apikey = require('../services/apikey.service');
const passwordLib = require('../lib/password');
const { addDays, addMinutes } = require('../lib/datetime');

const DEMO_EMAIL = process.env.SEED_EMAIL || 'kizu@malawalipayment.web.id';
const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'restukizu1';

/** QRIS statis valid (CRC 568D) — dipakai untuk demo & test. */
const QRIS_STRING =
  '00020101021126610014COM.GO-JEK.WWW01189360091432191540810210G2191540810303UMI51440014ID.CO.QRIS.WWW0215ID10253911118910303UMI5204581553033605802ID5924JUAN Pria Sigma, Digital6006BLITAR61056615462070703A016304568D';

/** API key development yang gampang diingat (hanya untuk seed dev). */
const DEV_DEFAULT_KEY = 'pk_live_seed_default_project';

const ago = (days, minutes = 0) => addMinutes(addDays(new Date(), -days), -minutes);

const seed = async ({ force = false } = {}) => {
  const count = await models.User.countDocuments();

  if (count > 0 && !force) return { seeded: false, reason: 'data sudah ada' };

  if (force) {
    await Promise.all([
      models.User.deleteMany({}),
      models.MerchantSettings.deleteMany({}),
      models.Project.deleteMany({}),
      models.QrisAccount.deleteMany({}),
      models.ProviderConnection.deleteMany({}),
      models.ListenerDevice.deleteMany({}),
      models.Order.deleteMany({}),
      models.SubscriptionPayment.deleteMany({}),
      models.WebhookDelivery.deleteMany({}),
      models.AppSetting.deleteMany({}),
    ]);
  }

  /* ── User ── */
  const user = await models.User.create({
    email: DEMO_EMAIL,
    passwordHash: await passwordLib.hashPassword(DEMO_PASSWORD),
    name: 'kizu',
    displayName: 'Kizu',
    merchantName: 'Kizushop',
    avatarColor: '#174d9b',
    emailVerified: true,
    role: 'user',
    isBotTenant: false,
    subscriptionUntil: addDays(new Date(), 49),
    lastLoginAt: ago(0, 35),
  });

  /* ── Admin ── */
  await models.User.create({
    email: 'admin@malawalipayment.web.id',
    passwordHash: await passwordLib.hashPassword('adminrestu1'),
    name: 'Admin',
    displayName: 'Administrator',
    merchantName: 'Malawali',
    avatarColor: '#0f3d73',
    emailVerified: true,
    role: 'admin',
  });

  /* ── Merchant settings ── */
  await models.MerchantSettings.create({
    userId: user._id,
    feePercent: 0.5,
    uniqueDigits: 2,
    orderTtl: 600,
    redirectUrl: 'https://kizushop.id/pembayaran-selesai',
    webhookSecret: `whsec_${ids.secret(10)}`,
    webhookSecretRotatedAt: ago(11),
  });

  /* ── Projects ── */
  const defaults = [
    {
      name: 'Project Utama',
      isDefault: true,
      apiKeyHash: apikey.hashKey(DEV_DEFAULT_KEY),
      apiKeyMasked: apikey.maskKey(DEV_DEFAULT_KEY),
      apiKeyRotatedAt: ago(9),
      apiKeyLastUsedAt: ago(0, 42),
      webhookUrl: 'https://kizushop.id/webhook/malawali',
    },
    {
      name: 'Bot Telegram',
      isDefault: false,
      apiKeyMasked: `pk_live_${'•'.repeat(12)}9b71`,
      apiKeyHash: apikey.hashKey('pk_live_seed_bot_telegram'),
      apiKeyRotatedAt: ago(6),
      apiKeyLastUsedAt: ago(1),
      webhookUrl: 'https://bot.kizushop.id/malawali/callback',
    },
    {
      name: 'Website Reseller',
      isDefault: false,
      apiKeyMasked: null,
      apiKeyHash: null,
      webhookUrl: '',
    },
  ];

  const projects = [];
  for (const item of defaults) {
    // eslint-disable-next-line no-await-in-loop
    projects.push(await models.Project.create({ userId: user._id, ...item }));
  }

  /* ── QRIS ── */
  await models.QrisAccount.create({
    userId: user._id,
    provider: 'shopee',
    qrisString: QRIS_STRING,
    merchantName: 'KIZUSHOP',
    merchantCity: 'BEKASI',
    qrisType: 'static',
    status: 'active',
  });

  /* ── Provider connections ── */
  await models.ProviderConnection.create({
    userId: user._id,
    provider: 'shopee',
    status: 'error',
    hasCredential: true,
    tokenPreview: 'eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp...',
    lastTestAt: ago(2),
    lastError: 'Sesi token kedaluwarsa. Ambil token baru dari portal merchant.',
    connectedAt: ago(11),
  });
  await models.ProviderConnection.create({
    userId: user._id,
    provider: 'gopay',
    status: 'disconnected',
    hasCredential: false,
  });

  /* ── Listener device ── */
  await models.ListenerDevice.create({
    userId: user._id,
    deviceId: ids.deviceId(),
    name: 'Redmi Note 12',
    model: 'Redmi Note 12',
    androidVersion: '12',
    appVersion: '1.0-beta.1',
    notificationAccess: true,
    enabledSources: ['shopee'],
    lastSeenAt: ago(3),
  });

  /* ── Orders ── */
  const statusPool = [
    'expired', 'paid', 'pending', 'expired', 'paid', 'expired', 'cancelled',
    'paid', 'expired', 'pending', 'paid', 'expired', 'expired', 'cancelled',
    'paid', 'expired', 'pending', 'paid', 'expired', 'paid', 'expired',
    'pending', 'paid', 'expired', 'paid', 'expired',
  ];
  const amounts = [10000, 25000, 50000, 15000, 5000, 1000, 75000, 100000];

  for (let i = 0; i < statusPool.length; i += 1) {
    const status = statusPool[i];
    const createdAt = ago(Math.floor((i / statusPool.length) * 13), (i * 37) % 600);
    const baseAmount = amounts[i % amounts.length];
    const uniqueCode = status === 'pending' ? 0 : (i * 7) % 100;
    const payAmount = baseAmount + uniqueCode;
    const project = projects[i % 3 === 2 ? 1 : 0];

    // eslint-disable-next-line no-await-in-loop
    await models.Order.create({
      orderId: ids.orderId(),
      userId: user._id,
      projectId: String(project._id),
      project: { id: String(project._id), name: project.name },
      reference: i % 3 === 0 ? `INV-${1000 + i}` : null,
      redirectUrl: 'https://kizushop.id/pembayaran-selesai',
      webhookUrl: i % 4 === 0 ? 'https://bot.kizushop.id/malawali/callback' : null,
      mode: 'live',
      provider: i % 3 === 0 ? 'gopay' : 'shopee',
      baseAmount,
      feePercent: 0.5,
      feeAmount: 0,
      uniqueCode,
      payAmount,
      status,
      qris: QRIS_STRING,
      checkoutUrl: '',
      ttlSeconds: 600,
      createdAt,
      expiresAt: addMinutes(createdAt, 10),
      paidAt: status === 'paid' ? addMinutes(createdAt, 4) : null,
      cancelledAt: status === 'cancelled' ? addMinutes(createdAt, 2) : null,
      matchedTransaction:
        status === 'paid'
          ? {
              providerTransactionId: `TRX${100000 + i * 37}`,
              amount: payAmount,
              occurredAt: addMinutes(createdAt, 4),
              claimedAt: addMinutes(createdAt, 4),
            }
          : null,
    });
  }

  /* ── Langganan ── */
  await models.SubscriptionPayment.create({
    paymentId: `sub_${ids.secret(6)}`,
    userId: user._id,
    planMonths: 2,
    price: config.planPrices[2] || 20000,
    totalCheckout: config.planPrices[2] || 20000,
    status: 'paid',
    createdAt: ago(11),
    paidAt: ago(11),
  });

  /* ── App setting ── */
  await models.AppSetting.create({
    key: 'global',
    pricing: { ...config.planPrices },
    disabledProviders: [],
    announcement: '',
  });

  return {
    seeded: true,
    user: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    projects: projects.length,
    orders: statusPool.length,
  };
};

/** Dipakai saat boot development: isi DB kalau masih kosong. */
const seedIfEmpty = async () => {
  try {
    return await seed({ force: false });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[seed] gagal:', error.message);
    return { seeded: false, error: error.message };
  }
};

module.exports = { seed, seedIfEmpty, DEMO_EMAIL, DEMO_PASSWORD, DEV_DEFAULT_KEY, QRIS_STRING };

/* Jalankan langsung: node src/db/seed.js [--fresh] */
if (require.main === module) {
  (async () => {
    const { connect, disconnect } = require('./connect');
    try {
      await connect();
      const result = await seed({ force: process.argv.includes('--fresh') });
      if (result.seeded) {
        // eslint-disable-next-line no-console
        console.log(`\n[seed] selesai. Login: ${result.user} / ${result.password}\n`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`\n[seed] dilewati (${result.reason || result.error}).\n`);
      }
      await disconnect();
      process.exit(0);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[seed] error:', error);
      process.exit(1);
    }
  })();
}
