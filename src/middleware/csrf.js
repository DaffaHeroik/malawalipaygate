'use strict';

const crypto = require('crypto');

/**
 * CSRF sederhana: token disimpan di session, dikirim lewat hidden input
 * bernama `_csrf`, dibandingkan waktu-konstan. Tidak memakai paket deprecated.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const getToken = (req) => {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
};

const csrf = (options = {}) => {
  const fieldName = options.fieldName || '_csrf';

  const middleware = (req, res, next) => {
    const token = getToken(req);
    res.locals.csrfToken = token;
    res.locals.csrfField = fieldName;

    if (SAFE_METHODS.has(req.method)) return next();

    // Lewati webhook & API key based endpoint: tidak memakai cookie session.
    if (req.path.startsWith('/api/')) return next();

    const sent = (req.body && req.body[fieldName]) || req.get('x-csrf-token') || '';
    const expected = req.session.csrfToken || '';

    const a = Buffer.from(String(sent));
    const b = Buffer.from(String(expected));
    const valid = a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!valid) {
      const err = new Error('Token CSRF tidak valid atau sudah kedaluwarsa.');
      err.status = 403;
      err.code = 'invalid_csrf';
      return next(err);
    }
    return next();
  };

  middleware.getToken = getToken;
  return middleware;
};

module.exports = csrf;
