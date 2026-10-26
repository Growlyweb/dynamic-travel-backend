const express = require('express');
const router = express.Router();

const controller = require('../controllers/settingController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireRole, requirePermission } = require('../middleware/authorizeMiddleware');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/setting.validation');
const { ROLES } = require('../config/constants');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api/settings. Internal users only.
//   Currencies and their rates: any admin or staff can read; changing a rate needs VISA_EDIT (admin always passes).
//   Everything else (document limits, retention, ...): read needs SETTINGS_VIEW, changing is for admins.
router.use(authenticate);

const internal = requireRole(ROLES.ADMIN, ROLES.STAFF);

router.get('/currencies', internal, controller.currencies);
router.put('/currencies', requirePermission(PERMISSIONS.VISA_EDIT), validate({ body: schemas.saveCurrencies }), controller.saveCurrencies);
router.post('/currencies/:code/refresh', requirePermission(PERMISSIONS.VISA_EDIT), validate({ params: schemas.currencyParam }), controller.refreshCurrency);

router.get('/', requirePermission(PERMISSIONS.SETTINGS_VIEW), controller.list);
router.put('/:key', requireRole(ROLES.ADMIN), validate({ params: schemas.keyParam, body: schemas.saveSetting }), controller.save);

module.exports = router;
