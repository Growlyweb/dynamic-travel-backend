const request = require('supertest');

const app = require('../../app');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const Journal = require('../../models/Journal');
const { createUser, bearer } = require('./helpers/factory');
const { createAccountant, createAdmin, daysAgo } = require('./helpers/accounting');

const post = (user, path, body) => request(app).post(path).set(bearer(user)).send(body);
const patch = (user, path, body) => request(app).patch(path).set(bearer(user)).send(body);
const get = (user, path) => request(app).get(path).set(bearer(user));

const vendor = (user, extra = {}) => post(user, '/api/vendors', { name: 'Skyline Visa Services', phone: '+8801711000001', ...extra });
const bill = (user, vendorId, extra = {}) => post(user, '/api/vendors/bills', { vendorId, amount: 45000, account: '5010', service: 'Embassy fees', invoiceRef: 'INV-1', ...extra });

describe('vendors', () => {
  it('creates, reads, changes and lists vendors', async () => {
    const user = await createAccountant();
    const made = await vendor(user, { contactPerson: 'Mr. Alam', creditLimit: 500000 });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ code: 'VND-0001', name: 'Skyline Visa Services', creditLimit: 500000, active: true, due: 0, advance: 0 });

    expect((await get(user, `/api/vendors/${made.body.data._id}`)).body.data.contactPerson).toBe('Mr. Alam');
    const changed = await patch(user, `/api/vendors/${made.body.data._id}`, { phone: '+8801799999999', active: false });
    expect(changed.body.data).toMatchObject({ phone: '+8801799999999', active: false });

    await vendor(user, { name: 'Grand Hotels' });
    const list = await get(user, '/api/vendors');
    expect(list.body.data.map((v) => v.name)).toEqual(['Grand Hotels', 'Skyline Visa Services']);
    expect(list.body.meta).toMatchObject({ total: 2 });
    expect((await get(user, '/api/vendors?search=hotel')).body.data).toHaveLength(1);
    expect((await get(user, '/api/vendors?active=false')).body.data).toHaveLength(1);
  });

  it('refuses a second vendor with the same name, and a missing vendor is 404', async () => {
    const user = await createAccountant();
    await vendor(user);
    expect((await vendor(user, { name: ' skyline  visa services ' })).body.code).toBe('VENDOR_EXISTS');
    expect((await get(user, '/api/vendors/6ac0a5f0eebc510147c67250')).status).toBe(404);
    expect((await get(user, '/api/vendors/not-an-id')).status).toBe(422);
  });

  it('posts an opening balance, owed or advanced, as an opening voucher', async () => {
    const user = await createAccountant();
    const owed = await vendor(user, { openingBalance: 20000, openingBalanceType: 'due' });
    const advance = await vendor(user, { name: 'Air Connect', openingBalance: 7000, openingBalanceType: 'advance' });
    expect(owed.body.data.due).toBe(20000);
    expect(advance.body.data).toMatchObject({ due: 0, advance: 7000 });
    expect(await Journal.countDocuments({ type: 'OB' })).toBe(2);
    expect((await get(user, '/api/accounts/advances')).body.data).toMatchObject({ total: 7000 });
    expect((await get(user, '/api/accounts/payables')).body.data.totals).toMatchObject({ due: 20000, count: 1 });
  });
});

