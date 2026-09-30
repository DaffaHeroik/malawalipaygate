'use strict';

const express = require('express');

const data = require('../data');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../lib/asyncHandler');
const validation = require('../lib/validation');
const crypto = require('../services/crypto.service');
const audit = require('../services/audit.service');

const router = express.Router();

const renderPage = async (req, res) => {
  res.render('pages/app/shopee', {
    layout: 'layouts/shell',
    pageTitle: 'Shopee Partner',
    pageEyebrow: 'Pembayaran',
    metaDescription: 'Hubungkan Shopee Partner untuk deteksi pembayaran otomatis.',
    user: req.user,
    connection: await data.getProviderConnection('shopee'),
    detection: await data.getDetection(),
    activeQris: await data.getActiveQris(),
  });
};

router.get('/', requireAuth, asyncHandler(renderPage));

router.post('/connect', requireAuth, asyncHandler(async (req, res) => {
  const token = validation.trim(req.body.token, 4000);

  if (!token || token.length < 20) {
    req.flash('danger', 'Token koneksi Shopee tidak valid.');
    return res.redirect('/shopee');
  }

  await data.connectProvider('shopee', {
    tokenPreview: crypto.preview(token, 24),
    // Token disimpan terenkripsi (AES-256-GCM), bukan plaintext.
    credentialsEnc: crypto.encryptJson({ token }),
  });
  audit.recordRequest(req, 'provider.shopee_connect', { targetType: 'provider', targetId: 'shopee' });
  req.flash('success', 'Token Shopee Partner disimpan dan koneksi diuji.');
  return res.redirect('/shopee');
}));

router.post('/test', requireAuth, asyncHandler(async (req, res) => {
  const connection = await data.testProviderConnection('shopee');
  audit.recordRequest(req, 'provider.shopee_test', {
    targetType: 'provider',
    targetId: 'shopee',
    meta: { status: connection?.status || 'unknown' },
  });
  if (connection?.status === 'connected') {
    req.flash('success', 'Koneksi Shopee Partner berhasil.');
  } else {
    req.flash('danger', 'Koneksi Shopee Partner gagal. Ambil token baru dari portal merchant.');
  }
  return res.redirect('/shopee');
}));

router.post('/disconnect', requireAuth, asyncHandler(async (req, res) => {
  await data.disconnectProvider('shopee');
  audit.recordRequest(req, 'provider.shopee_disconnect', { targetType: 'provider', targetId: 'shopee' });
  req.flash('success', 'Koneksi Shopee Partner diputuskan.');
  return res.redirect('/shopee');
}));

module.exports = router;
