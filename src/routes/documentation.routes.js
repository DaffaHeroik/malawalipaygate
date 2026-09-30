'use strict';

const express = require('express');

const config = require('../config');
const constants = require('../config/constants');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const SECTIONS = [
  { key: 'mulai', label: 'Mulai Integrasi' },
  { key: 'auth', label: 'Base URL & Autentikasi' },
  { key: 'project', label: 'Project' },
  { key: 'api-key', label: 'API Key' },
  { key: 'endpoints', label: 'Daftar Endpoint' },
  { key: 'qris', label: 'Setup QRIS' },
  { key: 'settings', label: 'Settings' },
  { key: 'hybrid', label: 'Mode Hybrid' },
  { key: 'order', label: 'Buat Order' },
  { key: 'status', label: 'Cek Status' },
  { key: 'cancel', label: 'Cancel' },
  { key: 'status-order', label: 'Status Order' },
  { key: 'webhook', label: 'Webhook' },
  { key: 'error', label: 'Error' },
];

router.get('/', requireAuth, (req, res) => {
  const requested = String(req.query.bagian || req.query.section || 'mulai');
  const section = SECTIONS.some((s) => s.key === requested) ? requested : 'mulai';

  res.render('pages/app/documentation', {
    layout: 'layouts/shell',
    pageTitle: 'Documentation',
    pageEyebrow: 'Bantuan',
    metaDescription: 'Dokumentasi integrasi: project, API key, order, status, QRIS, dan webhook.',
    user: req.user,
    sections: SECTIONS,
    section,
    apiBaseUrl: `${config.baseUrl}/api`,
    apiErrors: constants.API_ERRORS,
    providers: constants.PROVIDERS,
  });
});

module.exports = router;
