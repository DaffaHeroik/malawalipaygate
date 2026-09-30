'use strict';

const express = require('express');
const { authenticator } = require('otplib');

const data = require('../data');
const config = require('../config');
const { requireAuth, canManageApiKey } = require('../middleware/auth');
const asyncHandler = require('../lib/asyncHandler');
const validation = require('../lib/validation');
const passwordLib = require('../lib/password');
const mail = require('../lib/mail');
const qr = require('../lib/qr');
const models = require('../models');
const audit = require('../services/audit.service');

const router = express.Router();

const TABS = ['profile', 'api-key', 'webhook', 'password', 'twofa'];

const renderPage = async (req, res, extra = {}) => {
  const requested = String(req.query.tab || extra.tab || 'profile');
  const tab = TABS.includes(requested) ? requested : 'profile';
  const user = await data.getUser();

  return res.render('pages/app/settings/index', {
    layout: 'layouts/shell',
    pageTitle: 'Pengaturan',
    pageEyebrow: 'Akun',
    metaDescription: 'Kelola profil, API key, webhook, dan keamanan akun dari satu tempat.',
    user,
    tab,
    tabs: TABS,
    settings: await data.getSettings(),
    projects: await data.listProjects(),
    subscription: await data.getSubscription(),
    apiBaseUrl: `${config.baseUrl}/api`,
    canManageApiKey: canManageApiKey(user),
    ...extra,
  });
};

router.get('/', requireAuth, asyncHandler(async (req, res) => renderPage(req, res)));

/* ── Profil ── */
router.post('/profile', requireAuth, asyncHandler(async (req, res) => {
  const displayName = validation.trim(req.body.display_name, 60);
  const merchantName = validation.trim(req.body.merchant_name, 60);

  if (!displayName) {
    req.flash('danger', 'Nama tampilan wajib diisi.');
    return res.redirect('/settings?tab=profile');
  }

  await models.User.findByIdAndUpdate(req.user.id, {
    $set: { displayName, name: displayName, merchantName },
  });

  audit.recordRequest(req, 'settings.profile_update', { targetType: 'user', targetId: req.user.id });
  req.flash('success', 'Profil diperbarui.');
  return res.redirect('/settings?tab=profile');
}));

router.post('/profile/verify-email', requireAuth, asyncHandler(async (req, res) => {
  const user = await models.User.findById(req.user.id);
  if (user && !user.emailVerified) {
    const token = passwordLib.randomToken(32);
    user.verifyTokenHash = passwordLib.hashToken(token);
    user.verifyTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();
    await mail.verificationEmail({ email: user.email, displayName: user.displayName }, token);
  }
  req.flash('info', 'Tautan verifikasi dikirim ke email akun.');
  return res.redirect('/settings?tab=profile');
}));

/* ── API Key ── */
router.post('/api-key/rotate', requireAuth, asyncHandler(async (req, res) => {
  const user = await data.getUser();

  if (!canManageApiKey(user)) {
    req.flash('danger', 'Verifikasi email dulu sebelum membuat API key.');
    return res.redirect('/settings?tab=api-key');
  }

  const subscription = await data.getSubscription();
  if (!subscription.active) {
    req.flash('danger', 'Langganan aktif diperlukan untuk membuat API key.');
    return res.redirect('/settings?tab=api-key');
  }

  const password = validation.trim(req.body.password, 200);
  if (!password) {
    req.flash('danger', 'Password akun wajib diisi untuk membuat ulang API key.');
    return res.redirect('/settings?tab=api-key');
  }

  const userDoc = await models.User.findById(req.user.id);
  const ok = userDoc && (await passwordLib.verifyPassword(password, userDoc.passwordHash));
  if (!ok) {
    req.flash('danger', 'Password akun salah.');
    return res.redirect('/settings?tab=api-key');
  }

  const result = await data.rotateApiKey(validation.trim(req.body.project_id, 40));
  if (!result) {
    req.flash('danger', 'Project tidak ditemukan.');
    return res.redirect('/settings?tab=api-key');
  }

  audit.recordRequest(req, 'settings.api_key_rotate', {
    targetType: 'project',
    targetId: result.project.id,
    meta: { project: result.project.name },
  });
  req.flash('success', 'API key baru dibuat. Salin sekarang — key lama sudah tidak berlaku.');
  return renderPage(req, res, { tab: 'api-key', revealedKey: result.fullKey, revealedProject: result.project.name });
}));

/* ── Webhook ── */
router.post('/webhook/secret', requireAuth, asyncHandler(async (req, res) => {
  const secret = await data.rotateWebhookSecret();
  audit.recordRequest(req, 'settings.webhook_secret_rotate', { targetType: 'account' });
  req.flash('success', 'Webhook Secret diperbarui. Perbarui juga di server aplikasi Anda.');
  return renderPage(req, res, { tab: 'webhook', revealedSecret: secret });
}));

