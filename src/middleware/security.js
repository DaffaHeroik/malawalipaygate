'use strict';

const crypto = require('crypto');
const helmet = require('helmet');
const config = require('../config');

/**
 * helmet + CSP berbasis nonce.
 * Semua <script> inline di view wajib punya atribut nonce="<%= cspNonce %>".
 */
const security = (app) => {
  // nonce per request, dipakai inline script di view
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  const scriptSrc = [
    "'self'",
    (req, res) => `'nonce-${res.locals.cspNonce}'`,
  ];
  const frameSrc = ["'self'"];
  const connectSrc = ["'self'"];

  if (!config.turnstile.disabled) {
    scriptSrc.push('https://challenges.cloudflare.com');
    frameSrc.push('https://challenges.cloudflare.com');
  }
  if (config.isDev) {
    // mempermudah hot-reload / tooling saat development
    connectSrc.push('ws:', 'wss:');
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          scriptSrc,
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          objectSrc: ["'none'"],
          frameSrc,
          connectSrc,
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      xFrameOptions: { action: 'sameorigin' },
      xContentTypeOptions: true,
      xDnsPrefetchControl: { allow: false },
      xDownloadOptions: true,
      xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
      xXssProtection: false,
    })
  );
};

module.exports = security;
