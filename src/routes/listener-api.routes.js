'use strict';

const express = require('express');

const config = require('../config');
const data = require('../data');
const asyncHandler = require('../lib/asyncHandler');
const listenerSvc = require('../services/listener.service');
const { apiLimiter } = require('../middleware/rateLimit');
const {
  fail,
  authenticateApiKey,
  requireSubscription,
  requireDefaultProject,
  providerDisabled,
} = require('../middleware/apiKey');

/**
 * REST API untuk aplikasi Android **Malawali Listener**.
 *
 *  - Merchant mendaftarkan perangkat dengan API key (x-api-key).
 *  - APK mengirim notifikasi pembayaran dengan device token (x-device-token).
 *
 * Endpoint ini selalu memerlukan DATA_SOURCE=db (middleware API key menolak
 * mode mock).
 */
const router = express.Router();

const readDeviceToken = (req) =>
  String(req.get('x-device-token') || req.body?.device_token || '').trim();

/** Autentikasi perangkat lewat device token. Menempelkan `req.device`. */
const authenticateDevice = asyncHandler(async (req, res, next) => {
  if (config.dataSource !== 'db') {
    return fail(res, 'invalid_api_key', 'Listener API memerlukan DATA_SOURCE=db.');
  }

  const token = readDeviceToken(req);
  if (!token || !listenerSvc.isDeviceToken(token)) {
    return res.status(401).json({
      ok: false,
      error: { code: 'invalid_device_token', message: 'Device token tidak valid.' },
    });
  }

  const found = await data.findListenerDeviceByToken(token);
  if (!found) {
    return res.status(401).json({
      ok: false,
      error: { code: 'invalid_device_token', message: 'Device token tidak dikenali atau sudah dicabut.' },
    });
  }

  req.device = found.device;
  req.deviceUserId = found.userId;
  return next();
});

/* ══ Registrasi perangkat (API key Project Utama) ══ */
router.post(
  '/register',
  apiLimiter,
  authenticateApiKey,
  requireSubscription,
  requireDefaultProject,
  asyncHandler(async (req, res) => {
    const payload = listenerSvc.normalizeRegistration(req.body || {});

    const result = await data.registerListenerDeviceForUser(req.api.user.id, payload);
    if (!result) return fail(res, 'invalid_request');

    return res.status(201).json({
      ok: true,
      data: {
        device: result.device,
        device_token: result.token,
        token_preview: result.tokenPreview,
        token_issued: Boolean(result.token),
        note: result.token
          ? 'Simpan device_token sekarang; hanya ditampilkan sekali.'
          : 'Perangkat sudah terdaftar; device_token lama tetap berlaku.',
      },
    });
  })
);

/* ══ Daftar perangkat milik akun ══ */
router.get(
  '/devices',
  apiLimiter,
  authenticateApiKey,
  requireSubscription,
  asyncHandler(async (req, res) => {
    const devices = await data.listListenerDevicesForUser(req.api.user.id);
    return res.json({ ok: true, data: { devices } });
  })
);

/* ══ Cabut perangkat ══ */
router.post(
  '/devices/:deviceId/revoke',
  apiLimiter,
  authenticateApiKey,
  requireSubscription,
  asyncHandler(async (req, res) => {
    const removed = await data.revokeListenerDeviceForUser(req.api.user.id, req.params.deviceId);
    if (!removed) return fail(res, 'invalid_request', 'Perangkat tidak ditemukan.');
    return res.json({ ok: true, data: { revoked: true, device_id: req.params.deviceId } });
  })
);

/* ══ Heartbeat perangkat (device token) ══ */
router.get(
  '/me',
  apiLimiter,
  authenticateDevice,
  asyncHandler(async (req, res) => {
    await data.recordListenerActivity(req.device.deviceId, { push: false });
    return res.json({ ok: true, data: { device: req.device } });
  })
);

/* ══ Push pembayaran dari notifikasi (device token) ══ */
router.post(
  '/push',
  apiLimiter,
  authenticateDevice,
  asyncHandler(async (req, res) => {
    const payload = listenerSvc.normalizePayment(req.body || {});

    if (!payload.provider || !payload.providerTransactionId) return fail(res, 'invalid_request');
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) return fail(res, 'invalid_request');

    if (req.device.enabledSources.length && !req.device.enabledSources.includes(payload.provider)) {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'source_not_enabled',
          message: `Sumber ${payload.provider} belum diaktifkan pada perangkat ini.`,
        },
      });
    }

    if (await providerDisabled(payload.provider)) return fail(res, 'payment_provider_disabled');

    const result = await data.ingestListenerPayment({
      userId: req.deviceUserId,
      provider: payload.provider,
      providerTransactionId: payload.providerTransactionId,
      amount: payload.amount,
      occurredAt: payload.occurredAt,
      raw: payload.raw,
    });

    await data.recordListenerActivity(req.device.deviceId, { push: true });

    return res.json({
      ok: true,
      data: {
        matched: Boolean(result.matched),
        order_id: result.orderId || null,
        reason: result.reason || null,
      },
    });
  })
);

module.exports = router;
