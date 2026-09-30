'use strict';

const express = require('express');

const data = require('../data');
const { requireAuth } = require('../middleware/auth');
const constants = require('../config/constants');
const asyncHandler = require('../lib/asyncHandler');
const qr = require('../lib/qr');

const router = express.Router();

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const order = await data.getOrder(req.params.id);

  if (!order) {
    return res.status(404).render('pages/errors/404', {
      layout: 'layouts/shell',
      pageTitle: 'Order tidak ditemukan',
      pageEyebrow: 'Order',
    });
  }

  const payload = `${order.qris || 'QRIS'}|${order.payAmount}|${order.id}`;
  const qrDataUrl = await qr.toDataUrl(payload, { size: 240 });

  return res.render('pages/app/orders/show', {
    layout: 'layouts/shell',
    pageTitle: order.id,
    pageEyebrow: order.project?.name || 'Project',
    order,
    qrDataUrl,
    statusMeta: constants.ORDER_STATUS[order.status] || constants.ORDER_STATUS.pending,
  });
}));

/* Batalkan order (hanya pending) */
router.post('/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const result = await data.cancelOrder(req.params.id);

  if (!result.ok) {
    req.flash('warning', result.reason === 'not_pending'
      ? 'Order sudah tidak berstatus pending.'
      : 'Order tidak ditemukan.');
  } else {
    req.flash('success', 'Order dibatalkan.');
  }

  return res.redirect(`/orders/${req.params.id}`);
}));

module.exports = router;
