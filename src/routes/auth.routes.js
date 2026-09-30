'use strict';

const express = require('express');
const { authenticator } = require('otplib');

const config = require('../config');
const data = require('../data');
const models = require('../models');
const { requireGuest } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const turnstile = require('../middleware/turnstile');
const asyncHandler = require('../lib/asyncHandler');
const validation = require('../lib/validation');
const passwordLib = require('../lib/password');
const mail = require('../lib/mail');
const audit = require('../services/audit.service');
const google = require('../services/google.service');

const router = express.Router();

const turnstileView = () => ({
  turnstileEnabled: !config.turnstile.disabled && Boolean(config.turnstile.siteKey),
  turnstileSiteKey: config.turnstile.siteKey,
});

/** Hanya izinkan redirect internal. */
const safeNext = (value) => {
  const raw = String(value || '');
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
};

/* ── Masuk ── */
router.get('/login', requireGuest, (req, res) => {
  res.render('pages/auth/login', {
    layout: 'layouts/auth',
    pageTitle: 'Masuk',
    metaDescription: 'Masuk ke dashboard merchant.',
    next: safeNext(req.query.next),
    email: '',
    error: null,
    twoFactorRequired: false,
    googleEnabled: config.google.enabled,
    ...turnstileView(),
  });
});

router.post('/login', authLimiter, turnstile.guard('/login'), requireGuest, asyncHandler(async (req, res) => {
  const email = validation.normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const nextUrl = safeNext(req.body.next);

  const renderError = (message, twoFactorRequired = false) =>
    res.status(400).render('pages/auth/login', {
      layout: 'layouts/auth',
      pageTitle: 'Masuk',
      next: nextUrl,
      email,
      error: message,
      twoFactorRequired,
      googleEnabled: config.google.enabled,
      ...turnstileView(),
    });

  if (!validation.isEmail(email)) return renderError('Format email tidak valid.');
  if (!password) return renderError('Password wajib diisi.');

  // Fase UI (mock): belum ada autentikasi nyata, langsung masuk sebagai demo.
  if (config.dataSource === 'mock') return res.redirect(nextUrl);

  const user = await data.getUserByEmail(email);
  const valid = user && user.passwordHash && (await passwordLib.verifyPassword(password, user.passwordHash));

  if (!valid) {
    audit.recordRequest(req, 'auth.login_failed', { targetType: 'user', meta: { email } });
    return renderError('Email atau password salah.');
  }

  if (user.totpEnabled) {
    const code = validation.trim(req.body.totp, 6).replace(/\D/g, '');
    if (!code) return renderError('Masukkan kode autentikator 2FA.', true);
    if (!user.totpSecret || !authenticator.check(code, user.totpSecret)) {
      audit.recordRequest(req, 'auth.2fa_failed', { userId: String(user._id), targetType: 'user', targetId: user._id });
      return renderError('Kode autentikator tidak valid.', true);
    }
  }

  user.lastLoginAt = new Date();
  await user.save();

  req.session.userId = String(user._id);
  audit.recordRequest(req, 'auth.login', { userId: String(user._id), targetType: 'user', targetId: user._id });
  return res.redirect(nextUrl);
}));

/* ── Daftar ── */
router.get('/register', requireGuest, (req, res) => {
  res.render('pages/auth/register', {
    layout: 'layouts/auth',
    pageTitle: 'Daftar',
    metaDescription: 'Buat akun merchant baru.',
    email: '',
    error: null,
    sent: false,
    googleEnabled: config.google.enabled,
    ...turnstileView(),
  });
});

