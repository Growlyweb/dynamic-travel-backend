const express = require('express');
const router = express.Router();

const partnerController = require('../../controllers/partnerController');
const validate = require('../../middleware/validationMiddleware');
const schemas = require('../../validations/partner.validation');

// Mounted at /api/admin/b2b (auth + ADMIN role already applied by routes/admin/index.js)

router.get('/', validate({ query: schemas.listPartners }), partnerController.listPartners);
router.get('/:id', validate({ params: schemas.partnerParam }), partnerController.getPartner);

// Approve / reject / put under review / suspend a B2B partner
router.patch(
  '/:id/approval',
  validate({ params: schemas.partnerParam, body: schemas.decide }),
  partnerController.decide
);

// Mark an uploaded document VERIFIED or REJECTED
router.patch(
  '/:id/documents/:docId',
  validate({ params: schemas.reviewParam, body: schemas.reviewDocument }),
  partnerController.reviewDocument
);

module.exports = router;
