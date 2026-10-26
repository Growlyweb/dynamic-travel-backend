const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

// What a supplier charged us. Saving it posts "cost / accounts payable". Voiding it voids that journal.
const vendorBillSchema = new mongoose.Schema(
  {
    billNo: { type: String, required: true, unique: true },
    vendor: { type: ObjectId, ref: 'Party', required: true, index: true },
    vendorName: { type: String, default: '' },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    dueDate: { type: String },
    amount: { type: Number, required: true, min: 1 },
    invoiceRef: { type: String, trim: true, maxlength: 80, default: '' },
    service: { type: String, trim: true, maxlength: 100, default: '' },
    account: { type: String, required: true },
    segment: { type: String },
    file: { type: ObjectId, ref: 'SaleFile' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ['posted', 'void'], default: 'posted', index: true },
    voidReason: { type: String, default: '' },
    voidedAt: { type: Date },
    journal: { type: ObjectId, ref: 'Journal' },
    createdBy: { type: ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

module.exports = mongoose.model('VendorBill', vendorBillSchema);
