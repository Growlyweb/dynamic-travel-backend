const service = require('../services/visaCatalogService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// Mounted by routes/visaRoutes.js under /api/visa. Lists answer with `data` as an array and `meta` / `pagination`.

// ---- countries
exports.listCountries = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listCountries(req.query);
  sendResponse(res, 200, true, 'Visa countries fetched.', items, meta);
});
exports.getCountry = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Visa country fetched.', await service.getCountry(req.params.id)));
exports.createCountry = asyncHandler(async (req, res) =>
  sendResponse(res, 201, true, 'Country created.', await service.createCountry(req.user, req.body, contextOf(req)))
);
exports.updateCountry = asyncHandler(async (req, res) =>
  sendResponse(res, 200, true, 'Country updated.', await service.updateCountry(req.user, req.params.id, req.body, contextOf(req)))
);
exports.removeCountry = asyncHandler(async (req, res) => {
  await service.removeCountry(req.user, req.params.id, contextOf(req));
  sendResponse(res, 200, true, 'Country deleted.');
});

// ---- visa types
exports.listTypes = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listTypes(req.query);
  sendResponse(res, 200, true, 'Visa types fetched.', items, meta);
});
exports.getType = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Visa type fetched.', await service.getType(req.params.id)));
exports.createType = asyncHandler(async (req, res) =>
  sendResponse(res, 201, true, 'Visa type created.', await service.createType(req.user, req.body, contextOf(req)))
);
exports.updateType = asyncHandler(async (req, res) =>
  sendResponse(res, 200, true, 'Visa type updated.', await service.updateType(req.user, req.params.id, req.body, contextOf(req)))
);
exports.removeType = asyncHandler(async (req, res) => {
  await service.removeType(req.user, req.params.id, contextOf(req));
  sendResponse(res, 200, true, 'Visa type deleted.');
});

// ---- checklists
exports.getChecklist = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Checklist fetched.', await service.getChecklist(req.params)));
exports.saveChecklist = asyncHandler(async (req, res) =>
  sendResponse(res, 200, true, 'Checklist saved.', await service.saveChecklist(req.user, req.params, req.body, contextOf(req)))
);

// ---- statuses
exports.listStatuses = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listStatuses(req.query);
  sendResponse(res, 200, true, 'Visa statuses fetched.', items, meta);
});
exports.createStatus = asyncHandler(async (req, res) =>
  sendResponse(res, 201, true, 'Status created.', await service.createStatus(req.user, req.body, contextOf(req)))
);
exports.updateStatus = asyncHandler(async (req, res) =>
  sendResponse(res, 200, true, 'Status updated.', await service.updateStatus(req.user, req.params.id, req.body, contextOf(req)))
);
exports.removeStatus = asyncHandler(async (req, res) => {
  await service.removeStatus(req.user, req.params.id, contextOf(req));
  sendResponse(res, 200, true, 'Status deleted.');
});
