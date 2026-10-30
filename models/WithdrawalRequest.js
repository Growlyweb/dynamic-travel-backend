const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    partnerName: { type: String, default: '' },
    amount: { type: Number, required: true, min: 1 },
    method: {
      type: String,
      enum: ['Bank transfer', 'Wise', 'PayPal', 'bKash', 'Nagad', 'Cash'],
      default: 'Bank transfer'
    },
    accountDetails: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'paid'],
      default: 'pending',
      index: true
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    adminNote: { type: String, default: '', trim: true },
    transactionReference: { type: String, default: '', trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
