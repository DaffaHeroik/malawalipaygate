'use strict';

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    // userId diisi setelah order yang cocok ditemukan (saat klaim).
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    provider: { type: String, required: true },
    providerTransactionId: { type: String, required: true },
    amount: { type: Number, required: true },
    occurredAt: { type: Date, required: true },

    raw: { type: mongoose.Schema.Types.Mixed, default: {} },

    claimedByOrderId: { type: String, default: null },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Satu bukti bayar hanya boleh mengklaim satu order (anti reuse).
transactionSchema.index({ provider: 1, providerTransactionId: 1 }, { unique: true });
transactionSchema.index({ userId: 1, amount: 1, occurredAt: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