router.post('/register', authLimiter, turnstile.guard('/register'), requireGuest, asyncHandler(async (req, res) => {
  const email = validation.normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  const errors = [];
  if (!validation.isEmail(email)) errors.push('Format email tidak valid.');
  errors.push(...validation.passwordIssues(password));

  const renderRegister = (error, sent) =>
    res.status(error ? 400 : 200).render('pages/auth/register', {
      layout: 'layouts/auth',
      pageTitle: 'Daftar',
      email,
      error,
      sent,
      googleEnabled: config.google.enabled,
      ...turnstileView(),
    });

  if (errors.length) return renderRegister(errors.join(' '), false);

  if (config.dataSource === 'mock') return renderRegister(null, true);

  const existing = await data.getUserByEmail(email);
  if (existing) {
    // Jangan bocorkan keberadaan akun: tetap tampilkan "cek email".
    return renderRegister(null, true);
  }

  const displayName = email.split('@')[0].slice(0, 40);
  const token = passwordLib.randomToken(32);

  const user = await models.User.create({
    email,
    passwordHash: await passwordLib.hashPassword(password),
    name: displayName,
    displayName,
    merchantName: '',
    emailVerified: false,
    verifyTokenHash: passwordLib.hashToken(token),
    verifyTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  // Fondasi akun: pengaturan merchant + Project Utama.
  await models.MerchantSettings.create({ userId: user._id });
  await models.Project.create({ userId: user._id, name: 'Project Utama', isDefault: true });

  await mail.verificationEmail({ email: user.email, displayName: user.displayName }, token);
  audit.recordRequest(req, 'auth.register', { userId: String(user._id), targetType: 'user', targetId: user._id });

  return renderRegister(null, true);
}));

/* ── Verifikasi email ── */
router.get('/verify-email/:token', asyncHandler(async (req, res) => {
  if (config.dataSource === 'mock') {
    req.flash('success', 'Email berhasil diverifikasi. Silakan masuk.');
    return res.redirect('/login');
  }

  const hash = passwordLib.hashToken(req.params.token);
  const user = await models.User.findOne({ verifyTokenHash: hash });

  if (!user || !user.verifyTokenExpiresAt || user.verifyTokenExpiresAt.getTime() < Date.now()) {
    req.flash('danger', 'Tautan verifikasi tidak valid atau sudah kedaluwarsa.');
    return res.redirect('/login');
  }

  user.emailVerified = true;
  user.verifyTokenHash = null;
  user.verifyTokenExpiresAt = null;
  await user.save();

  audit.recordRequest(req, 'auth.email_verified', { userId: String(user._id), targetType: 'user', targetId: user._id });
  req.flash('success', 'Email berhasil diverifikasi. Silakan masuk.');
  return res.redirect('/login');
}));

/* ── Lupa password ── */
router.get('/forgot-password', requireGuest, (req, res) => {
  res.render('pages/auth/forgot-password', {
    layout: 'layouts/auth',
    pageTitle: 'Lupa Password',
    email: '',
    sent: false,
    error: null,
    ...turnstileView(),
  });
});

router.post('/forgot-password', authLimiter, turnstile.guard('/forgot-password'), requireGuest, asyncHandler(async (req, res) => {
  const email = validation.normalizeEmail(req.body.email);
  const valid = validation.isEmail(email);

  if (valid && config.dataSource !== 'mock') {
    const user = await models.User.findOne({ email });
    if (user) {
      const token = passwordLib.randomToken(32);
      user.resetTokenHash = passwordLib.hashToken(token);
      user.resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
      await mail.resetEmail({ email: user.email, displayName: user.displayName }, token);
    }
  }

  res.render('pages/auth/forgot-password', {
    layout: 'layouts/auth',
    pageTitle: 'Lupa Password',
    email,
    sent: valid,
    error: valid ? null : 'Format email tidak valid.',
    ...turnstileView(),
  });
}));

/* ── Reset password ── */
router.get('/reset-password/:token', requireGuest, (req, res) => {
  res.render('pages/auth/reset-password', {
    layout: 'layouts/auth',
    pageTitle: 'Reset Password',
    token: req.params.token,
    error: null,
    done: false,
  });
});

router.post('/reset-password/:token', authLimiter, requireGuest, asyncHandler(async (req, res) => {
  const password = String(req.body.password || '');
  const confirm = String(req.body.password_confirm || '');
  const issues = validation.passwordIssues(password);

  if (confirm !== password) issues.push('Konfirmasi password tidak sama.');

  if (issues.length) {
    return res.status(400).render('pages/auth/reset-password', {
      layout: 'layouts/auth',
      pageTitle: 'Reset Password',
      token: req.params.token,
      error: issues.join(' '),
      done: false,
    });
  }

  if (config.dataSource === 'mock') {
    return res.render('pages/auth/reset-password', {
      layout: 'layouts/auth',
      pageTitle: 'Reset Password',
      token: req.params.token,
      error: null,
      done: true,
    });
  }

  const hash = passwordLib.hashToken(req.params.token);
  const user = await models.User.findOne({ resetTokenHash: hash });

  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() < Date.now()) {
    return res.status(400).render('pages/auth/reset-password', {
      layout: 'layouts/auth',
      pageTitle: 'Reset Password',
      token: req.params.token,
      error: 'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.',
      done: false,
    });
  }

  user.passwordHash = await passwordLib.hashPassword(password);
  user.resetTokenHash = null;
  user.resetTokenExpiresAt = null;
  await user.save();

  audit.recordRequest(req, 'auth.password_reset', { userId: String(user._id), targetType: 'user', targetId: user._id });

  return res.render('pages/auth/reset-password', {
    layout: 'layouts/auth',
    pageTitle: 'Reset Password',
    token: req.params.token,
    error: null,
    done: true,
  });
}));

/* ── Google OAuth ── */
router.get('/auth/google', (req, res) => {
  const intent = req.query.intent === 'register' ? 'register' : 'login';

  if (!google.isEnabled() || config.dataSource !== 'db') {
    req.flash('warning', 'Login Google belum diaktifkan. Pakai email dan password dulu.');
    return res.redirect(intent === 'register' ? '/register' : '/login');
  }

  const state = google.createState();
  req.session.googleOAuthState = state;
  req.session.googleOAuthIntent = intent;
  return res.redirect(google.buildAuthUrl(state));
});

router.get('/auth/google/callback', asyncHandler(async (req, res) => {
  const failAndGo = (message) => {
    req.flash('danger', message);
    return res.redirect('/login');
  };

  if (!google.isEnabled() || config.dataSource !== 'db') {
    return failAndGo('Login Google belum diaktifkan.');
  }

  if (req.query.error) return failAndGo('Login Google dibatalkan.');

  const state = String(req.query.state || '');
  const expected = req.session.googleOAuthState;
  delete req.session.googleOAuthState;
  delete req.session.googleOAuthIntent;

  if (!state || !expected || state !== expected) {
    return failAndGo('Sesi login Google tidak valid. Coba lagi.');
  }

  const exchanged = await google.exchangeCode(req.query.code);
  if (!exchanged.ok) return failAndGo('Gagal menukar kode Google.');

  const profile = await google.fetchProfile(exchanged.tokens.access_token);
  if (!profile?.email) return failAndGo('Gagal membaca profil Google.');

  const email = validation.normalizeEmail(profile.email);
  let user = await models.User.findOne({ email });
  let created = false;

  if (!user) {
    const displayName = (profile.name || email.split('@')[0]).slice(0, 60);
    user = await models.User.create({
      email,
      googleId: profile.sub || null,
      name: displayName,
      displayName,
      merchantName: '',
      emailVerified: profile.emailVerified,
    });
    await models.MerchantSettings.create({ userId: user._id });
    await models.Project.create({ userId: user._id, name: 'Project Utama', isDefault: true });
    created = true;
  } else if (!user.googleId && profile.sub) {
    user.googleId = profile.sub;
  }

  user.lastLoginAt = new Date();
  await user.save();

  req.session.userId = String(user._id);
  audit.recordRequest(req, created ? 'auth.register_google' : 'auth.login_google', {
    userId: String(user._id),
    targetType: 'user',
    targetId: user._id,
  });

  return res.redirect('/dashboard');
}));

module.exports = router;
