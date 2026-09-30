'use strict';

const config = require('../config');
const constants = require('../config/constants');
const data = require('../data');
const apikey = require('../services/apikey.service');

/** Balas error sesuai tabel API_ERRORS. */
const fail = (res, code, messageOverride) => {
  const meta = constants.API_ERRORS[code] || { status: 400, message: code };
  return res.status(meta.status).json({
    ok: false,
    error: { code, message: messageOverride || meta.message },
  });
};

const readKey = (req) => req.get('x-api-key') || '';

/**
 * Autentikasi REST API memakai header `x-api-key: pk_live_…`.
 * Menempelkan `req.api = { user, project }`.
 */
const authenticateApiKey = async (req, res, next) => {
  try {
    if (config.dataSource !== 'db') {
      return fail(res, 'invalid_api_key', 'REST API memerlukan DATA_SOURCE=db.');
    }

    const key = String(readKey(req)).trim();
    if (!key) return fail(res, 'invalid_api_key');
    if (!apikey.isLiveKey(key)) return fail(res, 'live_key_required');

    const found = await data.findUserByApiKey(key);
    if (!found) return fail(res, 'invalid_api_key');

    req.api = { user: found.user, project: found.project, rawProject: found.rawProject };

    // usage tracking (non-blocking)
    data.markApiKeyUsed(String(found.rawProject._id)).catch(() => {});

    return next();
  } catch (error) {
    return next(error);
  }
};

/** Langganan aktif wajib untuk memakai REST API. */
const requireSubscription = async (req, res, next) => {
  try {
    const subscription = await data.getSubscriptionForUser(req.api.user.id);
    if (!subscription.active) return fail(res, 'subscription_required');
    return next();
  } catch (error) {
    return next(error);
  }
};

/** Endpoint pengaturan akun hanya boleh memakai API key Project Utama. */
const requireDefaultProject = (req, res, next) => {
  if (!req.api?.project?.isDefault) return fail(res, 'default_project_key_required');
  return next();
};

/** True bila provider sedang dinonaktifkan administrator. */
const providerDisabled = async (provider) => {
  const models = require('../models');
  const setting = await models.AppSetting.findOne({ key: 'global' });
  return (setting?.disabledProviders || []).includes(provider);
};

module.exports = {
  fail,
  authenticateApiKey,
  requireSubscription,
  requireDefaultProject,
  providerDisabled,
};
