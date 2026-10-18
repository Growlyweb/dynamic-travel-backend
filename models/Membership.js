const mongoose = require('mongoose');
const { DURATION_UNITS, MEMBERSHIP_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } = require('../config/constants');

// One purchase of one plan by one B2C customer.
//
// - planSnapshot is the plan as it was when sold. The discount is always read from it, never from the live plan.
// - status is what is STORED. What the API returns is the effective status (a stored "active" whose endDate has
//   passed is reported as "expired"); see services/membershipService.js.
// - Deleting is soft: isDeleted/deletedAt. A deleted membership leaves lists, counts and the one-active rule,
//   but its payment still counts in revenue.
const snapshotSchema = new mongoose.Schema(
  {
    name: String,
    durationValue: Number,
    durationUnit: { type: String, enum: DURATION_UNITS },
    price: Number,
    tourDiscountPercent: Number,
    visaDiscountPercent: Number,
    maxDiscountAmount: { type: Number, default: null }
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true, min: 0 },
    // Typed in by the admin for the record. Payments are recorded by hand, so nothing checks it.
    trxId: { type: String, trim: true, default: '', maxlength: 100 },
    status: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.UNPAID },
    paidAt: { type: Date, default: null }
  },
  { _id: false }
);

const membershipSchema = new mongoose.Schema(
  {
    // The customer is a User with role B2C.
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Copied from the customer when sold, for display and search. Kept in step when the customer edits their details.
    customerName: { type: String, default: '' },
    customerEmail: { type: String, default: '' },
    customerPhone: { type: String, default: '' },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipPlan', required: true, index: true },
    planSnapshot: { type: snapshotSchema, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true, index: true },
    status: { type: String, enum: Object.values(MEMBERSHIP_STATUS), default: MEMBERSHIP_STATUS.ACTIVE },
    payment: { type: paymentSchema, required: true },
    source: { type: String, enum: ['admin', 'online'], default: 'admin' },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, default: '', maxlength: 500 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        ret.id = String(ret._id);
        ret.customerId = String(ret.customerId);
        ret.planId = String(ret.planId);
        delete ret._id;
        delete ret.__v;
        delete ret.isDeleted;
        delete ret.deletedAt;
        return ret;
      }
    }
  }
);

// Rule R1: one stored-active membership per customer, enforced by the database. A deleted one does not count.
membershipSchema.index(
  { customerId: 1 },
  { unique: true, partialFilterExpression: { status: MEMBERSHIP_STATUS.ACTIVE, isDeleted: false } }
);
membershipSchema.index({ customerId: 1, startDate: -1 });
membershipSchema.index({ 'payment.paidAt': 1 });

module.exports = mongoose.model('Membership', membershipSchema);
