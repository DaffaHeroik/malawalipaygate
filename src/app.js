'use strict';

const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');

const config = require('./config');
const security = require('./middleware/security');
const buildSession = require('./middleware/session');
const csrf = require('./middleware/csrf');
const flash = require('./middleware/flash');
const locals = require('./middleware/locals');
const { loadUser } = require('./middleware/auth');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/error');
const routes = require('./routes');

const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  /* ── View engine ── */
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.set('layout', 'layouts/public');
  // Script & style per halaman tetap di dalam body (tidak diekstrak), supaya
  // urutan pemuatan mudah dilacak dan tidak ada tag yang hilang tanpa sengaja.
  app.set('layout extractScripts', false);
  app.set('layout extractStyles', false);
  app.use(expressLayouts);

  /* ── Static ── */
  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      maxAge: config.isProd ? '7d' : 0,
      etag: true,
    })
  );

  /* ── Body ── */
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));

  /* ── Keamanan & session ── */
  security(app);
  app.use(buildSession());
  app.use(flash());
  app.use(csrf({ fieldName: '_csrf' }));
  app.use(locals());
  app.use(loadUser);

  /* ── Route ── */
  app.use(routes);

  /* ── Penutup ── */
  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
