const mongoose = require('mongoose');
const { MESSAGE_CHANNELS } = require('../config/visa');

// Wording sent when an application reaches a status. `channel` is "email" (sent automatically through EmailJS when the
// status is reached) or "sms" (a prepared message that staff send by hand and mark as sent). The words
// {{applicantName}}, {{applicationNumber}}, {{country}}, {{visaType}}, {{status}} and {{trackingUrl}} are filled in.
// `active` is the on/off switch of each template.
const messageTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true },
    channel: { type: String, enum: MESSAGE_CHANNELS, required: true, index: true },
    trigger: { type: String, required: true, trim: true, maxlength: 40, index: true },
    subject: { type: String, trim: true, maxlength: 150, default: '' },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.nameKey; delete ret.__v; return ret; } } }
);

messageTemplateSchema.index({ channel: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model('MessageTemplate', messageTemplateSchema);
