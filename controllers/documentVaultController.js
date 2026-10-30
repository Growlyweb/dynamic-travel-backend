const vaultService = require('../services/documentVaultService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/documents
exports.listDocuments = asyncHandler(async (req, res) => {
  const result = await vaultService.listDocuments(req.query);
  sendResponse(res, 200, true, 'Documents fetched successfully.', result.items, result.meta);
});

// PATCH /api/documents/:id/status
exports.updateStatus = asyncHandler(async (req, res) => {
  const result = await vaultService.updateDocumentStatus(req.user, req.params.id, req.body);
  sendResponse(res, 200, true, 'Document status updated successfully.', result);
});

// DELETE /api/documents/:id
exports.deleteDocument = asyncHandler(async (req, res) => {
  const result = await vaultService.deleteDocument(req.user, req.params.id);
  sendResponse(res, 200, true, 'Document deleted successfully.', result);
});
