'use strict';

/**
 * Simulasi pembayaran masuk (mock provider) untuk uji end-to-end tanpa provider asli.
 *
 * Pakai:
 *   node scripts/fake-payment.js --order pay_xxxx        # dari order pending
 *   node scripts/fake-payment.js --amount 25000 --provider shopee
 *   node scripts/fake-payment.js --order pay_xxxx --tx TRX123 --occurred "2026-09-27T10:00:00Z"
 */

const config = require('../src/config');
const models = require('../src/models');
const { processPayment } = require('../src/services/matching.service');

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
};

const run = async () => {
  if (config.dataSource !== 'db') {
    // eslint-disable-next-line no-console
    console.error('fake-payment butuh DATA_SOURCE=db.');
    process.exit(1);
  }

  const { connect, disconnect } = require('../src/db/connect');
  await connect();

  const orderId = arg('order');
  let provider = arg('provider');
  let amount = arg('amount') ? Number.parseInt(arg('amount'), 10) : null;
  let occurredAt = arg('occurred') ? new Date(arg('occurred')) : new Date();

  if (orderId) {
    const order = await models.Order.findOne({ orderId });
    if (!order) {
      // eslint-disable-next-line no-console
      console.error(`Order ${orderId} tidak ditemukan.`);
      await disconnect();
      process.exit(1);
    }
    provider = provider || order.provider;
    amount = amount || order.payAmount;
    if (!occurredAt || Number.isNaN(occurredAt.getTime())) occurredAt = new Date(order.createdAt.getTime() + 30000);
  }

  if (!provider || !amount) {
    // eslint-disable-next-line no-console
    console.error('Butuh --order <pay_...> ATAU (--provider dan --amount).');
    await disconnect();
    process.exit(1);
  }

  const providerTransactionId = arg('tx') || `TRX${Date.now()}`;

  const result = await processPayment({ provider, providerTransactionId, amount, occurredAt });
  // eslint-disable-next-line no-console
  console.log('\n[fake-payment] hasil:', JSON.stringify(result, null, 2), '\n');

  await disconnect();
  process.exit(result.matched ? 0 : 2);
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[fake-payment] error:', error);
  process.exit(1);
});
