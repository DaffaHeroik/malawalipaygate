'use strict';

const mongoose = require('mongoose');

const webhookDeliverySchema = new mongoose.Schema(
  {
    deliveryId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    orderId: { type: String, default: null, index: true },
    projectId: { type: String, default: null },
    event: { type: String, required: true },

    url: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    secretVersion: { type: Date, default: null },

    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending', index: true },
    attempts: { type: Number, default: 0 },
    responseStatus: { type: Number, default: null },
    lastError: { type: String, default: null },
    nextRetryAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

webhookDeliverySchema.index({ status: 1, nextRetryAt: 1 });

module.exports = mongoose.model('WebhookDelivery', webhookDeliverySchema);
