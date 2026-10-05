const express = require('express');
const router = express.Router();

const tourController = require('../controllers/tourController');
const customTourController = require('../controllers/customTourController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { requireRole, requirePermission } = require('../middleware/authorizeMiddleware');
const { requireCustomerOrManager } = require('../services/tourAccess');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/tour.validation');
const { ROLES } = require('../config/constants');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api/tours.

// ---- Custom tour requests. Declared before /:id so "custom-requests" is never read as a tour id.
//   send    : B2C only
//   read    : a B2C customer sees their own, a tour manager sees all
//   status  : a tour manager moves it along, a B2C customer can only cancel their own new request
router.post('/custom-requests', authenticate, requireRole(ROLES.B2C), validate({ body: schemas.createCustomRequest }), customTourController.create);
router.get('/custom-requests', authenticate, requireCustomerOrManager, validate({ query: schemas.listCustomRequests }), customTourController.list);
router.get('/custom-requests/:id', authenticate, requireCustomerOrManager, validate({ params: schemas.customRequestParam }), customTourController.get);
router.patch(
  '/custom-requests/:id/status',
  authenticate,
  requireCustomerOrManager,
  validate({ params: schemas.customRequestParam, body: schemas.setCustomRequestStatus }),
  customTourController.setStatus
);

// ---- Tours. Reading is public (the answer depends on who asks). Changing needs TOUR_MANAGE.
router.get('/', optionalAuthenticate, validate({ query: schemas.listTours }), tourController.list);
router.get('/:id', optionalAuthenticate, validate({ params: schemas.tourParam }), tourController.get);

router.post('/', authenticate, requirePermission(PERMISSIONS.TOUR_MANAGE), validate({ body: schemas.createTour }), tourController.create);
router.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSIONS.TOUR_MANAGE),
  validate({ params: schemas.tourParam, body: schemas.updateTour }),
  tourController.update
);
router.delete('/:id', authenticate, requirePermission(PERMISSIONS.TOUR_MANAGE), validate({ params: schemas.tourParam }), tourController.remove);

module.exports = router;
