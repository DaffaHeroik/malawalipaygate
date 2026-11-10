'use strict';

/** Format respons legacy PayKita — salinan kontrak `buildErrorResponse` /
 *  `buildCreateResponse` dari backend lama (malawali-gw-server), dipertahankan
 *  eksak supaya SPA lama jalan tanpa ubah. */

const CREATOR = 'Malawali Api';
const DEFAULT_INVOICE_ALIAS = 'MPAY';

function buildErrorResponse(message, code = 'PAYMENT_CREATE_FAILED', extra = {}) {
  return { status: false, creator: CREATOR, code, message, ...extra };
}

function buildCreateResponse(payment, req, requestId) {
  const expiresInMs = Math.max(0, new Date(payment.expires_at).getTime() - Date.now());
  return {
    status: true,
    creator: CREATOR,
    code: 'PAYMENT_CREATED',
    message: 'Transaksi berhasil dibuat',
    request_id: requestId || payment.request_id || null,
    result: {
      idtrx: payment.idtrx,
      invoice_alias: payment.invoice_alias || DEFAULT_INVOICE_ALIAS,
      payment_status: payment.status,
      amount_requested: payment.base_amount,
      amount_to_pay: payment.amount,
      unique_code: payment.unique_fee,
      fee: payment.actual_fee_admin || 0,
      created_at: payment.created_at,
      expires_at: payment.expires_at,
      expires_in_seconds: Math.ceil(expiresInMs / 1000),
      qris_url: `${req.protocol}://${req.get('host')}/qris/${payment.qr_id}`,
    },
  };
}

module.exports = { buildErrorResponse, buildCreateResponse, CREATOR, DEFAULT_INVOICE_ALIAS };
