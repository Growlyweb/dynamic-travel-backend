const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 150,
      index: true,
    },
    source: { type: String, trim: true, default: 'storefront', maxlength: 100 },
    isActive: { type: Boolean, default: true, index: true },
    subscribedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

subscriberSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Subscriber', subscriberSchema);
