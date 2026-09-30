'use strict';

/** Bungkus handler async supaya error-nya diteruskan ke error middleware. */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
