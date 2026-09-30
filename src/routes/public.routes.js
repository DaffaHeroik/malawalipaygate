'use strict';

const express = require('express');

const data = require('../data');
const config = require('../config');
const asyncHandler = require('../lib/asyncHandler');
const qr = require('../lib/qr');

const router = express.Router();

/* ── Landing ── */
router.get('/', asyncHandler(async (req, res) => {
  res.render('pages/landing', {
    layout: 'layouts/public',
    pageTitle: null,
    metaDescription: `${res.locals.brand.name} — QRIS statis jadi sistem pembayaran otomatis. Buat order, deteksi pembayaran, dan kirim webhook.`,
    stats: await data.getPublicStats(),
    plans: await data.getPlans(),
  });
}));

/* ── Kebijakan & Privasi ── */
router.get('/privasi', (req, res) => {
  res.render('pages/privasi', {
    layout: config.isProd ? 'layouts/public' : 'layouts/shell',
    pageTitle: 'Ketentuan Layanan & Kebijakan Privasi',
    pageEyebrow: 'Bantuan',
  });
});

/* ── Halaman checkout publik ── */
router.get(
  '/pay/:id',
  asyncHandler(async (req, res) => {
    const forcedState = typeof req.query.state === 'string' ? req.query.state : null;
    const order = await data.getPayPreview(req.params.id, forcedState);

    if (!order) {
      return res.status(404).render('pages/errors/404', {
        layout: 'layouts/public',
        pageTitle: 'Order tidak ditemukan',
      });
    }

    // payload QR: gabungan string QRIS + nominal (Fase 12: TLV EMVCo asli)
    const payload = `${order.qris || 'QRIS'}|${order.payAmount}|${order.id}`;
    const qrDataUrl = await qr.toDataUrl(payload, { size: 260 });

    return res.render('pages/pay', {
      layout: 'layouts/checkout',
      pageTitle: `Pembayaran ${order.id}`,
      metaDescription: 'Selesaikan pembayaran QRIS.',
      order,
      qrDataUrl,
      now: new Date().toISOString(),
    });
  })
);

/* ── Keluar ── */
router.get('/logout', (req, res) => {
  req.session?.destroy?.(() => {
    res.clearCookie(config.session.name);
    res.redirect('/login');
  });
});

module.exports = router;
