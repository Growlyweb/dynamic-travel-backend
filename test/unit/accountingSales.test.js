const request = require('supertest');

const app = require('../../app');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const Journal = require('../../models/Journal');
const Party = require('../../models/Party');
const AuditLog = require('../../models/AuditLog');
const { createUser, bearer } = require('./helpers/factory');
const { createAccountant, createAdmin, daysAgo } = require('./helpers/accounting');

const post = (user, path, body) => request(app).post(path).set(bearer(user)).send(body);
const patch = (user, path, body) => request(app).patch(path).set(bearer(user)).send(body);
const get = (user, path) => request(app).get(path).set(bearer(user));

const sale = (user, extra = {}) =>
  post(user, '/api/accounts/sales', { category: 'Visa', clientType: 'B2C', clientName: 'Rahim Ahmed', phone: '+8801712556340', sale: 12000, cost: 8000, received: 5000, method: 'cash', ...extra });

describe('recording a sale', () => {
  it('makes a file, numbers it and posts the sale, the cost price and the money received', async () => {
    const user = await createAccountant();
    const res = await sale(user);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      fileNo: expect.stringMatching(/^VF-\d{4}-0001$/),
      category: 'Visa',
      segment: 'visa',
      partyType: 'B2C',
      partyName: 'Rahim Ahmed',
      sale: 12000,
      cost: 8000,
      profit: 4000,
      received: 5000,
      due: 7000,
      paymentStatus: 'Partial',
      status: 'Processing'
    });
    const types = (await Journal.find({ status: 'posted' }).sort({ no: 1 })).map((j) => j.type).sort();
    expect(types).toEqual(['JV', 'RV', 'SV']);
    for (const journal of await Journal.find()) {
      expect(journal.lines.reduce((s, l) => s + l.debit, 0)).toBe(journal.lines.reduce((s, l) => s + l.credit, 0));
    }
    expect(await AuditLog.countDocuments({ action: 'ACCOUNTING_CHANGED' })).toBe(1);
  });

  it('creates the client once and reuses it, and puts supplier costs on a named supplier', async () => {
    const user = await createAccountant();
    await sale(user);
    await sale(user, { clientName: 'rahim  ahmed' });
    expect(await Party.countDocuments({ type: 'B2C' })).toBe(1);
    expect(await Party.countDocuments({ type: 'Vendor', name: 'Unassigned supplier' })).toBe(1);
    const clients = await get(user, '/api/accounts/parties?type=B2C');
    expect(clients.body.data[0]).toMatchObject({ code: 'C-0001', invoices: 2, invoiced: 24000, received: 10000, due: 14000 });
  });

  it('makes a B2B sale for an agency with a credit limit, and a custom category books as Other', async () => {
    const user = await createAccountant();
    const res = await sale(user, { clientType: 'B2B', agencyName: 'Sunrise Tours', clientName: 'Sunrise Tours', category: 'Insurance', received: 0 });
    expect(res.body.data).toMatchObject({ partyType: 'B2B', category: 'Insurance', segment: 'other', paymentStatus: 'Unpaid' });
    const agents = await get(user, '/api/accounts/parties?type=B2B');
    expect(agents.body.data[0]).toMatchObject({ code: 'A-0001', creditLimit: 100000 });
    const categories = (await get(user, '/api/accounts/categories')).body.data;
    expect(categories.map((c) => c.label)).toEqual(expect.arrayContaining(['Visa', 'Tour Package', 'Air Ticket', 'Hotel', 'Transport', 'Insurance']));
  });

  it('refuses amounts that do not make sense', async () => {
    const user = await createAccountant();
    expect((await sale(user, { sale: 0 })).status).toBe(422);
    expect((await sale(user, { cost: -1 })).status).toBe(422);
    expect((await sale(user, { received: 13000 })).body.code).toBe('RECEIVED_TOO_HIGH');
    expect((await sale(user, { method: 'gold' })).status).toBe(422);
    expect((await sale(user, { date: '26-10-2026' })).status).toBe(422);
    expect(await Journal.countDocuments()).toBe(0);
  });

  it('works to the paisa', async () => {
    const user = await createAccountant();
    const res = await sale(user, { sale: 0.3, cost: 0.1, received: 0.1 });
    expect(res.body.data).toMatchObject({ sale: 0.3, cost: 0.1, received: 0.1, due: 0.2, profit: 0.2 });
  });
});

