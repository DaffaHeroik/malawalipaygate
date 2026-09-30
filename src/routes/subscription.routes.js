'use strict';

const express = require('express');

const data = require('../data');
const constants = require('../config/constants');
const { requireAuth } = require('../middleware/auth');
const { orderLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

const TABS = ['plans', 'history'];

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const tab = TABS.includes(String(req.query.tab)) ? String(req.query.tab) : 'plans';

  res.render('pages/app/subscription', {
    layout: 'layouts/shell',
    pageTitle: 'Langganan',
    pageEyebrow: 'Akun',
    metaDescription: 'Aktifkan API Key dan REST API untuk integrasi bot, website, atau aplikasi.',
    user: req.user,
    subscription: await data.getSubscription(),
    plans: await data.getPlans(),
    payments: await data.listSubscriptionPayments(),
    planFeatures: constants.PLAN_FEATURES,
    tab,
  });
}));

router.post('/buy', requireAuth, orderLimiter, asyncHandler(async (req, res) => {
  const months = Number.parseInt(req.body.months, 10);
  const plans = await data.getPlans();
  const plan = plans.find((p) => p.months === months);

  if (!plan) {
    req.flash('danger', 'Paket langganan tidak ditemukan.');
    return res.redirect('/subscription');
  }

  const payment = await data.createSubscriptionPayment(plan.months);
  req.flash('success', `Tagihan ${plan.label} dibuat (${payment.id}). Selesaikan pembayaran untuk mengaktifkan masa aktif.`);
  return res.redirect('/subscription?tab=history');
}));

module.exports = router;
