const mongoose = require('mongoose');

// A country the agency processes visas for. Deleting is allowed only while nothing points at it (see visaCatalogService);
// otherwise the country is paused, which hides it from new applications but keeps the old ones readable.
//
// nameKey is the lower-cased, single-spaced name. Its unique index stops two countries sharing a name in any letter case.
const sampleDocSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, trim: true, maxlength: 40, default: 'document' },
    url: { type: String, required: true, trim: true, maxlength: 500 }
  },
  { _id: true }
);

const visaCountrySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true, unique: true },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 3 },
    flag: { type: String, trim: true, maxlength: 16, default: '🌐' },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: ['active', 'paused'], default: 'active', index: true },
    displayOrder: { type: Number, default: 1, min: 1 },
    processingMode: { type: String, trim: true, maxlength: 60, default: '' },
    processingTime: { type: String, trim: true, maxlength: 60, default: '' },
    physicalPassportRequired: { type: Boolean, default: false },
    expressAvailable: { type: Boolean, default: false },
    // Rich text written in the dashboard. It is cleaned on every save (services/visaCatalogService.js).
    richChecklist: { type: String, default: '', maxlength: 20000 },
    sampleDocs: { type: [sampleDocSchema], default: [] }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.nameKey;
        delete ret.__v;
        return ret;
      }
    }
  }
);

module.exports = mongoose.model('VisaCountry', visaCountrySchema);
