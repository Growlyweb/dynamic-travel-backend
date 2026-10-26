// OpenAPI entries for the public visa status check, the Accounts screens and the vendors. Kept in its own file because the
// list is long. `ctx` brings the helpers of endpoints.js.
const publicV = require('../../validations/visaPublic.validation');
const accountsV = require('../../validations/accounts.validation');
const vendorV = require('../../validations/vendor.validation');

module.exports = ({ ok, obj, str, bool, arrayOf, INT, NUM, NOW }) => {
  const ID = (n) => `6ac0a5f0eebc510147c672${String(n).padStart(2, '0')}`;
  const SALE_ID = ID(70);
  const RECEIPT_ID = ID(71);
  const VENDOR_ID = ID(72);
  const BILL_ID = ID(73);
  const PAY_ID = ID(74);
  const PARTY_ID = ID(75);
  const CATEGORY_ID = ID(76);
  const list = (message, schema, example, extra = {}) => ok(200, message, arrayOf(schema), [example], { paginated: true, ...extra });

  // ---- shapes
  const SALE = obj({
    _id: str(SALE_ID), fileNo: str('VF-2026-0001'), type: str('Visa'), segment: str('visa'), category: str('Visa'), date: str('2026-10-26'), dueDate: str('2026-11-02'),
    applicant: str('Rahim Ahmed'), partyId: str(PARTY_ID), partyName: str('Rahim Ahmed'), partyType: str('B2C', { enum: ['B2B', 'B2C'] }), partyPhone: str('+8801712556340'),
    destination: str('China'), detail: str('Tourist Visa'), passportNo: str(''), notes: str(''), status: str('Processing', { enum: ['Processing', 'Completed', 'Cancelled'] }),
    sale: NUM(12000), discount: NUM(0), cost: NUM(8000), profit: NUM(4000), margin: NUM(33.3), received: NUM(5000), due: NUM(7000),
    paymentStatus: str('Partial', { enum: ['Paid', 'Partial', 'Unpaid'] }), daysWaiting: INT(3), daysOverdue: INT(0),
    costLines: arrayOf(obj({ _id: str(ID(77)), account: str('5010'), label: str('Cost price'), amount: NUM(8000), date: str('2026-10-26') })),
    source: { type: 'object', nullable: true }
  });
  const SALE_EXAMPLE = {
    _id: SALE_ID, fileNo: 'VF-2026-0001', type: 'Visa', segment: 'visa', category: 'Visa', date: '2026-10-26', dueDate: '2026-11-02', applicant: 'Rahim Ahmed', partyId: PARTY_ID, partyName: 'Rahim Ahmed', partyType: 'B2C',
    partyPhone: '+8801712556340', destination: 'China', detail: 'Tourist Visa', passportNo: '', notes: '', status: 'Processing', sale: 12000, discount: 0, cost: 8000, profit: 4000, margin: 33.3, received: 5000, due: 7000,
    paymentStatus: 'Partial', daysWaiting: 3, daysOverdue: 0, costLines: [{ _id: ID(77), account: '5010', label: 'Cost price', amount: 8000, date: '2026-10-26' }], source: null
  };
  const RECEIPT = obj({
    _id: str(RECEIPT_ID), no: str('RV-2026-0002'), manualNo: str(''), date: str('2026-10-26'), status: str('posted', { enum: ['posted', 'void'] }), clientName: str('Rahim Ahmed'), clientPhone: str('+8801712556340'),
    invoiceNo: str('VF-2026-0001'), category: str('Visa'), paymentType: str('Cash'), amount: NUM(7000), discount: NUM(0), totalApplied: NUM(7000), note: str('Money receipt - VF-2026-0001'), sale: NUM(12000), dueNow: NUM(0)
  });
  const RECEIPT_EXAMPLE = { _id: RECEIPT_ID, no: 'RV-2026-0002', manualNo: '', date: '2026-10-26', status: 'posted', clientName: 'Rahim Ahmed', clientPhone: '+8801712556340', invoiceNo: 'VF-2026-0001', category: 'Visa', paymentType: 'Cash', amount: 7000, discount: 0, totalApplied: 7000, note: 'Money receipt - VF-2026-0001', sale: 12000, dueNow: 0 };
  const PARTY = obj({ _id: str(PARTY_ID), code: str('C-0001'), type: str('B2C'), name: str('Rahim Ahmed'), phone: str('+8801712556340'), creditLimit: NUM(0), invoices: INT(2), invoiced: NUM(24000), received: NUM(10000), due: NUM(14000), creditUsed: NUM(0) });
  const PARTY_EXAMPLE = { _id: PARTY_ID, code: 'C-0001', type: 'B2C', name: 'Rahim Ahmed', phone: '+8801712556340', creditLimit: 0, invoices: 2, invoiced: 24000, received: 10000, due: 14000, creditUsed: 0 };
  const AGING = arrayOf(obj({ key: str('d1_30'), label: str('1-30 days'), color: str('#0879E8'), amount: NUM(12000) }));
  const VENDOR = obj({ _id: str(VENDOR_ID), code: str('VND-0001'), name: str('Skyline Visa Services'), phone: str('+8801711000001'), email: str(''), address: str(''), contactPerson: str('Mr. Alam'), creditLimit: NUM(500000), active: bool(true), billed: NUM(45000), paid: NUM(20000), due: NUM(25000), overdue: NUM(0), advance: NUM(0) });
  const VENDOR_EXAMPLE = { _id: VENDOR_ID, code: 'VND-0001', name: 'Skyline Visa Services', phone: '+8801711000001', email: '', address: '', contactPerson: 'Mr. Alam', creditLimit: 500000, active: true, billed: 45000, paid: 20000, due: 25000, overdue: 0, advance: 0 };
  const BILL = obj({ _id: str(BILL_ID), billNo: str('VB-2026-0001'), vendorId: str(VENDOR_ID), vendorName: str('Skyline Visa Services'), date: str('2026-10-20'), dueDate: str('2026-11-04'), amount: NUM(45000), paid: NUM(20000), due: NUM(25000), invoiceRef: str('INV-1001'), service: str('Embassy fees'), account: str('5010'), status: str('posted', { enum: ['posted', 'void'] }) });
  const BILL_EXAMPLE = { _id: BILL_ID, billNo: 'VB-2026-0001', vendorId: VENDOR_ID, vendorName: 'Skyline Visa Services', date: '2026-10-20', dueDate: '2026-11-04', amount: 45000, paid: 20000, due: 25000, invoiceRef: 'INV-1001', service: 'Embassy fees', account: '5010', status: 'posted' };
  const PAYMENT = obj({ _id: str(PAY_ID), voucherNo: str('VP-2026-0001'), vendorId: str(VENDOR_ID), vendorName: str('Skyline Visa Services'), date: str('2026-10-22'), amount: NUM(20000), method: str('city'), isAdvance: bool(false), status: str('posted', { enum: ['posted', 'void'] }) });
  const PAYMENT_EXAMPLE = { _id: PAY_ID, voucherNo: 'VP-2026-0001', vendorId: VENDOR_ID, vendorName: 'Skyline Visa Services', date: '2026-10-22', amount: 20000, method: 'city', isAdvance: false, status: 'posted' };

  const STATUS_VIEW = obj({
    applicationNo: str('VISA-2026-000001'), status: str('processing', { enum: ['submitted', 'processing', 'approved', 'ready', 'collected', 'docs_required', 'rejected', 'cancelled'] }), statusLabel: str('Under Review'),
    message: str('Your application is being reviewed by our team.'), applicant: obj({ fullName: str('Rahim Ahmed') }), country: obj({ name: str('China') }), visaType: str('Tourist Visa'), entryType: str('single'),
    submittedAt: str(NOW), events: obj({}), stages: arrayOf(str('submitted')), actionRequired: { type: 'object', nullable: true }, rejectionReason: { type: 'string', nullable: true },
    documents: arrayOf(obj({ type: str('Passport'), status: str('verified'), reviewNote: str('') })), passport: { type: 'object', nullable: true },
    timeline: arrayOf(obj({ at: str(NOW), event: str('Under Review'), message: str('Your application is being reviewed by our team.') }))
  });
  const STATUS_VIEW_EXAMPLE = {
    applicationNo: 'VISA-2026-000001', status: 'processing', statusLabel: 'Under Review', message: 'Your application is being reviewed by our team.', applicant: { fullName: 'Rahim Ahmed' }, country: { name: 'China' }, visaType: 'Tourist Visa', entryType: 'single',
    submittedAt: NOW, events: { submitted: NOW, processing: NOW }, stages: ['submitted', 'processing', 'approved', 'ready', 'collected'], actionRequired: null, rejectionReason: null,
    documents: [{ type: 'Passport', status: 'verified', reviewNote: '' }], passport: null, timeline: [{ at: NOW, event: 'Under Review', message: 'Your application is being reviewed by our team.' }]
  };

  const A = (method, path, id, summary, description, access, rest) => ({ method, path, tag: 'Accounts', id, summary, description, access, needsAuth: true, ...rest });
  const V = (method, path, id, summary, description, access, rest) => ({ method, path, tag: 'Vendors', id, summary, description, access, needsAuth: true, ...rest });
  const READ = 'ADMIN, or STAFF with REPORTS_VIEW';
  const EDIT = 'ADMIN, or STAFF with ACCOUNTS_EDIT';
  const VOID = 'ADMIN, or STAFF with ACCOUNTS_VOID';
  const REPORT = obj({});
  const DONE = ok(200, 'Done.');

  return [
    // =============================================================== PUBLIC VISA STATUS
    { method: 'post', path: '/api/visa/public/status/code', tag: 'Visa: public status', id: 'requestVisaStatusCode', summary: 'Ask for a status code',
      description: 'The applicant enters the application number and the email address used on the application. A six digit code is emailed to that address (valid 10 minutes, works once). **The answer is always the same**, whether or not the application exists, so nobody can find out which numbers are real. Rate limit: 3 requests per 15 minutes per IP + email.',
      access: 'Public', body: publicV.requestCode, bodyExample: { reference: 'VISA-2026-000001', email: 'rahim@example.com' },
      success: ok(200, 'If the details match an application, a code has been sent to its email address.', obj({ sent: bool(true), resendInSeconds: INT(60) }), { sent: true, resendInSeconds: 60 }), errors: { 422: true, 429: true } },
    { method: 'post', path: '/api/visa/public/status/verify', tag: 'Visa: public status', id: 'verifyVisaStatusCode', summary: 'Check the code and see the status',
      description: 'Returns the status in the simple stages of the storefront page, the timeline entries meant for the applicant, documents with the note meant for them, and a short token (`accessToken`, 15 minutes) for refreshing. It never contains money, staff names, internal notes, contact data or passport numbers. The code locks after 5 wrong tries. Every failure answers `INVALID_CODE`. Rate limit: 10 requests per 15 minutes per IP + email.',
      access: 'Public', body: publicV.verifyCode, bodyExample: { reference: 'VISA-2026-000001', email: 'rahim@example.com', code: '123456' },
      success: ok(200, 'Visa status fetched.', STATUS_VIEW, { ...STATUS_VIEW_EXAMPLE, accessToken: 'eyJhbGciOi...', expiresInSeconds: 900 }), errors: { 400: ['INVALID_CODE'], 422: true, 429: true } },
    { method: 'get', path: '/api/visa/public/status/{reference}', tag: 'Visa: public status', id: 'getVisaStatus', summary: 'Refresh the status with the token',
      description: 'The same view as the check, without a new code. Send the token from the check in the header `X-Status-Token`. It opens that one application only and is not accepted on any other route.',
      access: 'Public, with the status token', params: publicV.statusParam, paramExamples: { reference: 'VISA-2026-000001' },
      success: ok(200, 'Visa status fetched.', STATUS_VIEW, STATUS_VIEW_EXAMPLE), errors: { 401: ['TOKEN_INVALID'], 422: true } },

    // =============================================================== ACCOUNTS: reports
    A('get', '/api/accounts/home', 'getAccountsHome', 'Accounts overview',
      'The numbers of the Accounts home screen for one month (default: this month): revenue after discounts (`sale`), direct costs (`cost`), `unallocatedCost` (costs with no sale file), office expenses and `profit`, the previous month, the last 6 months, receivables with ageing from the due date, what is owed to vendors, partner capital and cash. Everything is added up from posted journals. Cancelled sales and voided vouchers count for nothing.',
      READ, { query: accountsV.homeQuery, queryExample: { year: '2026', month: '9' }, success: ok(200, 'Accounts overview fetched.', REPORT, { year: 2026, month: 9, monthName: 'October 2026', sale: 11000, cost: 8000, unallocatedCost: 0, grossProfit: 3000, officeExpenses: 1500, profit: 1500, totalDue: 0, overdue: 0, vendorDue: 0, money: { cash: 9500, bank: 0, bkash: 0 }, aging: [{ key: 'current', label: 'Not due', color: '#16A34A', amount: 0 }] }), errors: { 401: true, 403: true, 422: true } }),
    A('get', '/api/accounts/monthly', 'getAccountsMonthly', 'Monthly report',
      'Sales, costs, profit per day, the office expenses of the month and the categories. `month` is 0 to 11.',
      READ, { query: accountsV.monthlyQuery, queryExample: { year: '2026', month: '9' }, success: ok(200, 'Monthly report fetched.', REPORT, { year: 2026, month: 9, monthName: 'October 2026', sale: 12000, cost: 8000, officeExpenses: 1000, profit: 3000, days: [], expenses: [], categories: [], availableYears: [2026] }), errors: { 401: true, 403: true, 422: true } }),
    A('get', '/api/accounts/yearly', 'getAccountsYearly', 'Yearly report', 'One row per month with sale, cost, office expenses, profit and the number of sales.',
      READ, { query: accountsV.yearlyQuery, queryExample: { year: '2026' }, success: ok(200, 'Yearly report fetched.', REPORT, { year: 2026, rows: [{ month: 9, monthName: 'Oct', sale: 12000, cost: 8000, officeExpenses: 1000, profit: 3000, count: 1 }] }), errors: { 401: true, 403: true, 422: true } }),
    A('get', '/api/accounts/balances', 'getAccountsBalances', 'Cash balances', 'Cash in hand, bank (both banks) and bKash, as of today.',
      READ, { success: ok(200, 'Balances fetched.', arrayOf(obj({ key: str('cash'), label: str('Cash'), amount: NUM(9500) })), [{ key: 'cash', label: 'Cash', amount: 9500 }]), errors: { 401: true, 403: true } }),
    A('get', '/api/accounts/price-list', 'getAccountsPriceList', 'Price list', 'Average selling prices (B2B and B2C) and cost per built-in category, worked out from real sales. A category with no sales shows a starting price.',
      READ, { success: ok(200, 'Price list fetched.', arrayOf(obj({ label: str('Visa'), b2b: NUM(12000), b2c: NUM(15000), cost: NUM(9000), count: INT(3) })), [{ label: 'Visa', b2b: 12000, b2c: 15000, cost: 9000, count: 3 }]), errors: { 401: true, 403: true } }),
    A('get', '/api/accounts/payables', 'getAccountsPayables', 'Vendor payables', 'What is owed to each supplier, from the accounts payable control account. Payments settle the oldest bill first, and what is left is aged from each bill\'s due date.',
      READ, { success: ok(200, 'Vendor payables fetched.', REPORT, { rows: [{ partyId: VENDOR_ID, code: 'VND-0001', name: 'Skyline Visa Services', invoiced: 45000, collected: 20000, due: 25000, overdue: 0, oldestDays: 0, status: 'Unpaid' }], totals: { count: 1, invoiced: 45000, collected: 20000, due: 25000, overdue: 0 }, aging: [] }), errors: { 401: true, 403: true } }),
    A('get', '/api/accounts/advances', 'getAccountsAdvances', 'Vendor advances', 'Money paid to suppliers before there was a bill, still unused.',
      READ, { success: ok(200, 'Vendor advances fetched.', REPORT, { rows: [{ partyId: VENDOR_ID, name: 'Air Connect Agency', code: 'VND-0003', amount: 15000 }], total: 15000 }), errors: { 401: true, 403: true } }),
    A('get', '/api/accounts/partners', 'getAccountsPartners', 'Partner capital', 'Each partner\'s capital put in, drawings taken and share, and the latest movements.',
      READ, { success: ok(200, 'Partners fetched.', REPORT, { partners: [{ id: 'A', name: 'Partner A', net: 300000, invested: 300000, withdrawn: 0, share: 78.9 }], monthProfit: 1500, monthName: 'October 2026', transactions: [] }), errors: { 401: true, 403: true } }),
    A('post', '/api/accounts/partners/transactions', 'createPartnerTransaction', 'Partner puts money in or takes it out', 'Posts capital (`in`) or drawings (`out`) for partner A or B.',
      'ADMIN only', { body: accountsV.partnerTransaction, bodyExample: { partner: 'A', direction: 'in', amount: 300000, method: 'city', note: 'Capital' }, success: ok(201, 'Partner transaction saved.', REPORT, { _id: PAY_ID, no: 'PV-2026-0001', date: '2026-10-26', partner: 'A', direction: 'in', amount: 300000 }), errors: { 401: true, 403: true, 422: true } }),

    // =============================================================== ACCOUNTS: categories
    A('get', '/api/accounts/categories', 'listSaleCategories', 'Sale categories', 'The five built-in categories (Visa, Tour Package, Air Ticket, Hotel, Transport) and the ones staff added.',
      READ, { success: ok(200, 'Categories fetched.', arrayOf(obj({ _id: str(CATEGORY_ID), label: str('Visa'), color: str('#0879E8'), type: str('Visa'), builtin: bool(true) })), [{ _id: CATEGORY_ID, label: 'Visa', color: '#0879E8', type: 'Visa', builtin: true }]), errors: { 401: true, 403: true } }),
    A('get', '/api/accounts/categories/report', 'getSaleCategoryReport', 'Sales by category', 'Sale, cost and profit of the sales made in the period, per category, and whether a category can be removed.',
      READ, { query: accountsV.range, queryExample: { from: '2026-10-01', to: '2026-10-31' }, success: ok(200, 'Category report fetched.', arrayOf(obj({ label: str('Visa'), color: str('#0879E8'), sale: NUM(12000), cost: NUM(8000), profit: NUM(4000), count: INT(1), isUsed: bool(true), removable: bool(false) })), [{ label: 'Visa', color: '#0879E8', sale: 12000, cost: 8000, profit: 4000, count: 1, isUsed: true, removable: false }]), errors: { 401: true, 403: true, 422: true } }),
    A('post', '/api/accounts/categories', 'createSaleCategory', 'Add a category', 'A category staff add books as "Other" (revenue 4060, cost 5090). A sale with a category name that does not exist creates it too.',
      EDIT, { body: accountsV.createCategory, bodyExample: { label: 'Insurance', color: '#112233' }, success: ok(201, 'Category created.', obj({ _id: str(CATEGORY_ID), label: str('Insurance'), color: str('#112233') }), { _id: CATEGORY_ID, label: 'Insurance', color: '#112233' }), errors: { 401: true, 403: true, 409: ['CATEGORY_EXISTS'], 422: true } }),
    A('delete', '/api/accounts/categories/{id}', 'deleteSaleCategory', 'Delete a category', 'The built-in categories cannot be deleted, and a category that sales use cannot either.',
      EDIT, { params: accountsV.idParam, paramExamples: { id: CATEGORY_ID }, success: ok(200, 'Category deleted.'), errors: { 401: true, 403: true, 404: ['CATEGORY_NOT_FOUND'], 409: ['CATEGORY_LOCKED', 'CATEGORY_IN_USE'], 422: true } }),

    // =============================================================== ACCOUNTS: sales
    A('get', '/api/accounts/sales', 'listSales', 'Sales',
      'Every sale file except cancelled ones (ask for `status=Cancelled` to see those). `meta.summary` adds up every match, not only the page. Sale, discount, cost, profit, received and due are worked out from the journals tagged with the file.',
      READ, { query: accountsV.listSales, queryExample: { category: 'Visa', status: 'all', search: 'rahim', page: '1', limit: '50' }, success: list('Sales fetched.', SALE, SALE_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
    A('post', '/api/accounts/sales', 'createSale', 'Record a sale',
      'Makes the file (`VF-2026-0001` and so on, numbered by the server) and posts the sale, the cost price and any money received in one go. If one step fails, the earlier ones are voided again. The client is found by name or created. All amounts are in taka.',
      EDIT, { body: accountsV.createSale, bodyExample: { category: 'Visa', clientType: 'B2C', clientName: 'Rahim Ahmed', phone: '+8801712556340', sale: 12000, cost: 8000, received: 5000, method: 'cash' }, success: ok(201, 'Sale saved.', SALE, SALE_EXAMPLE), errors: { 401: true, 403: true, 422: ['VALIDATION_ERROR', 'INVALID_AMOUNT', 'RECEIVED_TOO_HIGH', 'INVALID_DATE', 'INVALID_METHOD'] } }),
    A('get', '/api/accounts/sales/{id}', 'getSale', 'One sale', 'The sale with its cost lines and figures. An unknown id answers `404`.',
      READ, { params: accountsV.idParam, paramExamples: { id: SALE_ID }, success: ok(200, 'Sale fetched.', SALE, SALE_EXAMPLE), errors: { 401: true, 403: true, 404: ['SALE_NOT_FOUND'], 422: true } }),
    A('patch', '/api/accounts/sales/{id}', 'updateSale', 'Edit a sale', 'Voids the sale and cost vouchers and posts new ones. Receipts and extra costs stay. The selling price cannot go below what was already received.',
      EDIT, { params: accountsV.idParam, paramExamples: { id: SALE_ID }, body: accountsV.updateSale, bodyExample: { category: 'Visa', clientName: 'Rahim Ahmed', sale: 15000, cost: 9000 }, success: ok(200, 'Sale updated.', SALE, SALE_EXAMPLE), errors: { 401: true, 403: true, 404: ['SALE_NOT_FOUND'], 409: ['SALE_CANCELLED'], 422: ['VALIDATION_ERROR', 'SALE_BELOW_RECEIVED'] } }),
    A('post', '/api/accounts/sales/{id}/cancel', 'cancelSale', 'Cancel a sale',
      'Voids every voucher of the sale, so it leaves all reports. **If money was received, say what happens to it** with `settlement`: `refund` (given back) or `keep` (kept as income, a cancellation fee). Without it the answer is `SETTLEMENT_REQUIRED`, because only the business can decide.',
      VOID, { params: accountsV.idParam, paramExamples: { id: SALE_ID }, body: accountsV.cancelSale, bodyExample: { reason: 'Client changed plans', settlement: 'refund' }, success: ok(200, 'Sale cancelled.', SALE, { ...SALE_EXAMPLE, status: 'Cancelled' }), errors: { 401: true, 403: true, 404: ['SALE_NOT_FOUND'], 409: ['SALE_CANCELLED'], 422: ['VALIDATION_ERROR', 'SETTLEMENT_REQUIRED'] } }),
    A('post', '/api/accounts/sales/{id}/costs', 'addSaleCost', 'Add a cost to a sale', 'An extra cost that came later. It is posted on a supplier (the one named by `vendorId`, or "Unassigned supplier").',
      EDIT, { params: accountsV.idParam, paramExamples: { id: SALE_ID }, body: accountsV.addCost, bodyExample: { amount: 500, note: 'Courier' }, success: ok(201, 'Cost added.', SALE, SALE_EXAMPLE), errors: { 401: true, 403: true, 404: ['SALE_NOT_FOUND', 'VENDOR_NOT_FOUND'], 409: ['SALE_CANCELLED'], 422: true } }),
    A('get', '/api/accounts/dues', 'listDues', 'Client dues', 'Sale files that still owe money, oldest first. `daysOverdue` counts from the due date of the file (7 days for visas, 15 for tours, 3 for air and transport). `meta.totals` adds up every match.',
      READ, { query: accountsV.pagingQuery, queryExample: { page: '1', limit: '50' }, success: list('Dues fetched.', SALE, { ...SALE_EXAMPLE, daysOverdue: 5 }), errors: { 401: true, 403: true, 422: true } }),

    // =============================================================== ACCOUNTS: receipts, expenses, clients
    A('get', '/api/accounts/receipts', 'listReceipts', 'Money receipts', 'Receipts, newest first, with the discount given on each. `meta.summary` adds up every match: total, cash, bank, bKash and discount. Voided receipts are not listed.',
      READ, { query: accountsV.listReceipts, queryExample: { from: '2026-10-01', to: '2026-10-31', search: 'rahim' }, success: list('Money receipts fetched.', RECEIPT, RECEIPT_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
    A('post', '/api/accounts/receipts', 'createReceipt', 'Take money against a sale',
      'The amount plus any discount can never be more than what is due (`RECEIPT_EXCEEDS_DUE`). The system number (`RV-2026-0002`) is made by the server. A paper receipt book number can be kept in `receiptNo` and cannot be used twice.',
      EDIT, { body: accountsV.createReceipt, bodyExample: { invoiceId: SALE_ID, amount: 7000, method: 'cash', note: 'Final payment' }, success: ok(201, 'Money receipt saved.', RECEIPT, RECEIPT_EXAMPLE), errors: { 401: true, 403: true, 404: ['SALE_NOT_FOUND'], 409: ['SALE_CANCELLED', 'RECEIPT_NO_USED'], 422: ['VALIDATION_ERROR', 'INVALID_AMOUNT', 'RECEIPT_EXCEEDS_DUE'] } }),
    A('get', '/api/accounts/receipts/{id}', 'getReceipt', 'One receipt', 'By id, or by the receipt number such as `RV-2026-0002`.',
      READ, { params: accountsV.receiptParam, paramExamples: { id: RECEIPT_ID }, success: ok(200, 'Money receipt fetched.', RECEIPT, RECEIPT_EXAMPLE), errors: { 401: true, 403: true, 404: ['RECEIPT_NOT_FOUND'], 422: true } }),
    A('post', '/api/accounts/receipts/{id}/void', 'voidReceipt', 'Void a receipt', 'A receipt is never deleted. It is voided with a reason, and the money is due again.',
      VOID, { params: accountsV.idParam, paramExamples: { id: RECEIPT_ID }, body: accountsV.voidBody, bodyExample: { reason: 'Wrong client' }, success: ok(200, 'Money receipt voided.', RECEIPT, { ...RECEIPT_EXAMPLE, status: 'void' }), errors: { 401: true, 403: true, 404: ['RECEIPT_NOT_FOUND'], 409: ['ALREADY_VOID'], 422: true } }),
    A('get', '/api/accounts/expense-accounts', 'listExpenseAccounts', 'Expense accounts', 'The operating expense accounts (6010 to 6100) an expense can be booked to.',
      READ, { success: ok(200, 'Expense accounts fetched.', arrayOf(obj({ code: str('6020'), name: str('Office Rent') })), [{ code: '6020', name: 'Office Rent' }]), errors: { 401: true, 403: true } }),
    A('post', '/api/accounts/expenses', 'createExpense', 'Record an expense', 'Office and running expenses (rent, internet, ads). They reduce net profit, not the profit of a sale.',
      EDIT, { body: accountsV.createExpense, bodyExample: { amount: 1500, account: '6020', method: 'cash', note: 'Rent' }, success: ok(201, 'Expense saved.', REPORT, { _id: PAY_ID, no: 'PV-2026-0001', date: '2026-10-26', amount: 1500, account: '6020', note: 'Rent' }), errors: { 401: true, 403: true, 422: ['VALIDATION_ERROR', 'INVALID_ACCOUNT', 'INVALID_AMOUNT'] } }),
    A('get', '/api/accounts/parties', 'listAccountParties', 'Clients', 'B2B agencies or B2C customers with what they were invoiced, paid and still owe, and the share of the credit limit used.',
      READ, { query: accountsV.listParties, queryExample: { type: 'B2C' }, success: ok(200, 'Clients fetched.', arrayOf(PARTY), [PARTY_EXAMPLE]), errors: { 401: true, 403: true, 422: true } }),
    A('post', '/api/accounts/parties', 'createAccountParty', 'Add a client', 'An agency gets a credit limit of 100,000 unless you send one. Codes are `A-0001` for agencies and `C-0001` for customers.',
      EDIT, { body: accountsV.createParty, bodyExample: { type: 'B2B', name: 'Everest Holidays', phone: '+8801900000000', creditLimit: 250000 }, success: ok(201, 'Client created.', PARTY, { ...PARTY_EXAMPLE, code: 'A-0001', type: 'B2B', creditLimit: 250000 }), errors: { 401: true, 403: true, 409: ['PARTY_EXISTS'], 422: true } }),

    // =============================================================== VENDORS
    V('get', '/api/vendors', 'listVendors', 'Vendors', 'Suppliers with what they billed, what was paid, what is due, what is overdue and any advance. Search the name, code or phone.',
      'ADMIN, or STAFF with VENDOR_VIEW', { query: vendorV.listVendors, queryExample: { search: 'skyline', active: 'true' }, success: list('Vendors fetched.', VENDOR, VENDOR_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
    V('post', '/api/vendors', 'createVendor', 'Add a vendor', 'Codes are `VND-0001` and so on. An `openingBalance` of type `due` (what we already owe) or `advance` (what we already paid) is posted as an opening voucher.',
      'ADMIN, or STAFF with VENDOR_MANAGE', { body: vendorV.createVendor, bodyExample: { name: 'Skyline Visa Services', phone: '+8801711000001', contactPerson: 'Mr. Alam', creditLimit: 500000, openingBalance: 20000, openingBalanceType: 'due' }, success: ok(201, 'Vendor created.', VENDOR, VENDOR_EXAMPLE), errors: { 401: true, 403: true, 409: ['VENDOR_EXISTS'], 422: true } }),
    V('get', '/api/vendors/{id}', 'getVendor', 'One vendor', 'The vendor with its balances. An unknown id answers `404`.',
      'ADMIN, or STAFF with VENDOR_VIEW', { params: vendorV.idParam, paramExamples: { id: VENDOR_ID }, success: ok(200, 'Vendor fetched.', VENDOR, VENDOR_EXAMPLE), errors: { 401: true, 403: true, 404: ['VENDOR_NOT_FOUND'], 422: true } }),
    V('patch', '/api/vendors/{id}', 'updateVendor', 'Change a vendor', 'Send only what changes. Set `active` to false to stop new bills. The opening balance cannot be edited: post a bill or payment instead.',
      'ADMIN, or STAFF with VENDOR_MANAGE', { params: vendorV.idParam, paramExamples: { id: VENDOR_ID }, body: vendorV.updateVendor, bodyExample: { phone: '+8801799999999' }, success: ok(200, 'Vendor updated.', VENDOR, VENDOR_EXAMPLE), errors: { 401: true, 403: true, 404: ['VENDOR_NOT_FOUND'], 409: ['VENDOR_EXISTS'], 422: true } }),
    V('get', '/api/vendors/bills', 'listVendorBills', 'Vendor bills', 'What suppliers charged. `paid` and `due` come from the payments linked to the bill.',
      'ADMIN, or STAFF with VENDOR_VIEW', { query: vendorV.listBills, queryExample: { vendorId: VENDOR_ID, status: 'posted' }, success: list('Vendor bills fetched.', BILL, BILL_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
    V('post', '/api/vendors/bills', 'createVendorBill', 'Save a vendor bill', 'Posts the cost (a direct cost account, 5010 to 5090) and what is owed. The server numbers it (`VB-2026-0001`). The due date defaults to 15 days after the bill date.',
      'ADMIN, or STAFF with VENDOR_MANAGE', { body: vendorV.createBill, bodyExample: { vendorId: VENDOR_ID, amount: 45000, account: '5010', service: 'Embassy fees', invoiceRef: 'INV-1001' }, success: ok(201, 'Vendor bill saved.', BILL, BILL_EXAMPLE), errors: { 401: true, 403: true, 404: ['VENDOR_NOT_FOUND', 'SALE_NOT_FOUND'], 409: ['VENDOR_INACTIVE'], 422: ['VALIDATION_ERROR', 'INVALID_AMOUNT', 'INVALID_ACCOUNT', 'INVALID_DATE'] } }),
    V('post', '/api/vendors/bills/{id}/void', 'voidVendorBill', 'Void a vendor bill', 'Voids the bill and its voucher. A bill with payments linked to it must have those payments voided first.',
      VOID, { params: vendorV.idParam, paramExamples: { id: BILL_ID }, body: vendorV.voidBody, bodyExample: { reason: 'Duplicate bill' }, success: ok(200, 'Vendor bill voided.', BILL, { ...BILL_EXAMPLE, status: 'void' }), errors: { 401: true, 403: true, 404: ['BILL_NOT_FOUND'], 409: ['ALREADY_VOID', 'BILL_HAS_PAYMENTS'], 422: true } }),
    V('get', '/api/vendors/payments', 'listVendorPayments', 'Vendor payments and advances', 'Money paid to suppliers, newest first. `isAdvance=true` lists only advances.',
      'ADMIN, or STAFF with VENDOR_VIEW', { query: vendorV.listPayments, queryExample: { vendorId: VENDOR_ID, isAdvance: 'false' }, success: list('Vendor payments fetched.', PAYMENT, PAYMENT_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
    V('post', '/api/vendors/payments', 'createVendorPayment', 'Pay a vendor, or pay an advance',
      'A regular payment settles what is owed and can never be more than that (`PAYMENT_EXCEEDS_DUE`): record the extra as an advance (`isAdvance: true`). Link it to a bill with `billId` to keep it inside that bill.',
      'ADMIN, or STAFF with VENDOR_MANAGE', { body: vendorV.createPayment, bodyExample: { vendorId: VENDOR_ID, amount: 20000, method: 'city', note: 'Part payment' }, success: ok(201, 'Vendor payment saved.', PAYMENT, PAYMENT_EXAMPLE), errors: { 401: true, 403: true, 404: ['VENDOR_NOT_FOUND', 'BILL_NOT_FOUND'], 422: ['VALIDATION_ERROR', 'INVALID_AMOUNT', 'PAYMENT_EXCEEDS_DUE', 'PAYMENT_EXCEEDS_BILL', 'INVALID_METHOD'] } }),
    V('post', '/api/vendors/payments/{id}/void', 'voidVendorPayment', 'Void a vendor payment', 'A payment is never deleted. It is voided with a reason, and the amount is owed again.',
      VOID, { params: vendorV.idParam, paramExamples: { id: PAY_ID }, body: vendorV.voidBody, bodyExample: { reason: 'Cheque bounced' }, success: ok(200, 'Vendor payment voided.', PAYMENT, { ...PAYMENT_EXAMPLE, status: 'void' }), errors: { 401: true, 403: true, 404: ['PAYMENT_NOT_FOUND'], 409: ['ALREADY_VOID'], 422: true } })
  ];
};
