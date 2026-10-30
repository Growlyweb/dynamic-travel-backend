const { z } = require('zod');
const { idParam, pagination, search, objectId } = require('./common');

const listDocuments = z.object({
  ...pagination,
  search,
  partnerId: objectId.optional(),
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
  type: z.string().trim().max(50).optional(),
  module: z.enum(['visa', 'partner', 'all']).optional()
});

const updateDocumentStatus = z.object({
  status: z.enum(['pending', 'verified', 'rejected']),
  reviewNote: z.string().trim().max(500).optional().default('')
});

module.exports = {
  listDocuments,
  idParam,
  updateDocumentStatus
};
