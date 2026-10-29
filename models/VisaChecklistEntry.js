const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

// The "Visa Check List" page of one country and visa type: a title, what the applicant must bring written in rich text,
// the processing time, sample links, and where it sits in the list. It is reading material for staff and, later, the
// storefront. The documents an application is checked against are the structured lists in VisaChecklist.
const mediaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, trim: true, maxlength: 40, default: 'document' },
    url: { type: String, required: true, trim: true, maxlength: 500 }
  },
  { _id: true }
);

const visaChecklistEntrySchema = new mongoose.Schema(
  {
    // VI0001, VI0002 ... numbered by the server.
    code: { type: String, required: true, unique: true },
    country: { type: ObjectId, ref: 'VisaCountry', required: true, index: true },
    visaType: { type: ObjectId, ref: 'VisaType', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    // Rich text, cleaned on every save (services/visaChecklistEntryService.js).
    description: { type: String, default: '', maxlength: 20000 },
    processingTime: { type: String, trim: true, maxlength: 60, default: '' },
    media: { type: [mediaSchema], default: [] },
    displayOrder: { type: Number, min: 1, default: 1 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

// One page for each country and visa type.
visaChecklistEntrySchema.index({ country: 1, visaType: 1 }, { unique: true });

module.exports = mongoose.model('VisaChecklistEntry', visaChecklistEntrySchema);