describe('money receipts', () => {
  it('takes money against a sale and recalculates what is due', async () => {
    const user = await createAccountant();
    const made = await sale(user);
    const res = await post(user, '/api/accounts/receipts', { invoiceId: made.body.data._id, amount: 7000, method: 'bkash', note: 'Final payment' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ no: expect.stringMatching(/^RV-\d{4}-0002$/), amount: 7000, paymentType: 'bKash', invoiceNo: made.body.data.fileNo, dueNow: 0, clientName: 'Rahim Ahmed' });
    const file = await get(user, `/api/accounts/sales/${made.body.data._id}`);
    expect(file.body.data).toMatchObject({ received: 12000, due: 0, paymentStatus: 'Paid' });
  });

  it('refuses more than the amount due, and takes a discount into profit', async () => {
    const user = await createAccountant();
    const made = await sale(user);
    const id = made.body.data._id;
    expect((await post(user, '/api/accounts/receipts', { invoiceId: id, amount: 7001 })).body.code).toBe('RECEIPT_EXCEEDS_DUE');
    expect((await post(user, '/api/accounts/receipts', { invoiceId: id, amount: 6500, discount: 600 })).body.code).toBe('RECEIPT_EXCEEDS_DUE');
    expect((await post(user, '/api/accounts/receipts', { invoiceId: id })).status).toBe(422);

    const ok = await post(user, '/api/accounts/receipts', { invoiceId: id, amount: 6000, discount: 1000 });
    expect(ok.body.data).toMatchObject({ amount: 6000, discount: 1000, totalApplied: 7000 });
    const file = (await get(user, `/api/accounts/sales/${id}`)).body.data;
    expect(file).toMatchObject({ due: 0, discount: 1000, received: 11000, paymentStatus: 'Paid', profit: 3000 });
  });

  it('numbers receipts on the server, and keeps a paper receipt number that cannot be used twice', async () => {
    const user = await createAccountant();
    const made = await sale(user);
    const id = made.body.data._id;
    const first = await post(user, '/api/accounts/receipts', { invoiceId: id, amount: 1000, receiptNo: 'BOOK-77' });
    expect(first.body.data).toMatchObject({ manualNo: 'BOOK-77', no: expect.stringMatching(/^RV-/) });
    const second = await post(user, '/api/accounts/receipts', { invoiceId: id, amount: 1000, receiptNo: 'BOOK-77' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('RECEIPT_NO_USED');
    const found = await get(user, `/api/accounts/receipts/${first.body.data.no}`);
    expect(found.body.data._id).toBe(first.body.data._id);
    expect((await get(user, '/api/accounts/receipts/RV-2026-9999')).status).toBe(404);
  });

  it('lists receipts with a summary, search and paging', async () => {
    const user = await createAccountant();
    const a = await sale(user, { received: 2000, method: 'cash' });
    const b = await sale(user, { clientName: 'Salma Begum', received: 3000, method: 'city' });
    await post(user, '/api/accounts/receipts', { invoiceId: b.body.data._id, amount: 1000, method: 'bkash' });

    const all = await get(user, '/api/accounts/receipts');
    expect(all.body.data).toHaveLength(3);
    expect(all.body.meta).toMatchObject({ total: 3, summary: { count: 3, total: 6000, cash: 2000, bank: 3000, bkash: 1000, discount: 0 } });
    expect(all.body.pagination.summary.total).toBe(6000);
    expect((await get(user, '/api/accounts/receipts?search=salma')).body.data).toHaveLength(2);
    expect((await get(user, `/api/accounts/receipts?search=${a.body.data.fileNo}`)).body.data).toHaveLength(1);
    expect((await get(user, '/api/accounts/receipts?limit=2&page=2')).body.data).toHaveLength(1);
    expect((await get(user, `/api/accounts/receipts?from=${daysAgo(-1)}`)).body.data).toHaveLength(0);
  });

  it('voids a receipt with a reason: the money is due again and the receipt leaves the list', async () => {
    const user = await createAccountant();
    const made = await sale(user);
    const receipt = await post(user, '/api/accounts/receipts', { invoiceId: made.body.data._id, amount: 7000 });
    expect((await post(user, `/api/accounts/receipts/${receipt.body.data._id}/void`, {})).status).toBe(422);
    const voided = await post(user, `/api/accounts/receipts/${receipt.body.data._id}/void`, { reason: 'Wrong client' });
    expect(voided.body.data).toMatchObject({ status: 'void', voidReason: 'Wrong client' });
    expect((await get(user, `/api/accounts/sales/${made.body.data._id}`)).body.data).toMatchObject({ received: 5000, due: 7000 });
    expect((await get(user, '/api/accounts/receipts')).body.data).toHaveLength(1);
    expect((await post(user, `/api/accounts/receipts/${receipt.body.data._id}/void`, { reason: 'again' })).body.code).toBe('ALREADY_VOID');
  });
});

describe('editing and cancelling a sale', () => {
  it('replaces the sale and cost vouchers, keeps the receipts, and refuses to drop below what was received', async () => {
    const user = await createAccountant();
    const made = await sale(user);
    const id = made.body.data._id;

    const res = await patch(user, `/api/accounts/sales/${id}`, { category: 'Visa', clientName: 'Rahim Ahmed', sale: 15000, cost: 9000 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ sale: 15000, cost: 9000, received: 5000, due: 10000, profit: 6000 });
    expect(await Journal.countDocuments({ status: 'void' })).toBe(2);
    expect(await Journal.countDocuments({ status: 'posted' })).toBe(3);

    const low = await patch(user, `/api/accounts/sales/${id}`, { category: 'Visa', clientName: 'Rahim Ahmed', sale: 4000, cost: 1000 });
    expect(low.body.code).toBe('SALE_BELOW_RECEIVED');
    const again = await patch(user, `/api/accounts/sales/${id}`, { category: 'Visa', clientName: 'Rahim Ahmed', sale: 15000, cost: 9500 });
    expect(again.body.data.cost).toBe(9500);
  });

  it('adds an extra cost to a sale', async () => {
    const user = await createAccountant();
    const made = await sale(user);
    const res = await post(user, `/api/accounts/sales/${made.body.data._id}/costs`, { amount: 500, note: 'Courier' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ cost: 8500, profit: 3500 });
    expect(res.body.data.costLines.map((c) => c.label)).toEqual(['Cost price', 'Courier']);
    expect((await post(user, `/api/accounts/sales/${made.body.data._id}/costs`, { amount: 0 })).status).toBe(422);
  });

  it('needs a decision about money already received before a sale is cancelled', async () => {
    const user = await createAccountant();
    const made = await sale(user);
    const url = `/api/accounts/sales/${made.body.data._id}/cancel`;
    const asked = await post(user, url, { reason: 'Client changed plans' });
    expect(asked.status).toBe(422);
    expect(asked.body.code).toBe('SETTLEMENT_REQUIRED');
    expect((await get(user, `/api/accounts/sales/${made.body.data._id}`)).body.data.status).toBe('Processing');
  });

  it('refunds: everything is voided and the sale leaves every report', async () => {
    const user = await createAccountant();
    const made = await sale(user);
    const res = await post(user, `/api/accounts/sales/${made.body.data._id}/cancel`, { reason: 'Refunded', settlement: 'refund' });
    expect(res.body.data).toMatchObject({ status: 'Cancelled' });
    expect(await Journal.countDocuments({ status: 'posted' })).toBe(0);
    expect((await get(user, '/api/accounts/sales')).body.data).toHaveLength(0);
    expect((await get(user, '/api/accounts/sales?status=Cancelled')).body.data).toHaveLength(1);
    expect((await get(user, '/api/accounts/dues')).body.data).toHaveLength(0);
    const home = (await get(user, '/api/accounts/home')).body.data;
    expect(home).toMatchObject({ sale: 0, cost: 0, profit: 0, totalDue: 0 });
    expect(home.money.cash).toBe(0);
    expect((await post(user, `/api/accounts/sales/${made.body.data._id}/cancel`, { reason: 'x', settlement: 'refund' })).body.code).toBe('SALE_CANCELLED');
    expect((await patch(user, `/api/accounts/sales/${made.body.data._id}`, { sale: 100, cost: 0 })).body.code).toBe('SALE_CANCELLED');
  });

  it('keeps the money as income when asked, and cash stays', async () => {
    const user = await createAccountant();
    const made = await sale(user);
    await post(user, `/api/accounts/sales/${made.body.data._id}/cancel`, { reason: 'No show', settlement: 'keep' });
    const home = (await get(user, '/api/accounts/home')).body.data;
    expect(home).toMatchObject({ sale: 5000, cost: 0, profit: 5000, totalDue: 0 });
    expect(home.money.cash).toBe(5000);
  });

  it('cancels a sale with no money received without asking', async () => {
    const user = await createAccountant();
    const made = await sale(user, { received: 0 });
    const res = await post(user, `/api/accounts/sales/${made.body.data._id}/cancel`, { reason: 'Duplicate entry' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Cancelled');
  });
});

describe('the profit rule and the reports', () => {
  it('counts revenue after discounts, direct costs and expenses, and keeps cash apart', async () => {
    const user = await createAccountant();
    await sale(user, { sale: 12000, cost: 8000, received: 11000, discount: 1000 });
    await post(user, '/api/accounts/expenses', { amount: 1500, account: '6020', method: 'cash', note: 'Rent' });

    const home = (await get(user, '/api/accounts/home')).body.data;
    expect(home).toMatchObject({ sale: 11000, cost: 8000, grossProfit: 3000, officeExpenses: 1500, profit: 1500 });
    expect(home.money.cash).toBe(9500);
    expect(home.categories[0]).toMatchObject({ label: 'Visa', sale: 11000, cost: 8000, profit: 3000, count: 1 });
    expect(home.series).toHaveLength(6);
    expect(home.series[5]).toMatchObject({ revenue: 11000, cost: 9500, profit: 1500 });
    expect(home.b2c).toBe(11000);
  });

  it('shows a direct cost that belongs to no file apart, as unallocated', async () => {
    const user = await createAccountant();
    const vendor = (await post(user, '/api/vendors', { name: 'Courier Co' })).body.data;
    await post(user, '/api/vendors/bills', { vendorId: vendor._id, amount: 700, account: '5020' });
    const home = (await get(user, '/api/accounts/home')).body.data;
    expect(home).toMatchObject({ cost: 700, unallocatedCost: 700, profit: -700 });
  });

  it('lists dues, ages them from the due date and totals overdue', async () => {
    const user = await createAccountant();
    await sale(user, { date: daysAgo(40), received: 0 });
    await sale(user, { clientName: 'Salma Begum', received: 0 });
    const dues = await get(user, '/api/accounts/dues');
    expect(dues.body.data).toHaveLength(2);
    expect(dues.body.data[0]).toMatchObject({ daysWaiting: 40, daysOverdue: 33, due: 12000 });
    expect(dues.body.meta.totals).toMatchObject({ due: 24000, b2c: 24000, overdue: 12000, count: 2 });

    const home = (await get(user, '/api/accounts/home')).body.data;
    expect(home).toMatchObject({ totalDue: 24000, overdue: 12000 });
    expect(home.aging.find((b) => b.key === 'd31_60').amount).toBe(12000);
    expect(home.aging.find((b) => b.key === 'current').amount).toBe(12000);
    expect(home.topClients[0].due).toBe(12000);
  });

  it('answers the monthly and yearly reports from the journals', async () => {
    const user = await createAccountant();
    await sale(user, { received: 12000 });
    await post(user, '/api/accounts/expenses', { amount: 1000, account: '6030', method: 'cash', note: 'Internet' });
    const now = new Date();
    const monthly = await get(user, `/api/accounts/monthly?year=${now.getFullYear()}&month=${now.getMonth()}`);
    expect(monthly.body.data).toMatchObject({ sale: 12000, cost: 8000, officeExpenses: 1000, profit: 3000 });
    expect(monthly.body.data.expenses).toHaveLength(1);
    expect(monthly.body.data.expenses[0]).toMatchObject({ amount: 1000, account: '6030', note: 'Internet' });
    expect(monthly.body.data.days.reduce((s, d) => s + d.sale, 0)).toBe(12000);
    expect(monthly.body.data.categories[0].count).toBe(1);
    expect(monthly.body.data.availableYears).toContain(now.getFullYear());

    const yearly = await get(user, `/api/accounts/yearly?year=${now.getFullYear()}`);
    expect(yearly.body.data.rows).toHaveLength(12);
    expect(yearly.body.data.rows[now.getMonth()]).toMatchObject({ sale: 12000, cost: 8000, officeExpenses: 1000, profit: 3000, count: 1 });
    expect((await get(user, '/api/accounts/monthly?year=2026&month=12')).status).toBe(422);
  });

  it('gives the category report, the price list and the cash balances', async () => {
    const user = await createAccountant();
    await sale(user, { received: 12000 });
    const report = (await get(user, '/api/accounts/categories/report')).body.data;
    expect(report.find((c) => c.label === 'Visa')).toMatchObject({ sale: 12000, cost: 8000, profit: 4000, count: 1, isUsed: true, removable: false });
    expect(report.find((c) => c.label === 'Hotel')).toMatchObject({ count: 0 });
    const prices = (await get(user, '/api/accounts/price-list')).body.data;
    expect(prices.find((p) => p.label === 'Visa')).toMatchObject({ b2c: 12000, cost: 8000, count: 1 });
    expect(prices.find((p) => p.label === 'Hotel')).toMatchObject({ count: 0, b2c: 25000 });
    const balances = (await get(user, '/api/accounts/balances')).body.data;
    expect(balances.find((b) => b.key === 'cash').amount).toBe(12000);
  });

  it('filters and pages the sales list, with a summary of every match', async () => {
    const user = await createAccountant();
    await sale(user, { clientName: 'Karim Uddin', date: daysAgo(3) });
    await sale(user, { clientName: 'Salma Begum', category: 'Hotel', sale: 20000, cost: 15000, received: 20000 });
    await sale(user, { clientName: 'Third Client', category: 'Hotel', sale: 5000, cost: 3000, received: 0 });

    const all = await get(user, '/api/accounts/sales');
    expect(all.body.data).toHaveLength(3);
    expect(all.body.meta.summary).toMatchObject({ count: 3, sale: 37000, cost: 26000, received: 25000, due: 12000 });
    expect((await get(user, '/api/accounts/sales?category=Hotel')).body.data).toHaveLength(2);
    expect((await get(user, '/api/accounts/sales?search=salma')).body.data).toHaveLength(1);
    expect((await get(user, '/api/accounts/sales?search=01712556340')).body.data).toHaveLength(3);
    expect((await get(user, `/api/accounts/sales?from=${daysAgo(1)}`)).body.data).toHaveLength(2);
    const page = await get(user, '/api/accounts/sales?limit=2&page=2');
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ total: 3, totalPages: 2, summary: { count: 3 } });
  });
});

describe('expenses, partners and clients', () => {
  it('records an expense on an expense account only', async () => {
    const user = await createAccountant();
    expect((await post(user, '/api/accounts/expenses', { amount: 500, account: '6050', method: 'cash', note: 'Taxi' })).status).toBe(201);
    expect((await post(user, '/api/accounts/expenses', { amount: 500, account: '4010' })).status).toBe(422);
    expect((await post(user, '/api/accounts/expenses', { amount: 500, account: '6999' })).body.code).toBe('INVALID_ACCOUNT');
    expect((await post(user, '/api/accounts/expenses', { amount: 0 })).status).toBe(422);
    const accounts = (await get(user, '/api/accounts/expense-accounts')).body.data;
    expect(accounts.map((a) => a.code)).toContain('6010');
    expect(accounts.every((a) => a.code.startsWith('6'))).toBe(true);
  });

  it('lets only an admin move partner capital, and shows each partner their share', async () => {
    const admin = await createAdmin();
    const user = await createAccountant();
    expect((await post(user, '/api/accounts/partners/transactions', { partner: 'A', direction: 'in', amount: 1000 })).status).toBe(403);
    await post(admin, '/api/accounts/partners/transactions', { partner: 'A', direction: 'in', amount: 300000, method: 'city', note: 'Capital' });
    await post(admin, '/api/accounts/partners/transactions', { partner: 'B', direction: 'in', amount: 100000, method: 'city' });
    await post(admin, '/api/accounts/partners/transactions', { partner: 'B', direction: 'out', amount: 20000, method: 'cash' });

    const res = (await get(user, '/api/accounts/partners')).body.data;
    expect(res.partners[0]).toMatchObject({ id: 'A', net: 300000, invested: 300000, withdrawn: 0 });
    expect(res.partners[0].share).toBeCloseTo((300000 / 380000) * 100, 5);
    expect(res.partners[1]).toMatchObject({ id: 'B', net: 80000, invested: 100000, withdrawn: 20000 });
    expect(res.transactions).toHaveLength(3);
    expect(res.transactions[0]).toHaveProperty('type');
    expect((await get(user, '/api/accounts/home')).body.data.partnerCapital).toBe(380000);
    expect((await post(admin, '/api/accounts/partners/transactions', { partner: 'C', direction: 'in', amount: 1 })).status).toBe(422);
  });

  it('adds a client once, with a credit limit for an agency', async () => {
    const user = await createAccountant();
    const res = await post(user, '/api/accounts/parties', { type: 'B2B', name: 'Everest Holidays', phone: '+8801900000000', creditLimit: 250000 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: 'A-0001', type: 'B2B', creditLimit: 250000 });
    expect((await post(user, '/api/accounts/parties', { type: 'B2B', name: ' everest holidays ' })).body.code).toBe('PARTY_EXISTS');
    expect((await post(user, '/api/accounts/parties', { type: 'Vendor', name: 'x' })).status).toBe(422);
  });

  it('adds and removes categories, but not the built-in ones or ones in use', async () => {
    const user = await createAccountant();
    const made = await post(user, '/api/accounts/categories', { label: 'Insurance', color: '#112233' });
    expect(made.status).toBe(201);
    expect((await post(user, '/api/accounts/categories', { label: 'insurance' })).body.code).toBe('CATEGORY_EXISTS');
    await sale(user, { category: 'Insurance' });
    expect((await request(app).delete(`/api/accounts/categories/${made.body.data._id}`).set(bearer(user))).body.code).toBe('CATEGORY_IN_USE');

    const builtin = (await get(user, '/api/accounts/categories')).body.data.find((c) => c.label === 'Visa');
    expect((await request(app).delete(`/api/accounts/categories/${builtin._id}`).set(bearer(user))).body.code).toBe('CATEGORY_LOCKED');
    const unused = await post(user, '/api/accounts/categories', { label: 'Visa Fast' });
    expect((await request(app).delete(`/api/accounts/categories/${unused.body.data._id}`).set(bearer(user))).status).toBe(200);
  });
});

describe('who may use the accounts', () => {
  it('lets staff with REPORTS_VIEW read, only ACCOUNTS_EDIT record, and only ACCOUNTS_VOID void or cancel', async () => {
    const admin = await createAdmin();
    const made = await sale(admin);
    const id = made.body.data._id;
    const reader = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.REPORTS_VIEW] });
    const editor = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.ACCOUNTS_EDIT] });
    const nobody = await createUser({ role: ROLES.STAFF });

    expect((await get(reader, '/api/accounts/home')).status).toBe(200);
    expect((await sale(reader)).status).toBe(403);
    expect((await sale(editor)).status).toBe(201);
    expect((await post(editor, `/api/accounts/sales/${id}/cancel`, { reason: 'x' })).status).toBe(403);
    expect((await post(editor, '/api/accounts/receipts/' + id + '/void', { reason: 'x' })).status).toBe(403);
    expect((await get(nobody, '/api/accounts/home')).status).toBe(403);
  });

  it('keeps customers, agencies and visitors out', async () => {
    const customer = await createUser({ role: ROLES.B2C });
    expect((await get(customer, '/api/accounts/home')).status).toBe(403);
    expect((await get(customer, '/api/vendors')).status).toBe(403);
    expect((await request(app).get('/api/accounts/home')).status).toBe(401);
    expect((await request(app).get('/api/vendors')).status).toBe(401);
  });
});
