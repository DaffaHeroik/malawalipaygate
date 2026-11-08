'use strict';

/**
 * Entry point Vercel untuk backend Malawali Payment.
 *
 * Dipakai @vercel/express (vercel.json → builds). Satu express app yang:
 *  - serve static SPA lama dari public/spa/
 *  - mount adapter kontrak legacy PayKita  → /payment/*, /auth/*, /qris/*,
 *    /user/*, /withdraw/*
 *  - mount integrasi deteksi pembayaran   → /webhook/*, /api/listener/*, /cron/detect
 *  - fallback ke index.html (SPA) untuk path yang bukan API/asset
 *
 * Data: Firebase RTDB (stateless function, tanpa DB Vercel).
 */

const path = require('path');
const express = require('express');

const legacy = require('../api/legacy');
const detect = require('../api/detect');

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  /* JSON body (legacy SPA POST pakai JSON) */
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  /* CORS: SPA same-origin jadi tidak perlu, tapi izinkan API untuk app lain */
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  /* health */
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', app: 'malawali-payment-gateway', uptime: Math.floor(process.uptime()), ts: Date.now() });
  });

  /* adapter kontrak legacy (format respons Malawali Api) */
  app.use(legacy.buildRouter());

  /* integrasi deteksi pembayaran (pengganti OrderKuota) */
  app.use(detect.buildRouter());

  /* ── static SPA lama ── */
  const spaDir = path.join(__dirname, '..', 'public', 'spa');
  const spaIndex = path.join(spaDir, 'index.html');
  app.use(express.static(spaDir, { maxAge: '1h' }));

  /* fallback → SPA (route selain /api, /payment, /auth, /qris, /user, /withdraw, /webhook, /cron, /health) */
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/payment') || req.path.startsWith('/auth') ||
      req.path.startsWith('/qris') || req.path.startsWith('/user') ||
      req.path.startsWith('/withdraw') || req.path.startsWith('/webhook') ||
      req.path.startsWith('/cron') || req.path.startsWith('/api') ||
      req.path.startsWith('/health') || req.path.startsWith('/stats')
    ) {
      return next();
    }
    return res.sendFile(spaIndex, (err) => (err ? next() : undefined));
  });

  /* 404 JSON untuk path API yang tak dikenal */
  app.use((req, res) => {
    res.status(404).json({ status: false, creator: 'Malawali Api', code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' });
  });

  return app;
}

const handler = buildApp();
module.exports = handler;
module.exports.default = handler;
