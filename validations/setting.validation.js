const { z } = require('zod');

const currencyItem = z.object({
  code: z
    .string('Currency code is required.')
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'A currency code is three letters, for example USD.'),
  name: z.string('Name is required.').trim().min(1, 'Name is required.').max(60, 'Name is too long.'),
  symbol: z.string('Symbol is required.').trim().min(1, 'Symbol is required.').max(5, 'Symbol is too long.'),
  rateToBase: z.number('The rate must be a number.').positive('The rate must be above zero.').max(1_000_000, 'The rate is too large.')
});

const saveCurrencies = z.object({
  items: z.array(currencyItem, 'Currencies must be a list.').min(1, 'List at least one currency.').max(20, 'At most 20 currencies.')
});

const currencyParam = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'A currency code is three letters.')
});

const keyParam = z.object({ key: z.string().trim().min(1).max(60) });

// The value is checked against the rules of its own setting inside settingService.
const saveSetting = z.object({ value: z.any().refine((value) => value !== undefined, 'A value is required.') });

module.exports = { saveCurrencies, currencyParam, keyParam, saveSetting };
