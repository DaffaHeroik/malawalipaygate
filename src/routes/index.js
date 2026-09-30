'use strict';

const express = require('express');

const router = express.Router();

router.use('/', require('./public.routes'));
router.use('/', require('./auth.routes'));
router.use('/dashboard', require('./dashboard.routes'));
router.use('/orders', require('./orders.routes'));
router.use('/projects', require('./projects.routes'));
router.use('/qris', require('./qris.routes'));
router.use('/qris-paykita', require('./qris-paykita.routes'));
router.use('/listener', require('./listener.routes'));
router.use('/shopee', require('./shopee.routes'));
router.use('/gopay', require('./gopay.routes'));
router.use('/subscription', require('./subscription.routes'));
router.use('/settings', require('./settings.routes'));
router.use('/tutorial', require('./tutorial.routes'));
router.use('/documentation', require('./documentation.routes'));
router.use('/api/listener', require('./listener-api.routes'));
router.use('/api', require('./api.routes'));
router.use('/admin', require('./admin.routes'));

module.exports = router;
