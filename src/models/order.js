'use strict';

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    projectId: { type: String, default: null },
    project: { type: { id: String, name: String }, default: null },

    reference: { type: String, default: null },
    redirectUrl: { type: String, default: null },
    webhookUrl: { type: String, default: null },

    mode: { type: String, default: 'live' },
    provider: { type: String, default: null },

    baseAmount: { type: Number, required: true },
    feePercent: { type: Number, default: 0 },
    feeAmount: { type: Number, default: 0 },
    uniqueCode: { type: Number, default: 0 },
    payAmount: { type: Number, required: true },

    status: { type: String, enum: ['pending', 'paid', 'expired', 'cancelled'], default: 'pending' },

    qris: { type: String, default: '' },
    checkoutUrl: { type: String, default: '' },
    ttlSeconds: { type: Number, default: 600 },

    expiresAt: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    matchedTransaction: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, payAmount: 1, status: 1 });
// pay_amount unik hanya di antara order pending (dijamin di level DB).
orderSchema.index(
  { userId: 1, provider: 1, payAmount: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
orderSchema.index({ userId: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1, expiresAt: 1 });
orderSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
