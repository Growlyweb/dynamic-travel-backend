const mongoose = require('mongoose');

// One row per numbering sequence, for example "visa-application:2026". The row is bumped with a single atomic
// update, so two requests arriving together can never receive the same number.
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
  },
  { versionKey: false }
);

module.exports = mongoose.model('Counter', counterSchema);
