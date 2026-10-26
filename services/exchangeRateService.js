const ApiError = require('../utils/ApiError');
const settingService = require('./settingService');

// Free daily rates, no key needed. https://www.exchangerate-api.com/docs/free
const RATES_URL = 'https://open.er-api.com/v6/latest';
const TIMEOUT_MS = 8000;

// How many BDT one unit of `code` is worth right now, from the free API. Nothing is saved here.
const fetchRate = async (code) => {
  let response;
  try {
    response = await fetch(`${RATES_URL}/${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ApiError(502, 'The exchange rate service did not answer. Enter the rate by hand.', { code: 'RATE_SERVICE_UNAVAILABLE' });
  }
  if (!response.ok) throw new ApiError(502, 'The exchange rate service refused the request. Enter the rate by hand.', { code: 'RATE_SERVICE_UNAVAILABLE' });

  const body = await response.json().catch(() => null);
  const rate = body && body.result === 'success' ? body.rates && body.rates[settingService.BASE_CURRENCY] : undefined;
  if (typeof rate !== 'number' || !(rate > 0)) {
    throw new ApiError(502, `The exchange rate service has no rate for ${code}. Enter the rate by hand.`, { code: 'RATE_SERVICE_UNAVAILABLE' });
  }
  return rate;
};

// Fetches the default rate and stores it on the currency. A rate typed by hand is replaced only when someone asks
// for a refresh, and staff can type over it again.
const refresh = async (actor, code, context = {}) => {
  const upper = String(code).toUpperCase();
  if (upper === settingService.BASE_CURRENCY) throw new ApiError(400, `${upper} is the base currency and always has a rate of 1.`);

  const currencies = await settingService.get('currencies');
  const item = currencies.items.find((entry) => entry.code === upper);
  if (!item) throw new ApiError(404, `${upper} is not an enabled currency.`, { code: 'CURRENCY_NOT_ENABLED' });

  const rate = await fetchRate(upper);
  const items = currencies.items.map((entry) =>
    entry.code === upper ? { ...entry, rateToBase: rate, source: 'api', updatedAt: new Date().toISOString() } : entry
  );
  return settingService.set(actor, 'currencies', { ...currencies, items }, context);
};

module.exports = { fetchRate, refresh };
