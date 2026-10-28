const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

// Someone money is owed to, or owed by: a customer (B2C), an agency (B2B) or a supplier (Vendor). One list, so the
// receivable and payable sub-ledgers all point at the same records.
const partySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['B2C', 'B2B', 'Vendor'], required: true, index: true },
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    nameKey: { type: String, required: true },
    phone: { type: String, trim: true, maxlength: 40, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    contactPerson: { type: String, trim: true, maxlength: 100, default: '' },
    // In paisa. 0 means no limit is set.
    creditLimit: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
    since: { type: String, required: true },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    // The agency in the partner module, when this party is one of its agencies.
    partner: { type: ObjectId, ref: 'Partner' }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.nameKey; delete ret.__v; return ret; } } }
);

partySchema.index({ type: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model('Party', partySchema);
