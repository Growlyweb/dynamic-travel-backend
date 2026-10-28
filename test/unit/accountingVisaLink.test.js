const request = require('supertest');

const app = require('../../app');
const events = require('../../utils/events');
const Journal = require('../../models/Journal');
const SaleFile = require('../../models/SaleFile');
const Party = require('../../models/Party');
const visaLink = require('../../services/accounting/visaLink');
const { createB2B, bearer } = require('./helpers/factory');
const { createAdmin, createCatalog, applicationBody } = require('./helpers/visa');

const post = (user, path, body) => request(app).post(path).set(bearer(user)).send(body);
const patch = (user, path, body) => request(app).patch(path).set(bearer(user)).send(body);
const get = (user, path) => request(app).get(path).set(bearer(user));

const createApplication = async (admin, catalog, extra) => {
  const res = await post(admin, '/api/visa/applications', applicationBody(catalog, extra));
  await events.idle();
  return res.body.data;
};
const sales = async (admin) => (await get(admin, '/api/accounts/sales')).body.data;

describe('a visa application in the books', () => {
  it('makes one sale file with the sale, the discount, the vendor cost and the advance', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await createApplication(admin, catalog, {
      discountAmount: 1000,
      advancePaid: 4000,
      paymentMethod: 'bKash / Nagad',
      vendorList: [{ name: 'Skyline Visa Services', service: 'visa', price: 5000 }, { name: 'Courier Co', service: 'visa', price: 500 }]
    });

    const [file] = await sales(admin);
    expect(file).toMatchObject({
      fileNo: expect.stringMatching(/^VF-\d{4}-0001$/),
      category: 'Visa',
      applicant: 'Rahim Ahmed',
      partyType: 'B2C',
      destination: catalog.country.name,
      detail: 'Tourist Visa',
      sale: 12000,
      discount: 1000,
      cost: 5500,
      received: 4000,
      due: 7000,
      profit: 5500,
      paymentStatus: 'Partial',
      source: { kind: 'visa-application', id: made._id }
    });
    expect(file.notes).toContain(made.number);
    expect(await Party.countDocuments({ type: 'Vendor', name: { $in: ['Skyline Visa Services', 'Courier Co'] } })).toBe(2);

    const receipts = (await get(admin, '/api/accounts/receipts')).body.data;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ amount: 4000, paymentType: 'bKash', invoiceNo: file.fileNo });
    expect((await get(admin, '/api/accounts/payables')).body.data.totals).toMatchObject({ due: 5500, count: 2 });
  });

  it('is safe to repeat: the same event twice changes nothing', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await createApplication(admin, catalog, { advancePaid: 2000, paymentMethod: 'Cash' });
    const before = await Journal.countDocuments();
    await visaLink.syncApplication(made._id);
    await visaLink.syncApplication(made._id);
    await visaLink.syncPayment(made._id, made.payments[0]._id);
    expect(await Journal.countDocuments()).toBe(before);
    expect(await SaleFile.countDocuments()).toBe(1);
  });

  it('posts a later payment as a receipt, and voiding the payment voids the receipt', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await createApplication(admin, catalog);
    expect((await sales(admin))[0]).toMatchObject({ received: 0, due: 12000, paymentStatus: 'Unpaid' });

    const paid = await post(admin, `/api/visa/applications/${made._id}/payments`, { amount: 5000, method: 'Bank Transfer', note: 'trx 1' });
    await events.idle();
    expect((await sales(admin))[0]).toMatchObject({ received: 5000, due: 7000 });
    const receipt = (await get(admin, '/api/accounts/receipts')).body.data[0];
    expect(receipt).toMatchObject({ amount: 5000, paymentType: 'Bank', note: expect.stringContaining(made.number) });

    await post(admin, `/api/visa/applications/${made._id}/payments/${paid.body.data.payments[0]._id}/void`, { reason: 'Wrong amount' });
    await events.idle();
    expect((await sales(admin))[0]).toMatchObject({ received: 0, due: 12000 });
    expect((await get(admin, '/api/accounts/receipts')).body.data).toHaveLength(0);
    expect(await Journal.countDocuments({ type: 'RV', status: 'void' })).toBe(1);
  });

  it('follows an edit of the total, the discount and the vendor lines', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await createApplication(admin, catalog, { vendorList: [{ name: 'Skyline Visa Services', service: 'visa', price: 5000 }] });
    expect((await sales(admin))[0]).toMatchObject({ sale: 12000, cost: 5000 });

    await patch(admin, `/api/visa/applications/${made._id}`, { discountAmount: 2000, vendorList: [{ name: 'Skyline Visa Services', service: 'visa', price: 6500 }] });
    await events.idle();
    const [file] = await sales(admin);
    expect(file).toMatchObject({ sale: 12000, discount: 2000, cost: 6500, due: 10000, profit: 3500 });
    expect(await SaleFile.countDocuments()).toBe(1);

    await patch(admin, `/api/visa/applications/${made._id}`, { name: 'Rahim Uddin' });
    await events.idle();
    expect((await sales(admin))[0].applicant).toBe('Rahim Ahmed');
  });

  it('books a file in USD in taka at the rate saved on the application', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    await createApplication(admin, catalog, { currency: 'USD' });
    const [file] = await sales(admin);
    expect(file.sale).toBeCloseTo(12000, -1);
    expect(file.sale).toBe(Math.round(98.36 * 122 * 100) / 100);
  });

  it('puts a partner application on the agency, linked to the partner', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    await createApplication(admin, catalog, { clientType: 'b2b', partnerId: String(partner._id) });
    const [file] = await sales(admin);
    expect(file).toMatchObject({ partyType: 'B2B', partyName: partner.companyName, sale: 10000 });
    const party = await Party.findOne({ type: 'B2B' });
    expect(String(party.partner)).toBe(String(partner._id));
    expect((await get(admin, '/api/accounts/parties?type=B2B')).body.data[0]).toMatchObject({ name: partner.companyName, invoices: 1, due: 10000 });
  });

  it('does not cancel anything in the books when the application is cancelled or rejected', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await createApplication(admin, catalog, { advancePaid: 3000, paymentMethod: 'Cash' });
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'cancelled', internalReason: 'Withdrawn' });
    await events.idle();
    const [file] = await sales(admin);
    expect(file).toMatchObject({ status: 'Processing', received: 3000 });
    // A person decides what happens to the money, from the sale: refund or keep.
    const cancelled = await post(admin, `/api/accounts/sales/${file._id}/cancel`, { reason: 'Application cancelled', settlement: 'refund' });
    expect(cancelled.body.data.status).toBe('Cancelled');
    expect(await sales(admin)).toHaveLength(0);
  });

  it('keeps the books of a file that was cancelled in accounts when the application changes later', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await createApplication(admin, catalog);
    const [file] = await sales(admin);
    await post(admin, `/api/accounts/sales/${file._id}/cancel`, { reason: 'Mistake' });
    await patch(admin, `/api/visa/applications/${made._id}`, { discountAmount: 500 });
    await post(admin, `/api/visa/applications/${made._id}/payments`, { amount: 100, method: 'Cash' });
    await events.idle();
    expect(await sales(admin)).toHaveLength(0);
    expect(await Journal.countDocuments({ status: 'posted' })).toBe(0);
  });

  it('shows visa money in the profit of the month', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    await createApplication(admin, catalog, { discountAmount: 1000, advancePaid: 11000, paymentMethod: 'Cash', vendorList: [{ name: 'Skyline Visa Services', service: 'visa', price: 7000 }] });
    const home = (await get(admin, '/api/accounts/home')).body.data;
    expect(home).toMatchObject({ sale: 11000, cost: 7000, profit: 4000, totalDue: 0, vendorDue: 7000 });
    expect(home.money.cash).toBe(11000);
    expect(home.categories[0]).toMatchObject({ label: 'Visa', sale: 11000, cost: 7000, profit: 4000 });
  });
});
