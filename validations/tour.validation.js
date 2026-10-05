const { z } = require('zod');
const { TOUR_STATUS, TOUR_CURRENCIES, CUSTOM_REQUEST_STATUS } = require('../config/constants');
const { objectId, phone, pagination, search } = require('./common');

// ---------------------------------------------------------------- building blocks

const required = (label, max) =>
  z.string(`${label} is required.`).trim().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`);

const optionalText = (label, max) => z.string(`${label} must be text.`).trim().max(max, `${label} must be at most ${max} characters.`);

const money = (label) =>
  z.number(`${label} must be a number.`).min(0, `${label} cannot be negative.`).max(100_000_000, `${label} is too large.`);

const whole = (label, min, max) =>
  z.number(`${label} must be a number.`).int(`${label} must be a whole number.`).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`);

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

const textList = (label, maxItems = 50) =>
  z.array(required(label, 200), `${label} must be a list.`).max(maxItems, `${label} can have at most ${maxItems} entries.`);

// "2026-11-01" or a full ISO date-time. Anything else (numbers, "tomorrow") is refused.
const isoDate = (label) =>
  z
    .string(`${label} is required.`)
    .trim()
    .refine((value) => /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be a valid date.`)
    .transform((value) => new Date(value));

// An id from this API (24 hex characters) or an id the frontend used before (cat_beach, tour_205).
const idOrLegacy = z
  .string('Id is required.')
  .trim()
  .regex(/^[A-Za-z0-9_-]{3,60}$/, 'Invalid id.');

const itineraryDay = z.object({
  day: whole('Day', 1, 365),
  title: required('Title', 150),
  description: required('Description', 2000)
});

// Days are unique, and always come out in ascending order.
const itinerary = z
  .array(itineraryDay, 'Itinerary must be a list.')
  .max(365, 'Itinerary is too long.')
  .refine((items) => new Set(items.map((item) => item.day)).size === items.length, 'Each itinerary day can appear only once.')
  .transform((items) => [...items].sort((a, b) => a.day - b.day));

const atLeastOne = (value) => Object.values(value).some((v) => v !== undefined);
const AT_LEAST_ONE = 'Send at least one field to change.';

// ---------------------------------------------------------------- categories

const createCategory = z.object({
  name: required('Name', 80).refine((value) => value.length >= 2, 'Name must be at least 2 characters.')
});

const listCategories = z.object({
  ...pagination,
  search,
  includeInactive: z.enum(['true', 'false'], 'includeInactive must be true or false.').optional()
});

const categoryParam = z.object({ id: idOrLegacy });

// ---------------------------------------------------------------- tours

const tourFields = {
  name: required('Name', 150),
  country: required('Country', 80),
  destination: required('Destination', 150),
  category: idOrLegacy.optional(),
  durationDays: whole('Duration', 1, 365),
  priceCurrency: z.enum(TOUR_CURRENCIES, `Currency must be one of ${TOUR_CURRENCIES.join(', ')}.`),
  price: money('Price'),
  b2bPrice: money('B2B price').optional(),
  seats: whole('Seats', 0, 100_000).optional(),
  status: z.enum(Object.values(TOUR_STATUS), `Status must be one of ${Object.values(TOUR_STATUS).join(', ')}.`),
  rating: z.number('Rating must be a number.').min(0, 'Rating must be between 0 and 5.').max(5, 'Rating must be between 0 and 5.').optional(),
  coverImage: httpUrl('Cover image').optional(),
  gallery: z.array(httpUrl('Gallery image'), 'Gallery must be a list.').max(20, 'Gallery can have at most 20 images.'),
  description: required('Description', 5000),
  included: textList('Included item'),
  excluded: textList('Excluded item'),
  hotels: textList('Hotel'),
  itinerary,
  terms: optionalText('Terms', 5000)
};

// A new tour starts as a draft with empty lists unless the body says otherwise.
const createTour = z.object({
  ...tourFields,
  status: tourFields.status.default(TOUR_STATUS.DRAFT),
  gallery: tourFields.gallery.default([]),
  included: tourFields.included.default([]),
  excluded: tourFields.excluded.default([]),
  hotels: tourFields.hotels.default([]),
  itinerary: tourFields.itinerary.default([]),
  terms: tourFields.terms.default('')
});

// Every field is optional on update, but at least one must be sent.
const updateTour = z.object(tourFields).partial().refine(atLeastOne, AT_LEAST_ONE);

const SORTS = ['createdAt', '-createdAt', 'price', '-price', 'durationDays', '-durationDays', 'rating', '-rating'];
const number = (label) => z.string().regex(/^\d+(\.\d+)?$/, `${label} must be a number.`).optional();

const listTours = z.object({
  ...pagination,
  search,
  category: z.string().trim().max(400).optional(), // one id, or several separated by commas
  country: z.string().trim().max(80).optional(),
  destination: z.string().trim().max(150).optional(),
  status: z.enum(Object.values(TOUR_STATUS), 'Invalid status.').optional(),
  minPrice: number('minPrice'),
  maxPrice: number('maxPrice'),
  durationDays: z.string().regex(/^\d+$/, 'durationDays must be a whole number.').optional(),
  sort: z.enum(SORTS, `sort must be one of ${SORTS.join(', ')}.`).optional()
});

const tourParam = z.object({ id: idOrLegacy });

// ---------------------------------------------------------------- custom tour requests

const customRequestFields = {
  customer: required('Customer name', 100),
  phone,
  destination: required('Destination', 150),
  travelers: whole('Travelers', 1, 100),
  startDate: isoDate('Start date'),
  endDate: isoDate('End date'),
  hotel: required('Hotel preference', 100),
  transportation: optionalText('Transportation', 60).min(1, 'Transportation cannot be empty.').default('Private car'),
  activities: textList('Activity', 20).default([]),
  requirements: optionalText('Requirements', 2000).default(''),
  itinerary: itinerary.default([])
};

const createCustomRequest = z.object(customRequestFields).superRefine((value, ctx) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date cannot be before the start date.' });
  }
});

const listCustomRequests = z.object({
  ...pagination,
  search,
  status: z.enum(Object.values(CUSTOM_REQUEST_STATUS), 'Invalid status.').optional()
});

const customRequestParam = z.object({ id: objectId });

const setCustomRequestStatus = z.object({
  status: z.enum(Object.values(CUSTOM_REQUEST_STATUS), `Status must be one of ${Object.values(CUSTOM_REQUEST_STATUS).join(', ')}.`),
  note: optionalText('Note', 500).optional()
});

module.exports = {
  createCategory,
  listCategories,
  categoryParam,
  createTour,
  updateTour,
  listTours,
  tourParam,
  createCustomRequest,
  listCustomRequests,
  customRequestParam,
  setCustomRequestStatus
};
