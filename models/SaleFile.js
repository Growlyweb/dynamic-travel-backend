const mongoose = require('mongoose');
const { FILE_STATUSES } = require('../config/accounting');

const { ObjectId } = mongoose.Schema.Types;

// A booking folder: one sale to one client. It is a label that groups journals. Its numbers (sale, cost, received, due,
// profit) are never stored here: they are added up from the journals tagged with the file, so there is one truth.
const costSchema = new mongoose.Schema(
  {
    account: { type: String, required: true },
    label: { type: String, trim: true, maxlength: 150, default: 'Cost price' },
    amount: { type: Number, min: 0, default: 0 },
    date: { type: String },
    vendor: { type: ObjectId, ref: 'Party' }
  },
  { _id: true }
);

const saleFileSchema = new mongoose.Schema(
  {
    fileNo: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    segment: { type: String, required: true },
    category: { type: String, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    dueDate: { type: String },
    applicant: { type: String, trim: true, maxlength: 150, default: '' },
    party: { type: ObjectId, ref: 'Party', required: true, index: true },
    partyName: { type: String, default: '' },
    partyType: { type: String, enum: ['B2C', 'B2B'], required: true },
    destination: { type: String, trim: true, maxlength: 150, default: '' },
    detail: { type: String, trim: true, maxlength: 300, default: '' },
    passportNo: { type: String, trim: true, maxlength: 30, default: '' },
    // What the file was sold for and the costs entered with it, in paisa. These are the INPUT of the posting. The books
    // hold the truth.
    sale: { type: Number, min: 0, default: 0 },
    discount: { type: Number, min: 0, default: 0 },
    costs: { type: [costSchema], default: [] },
    status: { type: String, enum: FILE_STATUSES, default: 'Processing', index: true },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    // The record that caused the file, when it was not typed in: { kind: 'visa-application', id }.
    source: { kind: { type: String }, id: { type: String } },
    revision: { type: Number, default: 1 },
    // For a file made from a visa application: a fingerprint of the numbers last posted, so nothing is posted twice.
    sig: { type: String },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true, maxlength: 300, default: '' },
    cancelSettlement: { type: String, enum: ['refund', 'keep', 'none', null], default: null },
    createdBy: { type: ObjectId, ref: 'User' },
    createdByName: { type: String, default: 'System' }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

saleFileSchema.index({ 'source.kind': 1, 'source.id': 1 }, { unique: true, partialFilterExpression: { 'source.kind': { $type: 'string' } } });

module.exports = mongoose.model('SaleFile', saleFileSchema);
