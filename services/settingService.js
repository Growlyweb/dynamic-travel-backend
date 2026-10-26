const { z } = require('zod');
const Setting = require('../models/Setting');
const { AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');

const BASE_CURRENCY = 'BDT';

const currencyCode = z
  .string('Currency code is required.')
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'A currency code is three letters, for example USD.');

const currency = z.object({
  code: currencyCode,
  name: z.string().trim().min(1).max(60),
  symbol: z.string().trim().min(1).max(5),
  // How many BDT one unit of this currency is worth. The base currency is always 1.
  rateToBase: z.number('The rate must be a number.').positive('The rate must be above zero.').max(1_000_000),
  source: z.enum(['base', 'manual', 'api']),
  updatedAt: z.string().optional()
});

// Every setting the platform knows. `schema` is what an admin may save, `defaults` is what is used until then.
// Limits and retention are settings, not constants, because the client still has to confirm them.
const DEFINITIONS = {
  'visa.documents': {
    defaults: { maxSizeMb: 10, allowedTypes: ['pdf', 'jpg', 'png', 'webp'], maxFilesPerItem: 5 },
    schema: z.object({
      maxSizeMb: z.number().int().min(1).max(25),
      allowedTypes: z.array(z.enum(['pdf', 'jpg', 'png', 'webp'])).min(1),
      maxFilesPerItem: z.number().int().min(1).max(20)
    })
  },
  'visa.retention': {
    defaults: { days: 730 },
    schema: z.object({ days: z.number().int().min(30).max(3650) })
  },
  'visa.duplicateWindowDays': {
    defaults: { days: 90 },
    schema: z.object({ days: z.number().int().min(0).max(365) })
  },
  currencies: {
    defaults: {
      base: BASE_CURRENCY,
      items: [
        { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', rateToBase: 1, source: 'base' },
        { code: 'USD', name: 'US Dollar', symbol: '$', rateToBase: 122, source: 'manual' }
      ]
    },
    schema: z
      .object({ base: z.literal(BASE_CURRENCY), items: z.array(currency).min(1).max(20) })
      .superRefine((value, ctx) => {
        const codes = value.items.map((item) => item.code);
        if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', message: 'A currency is listed twice.' });
        const base = value.items.find((item) => item.code === BASE_CURRENCY);
        if (!base || base.rateToBase !== 1) ctx.addIssue({ code: 'custom', message: `${BASE_CURRENCY} must be listed with a rate of 1.` });
      })
  }
};

const definitionOf = (key) => {
  const definition = DEFINITIONS[key];
  if (!definition) throw new ApiError(404, 'Setting not found.', { code: 'SETTING_NOT_FOUND' });
  return definition;
};

const get = async (key) => {
  const definition = definitionOf(key);
  const row = await Setting.findOne({ key }).lean();
  return row ? row.value : definition.defaults;
};

const getAll = async () => {
  const rows = await Setting.find({ key: { $in: Object.keys(DEFINITIONS) } }).lean();
  const saved = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return Object.fromEntries(Object.entries(DEFINITIONS).map(([key, { defaults }]) => [key, saved[key] ?? defaults]));
};

const set = async (actor, key, value, context = {}) => {
  const definition = definitionOf(key);
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({ field: issue.path.join('.') || 'value', message: issue.message }));
    throw new ApiError(422, errors.map((e) => e.message).join(' '), { errors, code: 'VALIDATION_ERROR' });
  }

  await Setting.findOneAndUpdate({ key }, { value: parsed.data, updatedBy: actor.id }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await auditService.record({ actorUserId: actor.id, action: AUDIT_ACTIONS.SETTING_CHANGED, resource: `setting:${key}`, ip: context.ip });
  return parsed.data;
};

// The rate used to turn an amount in `code` into BDT. A currency that is not listed cannot be used on a price.
const rateFor = async (code) => {
  const { items } = await get('currencies');
  const found = items.find((item) => item.code === String(code).toUpperCase());
  if (!found) throw new ApiError(422, `${code} is not an enabled currency. Add it in the currency settings first.`, { code: 'CURRENCY_NOT_ENABLED' });
  return found.rateToBase;
};

module.exports = { BASE_CURRENCY, DEFINITIONS, get, getAll, set, rateFor };
