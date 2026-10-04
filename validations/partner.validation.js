const { z } = require('zod');
const { APPROVAL_STATUS } = require('../config/constants');
const { objectId, pagination, search } = require('./common');

const listPartners = z.object({
  ...pagination,
  search,
  approvalStatus: z.enum(Object.values(APPROVAL_STATUS)).optional()
});

const decide = z.object({
  decision: z.enum(Object.values(APPROVAL_STATUS).filter((s) => s !== APPROVAL_STATUS.PENDING), 'Invalid decision.'),
  note: z.string().trim().max(500).optional()
});

const reviewDocument = z.object({
  status: z.enum(['VERIFIED', 'REJECTED'], 'Status must be VERIFIED or REJECTED.'),
  note: z.string().trim().max(500).optional()
});

const partnerParam = z.object({ id: objectId });
const reviewParam = z.object({ id: objectId, docId: objectId });
const documentParam = z.object({ partnerId: objectId, docId: objectId });

module.exports = { listPartners, decide, reviewDocument, partnerParam, reviewParam, documentParam };
