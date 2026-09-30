'use strict';

const express = require('express');

const config = require('../config');
const data = require('../data');
const validation = require('../lib/validation');
const asyncHandler = require('../lib/asyncHandler');
const qrisSvc = require('../services/qris.service');
const { apiLimiter } = require('../middleware/rateLimit');
const {
  fail,
  authenticateApiKey,
  requireSubscription,
  requireDefaultProject,
  providerDisabled,
} = require('../middleware/apiKey');

const router = express.Router();

/* Semua endpoint butuh API key + langganan aktif. */
router.use(apiLimiter, authenticateApiKey, requireSubscription);

const serializeOrder = (order) => ({
  id: order.id,
  status: order.status,
  provider: order.provider,
  base_amount: order.baseAmount,
  fee_amount: order.feeAmount,
  unique_code: order.uniqueCode,
  pay_amount: order.payAmount,
  qris: order.qris,
  checkout_url: order.checkoutUrl,
  reference_id: order.reference,
  expires_at: order.expiresAt,
  paid_at: order.paidAt,
  created_at: order.createdAt,
});

/* ══ POST /api/merchant/qris — simpan QRIS statis (Project Utama saja) ══ */
router.post(
  '/merchant/qris',
  requireDefaultProject,
  asyncHandler(async (req, res) => {
    const provider = validation.trim(req.body.provider, 30);
    const qrisRaw = validation.trim(req.body.qris, 4000);

    if (!provider) return fail(res, 'qris_provider_required');
    if (!qrisRaw) return fail(res, 'invalid_qris');

    let inspected;
    try {
      inspected = qrisSvc.inspectQris(qrisRaw);
    } catch (_) {
      return fail(res, 'invalid_qris');
    }

    if (!inspected || inspected.error) return fail(res, 'invalid_qris');
    if (!inspected.valid) return fail(res, 'invalid_qris');
    if (!inspected.isStatic) return fail(res, 'static_qris_required');
    if (await providerDisabled(provider)) return fail(res, 'payment_provider_disabled');

    const saved = await data.saveQrisForUser(req.api.user.id, {
      provider,
      merchantName: inspected.merchantName || 'MERCHANT',
      merchantCity: inspected.merchantCity || '-',
      qrisString: qrisRaw,
      makeActive: req.body.set_active !== false,
    });

    return res.json({
      ok: true,
      data: {
        provider: saved.provider,
        status: saved.status,
        qris_type: saved.qrisType,
        merchant_name: saved.merchantName,
        merchant_city: saved.merchantCity,
      },
    });
  })
);

/* ══ POST /api/merchant/settings — update setting akun ══ */
router.post(
  '/merchant/settings',
  requireDefaultProject,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const patch = {};

    if (body.fee_percent !== undefined) {
      const value = Number(body.fee_percent);
      if (!Number.isFinite(value) || value < 0 || value > 100) return fail(res, 'invalid_request');
      patch.feePercent = value;
    }

    if (body.unique_digits !== undefined) {
      const value = Number.parseInt(body.unique_digits, 10);
      if (!Number.isInteger(value) || value < 1 || value > 3) return fail(res, 'invalid_request');
      patch.uniqueDigits = value;
    }

    if (body.order_ttl !== undefined) {
      const value = Number.parseInt(body.order_ttl, 10);
      if (!Number.isInteger(value) || value < 60 || value > 86400) return fail(res, 'invalid_ttl');
      patch.orderTtl = value;
    }

    if (body.notify_url !== undefined) {
      const value = validation.trim(body.notify_url, 2048);
      if (value && !validation.isHttpsUrl(value)) return fail(res, 'invalid_request');
      patch.notifyUrl = value;
    }

    if (body.redirect_url !== undefined) {
      const value = validation.trim(body.redirect_url, 2048);
      if (value && !validation.isHttpsUrl(value)) return fail(res, 'invalid_request');
      patch.redirectUrl = value;
    }

    const applyMode = (field, modeField, feeField, uniqueField) => {
      if (!body[field]) return;
      if (!['fee', 'unique', 'hybrid'].includes(body[field])) return fail(res, 'invalid_request');
      patch[modeField] = body[field];
      patch[feeField] = body[field] === 'fee';
      patch[uniqueField] = body[field] === 'unique';
    };

    applyMode('shopee_mode', 'shopeeMode', 'shopeeFeeEnabled', 'shopeeUniqueEnabled');
    applyMode('gopay_mode', 'gopayMode', 'gopayFeeEnabled', 'gopayUniqueEnabled');

    const settings = Object.keys(patch).length
      ? await data.updateSettingsForUser(req.api.user.id, patch)
      : await data.getSettingsForUser(req.api.user.id);

    return res.json({
      ok: true,
      data: {
        fee_percent: settings.feePercent,
        unique_digits: settings.uniqueDigits,
        order_ttl: settings.orderTtl,
        notify_url: settings.notifyUrl,
        redirect_url: settings.redirectUrl,
        shopee_mode: settings.shopeeMode,
        gopay_mode: settings.gopayMode,
      },
    });
  })
);

/* ══ POST /api/orders — buat order baru ══ */
router.post(
  '/orders',
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    const baseAmount = Number.parseInt(body.base_amount, 10);
    if (!Number.isInteger(baseAmount) || baseAmount <= 0) return fail(res, 'invalid_base_amount');

    const ttl = body.ttl_seconds === undefined ? config.order.ttlDefault : Number.parseInt(body.ttl_seconds, 10);
    if (!Number.isInteger(ttl) || ttl < config.order.ttlMin || ttl > config.order.ttlMax) {
      return fail(res, 'invalid_ttl');
    }

    const notifyUrl = validation.trim(body.notify_url, 2048);
    if (notifyUrl && !validation.isHttpsUrl(notifyUrl)) return fail(res, 'invalid_request');

    const redirectUrl = validation.trim(body.redirect_url, 2048);
    if (redirectUrl && !validation.isHttpsUrl(redirectUrl)) return fail(res, 'invalid_request');

    const userId = req.api.user.id;
    const activeQris = await data.getActiveQrisForUser(userId);
    if (!activeQris) return fail(res, 'qris_not_configured');

    if (await providerDisabled(activeQris.provider)) return fail(res, 'payment_provider_disabled');

    const detection = await data.getDetectionForUser(userId);
    if (!detection.ready) return fail(res, 'detector_not_ready');

    const order = await data.createOrderForUser({
      userId,
      baseAmount,
      ttlSeconds: ttl,
      reference: validation.reference(body.reference_id),
      webhookUrl: notifyUrl || null,
      redirectUrl: redirectUrl || null,
      provider: activeQris.provider,
    });

    return res.status(201).json({ ok: true, data: serializeOrder(order) });
  })
);

/* ══ GET /api/orders/:id — cek status ══ */
router.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const order = await data.getOrderForUser(req.api.user.id, req.params.id);
    if (!order) return fail(res, 'order_not_found');
    return res.json({ ok: true, data: serializeOrder(order) });
  })
);

/* ══ POST /api/orders/:id/cancel — batalkan order ══ */
router.post(
  '/orders/:id/cancel',
  asyncHandler(async (req, res) => {
    const result = await data.cancelOrderForUser(req.api.user.id, req.params.id);
    if (!result.ok) {
      return fail(res, result.reason === 'not_pending' ? 'order_not_pending' : 'order_not_found');
    }
    return res.json({ ok: true, data: serializeOrder(result.order) });
  })
);

module.exports = router;
