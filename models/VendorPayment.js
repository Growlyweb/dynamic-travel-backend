const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

// Money paid to a supplier. A regular payment settles bills ("accounts payable / cash"). An advance is money paid before
// there is a bill ("advances to suppliers / cash") that later bills use up.
const vendorPaymentSchema = new mongoose.Schema(
  {
    voucherNo: { type: String, required: true, unique: true },
    vendor: { type: ObjectId, ref: 'Party', required: true, index: true },
    vendorName: { type: String, default: '' },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, required: true },
    isAdvance: { type: Boolean, default: false },
    bill: { type: ObjectId, ref: 'VendorBill' },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    status: { type: String, enum: ['posted', 'void'], default: 'posted', index: true },
    voidReason: { type: String, default: '' },
    voidedAt: { type: Date },
    journal: { type: ObjectId, ref: 'Journal' },
    createdBy: { type: ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

module.exports = mongoose.model('VendorPayment', vendorPaymentSchema);
