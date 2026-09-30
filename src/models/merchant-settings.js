'use strict';

const mongoose = require('mongoose');

const merchantSettingsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    feePercent: { type: Number, default: 0 },
    uniqueDigits: { type: Number, default: 2, min: 1, max: 3 },

    shopeeFeeEnabled: { type: Boolean, default: false },
    shopeeUniqueEnabled: { type: Boolean, default: false },
    shopeeMode: { type: String, enum: ['fee', 'unique', 'hybrid'], default: 'hybrid' },

    gopayFeeEnabled: { type: Boolean, default: false },
    gopayUniqueEnabled: { type: Boolean, default: false },
    gopayMode: { type: String, enum: ['fee', 'unique', 'hybrid'], default: 'hybrid' },

    orderTtl: { type: Number, default: 600 },
    notifyUrl: { type: String, default: '' },
    redirectUrl: { type: String, default: '' },

    webhookSecret: { type: String, default: null },
    webhookSecretRotatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MerchantSettings', merchantSettingsSchema);
