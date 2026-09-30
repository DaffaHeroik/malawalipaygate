'use strict';

require('dotenv').config();

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const isProd = (process.env.NODE_ENV || 'development') === 'production';

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  isDev: !isProd,
  port: toInt(process.env.PORT, 3000),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),

  /** 'mock' (fase UI, tanpa DB) atau 'db' */
  dataSource: process.env.DATA_SOURCE === 'db' ? 'db' : 'mock',

  db: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/malawali',
    useMemoryServer: toBool(process.env.DEVELOPMENT_MONGO_MEMORY, !isProd),
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
    name: process.env.SESSION_NAME || 'malawali.sid',
    ttlDays: toInt(process.env.SESSION_TTL_DAYS, 7),
    /** 'mongo' (default di mode db) atau 'memory' (dipakai test). */
    driver: process.env.SESSION_DRIVER === 'memory' ? 'memory' : 'mongo',
  },

  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY || '',
    secretKey: process.env.TURNSTILE_SECRET_KEY || '',
    disabled: toBool(process.env.TURNSTILE_DISABLED, !isProd),
  },

  google: {
    enabled: toBool(process.env.GOOGLE_ENABLED, false),
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },

  mail: {
    transport: process.env.MAIL_TRANSPORT || 'console',
    from: process.env.MAIL_FROM || 'Malawali Payment <no-reply@malawalipayment.web.id>',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: toInt(process.env.SMTP_PORT, 587),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },

  crypto: {
    credentialEncKey: process.env.CREDENTIAL_ENC_KEY || '',
    apiKeyPepper: process.env.API_KEY_PEPPER || 'dev-api-key-pepper',
  },

  order: {
    ttlDefault: 600,
    ttlMin: 60,
    ttlMax: 86400,
    expireSweepSeconds: toInt(process.env.ORDER_EXPIRE_SWEEP_SECONDS, 30),
  },

  webhook: {
    timeoutMs: toInt(process.env.WEBHOOK_TIMEOUT_MS, 10000),
    maxAttempts: toInt(process.env.WEBHOOK_MAX_ATTEMPTS, 3),
  },

  provider: {
    adapter: process.env.PROVIDER_ADAPTER || 'mock',
  },

  planPrices: {
    1: toInt(process.env.PLAN_PRICE_1, 10000),
    2: toInt(process.env.PLAN_PRICE_2, 20000),
    3: toInt(process.env.PLAN_PRICE_3, 30000),
    5: toInt(process.env.PLAN_PRICE_5, 40000),
  },

  uploadsDir: 'uploads',
};

/**
 * Peringatan konfigurasi yang nggak boleh lolos ke produksi.
 */
config.warnings = [];
if (config.isProd) {
  if (config.session.secret.includes('dev-only')) {
    config.warnings.push('SESSION_SECRET masih memakai nilai default development.');
  }
  if (config.dataSource === 'mock') {
    config.warnings.push('DATA_SOURCE=mock di produksi; data tidak akan tersimpan.');
  }
  if (config.turnstile.disabled) {
    config.warnings.push('TURNSTILE_DISABLED=true di produksi.');
  }
}

module.exports = config;
