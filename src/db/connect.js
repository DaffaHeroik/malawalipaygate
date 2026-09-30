'use strict';

const mongoose = require('mongoose');

const config = require('../config');

let memoryServer = null;

/**
 * Menyambung ke MongoDB.
 *
 * - Development tanpa mongod lokal: `DEVELOPMENT_MONGO_MEMORY=true` →
 *   mongodb-memory-server dinyalakan otomatis, data hilang saat restart.
 * - Produksi / MongoDB lokal / Atlas: isi `MONGODB_URI`.
 *
 * `config.db.uri` ikut diperbarui dengan URI final supaya MongoStore untuk
 * session memakai alamat yang sama.
 */
const connect = async () => {
  let uri = config.db.uri;

  if (config.db.useMemoryServer) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({ instance: { dbName: 'malawali' } });
    uri = memoryServer.getUri('malawali');
    // eslint-disable-next-line no-console
    console.log('[db] mongodb-memory-server aktif (data hilang saat restart).');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    autoIndex: !config.isProd,
    serverSelectionTimeoutMS: 10000,
  });

  config.db.uri = uri;

  // eslint-disable-next-line no-console
  console.log(`[db] terhubung ke ${uri.replace(/\/\/[^@]*@/, '//***@')}`);

  return { uri, mongoose };
};

const disconnect = async () => {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
};

const isConnected = () => mongoose.connection.readyState === 1;

module.exports = { connect, disconnect, isConnected };
