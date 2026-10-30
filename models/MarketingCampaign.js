const mongoose = require('mongoose');

const marketingCampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: ''
    },
    type: {
      type: String,
      enum: ['Email', 'SMS'],
      required: true
    },
    subject: {
      type: String,
      trim: true,
      default: ''
    },
    content: {
      type: String,
      required: true
    },
    summary: {
      type: String,
      trim: true,
      default: ''
    },
    recipients: {
      type: Number,
      default: 1
    },
    recipientName: {
      type: String,
      default: ''
    },
    recipientIds: [
      {
        type: mongoose.Schema.Types.Mixed
      }
    ],
    sent: {
      type: Number,
      default: 0
    },
    delivered: {
      type: Number,
      default: 0
    },
    failed: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['Completed', 'Scheduled', 'Failed', 'Draft', 'Processing'],
      default: 'Completed'
    },
    scheduledAt: {
      type: Date,
      default: null
    },
    templateId: {
      type: String,
      default: null
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

marketingCampaignSchema.index({ createdAt: -1 });
marketingCampaignSchema.index({ status: 1 });

module.exports = mongoose.model('MarketingCampaign', marketingCampaignSchema);
