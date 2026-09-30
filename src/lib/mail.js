'use strict';

const config = require('../config');
const brand = require('../config/brand');

/**
 * Pengiriman email. Di development `MAIL_TRANSPORT=console` → cukup cetak ke
 * terminal supaya link verifikasi / reset bisa diklik. Di produksi tinggal isi
 * SMTP_* dan transport otomatis memakai nodemailer.
 */
let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: config.mail.smtp.host,
    port: config.mail.smtp.port,
    secure: config.mail.smtp.port === 465,
    auth: config.mail.smtp.user
      ? { user: config.mail.smtp.user, pass: config.mail.smtp.pass }
      : undefined,
  });
  return transporter;
};

const send = async ({ to, subject, text, html }) => {
  if (config.mail.transport === 'console' || !config.mail.smtp.host) {
    /* eslint-disable no-console */
    console.log('\n──────── EMAIL (console transport) ────────');
    console.log(`To      : ${to}`);
    console.log(`Subject : ${subject}`);
    console.log('------------------------------------------');
    console.log(text);
    console.log('──────────────────────────────────────────\n');
    /* eslint-enable no-console */
    return { ok: true, transport: 'console' };
  }

  try {
    const info = await getTransporter().sendMail({
      from: config.mail.from,
      to,
      subject,
      text,
      html: html || `<pre>${text}</pre>`,
    });
    return { ok: true, transport: 'smtp', messageId: info.messageId };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[mail] gagal mengirim:', error.message);
    return { ok: false, error: error.message };
  }
};

const verificationEmail = (user, token) => {
  const link = `${config.baseUrl}/verify-email/${token}`;
  return send({
    to: user.email,
    subject: `Verifikasi email ${brand.name}`,
    text: [
      `Halo ${user.displayName || user.name || 'Merchant'},`,
      '',
      `Klik tautan berikut untuk memverifikasi email ${brand.name} Anda:`,
      link,
      '',
      'Tautan berlaku 24 jam. Abaikan email ini bila Anda tidak mendaftar.',
      '',
      `— ${brand.name}`,
    ].join('\n'),
  });
};

const resetEmail = (user, token) => {
  const link = `${config.baseUrl}/reset-password/${token}`;
  return send({
    to: user.email,
    subject: `Reset password ${brand.name}`,
    text: [
      `Halo ${user.displayName || user.name || 'Merchant'},`,
      '',
      'Kami menerima permintaan reset password. Klik tautan berikut:',
      link,
      '',
      'Tautan berlaku 60 menit. Abaikan email ini bila Anda tidak meminta reset.',
      '',
      `— ${brand.name}`,
    ].join('\n'),
  });
};

const subscriptionReminderEmail = (user, { daysLeft, until }) => {
  const untilLabel = until ? new Date(until).toLocaleDateString('id-ID') : '-';
  return send({
    to: user.email,
    subject: `Langganan ${brand.name} berakhir dalam ${daysLeft} hari`,
    text: [
      `Halo ${user.displayName || user.name || 'Merchant'},`,
      '',
      `Masa aktif langganan ${brand.name} Anda berakhir pada ${untilLabel} (${daysLeft} hari lagi).`,
      `Perpanjang di ${config.baseUrl}/subscription`,
      '',
      `— ${brand.name}`,
    ].join('\n'),
  });
};

module.exports = { send, verificationEmail, resetEmail, subscriptionReminderEmail };
