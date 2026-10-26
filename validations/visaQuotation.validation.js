const { z } = require('zod');
const { objectId, pagination, search } = require('./common');

const text = (label, max) => z.string(`${label} must be text.`).trim().max(max, `${label} must be at most ${max} characters.`);
const required = (label, max) => text(label, max).min(1, `${label} is required.`);
const amount = (label) => z.number(`${label} must be a number.`).min(0, `${label} cannot be negative.`).max(100_000_000, `${label} is too large.`);
const isoDate = (label) =>
  z
    .string(`${label} must be a date.`)
    .trim()
    .refine((value) => /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be a valid date.`)
    .transform((value) => new Date(value));

const idParam = z.object({ id: objectId });
const statuses = ['draft', 'sent', 'accepted', 'rejected', 'expired'];

const fields = {
  partnerId: objectId,
  clientName: required('Client name', 120),
  countryId: objectId,
  visaTypeId: objectId,
  quantity: z.number('Quantity must be a number.').int('Quantity must be a whole number.').min(1, 'Quantity must be at least 1.').max(1000, 'Quantity is too large.'),
  additionalFee: amount('The additional fee'),
  validUntil: isoDate('Valid until'),
  notes: text('Notes', 1000)
};

// A blank "valid until" means the default (14 days).
const blankDate = z.preprocess((value) => (value === '' || value === null ? undefined : value), fields.validUntil.optional());

const createQuotation = z.object({
  partnerId: fields.partnerId,
  clientName: fields.clientName,
  countryId: fields.countryId,
  visaTypeId: fields.visaTypeId,
  quantity: fields.quantity.optional(),
  additionalFee: fields.additionalFee.optional(),
  validUntil: blankDate,
  notes: fields.notes.optional()
});

const updateQuotation = z.object({
  partnerId: fields.partnerId.optional(),
  clientName: fields.clientName.optional(),
  countryId: fields.countryId.optional(),
  visaTypeId: fields.visaTypeId.optional(),
  quantity: fields.quantity.optional(),
  additionalFee: fields.additionalFee.optional(),
  validUntil: blankDate,
  notes: fields.notes.optional()
});

const changeStatus = z.object({ status: z.enum(['draft', 'sent', 'accepted', 'rejected'], 'Status must be draft, sent, accepted or rejected.') });

const listQuotations = z.object({ status: z.enum(statuses).optional(), partnerId: objectId.optional(), search, ...pagination });

const partnerLookup = z.object({ search });

module.exports = { idParam, createQuotation, updateQuotation, changeStatus, listQuotations, partnerLookup };
