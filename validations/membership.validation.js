const { z } = require('zod');
const { DURATION_UNITS, MEMBERSHIP_STATUS, PAYMENT_METHODS } = require('../config/constants');
const { objectId, search } = require('./common');

// Messages are written for an admin: the dashboard shows `message` straight inside its dialogs.

// ---------------------------------------------------------------- plans

const planFields = {
  name: z
    .string('Plan name is required.')
    .trim()
    .min(1, 'Plan name is required.')
    .max(80, 'Plan name must be at most 80 characters.'),
  durationValue: z
    .number('Duration must be a number.')
    .int('Duration must be a whole number.')
    .min(1, 'Duration must be at least 1.')
    .max(3650, 'Duration is too long.'),
  durationUnit: z.enum(DURATION_UNITS, `Duration unit must be one of ${DURATION_UNITS.join(', ')}.`),
  price: z.number('Price must be a number.').min(0, 'Price cannot be negative.').max(100_000_000, 'Price is too large.'),
  tourDiscountPercent: z
    .number('Tour discount must be a number.')
    .min(0, 'Tour discount must be between 0 and 100.')
    .max(100, 'Tour discount must be between 0 and 100.'),
  visaDiscountPercent: z
    .number('Visa discount must be a number.')
    .min(0, 'Visa discount must be between 0 and 100.')
    .max(100, 'Visa discount must be between 0 and 100.'),
  // The dashboard treats 0 as "no cap" too, so 0 and null both mean no cap and are saved as null.
  maxDiscountAmount: z
    .number('Maximum discount must be a number.')
    .min(0, 'Maximum discount cannot be negative.')
    .nullable()
    .transform((value) => (value ? value : null)),
  description: z.string('Description must be text.').trim().max(1000, 'Description must be at most 1000 characters.'),
  // Each feature is trimmed and empty ones are dropped.
  features: z
    .array(z.string('Each feature must be text.').trim().max(200, 'A feature must be at most 200 characters.'), 'Features must be a list.')
    .max(30, 'A plan can have at most 30 features.')
    .transform((items) => items.filter(Boolean)),
  isActive: z.boolean('isActive must be true or false.')
};

// Fields the dashboard may leave out on create get their default here.
const createPlan = z.object({
  ...planFields,
  tourDiscountPercent: planFields.tourDiscountPercent.default(0),
  visaDiscountPercent: planFields.visaDiscountPercent.default(0),
  maxDiscountAmount: planFields.maxDiscountAmount.default(null),
  description: planFields.description.default(''),
  features: planFields.features.default([]),
  isActive: planFields.isActive.default(true)
});

// The dashboard sends the whole plan back when editing, including id, sortOrder and timestamps: unknown keys are
// dropped here. The four core fields stay required; anything else that is left out is left unchanged.
const updatePlan = z.object({
  name: planFields.name,
  durationValue: planFields.durationValue,
  durationUnit: planFields.durationUnit,
  price: planFields.price,
  tourDiscountPercent: planFields.tourDiscountPercent.optional(),
  visaDiscountPercent: planFields.visaDiscountPercent.optional(),
  maxDiscountAmount: planFields.maxDiscountAmount.optional(),
  description: planFields.description.optional(),
  features: planFields.features.optional(),
  isActive: planFields.isActive.optional()
});

const listPlans = z.object({ search });

const idParam = z.object({ id: objectId });
const customerParam = z.object({ customerId: objectId });

// ---------------------------------------------------------------- memberships

// "YYYY-MM-DD", and a real calendar day (not 2026-02-30).
const day = z
  .string('Start date must be a date (YYYY-MM-DD).')
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be a date (YYYY-MM-DD).')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Start date must be a real date.');

const createMembership = z.object({
  customerId: z.string('Customer is required.').trim().min(1, 'Customer is required.').regex(/^[0-9a-fA-F]{24}$/, 'Invalid customer id.'),
  planId: z.string('Plan is required.').trim().min(1, 'Plan is required.').regex(/^[0-9a-fA-F]{24}$/, 'Invalid plan id.'),
  paymentMethod: z.enum(PAYMENT_METHODS, `Payment method must be one of ${PAYMENT_METHODS.join(', ')}.`),
  // Typed in by hand for the record. Always optional, and nothing checks it.
  trxId: z.string('Transaction id must be text.').trim().max(100, 'Transaction id must be at most 100 characters.').optional(),
  startDate: day.optional()
});

const cancelMembership = z.object({
  reason: z.string('Reason must be text.').trim().max(500, 'Reason must be at most 500 characters.').optional()
});

const extendMembership = z.object({
  days: z
    .number('Days must be a number.')
    .int('Days must be a whole number.')
    .min(1, 'Days must be at least 1.')
    .max(3650, 'Days must be at most 3650.')
});

const listMemberships = z.object({
  status: z.enum(Object.values(MEMBERSHIP_STATUS), 'Invalid status.').optional(),
  planId: objectId.optional(),
  expiringIn: z.string().regex(/^\d{1,4}$/, 'expiringIn must be a whole number of days.').optional(),
  search
});

// A customer reading their own list can only filter by status.
const listOwnMemberships = z.object({
  status: z.enum(Object.values(MEMBERSHIP_STATUS), 'Invalid status.').optional()
});

const reportPeriods = z.object({
  mode: z.enum(['monthly', 'half'], 'mode must be monthly or half.').optional()
});

module.exports = {
  createPlan,
  updatePlan,
  listPlans,
  idParam,
  customerParam,
  createMembership,
  cancelMembership,
  extendMembership,
  listMemberships,
  listOwnMemberships,
  reportPeriods
};