describe('vendor bills', () => {
  it('posts the cost and what is owed, numbers the bill, and shows it on the vendor', async () => {
    const user = await createAccountant();
    const v = (await vendor(user)).body.data;
    const res = await bill(user, v._id);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ billNo: expect.stringMatching(/^VB-\d{4}-0001$/), amount: 45000, paid: 0, due: 45000, account: '5010', status: 'posted', vendorName: v.name });
    expect(res.body.data.dueDate).toBeTruthy();
    expect((await get(user, `/api/vendors/${v._id}`)).body.data).toMatchObject({ billed: 45000, due: 45000 });
    const home = (await get(user, '/api/accounts/home')).body.data;
    expect(home).toMatchObject({ cost: 45000, vendorDue: 45000 });
  });

  it('refuses a bill that makes no sense', async () => {
    const user = await createAccountant();
    const v = (await vendor(user)).body.data;
    expect((await bill(user, v._id, { amount: 0 })).status).toBe(422);
    expect((await bill(user, v._id, { account: '6010' })).status).toBe(422);
    expect((await bill(user, v._id, { account: '5999' })).body.code).toBe('INVALID_ACCOUNT');
    expect((await bill(user, v._id, { date: daysAgo(2), dueDate: daysAgo(5) })).body.code).toBe('INVALID_DATE');
    expect((await bill(user, '6ac0a5f0eebc510147c67250')).status).toBe(404);
    await patch(user, `/api/vendors/${v._id}`, { active: false });
    expect((await bill(user, v._id)).body.code).toBe('VENDOR_INACTIVE');
    expect(await Journal.countDocuments()).toBe(0);
  });

  it('lists bills with filters and what is still due on each', async () => {
    const user = await createAccountant();
    const a = (await vendor(user)).body.data;
    const b = (await vendor(user, { name: 'Grand Hotels' })).body.data;
    const first = await bill(user, a._id, { amount: 1000, invoiceRef: 'A-1' });
    await bill(user, b._id, { amount: 2000, invoiceRef: 'B-1' });
    await post(user, '/api/vendors/payments', { vendorId: a._id, amount: 400, billId: first.body.data._id, method: 'cash' });

    const all = await get(user, '/api/vendors/bills');
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data.find((x) => x.invoiceRef === 'A-1')).toMatchObject({ paid: 400, due: 600 });
    expect((await get(user, `/api/vendors/bills?vendorId=${b._id}`)).body.data).toHaveLength(1);
    expect((await get(user, '/api/vendors/bills?search=grand')).body.data).toHaveLength(1);
    expect((await get(user, '/api/vendors/bills?limit=1&page=2')).body.data).toHaveLength(1);
  });

  it('voids a bill with a reason, unless payments are linked to it', async () => {
    const user = await createAccountant();
    const v = (await vendor(user)).body.data;
    const made = (await bill(user, v._id)).body.data;
    const pay = (await post(user, '/api/vendors/payments', { vendorId: v._id, amount: 1000, billId: made._id, method: 'cash' })).body.data;

    expect((await post(user, `/api/vendors/bills/${made._id}/void`, { reason: 'x' })).body.code).toBe('BILL_HAS_PAYMENTS');
    await post(user, `/api/vendors/payments/${pay._id}/void`, { reason: 'Wrong vendor' });
    expect((await post(user, `/api/vendors/bills/${made._id}/void`, {})).status).toBe(422);
    const voided = await post(user, `/api/vendors/bills/${made._id}/void`, { reason: 'Duplicate bill' });
    expect(voided.body.data).toMatchObject({ status: 'void', voidReason: 'Duplicate bill' });
    expect((await get(user, `/api/vendors/${v._id}`)).body.data).toMatchObject({ billed: 0, due: 0 });
    expect((await post(user, `/api/vendors/bills/${made._id}/void`, { reason: 'again' })).body.code).toBe('ALREADY_VOID');
  });
});

