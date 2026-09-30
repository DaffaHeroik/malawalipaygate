'use strict';

const brand = require('../config/brand');
const config = require('../config');
const constants = require('../config/constants');
const money = require('../lib/money');
const datetime = require('../lib/datetime');
const validation = require('../lib/validation');

/**
 * Variabel & helper yang otomatis tersedia di semua view.
 * View cukup pakai: <%= helpers.formatRupiah(order.payAmount) %>
 */
const locals = () => (req, res, next) => {
  res.locals.brand = brand;
  res.locals.constants = constants;
  res.locals.nav = constants.NAV;
  res.locals.icons = constants.ICONS;

  res.locals.helpers = {
    formatRupiah: money.formatRupiah,
    formatNumber: money.formatNumber,
    parseRupiah: money.parseRupiah,
    formatDateTime: datetime.formatDateTime,
    formatDate: datetime.formatDate,
    formatDateLong: datetime.formatDateLong,
    formatDayShort: datetime.formatDayShort,
    formatCountdown: datetime.formatCountdown,
    timeAgo: datetime.timeAgo,
    toIso: datetime.toIso,
    initials: validation.initials,
  };

  res.locals.app = {
    name: brand.name,
    tagline: brand.tagline,
    env: config.env,
    dataSource: config.dataSource,
    turnstile: {
      enabled: !config.turnstile.disabled && Boolean(config.turnstile.siteKey),
      siteKey: config.turnstile.siteKey,
    },
    googleEnabled: config.google.enabled,
    isProd: config.isProd,
  };

  res.locals.currentPath = req.path;
  res.locals.query = req.query || {};
  res.locals.user = req.user || null;
  res.locals.pageTitle = '';
  res.locals.page = {};
  res.locals.layout = res.locals.layout || 'layouts/public';

  // helper "aktif" untuk sidebar
  res.locals.isActive = (href, exact = false) => {
    if (!href) return false;
    if (exact) return req.path === href;
    if (href === '/dashboard') return req.path === '/dashboard';
    return req.path === href || req.path.startsWith(`${href}/`);
  };

  next();
};

module.exports = locals;
