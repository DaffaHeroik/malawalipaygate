'use strict';

const mongoose = require('mongoose');

const appSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    pricing: { type: mongoose.Schema.Types.Mixed, default: {} },
    disabledProviders: { type: [String], default: [] },
    announcement: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppSetting', appSettingSchema);
