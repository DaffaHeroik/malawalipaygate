'use strict';

const express = require('express');

const data = require('../data');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

/**
 * QRIS Malawali — QRIS siap pakai khusus penyewa Bot DigiKita.
 * Halaman ini terkunci selama flag `isBotTenant` belum aktif.
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const user = await data.getUser();

  res.render('pages/app/qris-paykita', {
    layout: 'layouts/shell',
    pageTitle: 'QRIS Malawali',
    pageEyebrow: 'Pembayaran',
    metaDescription: 'QRIS siap pakai tanpa perlu memiliki QRIS merchant sendiri.',
    user,
    unlocked: Boolean(user.isBotTenant),
    activeQris: await data.getActiveQris(),
    settings: await data.getSettings(),
  });
}));

module.exports = router;
