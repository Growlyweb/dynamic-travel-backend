const mongoose = require('mongoose');
const { TOUR_STATUS, TOUR_CURRENCIES } = require('../config/constants');
const itinerarySchema = require('./itinerarySchema');

// A tour package. b2bPrice is stored here but only leaves the API for people allowed to see it
// (see services/tourService.js, present()). Deleting a tour sets status to "archived".
// legacyId keeps the id the frontend used before the backend existed (tour_205, ...).
const tourSchema = new mongoose.Schema(
  {
    legacyId: { type: String, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    country: { type: String, required: true, trim: true, maxlength: 80 },
    destination: { type: String, required: true, trim: true, maxlength: 150 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'TourCategory', index: true },
    durationDays: { type: Number, required: true, min: 1, max: 365, validate: Number.isInteger },
    priceCurrency: { type: String, enum: TOUR_CURRENCIES, required: true },
    price: { type: Number, required: true, min: 0 },
    b2bPrice: { type: Number, min: 0 },
    // Total capacity. Availability belongs to a booking module, which does not exist yet.
    seats: { type: Number, min: 0, validate: Number.isInteger },
    status: { type: String, enum: Object.values(TOUR_STATUS), default: TOUR_STATUS.DRAFT },
    rating: { type: Number, min: 0, max: 5 },
    coverImage: { type: String, trim: true, default: '' },
    gallery: { type: [String], default: [] },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    included: { type: [String], default: [] },
    excluded: { type: [String], default: [] },
    hotels: { type: [String], default: [] },
    itinerary: { type: [itinerarySchema], default: [] },
    terms: { type: String, trim: true, default: '', maxlength: 5000 }
  },
  { timestamps: true }
);

tourSchema.index({ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: 'string' } } });
tourSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Tour', tourSchema);
