const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/notification.validation');

// All notification routes require an authenticated user
router.use(authenticate);

router.get('/', validate({ query: schemas.listNotifications }), notificationController.list);
router.post('/', validate({ body: schemas.createNotification }), notificationController.create);
router.post('/mark-all-read', notificationController.markAllRead);
router.patch('/:id', validate({ params: schemas.idParam, body: schemas.updateNotification }), notificationController.markAsRead);
router.delete('/:id', validate({ params: schemas.idParam }), notificationController.deleteNotification);

module.exports = router;
