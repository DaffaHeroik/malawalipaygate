'use strict';

const express = require('express');

const data = require('../data');
const { requireAuth } = require('../middleware/auth');
const constants = require('../config/constants');
const asyncHandler = require('../lib/asyncHandler');
const datetime = require('../lib/datetime');

const router = express.Router();

const ALLOWED_STATUS = ['all', ...constants.ORDER_STATUS_LIST];

const normalizeStatus = (value) => (ALLOWED_STATUS.includes(value) ? value : 'all');

/* ── Ringkasan ── */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const status = normalizeStatus(String(req.query.status || 'all'));
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const dashboard = await data.getDashboard({ status, page });

  res.render('pages/app/dashboard', {
    layout: 'layouts/shell',
    pageTitle: 'Dashboard',
    pageEyebrow: 'Overview',
    metaDescription: 'Ringkasan transaksi dan delivery record.',
    status,
    ...dashboard,
    user: req.user,
    subscription: await data.getSubscription(),
    detection: await data.getDetection(),
    settings: await data.getSettings(),
    seriesLabels: dashboard.series.map((d) => datetime.formatDayShort(d.date)),
  });
}));

/* ── Export CSV ── */
router.get('/export.csv', requireAuth, asyncHandler(async (req, res) => {
  const status = normalizeStatus(String(req.query.status || 'all'));
  const listing = await data.listOrders({ status, page: 1, perPage: 1000 });

  const header = [
    'Order ID', 'Project', 'Reference', 'Provider', 'Mode',
    'Base Amount', 'Fee Percent', 'Fee Amount', 'Unique Code', 'Pay Amount',
    'Status', 'Dibuat', 'Expired', 'Paid',
  ];

  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const rows = listing.rows.map((order) => [
    order.id,
    order.project?.name || '',
    order.reference || '',
    order.provider || '',
    order.mode || '',
    order.baseAmount,
    order.feePercent,
    order.feeAmount,
    order.uniqueCode,
    order.payAmount,
    order.status,
    datetime.formatDateTime(order.createdAt),
    datetime.formatDateTime(order.expiresAt),
    order.paidAt ? datetime.formatDateTime(order.paidAt) : '',
  ].map(escape).join(','));

  const csv = [header.map(escape).join(','), ...rows].join('\r\n');
  const filename = `malawali-orders-${status}-${datetime.formatDate(new Date()).replace(/\//g, '-')}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${csv}`);
}));

module.exports = router;
