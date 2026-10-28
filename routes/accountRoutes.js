const express = require('express');
const router = express.Router();

const controller = require('../controllers/accountsController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireRole, requirePermission } = require('../middleware/authorizeMiddleware');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/accounts.validation');
const asyncHandler = require('../utils/asyncHandler');
const { ensureChartIfEmpty } = require('../services/accounting/chart');
const { ROLES } = require('../config/constants');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api/accounts: the simple Accounts screens. Internal users only.
//   reading               REPORTS_VIEW
//   recording money       ACCOUNTS_EDIT (sales, costs, receipts, expenses, clients, categories)
//   voiding and cancelling ACCOUNTS_VOID
//   partner capital       ADMIN only
// An admin always passes. All numbers come from the journals, so these screens and any accountant view agree.
router.use(authenticate);
router.use(asyncHandler(async (req, res, next) => {
  await ensureChartIfEmpty();
  next();
}));

const view = requirePermission(PERMISSIONS.REPORTS_VIEW);
const edit = requirePermission(PERMISSIONS.ACCOUNTS_EDIT);
const voider = requirePermission(PERMISSIONS.ACCOUNTS_VOID);

// Reports
router.get('/home', view, validate({ query: schemas.homeQuery }), controller.home);
router.get('/monthly', view, validate({ query: schemas.monthlyQuery }), controller.monthly);
router.get('/yearly', view, validate({ query: schemas.yearlyQuery }), controller.yearly);
router.get('/balances', view, controller.balances);
router.get('/price-list', view, controller.priceList);
router.get('/payables', view, controller.payables);
router.get('/advances', view, controller.advances);
router.get('/partners', view, controller.partners);
router.post('/partners/transactions', requireRole(ROLES.ADMIN), validate({ body: schemas.partnerTransaction }), controller.partnerTransaction);

// Categories
router.get('/categories', view, controller.categories);
router.get('/categories/report', view, validate({ query: schemas.range }), controller.categoryReport);
router.post('/categories', edit, validate({ body: schemas.createCategory }), controller.addCategory);
router.delete('/categories/:id', edit, validate({ params: schemas.idParam }), controller.removeCategory);

// Sales
router.get('/sales', view, validate({ query: schemas.listSales }), controller.listSales);
router.post('/sales', edit, validate({ body: schemas.createSale }), controller.createSale);
router.get('/sales/:id', view, validate({ params: schemas.idParam }), controller.getSale);
router.patch('/sales/:id', edit, validate({ params: schemas.idParam, body: schemas.updateSale }), controller.updateSale);
router.post('/sales/:id/cancel', voider, validate({ params: schemas.idParam, body: schemas.cancelSale }), controller.cancelSale);
router.post('/sales/:id/costs', edit, validate({ params: schemas.idParam, body: schemas.addCost }), controller.addCost);
router.get('/dues', view, validate({ query: schemas.listDues }), controller.dues);

// Receipts and expenses
router.get('/receipts', view, validate({ query: schemas.listReceipts }), controller.listReceipts);
router.post('/receipts', edit, validate({ body: schemas.createReceipt }), controller.createReceipt);
router.get('/receipts/:id', view, validate({ params: schemas.receiptParam }), controller.getReceipt);
router.post('/receipts/:id/void', voider, validate({ params: schemas.idParam, body: schemas.voidBody }), controller.voidReceipt);
router.get('/expense-accounts', view, controller.expenseAccounts);
router.post('/expenses', edit, validate({ body: schemas.createExpense }), controller.createExpense);

// Clients (B2B agents and B2C customers)
router.get('/parties', view, validate({ query: schemas.listParties }), controller.listParties);
router.post('/parties', edit, validate({ body: schemas.createParty }), controller.createParty);

module.exports = router;
