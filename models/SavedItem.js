const mongoose = require('mongoose');

const savedItemSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['visa', 'tour'], required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    place: { type: String, default: '', trim: true, maxlength: 100 },
    countryCode: { type: String, default: '', trim: true, maxlength: 10 },
    image: { type: String, default: '' },
    href: { type: String, default: '' },
    meta: {
      type: [
        new mongoose.Schema(
          {
            icon: { type: String, default: '' },
            text: { type: String, default: '' }
          },
          { _id: false }
        )
      ],
      default: []
    }
  },
  { timestamps: true }
);

savedItemSchema.index({ userId: 1, kind: 1, title: 1 }, { unique: true });
savedItemSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('SavedItem', savedItemSchema);
