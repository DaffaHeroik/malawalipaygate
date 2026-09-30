'use strict';

const config = require('../config');
const models = require('../models');
const context = require('../lib/context');

/**
 * Catatan audit (AuditLog).
 *
 * Aturan pemakaian:
 *  - Selalu fire-and-forget: fungsi ini TIDAK pernah melempar error, jadi
 *    kegagalan tulis log tidak boleh menggagalkan aksi bisnis.
 *  - Otomatis nonaktif saat `DATA_SOURCE=mock` (tidak ada koneksi Mongo).
 *  - `userId` diambil dari AsyncLocalStorage bila tidak diberikan.
 */

const clientIp = (req) => {
  if (!req) return null;
  const forwarded = String(req.get?.('x-forwarded-for') || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || null;
};

const record = async (action, options = {}) => {
  try {
    if (config.dataSource !== 'db') return false;

    const {
      targetType = null,
      targetId = null,
      meta = {},
      userId = context.currentUserId(),
      ip = null,
      ua = null,
    } = options;

    await models.AuditLog.create({
      userId: userId || null,
      action: String(action).slice(0, 120),
      targetType: targetType ? String(targetType).slice(0, 60) : null,
      targetId: targetId ? String(targetId).slice(0, 120) : null,
      ip,
      ua: ua ? String(ua).slice(0, 300) : null,
      meta: meta && typeof meta === 'object' ? meta : {},
    });
    return true;
  } catch (_) {
    return false;
  }
};

/** Versi yang mengambil ip/ua dari request Express. */
const recordRequest = (req, action, options = {}) =>
  record(action, {
    ...options,
    ip: options.ip || clientIp(req),
    ua: options.ua || req?.get?.('user-agent') || null,
  });

/** Ambil log terbaru (untuk panel admin / debugging). */
const list = async ({ userId = null, limit = 50 } = {}) => {
  if (config.dataSource !== 'db') return [];
  const filter = userId ? { userId } : {};
  const docs = await models.AuditLog.find(filter).sort({ createdAt: -1 }).limit(Math.min(200, limit));
  return docs.map((d) => {
    const p = d.toObject();
    return {
      id: String(p._id),
      userId: p.userId ? String(p.userId) : null,
      action: p.action,
      targetType: p.targetType,
      targetId: p.targetId,
      ip: p.ip,
      ua: p.ua,
      meta: p.meta,
      createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    };
  });
};

module.exports = { record, recordRequest, list, clientIp };
