const mongoose = require('mongoose');

const marketingTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ['email', 'sms', 'both'],
      default: 'both'
    },
    subject: {
      type: String,
      trim: true,
      default: ''
    },
    smsBody: {
      type: String,
      trim: true,
      default: ''
    },
    emailSubject: {
      type: String,
      trim: true,
      default: ''
    },
    emailBodyHtml: {
      type: String,
      default: ''
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = String(ret._id);
        delete ret.__v;
        return ret;
      }
    }
  }
);

marketingTemplateSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MarketingTemplate', marketingTemplateSchema);
