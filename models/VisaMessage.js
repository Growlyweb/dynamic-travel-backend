const mongoose = require('mongoose');
const { MESSAGE_CHANNELS, MESSAGE_STATUSES } = require('../config/visa');

const { ObjectId } = mongoose.Schema.Types;

// The message log. Every message ever prepared for an applicant is one row, with the text exactly as it was sent.
//  - sms:   status "pending" until staff send it by hand and mark it "sent" (or "failed"). There is no SMS provider yet.
//  - email: sent through EmailJS at once, so it is "sent" or "failed" with the reason.
// `source` says whether the system made it from a template at a status change ("auto") or a person wrote it ("manual").
const visaMessageSchema = new mongoose.Schema(
  {
    application: { type: ObjectId, ref: 'VisaApplication', required: true, index: true },
    applicationNumber: { type: String, required: true, index: true },
    channel: { type: String, enum: MESSAGE_CHANNELS, required: true, index: true },
    to: { type: String, trim: true, default: '' },
    toName: { type: String, trim: true, default: '' },
    template: { type: ObjectId, ref: 'MessageTemplate' },
    templateName: { type: String, default: 'Custom message' },
    trigger: { type: String, default: '' },
    subject: { type: String, default: '' },
    body: { type: String, required: true },
    status: { type: String, enum: MESSAGE_STATUSES, default: 'pending', index: true },
    source: { type: String, enum: ['auto', 'manual'], default: 'manual' },
    provider: { type: String, default: 'manual' },
    error: { type: String, default: '' },
    createdBy: { type: ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
    sentAt: { type: Date },
    sentBy: { type: ObjectId, ref: 'User' },
    sentByName: { type: String, default: '' }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

visaMessageSchema.index({ createdAt: -1 });

module.exports = mongoose.model('VisaMessage', visaMessageSchema);
