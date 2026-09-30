'use strict';

const models = require('../models');
const webhook = require('./webhook.service');

/**
 * Pencocokan pembayaran 3 tahap:
 *   1. nominal harus cocok persis dengan pay_amount order (pending, provider sama)
 *   2. pembayaran harus jatuh di dalam window waktu order (createdAt..expiresAt)
 *   3. provider_transaction_id diklaim SEKALI (unique) → bukti bayar tidak bisa dipakai ulang
 *
 * Urutan kandidat: order pending paling lama dulu.
 */
const processPayment = async ({ provider, providerTransactionId, amount, occurredAt = new Date(), raw = {}, userId = null }) => {
  if (!provider || !providerTransactionId) {
    return { matched: false, reason: 'invalid_payload' };
  }

  const occurred = new Date(occurredAt);
  const value = Math.round(Number(amount) || 0);

  // 1) Klaim bukti bayar. Unique index mencegah reuse.
  let tx;
  try {
    tx = await models.Transaction.create({
      userId: userId || null,
      provider,
      providerTransactionId: String(providerTransactionId),
      amount: value,
      occurredAt: occurred,
      raw,
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return { matched: false, reason: 'already_claimed' };
    }
    throw error;
  }

  // 2) Cari kandidat order. Bila userId diketahui (mis. push dari Listener),
  //    batasi ke merchant itu supaya tidak salah cocok antar tenant.
  const filter = { provider, payAmount: value, status: 'pending' };
  if (userId) filter.userId = userId;
  const candidates = await models.Order.find(filter).sort({ createdAt: 1 });

  // 3) Cocokkan window waktu lalu klaim.
  for (const order of candidates) {
    const created = new Date(order.createdAt).getTime();
    const expires = new Date(order.expiresAt).getTime();
    const at = occurred.getTime();

    if (at < created || at > expires) continue;

    // klaim transaction sekali
    // eslint-disable-next-line no-await-in-loop
    const claimed = await models.Transaction.findOneAndUpdate(
      { _id: tx._id, claimedByOrderId: null },
      { $set: { claimedByOrderId: order.orderId, claimedAt: new Date(), userId: order.userId } },
      { new: true }
    );
    if (!claimed) return { matched: false, reason: 'already_claimed' };

    // tandai order paid (hanya kalau masih pending)
    // eslint-disable-next-line no-await-in-loop
    const paid = await models.Order.findOneAndUpdate(
      { _id: order._id, status: 'pending' },
      {
        $set: {
          status: 'paid',
          paidAt: new Date(),
          matchedTransaction: {
            providerTransactionId: String(providerTransactionId),
            amount: value,
            occurredAt: occurred.toISOString(),
            claimedAt: new Date().toISOString(),
          },
        },
      },
      { new: true }
    );

    if (!paid) {
      // order sudah tidak pending → lepas klaim, coba kandidat berikutnya
      // eslint-disable-next-line no-await-in-loop
      await models.Transaction.updateOne(
        { _id: tx._id },
        { $set: { claimedByOrderId: null, claimedAt: null, userId: null } }
      );
      continue;
    }

    const orderPlain = paid.toObject();
    const normalized = {
      id: orderPlain.orderId,
      projectId: orderPlain.projectId,
      status: orderPlain.status,
      baseAmount: orderPlain.baseAmount,
      payAmount: orderPlain.payAmount,
      reference: orderPlain.reference,
      provider: orderPlain.provider,
      paidAt: orderPlain.paidAt ? orderPlain.paidAt.toISOString() : null,
      webhookUrl: orderPlain.webhookUrl,
    };

    // Kirim webhook order.paid (best effort).
    // eslint-disable-next-line no-await-in-loop
    await notifyPaid({ order: normalized, userId: orderPlain.userId });

    return { matched: true, orderId: orderPlain.orderId, transactionId: tx._id.toString() };
  }

  return { matched: false, reason: 'no_matching_order' };
};

/** Ambil secret & target webhook lalu kirim event. */
const notifyPaid = async ({ order, userId }) => {
  const [project, settings] = await Promise.all([
    order.projectId ? models.Project.findById(order.projectId) : null,
    models.MerchantSettings.findOne({ userId }),
  ]);

  const secret = settings?.webhookSecret || null;
  if (!secret) return { ok: false, reason: 'no_secret' };

  return webhook.sendOrderPaid({
    order,
    project: project ? { id: String(project._id), webhookUrl: project.webhookUrl } : null,
    settings: settings ? { notifyUrl: settings.notifyUrl } : null,
    userId,
    secret,
  });
};

module.exports = { processPayment, notifyPaid };
