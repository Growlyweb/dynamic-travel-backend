const mongoose = require('mongoose');

// A visa product of one country, with its prices. Amounts are in `currency`; an application copies the price and the
// exchange rate when it is created, so a later price change never alters an old file.
const visaTypeSchema = new mongoose.Schema(
  {
    country: { type: mongoose.Schema.Types.ObjectId, ref: 'VisaCountry', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    processingTime: { type: String, trim: true, maxlength: 60, default: '' },
    entries: { type: String, enum: ['single', 'double', 'multiple'], default: 'single' },
    currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3, default: 'BDT' },
    b2cPrice: { type: Number, required: true, min: 0 },
    b2bNetPrice: { type: Number, required: true, min: 0 },
    fees: {
      embassy: { type: Number, min: 0, default: 0 },
      service: { type: Number, min: 0, default: 0 },
      vat: { type: Number, min: 0, default: 0 }
    },
    validFrom: { type: Date },
    terms: { type: String, trim: true, maxlength: 5000, default: '' },
    status: { type: String, enum: ['active', 'paused'], default: 'active', index: true },
    passportRequirement: { type: String, enum: ['online_processing', 'physical_required'], default: 'online_processing' },
    pickupAvailable: { type: Boolean, default: false },
    officeSubmissionAvailable: { type: Boolean, default: false }
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

visaTypeSchema.index({ country: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model('VisaType', visaTypeSchema);
