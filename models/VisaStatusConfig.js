const mongoose = require('mongoose');
const { STATUS_CATEGORIES } = require('../config/visa');

// How a status is shown and what the applicant is told. The 11 system statuses (config/visaStatuses.json) are created
// by visaStatusService.ensureSystem and cannot be deleted or deactivated. Staff may add their own inside a category.
const visaStatusConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, match: /^[a-z][a-z0-9_]*$/, maxlength: 40 },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    customerMessage: { type: String, trim: true, maxlength: 500, default: '' },
    internalDescription: { type: String, trim: true, maxlength: 500, default: '' },
    category: { type: String, enum: STATUS_CATEGORIES, required: true },
    active: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 100 },
    isSystem: { type: Boolean, default: false }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

module.exports = mongoose.model('VisaStatusConfig', visaStatusConfigSchema);
