'use strict';

const mongoose = require('mongoose');

const providerConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, required: true },

    credentialsEnc: { type: String, default: null },
    status: { type: String, enum: ['connected', 'error', 'disconnected'], default: 'disconnected' },
    hasCredential: { type: Boolean, default: false },
    tokenPreview: { type: String, default: null },
    merchantPhone: { type: String, default: null },

    lastTestAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    connectedAt: { type: Date, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

providerConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('ProviderConnection', providerConnectionSchema);
