'use strict';

const config = require('../config');
const models = require('../models');

/** Tandai order pending yang sudah melewati expiresAt menjadi expired. */
const expireStaleOrders = async () => {
  const result = await models.Order.updateMany(
    { status: 'pending', expiresAt: { $lte: new Date() } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount || 0;
};

let sweepTimer = null;

/** Jalankan sweep berkala. Hanya relevan di mode db. */
const startExpireSweep = (intervalSeconds = config.order.expireSweepSeconds) => {
  if (config.dataSource !== 'db' || sweepTimer) return null;

  const seconds = Math.max(5, Number(intervalSeconds) || 30);
  sweepTimer = setInterval(() => {
    expireStaleOrders().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[order] sweep expire gagal:', error.message);
    });
  }, seconds * 1000);

  // jangan menahan proses keluar
  if (sweepTimer.unref) sweepTimer.unref();
  return sweepTimer;
};

const stopExpireSweep = () => {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
};

module.exports = { expireStaleOrders, startExpireSweep, stopExpireSweep };
