'use strict';

const express = require('express');

const data = require('../data');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

const SECTIONS = [
  { key: 'mulai', label: 'Sebelum Mulai' },
  { key: 'wajib', label: 'Setup Wajib' },
  { key: 'shopee', label: 'Shopee' },
  { key: 'gopay', label: 'GoPay' },
  { key: 'gopay-rekomendasi', label: 'GoPay Recommendation' },
  { key: 'listener', label: 'Listener Provider' },
  { key: 'projects', label: 'Projects' },
  { key: 'api', label: 'API & Webhook' },
  { key: 'faq', label: 'FAQ' },
];

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const requested = String(req.query.bagian || req.query.section || 'mulai');
  const section = SECTIONS.some((s) => s.key === requested) ? requested : 'mulai';

  res.render('pages/app/tutorial', {
    layout: 'layouts/shell',
    pageTitle: 'Tutorial',
    pageEyebrow: 'Bantuan',
    metaDescription: 'Panduan dari QRIS statis sampai order otomatis PAID.',
    user: req.user,
    sections: SECTIONS,
    section,
    detection: await data.getDetection(),
    settings: await data.getSettings(),
    activeQris: await data.getActiveQris(),
    app: await data.getListenerApp(),
  });
}));

module.exports = router;
