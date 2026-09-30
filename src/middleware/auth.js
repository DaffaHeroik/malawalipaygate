'use strict';

const config = require('../config');
const data = require('../data');
const context = require('../lib/context');

const isMockMode = () => config.dataSource === 'mock';

/**
 * Memuat user yang login.
 * - Mode mock: otomatis dianggap login sebagai user demo supaya UI bisa direview.
 * - Mode db: baca `session.userId`, ambil dari DB, lalu jalankan sisa request di
 *   dalam AsyncLocalStorage supaya lapisan data tahu user mana yang aktif.
 */
const loadUser = async (req, res, next) => {
  if (isMockMode()) {
    const demo = data.getUser();
    req.user = demo;
    if (req.session) req.session.userId = demo.id;
    res.locals.user = demo;
    return next();
  }

  const userId = req.session?.userId;

  if (!userId) {
    req.user = null;
    res.locals.user = null;
    return context.runWithContext(context.createRequestContext({ userId: null }), () => next());
  }

  try {
    req.user = await data.getUserById(userId);
  } catch {
    req.user = null;
  }

  if (!req.user) {
    // Sesi menunjuk user yang sudah tidak ada → bersihkan.
    if (req.session) delete req.session.userId;
  }

  res.locals.user = req.user;

  const ctx = context.createRequestContext({
    userId: req.user ? req.user.id : null,
    user: req.user,
    role: req.user ? req.user.role : null,
  });

  return context.runWithContext(ctx, () => next());
};

const requireAuth = (req, res, next) => {
  if (req.user) return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: { code: 'invalid_api_key', message: 'Autentikasi diperlukan.' } });
  }
  const back = encodeURIComponent(req.originalUrl || '/dashboard');
  return res.redirect(`/login?next=${back}`);
};

const requireGuest = (req, res, next) => {
  // Di mode mock halaman login tetap boleh dibuka (biar bisa direview).
  if (isMockMode()) return next();
  if (req.user) return res.redirect('/dashboard');
  return next();
};

const requireVerified = (req, res, next) => {
  if (!req.user) return requireAuth(req, res, next);
  if (req.user.emailVerified) return next();
  req.flash('warning', 'Verifikasi email dulu untuk memakai fitur ini.');
  return res.redirect('/settings?tab=profile');
};

const requireAdmin = (req, res, next) => {
  if (!req.user) return requireAuth(req, res, next);
  if (req.user.role === 'admin') return next();
  const err = new Error('Halaman ini hanya untuk administrator.');
  err.status = 403;
  return next(err);
};

/** Dipakai di halaman Pengaturan: API key baru bisa dibuat setelah email verified. */
const canManageApiKey = (user) => Boolean(user && user.emailVerified);

module.exports = {
  loadUser,
  requireAuth,
  requireGuest,
  requireVerified,
  requireAdmin,
  canManageApiKey,
  isMockMode,
};
