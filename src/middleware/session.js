'use strict';

const session = require('express-session');
const config = require('../config');

/**
 * Session. Di mode mock pakai MemoryStore (default) supaya nol dependensi.
 * Di mode db nanti diganti MongoStore (lihat Fase 10).
 */
const buildSession = () => {
  const options = {
    name: config.session.name,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: config.session.ttlDays * 24 * 60 * 60 * 1000,
    },
  };

  if (config.dataSource === 'db' && config.db.uri && config.session.driver !== 'memory') {
    try {
      const MongoStore = require('connect-mongo');
      options.store = MongoStore.create({
        mongoUrl: config.db.uri,
        ttl: config.session.ttlDays * 24 * 60 * 60,
        touchAfter: 24 * 3600,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[session] MongoStore gagal dimuat, memakai MemoryStore:', error.message);
    }
  }

  return session(options);
};

module.exports = buildSession;
