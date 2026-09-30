'use strict';

const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    isDefault: { type: Boolean, default: false },

    apiKeyHash: { type: String, default: null },
    apiKeyMasked: { type: String, default: null },
    apiKeyLastUsedAt: { type: Date, default: null },
    apiKeyRotatedAt: { type: Date, default: null },

    webhookUrl: { type: String, default: '' },
    lastActivityAt: { type: Date, default: null },
  },
  { timestamps: true }
);

projectSchema.index({ userId: 1, name: 1 });
projectSchema.index({ apiKeyHash: 1 }, { sparse: true });

module.exports = mongoose.model('Project', projectSchema);
