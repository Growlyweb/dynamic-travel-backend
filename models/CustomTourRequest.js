const mongoose = require('mongoose');
const { CUSTOM_REQUEST_STATUS } = require('../config/constants');
const itinerarySchema = require('./itinerarySchema');

// A B2C customer asking for a tour built to their wishes. The itinerary is the draft the frontend
// generated; a consultant confirms availability and the final price (status QUOTED, then CONFIRMED).
const customTourRequestSchema = new mongoose.Schema(
  {
    // The signed-in customer who sent it. Always taken from the token, never from the body.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customer: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true, maxlength: 150 },
    travelers: { type: Number, required: true, min: 1, max: 100, validate: Number.isInteger },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    hotel: { type: String, required: true, trim: true, maxlength: 100 },
    transportation: { type: String, trim: true, default: 'Private car', maxlength: 60 },
    activities: { type: [String], default: [] },
    requirements: { type: String, trim: true, default: '', maxlength: 2000 },
    itinerary: { type: [itinerarySchema], default: [] },

    status: { type: String, enum: Object.values(CUSTOM_REQUEST_STATUS), default: CUSTOM_REQUEST_STATUS.NEW, index: true },
    reviewNote: { type: String, trim: true, default: '', maxlength: 500 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date }
  },
  { timestamps: true }
);

customTourRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CustomTourRequest', customTourRequestSchema);
