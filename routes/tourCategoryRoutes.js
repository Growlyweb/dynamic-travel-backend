const express = require('express');
const router = express.Router();

const controller = require('../controllers/tourCategoryController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizeMiddleware');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/tour.validation');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api/tour-categories.
// Reading is public. Changing needs an admin, or staff an admin gave TOUR_MANAGE to.

router.get('/', optionalAuthenticate, validate({ query: schemas.listCategories }), controller.list);
router.get('/:id', optionalAuthenticate, validate({ params: schemas.categoryParam }), controller.get);

router.post('/', authenticate, requirePermission(PERMISSIONS.TOUR_MANAGE), validate({ body: schemas.createCategory }), controller.create);
router.delete('/:id', authenticate, requirePermission(PERMISSIONS.TOUR_MANAGE), validate({ params: schemas.categoryParam }), controller.remove);

module.exports = router;
