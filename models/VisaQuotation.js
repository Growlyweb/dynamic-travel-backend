const mongoose = require('mongoose');
const { QUOTATION_STATUSES } = require('../config/visa');

const { ObjectId } = mongoose.Schema.Types;

// A price quote for a B2B partner. The net price, the currency and the exchange rate are copied from the visa type when
// the quotation is made, and the total is calculated on the server, so a later price change never alters a quote that
// was already sent.
const money = { type: Number, min: 0, default: 0 };

const visaQuotationSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    partner: { type: ObjectId, ref: 'Partner', required: true, index: true },
    partnerName: { type: String, required: true },
    clientName: { type: String, required: true, trim: true, maxlength: 120 },
    country: { type: ObjectId, ref: 'VisaCountry', required: true },
    countryName: { type: String, required: true },
    visaType: { type: ObjectId, ref: 'VisaType', required: true },
    visaTypeName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, max: 1000 },
    currency: { type: String, required: true, default: 'BDT' },
    rateToBase: { type: Number, required: true, default: 1 },
    netPrice: money,
    additionalFee: money,
    total: money,
    totalBase: money,
    validUntil: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    // draft, sent, accepted, rejected. "expired" is not stored: a draft or sent quotation past `validUntil` is shown as expired.
    status: { type: String, enum: QUOTATION_STATUSES, default: 'draft', index: true },
    statusChangedAt: { type: Date, default: Date.now },
    createdBy: { type: ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

visaQuotationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('VisaQuotation', visaQuotationSchema);
