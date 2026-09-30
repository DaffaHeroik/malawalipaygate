'use strict';

const express = require('express');

const data = require('../data');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../lib/asyncHandler');
const validation = require('../lib/validation');
const crypto = require('../services/crypto.service');
const audit = require('../services/audit.service');

const router = express.Router();

const renderPage = async (req, res, extra = {}) => {
  const connection = await data.getProviderConnection('gopay');

  res.render('pages/app/gopay', {
    layout: 'layouts/shell',
    pageTitle: 'GoPay Merchant',
    pageEyebrow: 'Pembayaran',
    metaDescription: 'Hubungkan akun GoPay Merchant/GoBiz untuk deteksi pembayaran otomatis.',
    user: req.user,
    connection,
    detection: await data.getDetection(),
    activeQris: await data.getActiveQris(),
    otpSent: extra.otpSent || false,
    phone: extra.phone || connection?.merchantPhone || '',
  });
};

router.get('/', requireAuth, asyncHandler(async (req, res) => renderPage(req, res)));

router.post('/otp', requireAuth, asyncHandler(async (req, res) => {
  const phone = validation.trim(req.body.phone, 20).replace(/[^\d+]/g, '');

  if (phone.replace(/\D/g, '').length < 9) {
    req.flash('danger', 'Nomor handphone tidak valid.');
    return renderPage(req, res);
  }

  req.flash('success', `OTP dikirim ke ${phone}.`);
  return renderPage(req, res, { otpSent: true, phone });
}));

router.post('/verify', requireAuth, asyncHandler(async (req, res) => {
  const phone = validation.trim(req.body.phone, 20).replace(/[^\d+]/g, '');
  const otp = validation.trim(req.body.otp, 6).replace(/\D/g, '');

  if (otp.length !== 6) {
    req.flash('danger', 'Kode OTP harus 6 digit.');
    return renderPage(req, res, { otpSent: true, phone });
  }

  await data.connectProvider('gopay', {
    merchantPhone: phone,
    // Sesi/nomor terenkripsi (AES-256-GCM). OTP tidak pernah disimpan mentah.
    credentialsEnc: crypto.encryptJson({ phone, verified: true }),
  });
  audit.recordRequest(req, 'provider.gopay_connect', { targetType: 'provider', targetId: 'gopay' });
  req.flash('success', 'Akun GoPay Merchant berhasil dihubungkan.');
  return res.redirect('/gopay');
}));

router.post('/test', requireAuth, asyncHandler(async (req, res) => {
  const connection = await data.testProviderConnection('gopay');
  audit.recordRequest(req, 'provider.gopay_test', {
    targetType: 'provider',
    targetId: 'gopay',
    meta: { status: connection?.status || 'unknown' },
  });
  if (connection?.status === 'connected') {
    req.flash('success', 'Koneksi GoPay Merchant berhasil.');
  } else {
    req.flash('danger', 'Koneksi GoPay Merchant gagal. Hubungkan ulang akun.');
  }
  return res.redirect('/gopay');
}));

router.post('/disconnect', requireAuth, asyncHandler(async (req, res) => {
  await data.disconnectProvider('gopay');
  audit.recordRequest(req, 'provider.gopay_disconnect', { targetType: 'provider', targetId: 'gopay' });
  req.flash('success', 'Koneksi GoPay Merchant diputuskan.');
  return res.redirect('/gopay');
}));

module.exports = router;
