const mongoose = require('mongoose');
const { ACCOUNT_TYPES } = require('../config/accounting');

// One account of the chart (config/accounting.js). The list is created at start-up and can grow, but a posted journal
// can never point at a code that is not here.
const accountSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, match: /^\d{4}$/ },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    group: { type: String, required: true },
    cash: { type: Boolean, default: false },
    bank: { type: Boolean, default: false },
    control: { type: String, enum: ['AR', 'AP', null], default: null },
    contra: { type: Boolean, default: false },
    segment: { type: String },
    active: { type: Boolean, default: true }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

module.exports = mongoose.model('Account', accountSchema);
