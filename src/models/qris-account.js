'use strict';

const mongoose = require('mongoose');

const qrisAccountSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, required: true },
    qrisString: { type: String, required: true },
    merchantName: { type: String, default: '' },
    merchantCity: { type: String, default: '' },
    imagePath: { type: String, default: null },
    qrisType: { type: String, enum: ['static', 'dynamic'], default: 'static' },
    status: { type: String, enum: ['active', 'standby'], default: 'standby' },
  },
  { timestamps: true }
);

qrisAccountSchema.index({ userId: 1, provider: 1 });
qrisAccountSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('QrisAccount', qrisAccountSchema);
