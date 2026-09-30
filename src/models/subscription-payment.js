'use strict';

const mongoose = require('mongoose');

const subscriptionPaymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    planMonths: { type: Number, required: true },
    price: { type: Number, required: true },
    totalCheckout: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'paid', 'expired', 'cancelled'], default: 'pending' },
    orderId: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

subscriptionPaymentSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);
