const mongoose = require('mongoose');

// A sale category of the simple Sales screen. The five built-in ones (Visa, Tour Package, Air Ticket, Hotel, Transport)
// have their own revenue and cost accounts. A category staff add books as "Other".
const saleCategorySchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    labelKey: { type: String, required: true, unique: true },
    color: { type: String, default: '#64748B', match: /^#[0-9A-Fa-f]{6}$/ },
    type: { type: String, required: true },
    segment: { type: String, required: true },
    revenue: { type: String, required: true },
    costAccount: { type: String, required: true },
    prefix: { type: String, required: true },
    dueDays: { type: Number, default: 7 },
    builtin: { type: Boolean, default: false }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.labelKey; delete ret.__v; return ret; } } }
);

module.exports = mongoose.model('SaleCategory', saleCategorySchema);
