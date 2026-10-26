const mongoose = require('mongoose');
const { VOUCHER_TYPES } = require('../config/accounting');

const { ObjectId } = mongoose.Schema.Types;

// A voucher: balanced debits and credits. Amounts are whole paisa.
//
// A posted journal is never edited. A mistake is corrected by voiding it (status "void", with a reason) and posting a
// new one, so the history is always complete. Voided journals count for nothing in any report.
//
// `source` ties a journal to the record that caused it (a visa payment, a vendor bill). The unique index on it means a
// retried request or event can never post the same thing twice.
const lineSchema = new mongoose.Schema(
  {
    account: { type: String, required: true, match: /^\d{4}$/ },
    debit: { type: Number, min: 0, default: 0 },
    credit: { type: Number, min: 0, default: 0 },
    party: { type: ObjectId, ref: 'Party' },
    memo: { type: String, trim: true, maxlength: 200, default: '' },
    dueDate: { type: String },
    // "discount" marks a line that is a discount given on a receipt.
    kind: { type: String, enum: ['discount', null], default: null }
  },
  { _id: false }
);

const journalSchema = new mongoose.Schema(
  {
    no: { type: String, required: true, unique: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    type: { type: String, enum: VOUCHER_TYPES, default: 'JV', index: true },
    narration: { type: String, trim: true, maxlength: 300, default: 'Journal voucher' },
    segment: { type: String },
    party: { type: ObjectId, ref: 'Party', index: true },
    file: { type: ObjectId, ref: 'SaleFile', index: true },
    ref: { type: String, trim: true, maxlength: 80, default: '' },
    // The number on a paper receipt book, when staff want to keep it. The system number (`no`) is always made by the server.
    manualNo: { type: String, trim: true, maxlength: 40 },
    lines: { type: [lineSchema], validate: (lines) => lines.length >= 2 },
    status: { type: String, enum: ['posted', 'void'], default: 'posted', index: true },
    voidedAt: { type: Date },
    voidedBy: { type: ObjectId, ref: 'User' },
    voidReason: { type: String, trim: true, maxlength: 300, default: '' },
    source: {
      kind: { type: String },
      id: { type: String },
      role: { type: String }
    },
    createdBy: { type: ObjectId, ref: 'User' },
    createdByName: { type: String, default: 'System' }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

journalSchema.index({ 'lines.account': 1, date: 1 });
journalSchema.index({ manualNo: 1 }, { unique: true, partialFilterExpression: { manualNo: { $type: 'string' } } });
journalSchema.index({ 'source.kind': 1, 'source.id': 1, 'source.role': 1 }, { unique: true, partialFilterExpression: { 'source.kind': { $type: 'string' } } });

module.exports = mongoose.model('Journal', journalSchema);
