'use strict';

const config = require('../config');
const context = require('../lib/context');
const mockStore = require('../mock/store');

/**
 * Facade lapisan data. Route memanggil method ini tanpa peduli implementasinya:
 *
 * - `DATA_SOURCE=mock` → MockStore in-memory (UI jalan tanpa MongoDB).
 * - `DATA_SOURCE=db`   → implementasi MongoDB; method tanpa userId membaca
 *   user aktif dari AsyncLocalStorage (`lib/context`), jadi aman di request paralel.
 *
 * Semua method mengembalikan promise (mock dibungkus Promise.resolve) supaya
 * route boleh `await` di kedua mode.
 */

const db = require('./db');

const makeProxy = (target) =>
  new Proxy(target, {
    get(store, key) {
      const value = store[key];
      if (typeof value !== 'function') return value;
      return (...args) => Promise.resolve(value.apply(store, args));
    },
  });

let implementation;
if (config.dataSource === 'db') {
  implementation = db;
} else {
  implementation = mockStore;

  /** Mode mock: context request diikat ke user demo untuk seluruh alur. */
  const mockUserId = () => mockStore.getUser().id;
  const originalRunWithContext = context.runWithContext;
  context.runWithContext = (ctx, callback) =>
    originalRunWithContext({ ...ctx, userId: ctx?.userId || mockUserId() }, callback);
}

module.exports = makeProxy(implementation);
