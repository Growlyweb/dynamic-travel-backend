const settingService = require('../services/settingService');
const exchangeRateService = require('../services/exchangeRateService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// GET /api/settings
exports.list = asyncHandler(async (req, res) => {
  sendResponse(res, 200, true, 'Settings fetched.', await settingService.getAll());
});

// GET /api/settings/currencies
exports.currencies = asyncHandler(async (req, res) => {
  sendResponse(res, 200, true, 'Currencies fetched.', await settingService.get('currencies'));
});

// PUT /api/settings/currencies   (a rate typed by hand: the source becomes "manual")
exports.saveCurrencies = asyncHandler(async (req, res) => {
  const current = await settingService.get('currencies');
  const stamp = new Date().toISOString();
  const items = req.body.items.map((item) => {
    const before = current.items.find((entry) => entry.code === item.code);
    const changed = !before || before.rateToBase !== item.rateToBase;
    if (item.code === settingService.BASE_CURRENCY) return { ...item, source: 'base' };
    return changed ? { ...item, source: 'manual', updatedAt: stamp } : { ...item, source: before.source, updatedAt: before.updatedAt };
  });
  const saved = await settingService.set(req.user, 'currencies', { base: settingService.BASE_CURRENCY, items }, contextOf(req));
  sendResponse(res, 200, true, 'Currencies saved.', saved);
});

// POST /api/settings/currencies/:code/refresh   (default rate from the free exchange rate API)
exports.refreshCurrency = asyncHandler(async (req, res) => {
  const saved = await exchangeRateService.refresh(req.user, req.params.code, contextOf(req));
  sendResponse(res, 200, true, 'Exchange rate refreshed.', saved);
});

// PUT /api/settings/:key
exports.save = asyncHandler(async (req, res) => {
  const saved = await settingService.set(req.user, req.params.key, req.body.value, contextOf(req));
  sendResponse(res, 200, true, 'Setting saved.', { key: req.params.key, value: saved });
});
