const Counter = require('../models/Counter');

// The next number of a sequence. Starts at 1.
const next = async (key) => {
  const counter = await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return counter.seq;
};

// "VISA-2026-000101". The sequence restarts every year because the year is part of the counter key.
const nextNumber = async (prefix, { year = new Date().getFullYear(), width = 6 } = {}) => {
  const seq = await next(`${prefix}:${year}`);
  return `${prefix}-${year}-${String(seq).padStart(width, '0')}`;
};

module.exports = { next, nextNumber };
