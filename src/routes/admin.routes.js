'use strict';

const express = require('express');

const config = require('../config');
const data = require('../data');
const constants = require('../config/constants');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const asyncHandler = require('../lib/asyncHandler');
const validation = require('../lib/validation');
const models = require('../models');
const audit = require('../services/audit.service');

const router = express.Router();

const TABS = ['overview', 'subscriptions', 'providers', 'merchants'];

const emptyOverview = () => ({
  users: 0,
  orders: 0,
  paidCount: 0,
  paidVolume: 0,
  pendingSubscriptions: 0,
  pricing: { ...config.planPrices },
  disabledProviders: [],
  announcement: '',
});

router.get('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const tab = TABS.includes(String(req.query.tab)) ? String(req.query.tab) : 'overview';
  const isDb = typeof data.getAdminOverview === 'function';

  const overview = isDb ? await data.getAdminOverview() : emptyOverview();
  const users = isDb ? await data.listUsers() : [];
  const orders = isDb ? await data.listAllOrders({ limit: 25 }) : [];
  const payments = isDb ? await data.listAllSubscriptionPayments() : [];

  res.render('pages/admin/index', {
    layout: 'layouts/shell',
    pageTitle: 'Admin',
    pageEyebrow: 'Administrator',
    metaDescription: 'Panel administrator: harga, provider, merchant, dan langganan.',
    user: req.user,
    tab,
    tabs: TABS,
    overview,
    users,
    orders,
    payments,
    isDb,
    plans: constants.PLANS,
    providers: constants.PROVIDERS.filter((p) => p.group !== 'auto'),
    orderStatus: constants.ORDER_STATUS,
  });
}));

router.post('/pricing', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const pricing = {};
  [1, 2, 3, 5].forEach((months) => {
    const value = Number.parseInt(req.body[`price_${months}`], 10);
    pricing[months] = Number.isFinite(value) && value > 0 ? value : config.planPrices[months];
  });

  if (typeof data.updateGlobalSetting === 'function') {
    await data.updateGlobalSetting({ pricing });
  }
  audit.recordRequest(req, 'admin.pricing_update', { targetType: 'setting', targetId: 'pricing', meta: { pricing } });
  req.flash('success', 'Harga paket diperbarui.');
  return res.redirect('/admin?tab=overview');
}));

router.post('/providers/toggle', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const provider = validation.trim(req.body.provider, 30);
  const overview = typeof data.getAdminOverview === 'function' ? await data.getAdminOverview() : emptyOverview();
  const disabled = new Set(overview.disabledProviders || []);

  if (disabled.has(provider)) disabled.delete(provider);
  else disabled.add(provider);

  if (typeof data.updateGlobalSetting === 'function') {
    await data.updateGlobalSetting({ disabledProviders: [...disabled] });
  }

  audit.recordRequest(req, 'admin.provider_toggle', {
    targetType: 'provider',
    targetId: provider,
    meta: { disabled: disabled.has(provider) },
  });
  req.flash('success', `Provider ${provider} ${disabled.has(provider) ? 'dinonaktifkan' : 'diaktifkan'}.`);
  return res.redirect('/admin?tab=providers');
}));

router.post('/announcement', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const announcement = validation.trim(req.body.announcement, 500);
  if (typeof data.updateGlobalSetting === 'function') {
    await data.updateGlobalSetting({ announcement });
  }
  audit.recordRequest(req, 'admin.announcement_update', { targetType: 'setting', targetId: 'announcement' });
  req.flash('success', 'Pengumuman disimpan.');
  return res.redirect('/admin?tab=overview');
}));

router.post('/subscriptions/:id/activate', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (typeof data.getAdminOverview !== 'function') {
    req.flash('danger', 'Aktivasi langganan hanya tersedia saat DATA_SOURCE=db.');
    return res.redirect('/admin?tab=subscriptions');
  }

  const payment = await models.SubscriptionPayment.findOne({ paymentId: req.params.id });
  if (!payment) {
    req.flash('danger', 'Tagihan tidak ditemukan.');
    return res.redirect('/admin?tab=subscriptions');
  }

  await data.activateSubscription(String(payment.userId), payment.planMonths, { paymentId: payment.paymentId });
  audit.recordRequest(req, 'admin.subscription_activate', {
    targetType: 'subscription',
    targetId: payment.paymentId,
    userId: String(payment.userId),
    meta: { months: payment.planMonths },
  });
  req.flash('success', `Langganan ${payment.planMonths} bulan diaktifkan.`);
  return res.redirect('/admin?tab=subscriptions');
}));

module.exports = router;
