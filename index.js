'use strict';

/**
 * Shim entrypoint Vercel.
 *
 * @vercel/express mendeteksi entrypoint dengan glob nama-nama khusus
 * (app/index/server + src/app, src/index, src/server) di root project, lalu
 * memprioritaskan file yang langsung `require('express')`. Tanpa file ini,
 * glob menangkap `src/app.js` (app EJS lama) → seluruh tree lama ikut
 * ter-bundle ke function → crash cold-start (mkdirSync di fs read-only).
 *
 * File ini menang karena "index.js" di root ada di urutan glob paling
 * awal, lalu forward ke app yang sebenarnya (legacy API + detect).
 */

// marker agar lolos deteksi @vercel/express (regex require("express"))
const express = require('express');
void express;

const app = require('./vercel/entry');

module.exports = app;
module.exports.default = app;
