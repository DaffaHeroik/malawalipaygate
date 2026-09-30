'use strict';

const config = require('./config');
const createApp = require('./app');

const start = async () => {
  if (config.dataSource === 'db') {
    try {
      const { connect } = require('./db/connect');
      await connect();

      // Development: isi data contoh kalau DB masih kosong.
      if (config.isDev) {
        const { seedIfEmpty } = require('./db/seed');
        const result = await seedIfEmpty();
        if (result.seeded) {
          // eslint-disable-next-line no-console
          console.log(`[seed] data demo dibuat. Login: ${result.user} / ${result.password}`);
        }
      }

      // Job berkala: tandai order pending yang sudah lewat TTL.
      const { startExpireSweep } = require('./services/order.service');
      startExpireSweep();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[db] gagal terhubung:', error.message);
      process.exit(1);
    }
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log('');
    console.log(`  ${require('./config/brand').name} — ${config.env}`);
    console.log(`  → http://localhost:${config.port}`);
    console.log(`  data source : ${config.dataSource}`);
    console.log(`  views       : EJS + layouts`);
    config.warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
    console.log('');
  });

  const shutdown = (signal) => () => {
    // eslint-disable-next-line no-console
    console.log(`\n[${signal}] menutup server...`);
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
};

start();
