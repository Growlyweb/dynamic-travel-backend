const express = require('express');
const router = express.Router();
const visaController = require('../controllers/visaController');
const { authenticate } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizeMiddleware');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api/visa. Internal users only. An admin always passes; staff need the permission an admin gave them:
// VISA_VIEW to read, VISA_EDIT to change countries, visa types and checklists.
// (This module still runs on in-memory demo data, see controllers/visaController.js.)
router.use(authenticate);

const view = requirePermission(PERMISSIONS.VISA_VIEW);
const edit = requirePermission(PERMISSIONS.VISA_EDIT);

router.get('/dashboard', view, visaController.getVisaDashboard);

// Countries
router.get('/countries', view, visaController.getCountries);
router.post('/countries', edit, visaController.createCountry);
router.patch('/countries/:id', edit, visaController.updateCountry);
router.delete('/countries/:id', edit, visaController.deleteCountry);

// Visa Types
router.get('/types', view, visaController.getVisaTypes);
router.post('/types', edit, visaController.createVisaType);

// Checklists
router.get('/checklists/:countryId/:visaTypeId/:applicantType', view, visaController.getChecklist);
router.put('/checklists/:countryId/:visaTypeId/:applicantType', edit, visaController.saveChecklist);

// Applications
router.get('/applications', view, visaController.getApplications);
router.get('/applications/:id', view, visaController.getApplicationById);

module.exports = router;
