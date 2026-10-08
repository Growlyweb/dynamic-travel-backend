// Creates the four starting membership plans from the spec (Starter, Basic, Silver, Gold).
// The prices are PLACEHOLDERS: set the real ones from the dashboard (edit a plan), or change them here before running.
// Safe to run again: a plan that already exists (by name, in any letter case) is left exactly as it is.
// Usage: npm run seed:membership
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const MembershipPlan = require('../models/MembershipPlan');
const { keyOf } = require('../services/membershipPlanService');

const PLANS = [
  { name: 'Starter', durationValue: 15, durationUnit: 'day', price: 500, tourDiscountPercent: 5, visaDiscountPercent: 5, maxDiscountAmount: null, sortOrder: 1 },
  { name: 'Basic', durationValue: 30, durationUnit: 'day', price: 900, tourDiscountPercent: 5, visaDiscountPercent: 5, maxDiscountAmount: null, sortOrder: 2 },
  { name: 'Silver', durationValue: 6, durationUnit: 'month', price: 2500, tourDiscountPercent: 10, visaDiscountPercent: 10, maxDiscountAmount: 1500, sortOrder: 3 },
  { name: 'Gold', durationValue: 1, durationUnit: 'year', price: 4500, tourDiscountPercent: 10, visaDiscountPercent: 10, maxDiscountAmount: 3000, sortOrder: 4 }
].map((plan) => ({
  ...plan,
  description: `${plan.tourDiscountPercent}% off tour packages and ${plan.visaDiscountPercent}% off visa processing.`,
  features: [`${plan.tourDiscountPercent}% off tour packages`, `${plan.visaDiscountPercent}% off visa processing`]
}));

// Returns the names it created, so a test (or a person) can see whether anything changed.
const seedMembership = async () => {
  const created = [];
  for (const plan of PLANS) {
    const nameKey = keyOf(plan.name);
    if (await MembershipPlan.exists({ nameKey })) continue;
    await MembershipPlan.create({ ...plan, nameKey });
    created.push(plan.name);
  }
  return created;
};

module.exports = { seedMembership, PLANS };

if (require.main === module) {
  (async () => {
    await connectDB();
    await MembershipPlan.syncIndexes();
    const created = await seedMembership();
    console.log(created.length ? `Plans created: ${created.join(', ')} (placeholder prices: change them in the dashboard)` : 'All 4 plans already exist.');
  })()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err.message || err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
