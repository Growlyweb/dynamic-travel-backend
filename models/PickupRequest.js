const mongoose = require('mongoose');

const pickupRequestSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    partnerName: { type: String, default: '' },
    location: { type: String, required: true, trim: true },
    contactPerson: { type: String, required: true, trim: true },
    contactPhone: { type: String, required: true, trim: true },
    pickupAt: { type: Date, required: true },
    travelers: { type: Number, required: true, min: 1, default: 1 },
    status: {
      type: String,
      enum: ['requested', 'scheduled', 'picked_up', 'delivered_to_hub', 'cancelled'],
      default: 'requested',
      index: true
    },
    assignedStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, default: '', trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('PickupRequest', pickupRequestSchema);
