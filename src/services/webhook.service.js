'use strict';

const config = require('../config');
const models = require('../models');
const ids = require('../lib/ids');
const hmac = require('../lib/hmac');

/**
 * Webhook keluar.
 *
 * - Header: x-malawali-timestamp, x-malawali-signature: v1=<hex>, x-malawali-event
 * - Tanda tangan: HMAC-SHA256(secret, timestamp + "." + raw_body)
 * - Timeout 10s, retry maksimal 3x dengan backoff
 * - Prioritas tujuan: order.webhookUrl → project.webhookUrl → settings.notifyUrl
 */

const resolveTargetUrl = ({ order = null, project = null, settings = null }) =>
  order?.webhookUrl || project?.webhookUrl || settings?.notifyUrl || null;

const buildPayload = (event, order, extra = {}) => ({
  event,
  created_at: new Date().toISOString(),
  data: {
    id: order?.id || null,
    project_id: order?.projectId || null,
    status: order?.status || null,
    base_amount: order?.baseAmount ?? null,
    pay_amount: order?.payAmount ?? null,
    reference_id: order?.reference || null,
    provider: order?.provider || null,
    paid_at: order?.paidAt || null,
    ...extra,
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kirim satu request webhook. */
const postOnce = async ({ url, raw, signature, timestamp, event }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.webhook.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [hmac.TIMESTAMP_HEADER]: String(timestamp),
        [hmac.SIGNATURE_HEADER]: signature,
        [hmac.EVENT_HEADER]: event,
      },
      body: raw,
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: null, error: error.message };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Kirim event ke server merchant, catat ke WebhookDelivery.
 * Tidak melempar error — pengiriman webhook bersifat best effort.
 */
const deliver = async ({ event, order = null, project = null, settings = null, userId, secret, extra = {} }) => {
  const url = resolveTargetUrl({ order, project, settings });
  if (!url || !secret || !userId) return { ok: false, reason: 'no_target' };

  const payload = buildPayload(event, order, extra);
  const raw = JSON.stringify(payload);
  const timestamp = hmac.nowSeconds();

  const delivery = await models.WebhookDelivery.create({
    deliveryId: ids.eventId(),
    userId,
    orderId: order?.id || null,
    projectId: order?.projectId || project?.id || null,
    event,
    url,
    payload,
    secretVersion: new Date(),
    status: 'pending',
    attempts: 0,
  });

  const maxAttempts = Math.max(1, config.webhook.maxAttempts);
  let last = { ok: false, status: null, error: null };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const signature = hmac.format(hmac.sign(secret, timestamp, raw));
    // eslint-disable-next-line no-await-in-loop
    last = await postOnce({ url, raw, signature, timestamp, event });

    delivery.attempts = attempt;
    delivery.responseStatus = last.status;
    delivery.lastError = last.ok ? null : last.error || `HTTP ${last.status}`;

    if (last.ok) break;
    if (attempt < maxAttempts) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.min(2000, 250 * 2 ** attempt));
    }
  }

  delivery.status = last.ok ? 'success' : 'failed';
  delivery.deliveredAt = last.ok ? new Date() : null;
  if (!last.ok) delivery.nextRetryAt = null;
  await delivery.save();

  return { ok: last.ok, status: last.status, deliveryId: delivery.deliveryId };
};

/** Kirim event order.paid untuk sebuah order. */
const sendOrderPaid = async ({ order, project = null, settings = null, userId, secret }) =>
  deliver({ event: 'order.paid', order, project, settings, userId, secret });

/** Kirim event webhook.test (dipakai tombol di halaman Pengaturan). */
const sendTest = async ({ project, settings = null, userId, secret }) =>
  deliver({
    event: 'webhook.test',
    order: null,
    project,
    settings,
    userId,
    secret,
    extra: { message: 'Ini event uji dari Malawali Payment.' },
  });

module.exports = { resolveTargetUrl, buildPayload, deliver, sendOrderPaid, sendTest };
