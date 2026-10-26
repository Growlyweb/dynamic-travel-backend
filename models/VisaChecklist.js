const mongoose = require('mongoose');
const { CHECKLIST_REQUIREMENTS, SUBMISSION_MODES, APPLICANT_TYPES } = require('../config/visa');

// The documents an applicant has to provide, per country, visa type and applicant type.
const itemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 200 },
    requirement: { type: String, enum: CHECKLIST_REQUIREMENTS, default: 'required' },
    active: { type: Boolean, default: true },
    submissionMode: { type: String, enum: SUBMISSION_MODES, default: 'digital' },
    fileFormats: { type: String, trim: true, maxlength: 60, default: 'PDF/JPG/PNG' },
    maxSizeMb: { type: Number, min: 1, max: 25, default: 10 }
  },
  { _id: true }
);

const visaChecklistSchema = new mongoose.Schema(
  {
    country: { type: mongoose.Schema.Types.ObjectId, ref: 'VisaCountry', required: true },
    visaType: { type: mongoose.Schema.Types.ObjectId, ref: 'VisaType', required: true },
    applicantType: { type: String, enum: APPLICANT_TYPES, required: true },
    items: { type: [itemSchema], default: [] }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

visaChecklistSchema.index({ country: 1, visaType: 1, applicantType: 1 }, { unique: true });

module.exports = mongoose.model('VisaChecklist', visaChecklistSchema);
