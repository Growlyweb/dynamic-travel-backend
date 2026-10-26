const books = require('../services/accounting/books');
const reports = require('../services/accounting/reports');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');

// The simple Accounts screens. Every number is added up from the journals (services/accounting/reports.js).
// Money is in taka. Lists answer with data as an array plus meta and pagination.
const ok = (res, message, data, status = 200) => sendResponse(res, status, true, message, data);
const paged = (res, message, { rows, total, ...extra }, query) => {
  const { page, limit } = paginate(query);
  return sendResponse(res, 200, true, message, rows, { ...buildMeta(total, page, limit), ...extra });
};

// ---- categories
exports.categories = asyncHandler(async (req, res) => ok(res, 'Categories fetched.', await books.categoryList()));
exports.addCategory = asyncHandler(async (req, res) => ok(res, 'Category created.', await books.addCategory(req.user, req.body), 201));
exports.removeCategory = asyncHandler(async (req, res) => {
  await books.removeCategory(req.user, req.params.id);
  ok(res, 'Category deleted.', null);
});
exports.categoryReport = asyncHandler(async (req, res) => ok(res, 'Category report fetched.', await reports.categoryReport(req.query)));

// ---- reports
exports.home = asyncHandler(async (req, res) => ok(res, 'Accounts overview fetched.', await reports.home(req.query)));
exports.monthly = asyncHandler(async (req, res) => ok(res, 'Monthly report fetched.', await reports.monthly(req.query.year, req.query.month)));
exports.yearly = asyncHandler(async (req, res) => ok(res, 'Yearly report fetched.', await reports.yearly(req.query.year)));
exports.balances = asyncHandler(async (req, res) => ok(res, 'Balances fetched.', await reports.accountBalances()));
exports.priceList = asyncHandler(async (req, res) => ok(res, 'Price list fetched.', await books.priceList()));
exports.partners = asyncHandler(async (req, res) => ok(res, 'Partners fetched.', await reports.partners()));
exports.payables = asyncHandler(async (req, res) => ok(res, 'Vendor payables fetched.', await reports.supplierPayables()));
exports.advances = asyncHandler(async (req, res) => ok(res, 'Vendor advances fetched.', await reports.supplierAdvances()));

// ---- sales
exports.listSales = asyncHandler(async (req, res) => {
  const { page, limit } = paginate(req.query);
  const { rows, summary, total } = await reports.listFiles(req.query, { page, limit });
  paged(res, 'Sales fetched.', { rows, total, summary }, req.query);
});
exports.getSale = asyncHandler(async (req, res) => ok(res, 'Sale fetched.', await books.getSale(req.params.id)));
exports.createSale = asyncHandler(async (req, res) => ok(res, 'Sale saved.', await books.createSale(req.user, req.body), 201));
exports.updateSale = asyncHandler(async (req, res) => ok(res, 'Sale updated.', await books.updateSale(req.user, req.params.id, req.body)));
exports.cancelSale = asyncHandler(async (req, res) => ok(res, 'Sale cancelled.', await books.cancelSale(req.user, req.params.id, req.body)));
exports.addCost = asyncHandler(async (req, res) => ok(res, 'Cost added.', await books.addCost(req.user, req.params.id, req.body), 201));
exports.dues = asyncHandler(async (req, res) => {
  const { page, limit } = paginate(req.query);
  const { rows, totals, total } = await reports.listDues({ page, limit });
  paged(res, 'Dues fetched.', { rows, total, totals }, req.query);
});

// ---- receipts, expenses
exports.listReceipts = asyncHandler(async (req, res) => {
  const { page, limit } = paginate(req.query);
  const { rows, summary, total } = await books.listReceipts({ ...req.query, page, limit });
  paged(res, 'Money receipts fetched.', { rows, total, summary }, req.query);
});
exports.getReceipt = asyncHandler(async (req, res) => ok(res, 'Money receipt fetched.', await books.getReceipt(req.params.id)));
exports.createReceipt = asyncHandler(async (req, res) => ok(res, 'Money receipt saved.', await books.addReceipt(req.user, req.body), 201));
exports.voidReceipt = asyncHandler(async (req, res) => ok(res, 'Money receipt voided.', await books.voidReceipt(req.user, req.params.id, req.body)));
exports.expenseAccounts = asyncHandler(async (req, res) => ok(res, 'Expense accounts fetched.', await books.expenseAccounts()));
exports.createExpense = asyncHandler(async (req, res) => ok(res, 'Expense saved.', await books.addExpense(req.user, req.body), 201));
exports.partnerTransaction = asyncHandler(async (req, res) => ok(res, 'Partner transaction saved.', await books.addPartnerTransaction(req.user, req.body), 201));

// ---- clients
exports.listParties = asyncHandler(async (req, res) => ok(res, 'Clients fetched.', await books.listParties(req.query.type)));
exports.createParty = asyncHandler(async (req, res) => ok(res, 'Client created.', await books.addParty(req.user, req.body), 201));
