'use strict';

const { AsyncLocalStorage } = require('async_hooks');

/**
 * Request-scoped context.
 *
 * Route & view memanggil `data.listProjects()` tanpa mengirim userId (kontrak
 * yang sama dengan fase mock). Di mode DB, userId dibaca dari AsyncLocalStorage
 * yang diisi middleware `loadUser`, jadi tidak ada state global yang bocor antar
 * request paralel.
 */
const storage = new AsyncLocalStorage();

const runWithContext = (context, callback) => storage.run(context, callback);

const createRequestContext = ({ userId = null, user = null, role = null } = {}) => ({
  userId,
  user,
  role,
});

const getContext = () => storage.getStore() || {};

const currentUserId = () => getContext().userId || null;

module.exports = { runWithContext, createRequestContext, getContext, currentUserId };
