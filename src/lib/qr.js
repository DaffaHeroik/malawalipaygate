'use strict';

const crypto = require('crypto');

/**
 * Helper QR.
 *
 * Fase UI: kalau paket `qrcode` belum terpasang, dipakai gambar pseudo-QR
 * (deterministik dari payload, tidak bisa discan) supaya tampilan tetap benar.
 * Fase 12: `qrcode` sudah terpasang sehingga menghasilkan QR asli.
 */

let qrcodeLib = null;
try {
  // eslint-disable-next-line global-require
  qrcodeLib = require('qrcode');
} catch (_) {
  qrcodeLib = null;
}

const isAvailable = () => Boolean(qrcodeLib);

/** Pseudo-QR: matriks 25x25 dari hash payload, plus tiga finder pattern. */
const pseudoSvg = (payload, { size = 260, dark = '#111827', light = '#ffffff' } = {}) => {
  const modules = 25;
  const cell = size / modules;

  const hash = crypto.createHash('sha256').update(String(payload)).digest();
  // perluas hash jadi cukup banyak bit
  const bits = [];
  let seed = hash;
  while (bits.length < modules * modules) {
    for (let i = 0; i < seed.length; i += 1) {
      const byte = seed[i];
      for (let b = 0; b < 8; b += 1) bits.push((byte >> b) & 1);
    }
    seed = crypto.createHash('sha256').update(seed).digest();
  }

  const inFinder = (x, y) => {
    const corners = [
      [0, 0],
      [modules - 7, 0],
      [0, modules - 7],
    ];
    return corners.some(([cx, cy]) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7);
  };

  const isFinderDark = (x, y) => {
    const corners = [
      [0, 0],
      [modules - 7, 0],
      [0, modules - 7],
    ];
    return corners.some(([cx, cy]) => {
      const lx = x - cx;
      const ly = y - cy;
      if (lx < 0 || ly < 0 || lx > 6 || ly > 6) return false;
      const onOuter = lx === 0 || ly === 0 || lx === 6 || ly === 6;
      const inCore = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
      return onOuter || inCore;
    });
  };

  let rects = '';
  for (let y = 0; y < modules; y += 1) {
    for (let x = 0; x < modules; x += 1) {
      const dark_ = inFinder(x, y) ? isFinderDark(x, y) : bits[y * modules + x] === 1;
      if (!dark_) continue;
      rects += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QRIS"><rect width="${size}" height="${size}" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

/** Selalu mengembalikan data URL siap dipakai di atribut src. */
const toDataUrl = async (payload, options = {}) => {
  const text = String(payload || '');
  if (!text) return pseudoSvg('empty', options);

  if (qrcodeLib) {
    try {
      return await qrcodeLib.toDataURL(text, {
        errorCorrectionLevel: options.errorCorrectionLevel || 'M',
        margin: options.margin ?? 1,
        width: options.size || 260,
        color: { dark: options.dark || '#111827ff', light: options.light || '#ffffffff' },
      });
    } catch (_) {
      return pseudoSvg(text, options);
    }
  }

  return pseudoSvg(text, options);
};

/** Versi sinkron untuk tempat yang tidak bisa await. */
const toDataUrlSync = (payload, options = {}) => pseudoSvg(String(payload || 'empty'), options);

module.exports = { toDataUrl, toDataUrlSync, pseudoSvg, isAvailable };
