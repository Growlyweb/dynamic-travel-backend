const mongoose = require('mongoose');

// One day of a plan. Shared by Tour.itinerary and CustomTourRequest.itinerary.
const itinerarySchema = new mongoose.Schema(
  {
    day: { type: Number, required: true, min: 1, max: 365, validate: Number.isInteger },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, required: true, trim: true, maxlength: 2000 }
  },
  { _id: false }
);

module.exports = itinerarySchema;
