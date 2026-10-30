const { z } = require('zod');
const { objectId, pagination, search } = require('./common');
const { STATUS_CATEGORIES, APPLICANT_TYPES, CHECKLIST_REQUIREMENTS, SUBMISSION_MODES, PASSPORT_REQUIREMENTS } = require('../config/visa');

const text = (label, max) => z.string(`${label} must be text.`).trim().max(max, `${label} must be at most ${max} characters.`);
const required = (label, max) => text(label, max).min(1, `${label} is required.`);
const money = (label) => z.number(`${label} must be a number.`).min(0, `${label} cannot be negative.`).max(100_000_000, `${label} is too large.`);

const httpUrl = (label) =>
  z
    .string(`${label} must be text.`)
    .trim()
    .max(500, `${label} is too long.`)
    .refine((value) => {
      try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    }, `${label} must be a http or https link.`);

const idParam = z.object({ id: objectId });

// ---------------------------------------------------------------- countries

const country = {
  name: required('Name', 80),
  code: z
    .string('Code is required.')
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,3}$/, 'The country code is 2 or 3 letters.'),
  flag: text('Flag', 16),
  description: text('Description', 1000),
  status: z.enum(['active', 'paused'], 'Status must be active or paused.'),
  displayOrder: z.number().int().min(1).max(10000),
  processingMode: text('Processing mode', 60),
  processingTime: text('Processing time', 60),
  physicalPassportRequired: z.boolean(),
  expressAvailable: z.boolean(),
  richChecklist: text('Checklist text', 20000),
  sampleDocs: z
    .array(z.object({ name: required('Sample name', 120), type: text('Sample type', 40).optional(), url: httpUrl('Sample link') }))
    .max(20, 'At most 20 sample documents.')
};

const createCountry = z.object({ ...country, flag: country.flag.optional(), description: country.description.optional(), status: country.status.optional(), displayOrder: country.displayOrder.optional(), processingMode: country.processingMode.optional(), processingTime: country.processingTime.optional(), physicalPassportRequired: country.physicalPassportRequired.optional(), expressAvailable: country.expressAvailable.optional(), richChecklist: country.richChecklist.optional(), sampleDocs: country.sampleDocs.optional() });

const updateCountry = z.object(Object.fromEntries(Object.entries(country).map(([key, schema]) => [key, schema.optional()])));

const listCountries = z.object({ search, status: z.enum(['active', 'paused']).optional(), ...pagination });

// ---------------------------------------------------------------- visa types

const type = {
  countryId: objectId,
  name: required('Name', 80),
  description: text('Description', 1000),
  processingTime: text('Processing time', 60),
  entries: z.enum(['single', 'double', 'multiple'], 'Entries must be single, double or multiple.'),
  currency: z
    .string('Currency is required.')
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'A currency code is three letters.'),
  b2cPrice: money('The B2C price'),
  b2bNetPrice: z.union([money('The B2B net price'), z.null(), z.undefined()]).optional().transform((v) => (v == null ? 0 : v)),
  fees: z.object({ embassy: money('The embassy fee').optional(), service: money('The service fee').optional(), vat: money('The VAT').optional() }),
  validFrom: z
    .union([
      z.string().trim().refine((value) => !value || (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))), 'Valid from must be a date.').transform((value) => (value ? new Date(value) : null)),
      z.date(),
      z.null(),
      z.undefined(),
    ])
    .optional(),
  terms: text('Terms', 5000),
  status: z.enum(['active', 'paused'], 'Status must be active or paused.'),
  passportRequirement: z.enum(PASSPORT_REQUIREMENTS),
  pickupAvailable: z.boolean(),
  officeSubmissionAvailable: z.boolean()
};

const optionalKeys = ['description', 'processingTime', 'entries', 'currency', 'fees', 'validFrom', 'terms', 'status', 'passportRequirement', 'pickupAvailable', 'officeSubmissionAvailable'];
const createType = z.object(Object.fromEntries(Object.entries(type).map(([key, schema]) => [key, optionalKeys.includes(key) ? schema.optional() : schema])));
const updateType = z.object(Object.fromEntries(Object.entries(type).map(([key, schema]) => [key, schema.optional()])));

const listTypes = z.object({ countryId: objectId.optional(), status: z.enum(['active', 'paused']).optional(), search, ...pagination });

// ---------------------------------------------------------------- checklists

const checklistParam = z.object({ countryId: objectId, visaTypeId: objectId, applicantType: z.enum(APPLICANT_TYPES, 'Unknown applicant type.') });

const checklistItem = z.object({
  label: required('Item name', 200),
  requirement: z.enum(CHECKLIST_REQUIREMENTS).optional(),
  active: z.boolean().optional(),
  submissionMode: z.enum(SUBMISSION_MODES).optional(),
  fileFormats: text('File formats', 60).optional(),
  maxSizeMb: z.number().int().min(1).max(25).optional()
});

const saveChecklist = z.object({ items: z.array(checklistItem, 'Items must be a list.').max(50, 'At most 50 items.') });

// ---------------------------------------------------------------- statuses

const status = {
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'The key is lower case letters, digits and underscores, starting with a letter.'),
  displayName: required('Name', 60),
  customerMessage: text('Customer message', 500),
  internalDescription: text('Internal description', 500),
  category: z.enum(STATUS_CATEGORIES, 'Unknown category.'),
  active: z.boolean(),
  displayOrder: z.number().int().min(1).max(10000)
};

const createStatus = z.object({ ...status, key: status.key.optional(), customerMessage: status.customerMessage.optional(), internalDescription: status.internalDescription.optional(), active: status.active.optional(), displayOrder: status.displayOrder.optional() });
const updateStatus = z.object({ displayName: status.displayName.optional(), customerMessage: status.customerMessage.optional(), internalDescription: status.internalDescription.optional(), category: status.category.optional(), active: status.active.optional(), displayOrder: status.displayOrder.optional() });

const listStatuses = z.object({ active: z.enum(['true', 'false']).optional(), ...pagination });

module.exports = { idParam, createCountry, updateCountry, listCountries, createType, updateType, listTypes, checklistParam, saveChecklist, listStatuses, createStatus, updateStatus };
