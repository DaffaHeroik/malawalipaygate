'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null },
    googleId: { type: String, default: null },

    name: { type: String, trim: true, default: '' },
    displayName: { type: String, trim: true, default: '' },
    merchantName: { type: String, trim: true, default: '' },
    avatarColor: { type: String, default: '#174d9b' },

    emailVerified: { type: Boolean, default: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBotTenant: { type: Boolean, default: false },

    totpSecret: { type: String, default: null },
    totpEnabled: { type: Boolean, default: false },

    subscriptionUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },

    verifyTokenHash: { type: String, default: null, select: false },
    verifyTokenExpiresAt: { type: Date, default: null, select: false },
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpiresAt: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ subscriptionUntil: 1 });

module.exports = mongoose.model('User', userSchema);
