const { z } = require('zod');
const { objectId, pagination, search } = require('./common');

const text = (label, max) => z.string(`${label} must be text.`).trim().max(max, `${label} must be at most ${max} characters.`);
const required = (label, max) => text(label, max).min(1, `${label} is required.`);

const httpUrl = z
  .string('Sample link must be text.')
  .trim()
  .max(500, 'Sample link is too long.')
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Sample link must be a http or https link.');

const idParam = z.object({ id: objectId });

const fields = {
  countryId: objectId,
  visaTypeId: objectId,
  title: required('Title', 150),
  description: text('Description', 20000),
  processingTime: text('Processing time', 60),
  media: z.array(z.object({ name: required('Sample name', 120), type: text('Sample type', 40).optional(), url: httpUrl })).max(20, 'At most 20 samples.'),
  displayOrder: z.number('Display order must be a number.').int('Display order must be a whole number.').min(1, 'Display order starts at 1.').max(10000, 'Display order is too large.'),
  status: z.enum(['active', 'inactive'], 'Status must be active or inactive.')
};

const optional = (...keys) => Object.fromEntries(keys.map((key) => [key, fields[key].optional()]));

const createEntry = z.object({ countryId: fields.countryId, visaTypeId: fields.visaTypeId, title: fields.title, ...optional('description', 'processingTime', 'media', 'displayOrder', 'status') });
// The country and visa type are what the page is about, so they cannot change: add a new page instead.
const updateEntry = z.object(optional('title', 'description', 'processingTime', 'media', 'displayOrder', 'status'));

const listEntries = z.object({
  search,
  countryId: objectId.optional(),
  entries: z.enum(['single', 'double', 'multiple'], 'Entry type must be single, double or multiple.').optional(),
  status: z.enum(['active', 'inactive']).optional(),
  ...pagination
});

module.exports = { idParam, createEntry, updateEntry, listEntries };
