'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

/** Di development, batasnya dilonggarkan biar nggak ganggu saat ngoprek UI. */
const devMultiplier = config.isDev ? 20 : 1;

/** Batasi percobaan login/register/reset. */
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30 * devMultiplier,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'invalid_request', message: 'Terlalu banyak percobaan. Coba lagi nanti.' } },
});

/** Batasi endpoint REST API per API key / IP. */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120 * devMultiplier,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.get('x-api-key') || req.ip,
  message: { ok: false, error: { code: 'invalid_request', message: 'Rate limit terlampaui.' } },
});

/** Batasi pembuatan order dari dashboard. */
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40 * devMultiplier,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'invalid_request', message: 'Terlalu banyak permintaan order.' } },
});

module.exports = { authLimiter, apiLimiter, orderLimiter };
