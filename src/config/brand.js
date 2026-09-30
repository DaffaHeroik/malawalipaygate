'use strict';

/**
 * Semua teks & path yang berbau brand dikumpulkan di sini supaya kalau nama
 * brand berubah, nggak perlu ngubek-ngubek view satu per satu.
 */
const brand = {
  name: process.env.APP_NAME || 'Malawali Payment',
  shortName: 'Malawali',
  panelName: 'Merchant Panel',
  tagline: 'Payment Gateway QRIS Indonesia',
  footerNote: 'Fintech SaaS',
  supportLabel: 'Contact Support',
  supportPlatform: 'Telegram',
  supportUrl: process.env.SUPPORT_URL || 'https://t.me/malawali_payment_bot',
  copyrightYear: 2026,
  logoWordmark: '/brand/logo.svg',
  logoLight: '/brand/logo-light.svg',
  logoIcon: '/brand/logo-icon.svg',
  favicon: '/brand/favicon.svg',
  themeStorageKey: 'malawali.theme',
  /** Prefix API key. Netral, tidak mengandung nama brand. */
  apiKeyPrefix: 'pk_live_',
  orderIdPrefix: 'pay_',
  eventIdPrefix: 'evt_',
};

module.exports = brand;
