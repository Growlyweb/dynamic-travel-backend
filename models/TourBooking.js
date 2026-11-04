const mongoose = require('mongoose');

const tourBookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bookingRef: { type: String, required: true, unique: true, index: true },
    tourId: { type: String, default: '' },
    tourName: { type: String, required: true, trim: true, maxlength: 200 },
    destination: { type: String, required: true, trim: true, maxlength: 100 },
    duration: { type: String, default: '' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    travelers: { type: String, default: '1 Adult' },
    adults: { type: Number, default: 1 },
    children: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    status: {
      type: String,
      enum: ['Upcoming', 'In Progress', 'Completed', 'Cancelled'],
      default: 'Upcoming',
      index: true
    },
    image: { type: String, default: '' },
    contact: {
      name: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' }
    },
    notes: { type: String, default: '', maxlength: 1000 }
  },
  { timestamps: true }
);

tourBookingSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('TourBooking', tourBookingSchema);
