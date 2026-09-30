'use strict';

/**
 * Flash message berbasis session: req.flash('success', 'tersimpan').
 * Pesan diambil sekali lalu dihapus, dan diekspos ke view sebagai `flashes`.
 */
const flash = () => (req, res, next) => {
  if (!req.session) {
    res.locals.flashes = [];
    return next();
  }

  req.flash = (type, message) => {
    if (!req.session.flash) req.session.flash = [];
    req.session.flash.push({ type, message });
  };

  const queued = req.session.flash || [];
  delete req.session.flash;
  res.locals.flashes = queued;

  return next();
};

module.exports = flash;
