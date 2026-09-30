'use strict';

const express = require('express');

const data = require('../data');
const constants = require('../config/constants');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const devices = await data.listListenerDevices();
  const detection = await data.getDetection();

  res.render('pages/app/listener', {
    layout: 'layouts/shell',
    pageTitle: 'Malawali Listener',
    pageEyebrow: 'Pemantau Pembayaran',
    metaDescription: 'Aplikasi Android pendamping untuk mengenali pembayaran dari notifikasi merchant.',
    user: req.user,
    summary: await data.getListenerSummary(),
    devices,
    app: await data.getListenerApp(),
    detection,
    activeQris: await data.getActiveQris(),
    providers: constants.PROVIDERS.filter((p) => p.group !== 'auto'),
  });
}));

/* Cabut perangkat Listener (token langsung tidak berlaku). */
router.post('/devices/:deviceId/revoke', requireAuth, asyncHandler(async (req, res) => {
  if (config.dataSource !== 'db') {
    req.flash('warning', 'Mode mock: aksi ini tidak disimpan. Jalankan DATA_SOURCE=db untuk mencabut perangkat.');
    return res.redirect('/listener');
  }

  const removed = await data.revokeListenerDeviceForUser(req.user.id, req.params.deviceId);
  req.flash(removed ? 'success' : 'danger', removed ? 'Perangkat dicabut.' : 'Perangkat tidak ditemukan.');
  return res.redirect('/listener');
}));

module.exports = router;
