'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const data = require('../data');
const constants = require('../config/constants');
const { requireAuth } = require('../middleware/auth');
const { orderLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../lib/asyncHandler');
const validation = require('../lib/validation');
const money = require('../lib/money');

const router = express.Router();

/* ── Upload gambar QRIS ── */
const uploadsRoot = path.join(__dirname, '..', '..', 'public', 'uploads');
fs.mkdirSync(path.join(uploadsRoot, 'qris'), { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(uploadsRoot, 'qris')),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.png').toLowerCase();
      cb(null, `qris-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    return cb(new Error('Format gambar harus PNG, JPG, WEBP, atau GIF.'));
  },
});

const qrisView = async (req, res, extra = {}) =>
  res.render('pages/app/qris/index', {
    layout: 'layouts/shell',
    pageTitle: 'QRIS',
    pageEyebrow: 'QRIS Checkout',
    metaDescription: 'Satu akun memakai satu QRIS aktif dengan deteksi pembayaran otomatis.',
    user: req.user,
    settings: await data.getSettings(),
    activeQris: await data.getActiveQris(),
    qrisAccounts: await data.listQris(),
    detection: await data.getDetection(),
    providers: constants.PROVIDERS,
    amountModes: constants.AMOUNT_MODES,
    projects: await data.listProjects(),
    createdOrder: extra.createdOrder || null,
    ...extra,
  });

router.get('/', requireAuth, asyncHandler(async (req, res) => qrisView(req, res)));

/* Simpan QRIS statis (upload gambar / tempel string) */
router.post('/', requireAuth, upload.single('qris_image'), asyncHandler(async (req, res) => {
  const provider = validation.trim(req.body.provider, 30) || 'auto';
  const qrisString = validation.trim(req.body.qris_string, 2000);
  const merchantName = validation.trim(req.body.merchant_name, 60) || req.user.merchantName || 'MERCHANT';
  const merchantCity = validation.trim(req.body.merchant_city, 60) || '-';
  const imagePath = req.file ? `/uploads/qris/${req.file.filename}` : null;

  if (!qrisString) {
    req.flash('danger', 'String QRIS wajib diisi.');
    return res.redirect('/qris');
  }

  if (qrisString.length < 40) {
    req.flash('danger', 'String QRIS tidak valid. Pastikan memakai QRIS statis merchant.');
    return res.redirect('/qris');
  }

  await data.saveQris({
    provider: provider === 'auto' ? 'shopee' : provider,
    merchantName,
    merchantCity,
    qrisString,
    imagePath,
    makeActive: true,
  });

  req.flash('success', 'QRIS aktif diperbarui.');
  return res.redirect('/qris');
}));

/* Hapus QRIS aktif */
router.post('/delete', requireAuth, asyncHandler(async (req, res) => {
  const active = await data.getActiveQris();
  if (active) await data.removeQris(active.id);
  req.flash('success', 'QRIS aktif dihapus.');
  return res.redirect('/qris');
}));

/* Pengaturan pembayaran akun */
router.post('/settings', requireAuth, asyncHandler(async (req, res) => {
  const settings = await data.getSettings();
  const feePercent = Math.min(100, Math.max(0, Number(req.body.fee_percent) || 0));
  const uniqueDigits = validation.clampInt(req.body.unique_digits, { min: 1, max: 3, fallback: settings.uniqueDigits });
  const orderTtl = validation.clampInt(req.body.order_ttl, { min: 60, max: 86400, fallback: Math.round(settings.orderTtl / 60) }) * 60;
  const redirectUrl = validation.trim(req.body.redirect_url, 2048);

  if (redirectUrl && !validation.isHttpsUrl(redirectUrl)) {
    req.flash('danger', 'Redirect URL harus HTTPS dan valid.');
    return res.redirect('/qris');
  }

  const shopeeMode = ['fee', 'unique', 'hybrid'].includes(req.body.shopee_mode) ? req.body.shopee_mode : settings.shopeeMode;
  const gopayMode = ['fee', 'unique', 'hybrid'].includes(req.body.gopay_mode) ? req.body.gopay_mode : settings.gopayMode;

  await data.updateSettings({
    feePercent,
    uniqueDigits,
    orderTtl,
    redirectUrl,
    shopeeMode,
    shopeeFeeEnabled: shopeeMode === 'fee',
    shopeeUniqueEnabled: shopeeMode === 'unique',
    gopayMode,
    gopayFeeEnabled: gopayMode === 'fee',
    gopayUniqueEnabled: gopayMode === 'unique',
  });

  req.flash('success', 'Pengaturan pembayaran disimpan.');
  return res.redirect('/qris');
}));

/* Buat order manual dari dashboard */
router.post('/order', requireAuth, orderLimiter, asyncHandler(async (req, res) => {
  const baseAmount = money.parseRupiah(req.body.base_amount);
  const detection = await data.getDetection();
  const projectId = validation.trim(req.body.project_id, 40) || null;

  if (!money.isValidAmount(baseAmount)) {
    req.flash('danger', 'Nominal harus bilangan bulat rupiah lebih dari 0.');
    return res.redirect('/qris');
  }

  if (!detection.ready) {
    req.flash('danger', `Deteksi pembayaran belum siap untuk ${detection.providerLabel || 'provider aktif'}. Hubungkan akun merchant atau aktifkan aplikasi sumber di Malawali Listener sebelum membuat order LIVE.`);
    return res.redirect('/qris');
  }

  const ttlMinutes = validation.clampInt(req.body.ttl_minutes, { min: 1, max: 1440, fallback: 10 });
  const order = await data.createOrder({
    projectId,
    baseAmount,
    reference: validation.reference(req.body.reference),
    ttlMinutes,
  });

  req.flash('success', `Order ${order.id} dibuat. Total bayar ${money.formatRupiah(order.payAmount)}.`);
  return res.redirect(`/orders/${order.id}`);
}));

module.exports = router;
