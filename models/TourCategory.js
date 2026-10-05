const mongoose = require('mongoose');

// A tour category such as "Beach & Resort".
//
// nameKey is the lower-cased, single-spaced name. The unique index on it is what stops two
// categories from sharing a name in any letter case, even when two requests arrive together.
// legacyId keeps the id the frontend used before the backend existed (cat_beach, ...).
// Deleting a category only sets isActive to false, because tours may still point at it.
const tourCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true, unique: true },
    slug: { type: String, required: true, unique: true },
    legacyId: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true }
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

tourCategorySchema.index({ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: 'string' } } });

module.exports = mongoose.model('TourCategory', tourCategorySchema);