describe('vendor payments and advances', () => {
  it('settles what is owed, and refuses to pay more than that', async () => {
    const user = await createAccountant();
    const v = (await vendor(user)).body.data;
    await bill(user, v._id, { amount: 10000 });
    expect((await post(user, '/api/vendors/payments', { vendorId: v._id, amount: 10001, method: 'city' })).body.code).toBe('PAYMENT_EXCEEDS_DUE');

    const res = await post(user, '/api/vendors/payments', { vendorId: v._id, amount: 4000, method: 'city', note: 'Part' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ voucherNo: expect.stringMatching(/^VP-\d{4}-0001$/), amount: 4000, isAdvance: false, method: 'city' });
    expect((await get(user, `/api/vendors/${v._id}`)).body.data).toMatchObject({ billed: 10000, paid: 4000, due: 6000 });
    expect((await get(user, '/api/accounts/balances')).body.data.find((b) => b.key === 'bank').amount).toBe(-4000);
  });

  it('keeps a payment inside the bill it is linked to', async () => {
    const user = await createAccountant();
    const v = (await vendor(user)).body.data;
    const one = (await bill(user, v._id, { amount: 1000 })).body.data;
    await bill(user, v._id, { amount: 5000, invoiceRef: 'INV-2' });
    expect((await post(user, '/api/vendors/payments', { vendorId: v._id, amount: 1001, billId: one._id })).body.code).toBe('PAYMENT_EXCEEDS_BILL');
    expect((await post(user, '/api/vendors/payments', { vendorId: v._id, amount: 100, billId: '6ac0a5f0eebc510147c67250' })).status).toBe(404);
    expect((await post(user, '/api/vendors/payments', { vendorId: v._id, amount: 1000, billId: one._id })).status).toBe(201);
  });

  it('records an advance before there is a bill, and shows it as an advance', async () => {
    const user = await createAccountant();
    const v = (await vendor(user)).body.data;
    const res = await post(user, '/api/vendors/payments', { vendorId: v._id, amount: 15000, method: 'bkash', isAdvance: true, note: 'For the next group' });
    expect(res.body.data).toMatchObject({ isAdvance: true, amount: 15000 });
    expect((await get(user, `/api/vendors/${v._id}`)).body.data).toMatchObject({ advance: 15000, due: 0 });
    const advances = (await get(user, '/api/accounts/advances')).body.data;
    expect(advances.rows[0]).toMatchObject({ name: v.name, amount: 15000 });
    expect((await get(user, '/api/vendors/payments?isAdvance=true')).body.data).toHaveLength(1);
  });

  it('voids a payment and the amount is due again', async () => {
    const user = await createAccountant();
    const v = (await vendor(user)).body.data;
    await bill(user, v._id, { amount: 3000 });
    const pay = (await post(user, '/api/vendors/payments', { vendorId: v._id, amount: 3000, method: 'cash' })).body.data;
    expect((await get(user, `/api/vendors/${v._id}`)).body.data.due).toBe(0);
    const voided = await post(user, `/api/vendors/payments/${pay._id}/void`, { reason: 'Cheque bounced' });
    expect(voided.body.data).toMatchObject({ status: 'void', voidReason: 'Cheque bounced' });
    expect((await get(user, `/api/vendors/${v._id}`)).body.data.due).toBe(3000);
    expect((await get(user, '/api/vendors/payments?status=void')).body.data).toHaveLength(1);
    expect((await post(user, `/api/vendors/payments/${pay._id}/void`, { reason: 'again' })).body.code).toBe('ALREADY_VOID');
  });

  it('settles the oldest bill first and ages what is left from the due date', async () => {
    const user = await createAccountant();
    const v = (await vendor(user)).body.data;
    await bill(user, v._id, { amount: 1000, date: daysAgo(80), dueDate: daysAgo(70), invoiceRef: 'OLD' });
    await bill(user, v._id, { amount: 2000, date: daysAgo(10), dueDate: daysAgo(-5), invoiceRef: 'NEW' });
    await post(user, '/api/vendors/payments', { vendorId: v._id, amount: 600, method: 'cash' });

    const payables = (await get(user, '/api/accounts/payables')).body.data;
    expect(payables.rows[0]).toMatchObject({ name: v.name, invoiced: 3000, collected: 600, due: 2400, overdue: 400, oldestDays: 70, status: 'Overdue' });
    const aging = Object.fromEntries(payables.aging.map((b) => [b.key, b.amount]));
    expect(aging).toMatchObject({ current: 2000, d61_90: 400, d1_30: 0 });
    expect(payables.totals).toMatchObject({ due: 2400, overdue: 400, count: 1 });
    expect((await get(user, '/api/accounts/home')).body.data).toMatchObject({ vendorDue: 2400, vendorOverdue: 400 });
  });
});

describe('who may use the vendors', () => {
  it('needs VENDOR_VIEW to read, VENDOR_MANAGE to create and ACCOUNTS_VOID to void', async () => {
    const admin = await createAdmin();
    const v = (await vendor(admin)).body.data;
    const made = (await bill(admin, v._id)).body.data;
    const reader = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VENDOR_VIEW] });
    const manager = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VENDOR_VIEW, PERMISSIONS.VENDOR_MANAGE] });
    const nobody = await createUser({ role: ROLES.STAFF });

    expect((await get(reader, '/api/vendors')).status).toBe(200);
    expect((await vendor(reader, { name: 'New' })).status).toBe(403);
    expect((await vendor(manager, { name: 'New' })).status).toBe(201);
    expect((await post(manager, `/api/vendors/bills/${made._id}/void`, { reason: 'x' })).status).toBe(403);
    expect((await get(nobody, '/api/vendors')).status).toBe(403);
  });
});
