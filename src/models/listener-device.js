'use strict';

const mongoose = require('mongoose');

const listenerDeviceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    model: { type: String, default: '' },
    androidVersion: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    notificationAccess: { type: Boolean, default: false },
    enabledSources: { type: [String], default: [] },
    lastSeenAt: { type: Date, default: null },

    /** Autentikasi APK: hash token (token mentah hanya tampil sekali). */
    tokenHash: { type: String, default: null, index: true },
    tokenPreview: { type: String, default: null },
    tokenRotatedAt: { type: Date, default: null },
    pushCount: { type: Number, default: 0 },
    lastPushAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ListenerDevice', listenerDeviceSchema);
