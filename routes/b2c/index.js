const express = require('express');
const router = express.Router();

const profileController = require('../../controllers/profileController');
const membershipController = require('../../controllers/membershipController');
const { authenticate } = require('../../middleware/authMiddleware');
const { requireRole } = require('../../middleware/authorizeMiddleware');
const validate = require('../../middleware/validationMiddleware');
const { updateProfile } = require('../../validations/profile.validation');
const { listOwnMemberships } = require('../../validations/membership.validation');
const { ROLES } = require('../../config/constants');

// Mounted at /api/b2c. B2C users only. Handlers use req.user.id, never an id from the body.
router.use(authenticate, requireRole(ROLES.B2C));

router.get('/profile', profileController.getProfile);
router.patch('/profile', validate({ body: updateProfile }), profileController.updateProfile);

// A customer's own memberships (read-only). The customer is always the one in the token.
router.get('/memberships', validate({ query: listOwnMemberships }, { statusCode: 400 }), membershipController.listOwn);

const b2cController = require('../../controllers/b2cController');

// Customer Dashboard Overview
router.get('/overview', b2cController.getOverview);

// Customer Visa Applications
router.get('/visa-applications', b2cController.listVisaApplications);
router.post('/visa-applications', b2cController.createVisaApplication);

// Customer Tour Bookings
router.get('/tours/bookings', b2cController.listTourBookings);
router.post('/tours/bookings', b2cController.createTourBooking);

// Customer Saved Items (Wishlist)
router.get('/saved', b2cController.listSavedItems);
router.post('/saved', b2cController.addSavedItem);
router.delete('/saved/:id', b2cController.removeSavedItem);

module.exports = router;
