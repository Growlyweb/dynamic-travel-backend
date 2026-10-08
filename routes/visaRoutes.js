const express = require('express');
const router = express.Router();
const visaController = require('../controllers/visaController');

router.get('/dashboard', visaController.getVisaDashboard);

// Countries
router.get('/countries', visaController.getCountries);
router.post('/countries', visaController.createCountry);
router.patch('/countries/:id', visaController.updateCountry);
router.delete('/countries/:id', visaController.deleteCountry);

// Visa Types
router.get('/types', visaController.getVisaTypes);
router.post('/types', visaController.createVisaType);

// Checklists
router.get('/checklists/:countryId/:visaTypeId/:applicantType', visaController.getChecklist);
router.put('/checklists/:countryId/:visaTypeId/:applicantType', visaController.saveChecklist);

// Applications
router.get('/applications', visaController.getApplications);
router.get('/applications/:id', visaController.getApplicationById);

module.exports = router;
