'use strict';

const config = require('../config');
const brand = require('../config/brand');

/**
 * Error handler terakhir.
 * - Kalau request ke /api/* -> balas JSON (format error sesuai spec)
 * - Selain itu -> render halaman 500
 */
const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  if (req.path.startsWith('/api/') || req.xhr) {
    return res.status(status).json({
      ok: false,
      error: {
        code: err.code || 'server_error',
        message: status >= 500 && config.isProd ? 'Terjadi kesalahan pada server.' : err.message,
      },
    });
  }

  if (res.headersSent) return undefined;

  return res.status(status).render('pages/errors/500', {
    layout: 'layouts/public',
    pageTitle: 'Terjadi kesalahan',
    errorCode: status,
    errorMessage: err.message,
    errorStack: config.isProd ? null : err.stack,
    brandName: brand.name,
  });
};

module.exports = errorHandler;
