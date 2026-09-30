'use strict';

const notFound = (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      ok: false,
      error: { code: 'invalid_request', message: 'Endpoint tidak ditemukan.' },
    });
  }
  return res.status(404).render('pages/errors/404', {
    layout: 'layouts/public',
    pageTitle: 'Halaman tidak ditemukan',
  });
};

module.exports = notFound;
