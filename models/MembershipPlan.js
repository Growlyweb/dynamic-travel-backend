const mongoose = require('mongoose');
const { DURATION_UNITS } = require('../config/constants');

// A membership an admin sells (name, length, price, discounts). Customers buy these as Membership records,
// and each purchase keeps a copy of the plan (planSnapshot), so editing a plan never changes a sold membership.
//
// nameKey is the lower-cased, single-spaced name. Its unique index is what makes "Gold" and "gold" clash,
// even when two requests arrive together.
const membershipPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true, unique: true },
    durationValue: { type: Number, required: true, min: 1, max: 3650, validate: Number.isInteger },
    durationUnit: { type: String, enum: DURATION_UNITS, required: true },
    price: { type: Number, required: true, min: 0 },
    tourDiscountPercent: { type: Number, min: 0, max: 100, default: 0 },
    visaDiscountPercent: { type: Number, min: 0, max: 100, default: 0 },
    // A cap on the discount of one booking, in BDT. null means no cap (0 is saved as null).
    maxDiscountAmount: { type: Number, min: 0, default: null },
    description: { type: String, trim: true, default: '', maxlength: 1000 },
    features: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, index: true }
  },
  {
    timestamps: true,
    toJSON: {
      // The dashboard reads `id`, not `_id`.
      transform: (doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.nameKey;
        delete ret.__v;
        return ret;
      }
    }
  }
);

module.exports = mongoose.model('MembershipPlan', membershipPlanSchema);