router.post('/webhook/save', requireAuth, asyncHandler(async (req, res) => {
  const projectId = validation.trim(req.body.project_id, 40);
  const url = validation.trim(req.body.webhook_url, 2048);

  if (url && !validation.isHttpsUrl(url, { maxLength: 2048 })) {
    req.flash('danger', 'Webhook URL harus HTTPS dan maksimal 2048 karakter.');
    return res.redirect('/settings?tab=webhook');
  }

  const project = await data.saveProjectWebhook(projectId, url);
  if (project) audit.recordRequest(req, 'settings.webhook_save', { targetType: 'project', targetId: projectId });
  req.flash(project ? 'success' : 'danger', project ? 'Webhook project disimpan.' : 'Project tidak ditemukan.');
  return res.redirect('/settings?tab=webhook');
}));

router.post('/webhook/test', requireAuth, asyncHandler(async (req, res) => {
  const project = await data.getProject(validation.trim(req.body.project_id, 40));

  if (!project?.webhookUrl) {
    req.flash('danger', 'Simpan Webhook URL dulu sebelum mengirim test.');
    return res.redirect('/settings?tab=webhook');
  }

  req.flash('success', `Event webhook.test dikirim ke ${project.webhookUrl}.`);
  return res.redirect('/settings?tab=webhook');
}));

/* ── Password ── */
router.post('/password', requireAuth, asyncHandler(async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const confirm = String(req.body.confirm_password || '');

  const errors = [];
  if (!current) errors.push('Password lama wajib diisi.');
  errors.push(...validation.passwordIssues(next));
  if (next !== confirm) errors.push('Konfirmasi password baru tidak sama.');

  if (errors.length) {
    req.flash('danger', errors.join(' '));
    return res.redirect('/settings?tab=password');
  }

  const userDoc = await models.User.findById(req.user.id);
  const ok = userDoc && (await passwordLib.verifyPassword(current, userDoc.passwordHash));
  if (!ok) {
    req.flash('danger', 'Password lama salah.');
    return res.redirect('/settings?tab=password');
  }

  userDoc.passwordHash = await passwordLib.hashPassword(next);
  await userDoc.save();

  audit.recordRequest(req, 'settings.password_change', { targetType: 'user', targetId: req.user.id });
  req.flash('success', 'Password diperbarui.');
  return res.redirect('/settings?tab=password');
}));

/* ── 2FA ── */
router.post('/twofa/enable', requireAuth, asyncHandler(async (req, res) => {
  const user = await data.getUser();
  const code = validation.trim(req.body.code, 6).replace(/\D/g, '');
  const userDoc = await models.User.findById(req.user.id);

  if (!userDoc) {
    req.flash('danger', 'Akun tidak ditemukan.');
    return res.redirect('/settings?tab=twofa');
  }

  // Tahap 1: belum ada kode → tampilkan QR + secret.
  if (!user.twoFactorEnabled && !code) {
    const secret = authenticator.generateSecret();
    userDoc.totpSecret = secret;
    await userDoc.save();

    const otpauth = authenticator.keyuri(user.email, res.locals.brand.name, secret);
    const qrDataUrl = await qr.toDataUrl(otpauth, { size: 200 });

    return renderPage(req, res, {
      tab: 'twofa',
      twoFactorSetup: { secret, otpauth, qrDataUrl },
    });
  }

  if (code.length !== 6) {
    req.flash('danger', 'Kode autentikator harus 6 digit.');
    return res.redirect('/settings?tab=twofa');
  }

  if (!userDoc.totpSecret || !authenticator.check(code, userDoc.totpSecret)) {
    req.flash('danger', 'Kode autentikator tidak valid. Coba lagi.');
    return res.redirect('/settings?tab=twofa');
  }

  userDoc.totpEnabled = true;
  await userDoc.save();

  audit.recordRequest(req, 'settings.2fa_enable', { targetType: 'user', targetId: req.user.id });
  req.flash('success', '2FA diaktifkan. Login berikutnya memerlukan kode autentikator.');
  return res.redirect('/settings?tab=twofa');
}));

router.post('/twofa/disable', requireAuth, asyncHandler(async (req, res) => {
  await models.User.findByIdAndUpdate(req.user.id, {
    $set: { totpEnabled: false, totpSecret: null },
  });
  audit.recordRequest(req, 'settings.2fa_disable', { targetType: 'user', targetId: req.user.id });
  req.flash('success', '2FA dinonaktifkan.');
  return res.redirect('/settings?tab=twofa');
}));

module.exports = router;
