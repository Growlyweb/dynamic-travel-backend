const request = require('supertest');

const app = require('../../app');
const env = require('../../config/env');
const { ROLES } = require('../../config/constants');
const VisaApplication = require('../../models/VisaApplication');
const VisaCountry = require('../../models/VisaCountry');
const VisaType = require('../../models/VisaType');
const VisaStatusConfig = require('../../models/VisaStatusConfig');
const Counter = require('../../models/Counter');
const { run } = require('../../scripts/seed');
const VisaQuotation = require('../../models/VisaQuotation');
const VisaMessage = require('../../models/VisaMessage');
const MessageTemplate = require('../../models/MessageTemplate');
const Journal = require('../../models/Journal');
const SaleFile = require('../../models/SaleFile');
const Party = require('../../models/Party');
const Account = require('../../models/Account');
const { ACCOUNTS } = require('../../config/accounting');
const { createUser, createB2B, bearer } = require('./helpers/factory');

const quiet = { log: () => {} };

describe('the seed commands (npm run seed:all, seed:clear, seed:reset)', () => {
  it('creates the visa catalog and sample applications, and the API serves them', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const staff = await createUser({ role: ROLES.STAFF, name: 'Priya Nair' });
    await createB2B();

    const summary = await run('seed', [], quiet);
    expect(summary['visa.seeded']).toMatchObject({ statuses: 11, countries: 8, types: 10, checklists: 1, checklistEntries: 10, applications: 11, templates: 13, messages: 2, quotations: 3 });
    expect(await MessageTemplate.countDocuments({ channel: 'email' })).toBe(5);
    expect((await VisaMessage.find().lean()).map((m) => m.status).sort()).toEqual(['pending', 'sent']);
    expect((await VisaQuotation.find().lean()).map((q) => q.status).sort()).toEqual(['accepted', 'draft', 'sent']);
    expect(await VisaApplication.countDocuments()).toBe(11);

    // 8 visa files, then a ticket, a hotel booking and a tour package
    const statuses = (await VisaApplication.find({ serviceType: 'visa' }).lean()).map((a) => a.status).sort();
    expect(statuses).toEqual(['approved', 'action_required', 'cancelled', 'completed', 'processing', 'rejected', 'submitted', 'under_review'].sort());
    expect((await VisaApplication.find({ serviceType: { $ne: 'visa' } }).lean()).map((a) => a.serviceType).sort()).toEqual(['hotel', 'ticket', 'tour']);
    expect(await VisaApplication.countDocuments({ assignedStaff: staff._id })).toBeGreaterThan(0);

    const list = await request(app).get('/api/visa/applications?limit=50').set(bearer(admin));
    expect(list.body.data).toHaveLength(11);
    expect(list.body.data.map((a) => a.number).filter((number) => number.startsWith('VISA-')).sort()[0]).toMatch(/^VISA-\d{4}-000001$/);
    const tickets = await request(app).get('/api/visa/applications?serviceType=ticket').set(bearer(admin));
    expect(tickets.body.data).toHaveLength(1);
    expect(tickets.body.data[0]).toMatchObject({ number: expect.stringMatching(/^TKT-\d{4}-000001$/), serviceLabel: 'Ticket', serviceSummary: 'Dhaka (DAC) to Dubai (DXB), Round Way, Economy' });

    const countries = await request(app).get('/api/visa/countries').set(bearer(admin));
    expect(countries.body.data.map((c) => c.name)).toContain('Thailand');
    const dashboard = await request(app).get('/api/visa/dashboard').set(bearer(admin));
    expect(dashboard.body.data.total).toBe(11);
    expect(dashboard.body.data.services).toEqual({ visa: 8, ticket: 1, hotel: 1, tour: 1 });
    expect(dashboard.body.data.countries.reduce((sum, row) => sum + row.applications, 0)).toBe(8);

    // the books: the chart, 3 vendors, 6 typed sales, and one file for each of the 11 applications
    expect(summary['accounting.seeded']).toMatchObject({ accounts: ACCOUNTS.length, vendors: 3, bills: 3, payments: 2, sales: 6, expenses: 3, visaFiles: 11 });
    expect(await Account.countDocuments()).toBe(ACCOUNTS.length);
    expect(await SaleFile.countDocuments()).toBe(17);
    expect((await SaleFile.find({ 'source.kind': 'visa-application' }).lean()).map((file) => file.segment).sort()).toEqual(['air', 'hotel', 'tour', 'visa', 'visa', 'visa', 'visa', 'visa', 'visa', 'visa', 'visa']);
    for (const journal of await Journal.find()) expect(journal.lines.reduce((s, l) => s + l.debit, 0)).toBe(journal.lines.reduce((s, l) => s + l.credit, 0));
    const sales = await request(app).get('/api/accounts/sales?limit=50').set(bearer(admin));
    expect(sales.body.data).toHaveLength(17);
    const home = await request(app).get('/api/accounts/home').set(bearer(admin));
    expect(home.body.data.sale).toBeGreaterThan(0);
    expect(home.body.data.vendorDue).toBeGreaterThan(0);
    expect((await request(app).get('/api/vendors').set(bearer(admin))).body.data.length).toBeGreaterThanOrEqual(3);
  });

  it('is safe to run again', async () => {
    await createUser({ role: ROLES.ADMIN });
    await createB2B();
    await run('seed', [], quiet);
    const again = await run('seed', [], quiet);
    expect(again['visa.seeded']).toMatchObject({ statuses: 11, countries: 0, types: 0, checklists: 0, checklistEntries: 0, applications: 0, templates: 0, messages: 0, quotations: 0 });
    expect(await MessageTemplate.countDocuments()).toBe(13);
    expect(await VisaQuotation.countDocuments()).toBe(3);
    expect(await VisaCountry.countDocuments()).toBe(8);
    expect(await VisaType.countDocuments()).toBe(10);
    expect(await VisaApplication.countDocuments()).toBe(11);
    expect(again['accounting.seeded'].note).toMatch(/already exist/);
    expect(await SaleFile.countDocuments()).toBe(17);
    expect(await Party.countDocuments({ type: 'Vendor' })).toBeGreaterThanOrEqual(3);
  });

  it('seeds the catalog without applications when there is no admin yet, and says why', async () => {
    const summary = await run('seed', ['visa'], quiet);
    expect(summary['visa.seeded'].applications).toBe(0);
    expect(summary['visa.seeded'].note).toMatch(/npm run seed/);
    expect(await VisaCountry.countDocuments()).toBe(8);
  });

  it('clears the module, and reset clears then seeds', async () => {
    await createUser({ role: ROLES.ADMIN });
    await createB2B();
    await run('seed', [], quiet);

    const cleared = await run('clear', [], quiet);
    expect(cleared['visa.cleared']).toMatchObject({ applications: 11, countries: 8, types: 10, statuses: 11, templates: 13, messages: 2, quotations: 3 });
    expect(cleared['accounting.cleared']).toMatchObject({ files: 17 });
    expect(await Journal.countDocuments()).toBe(0);
    expect(await Account.countDocuments()).toBe(ACCOUNTS.length);
    expect(await VisaApplication.countDocuments()).toBe(0);
    expect(await VisaStatusConfig.countDocuments()).toBe(0);
    expect(await Counter.countDocuments({ _id: /^((VISA|TKT|HTL|TOUR):|VI$)/ })).toBe(0);

    const reset = await run('reset', [], quiet);
    expect(reset['visa.seeded']).toMatchObject({ countries: 8, applications: 11 });
    expect(await VisaApplication.countDocuments()).toBe(11);
  });

  it('refuses an unknown module and an unknown command', async () => {
    await expect(run('seed', ['nope'], quiet)).rejects.toThrow(/Unknown seed module/);
    await expect(run('wipe', [], quiet)).rejects.toThrow(/Usage/);
  });

  describe('in production', () => {
    beforeEach(() => {
      env.isProduction = true;
    });
    afterEach(() => {
      env.isProduction = false;
    });

    it('seeds only the statuses the system needs, never demo data', async () => {
      await createUser({ role: ROLES.ADMIN });
      const summary = await run('seed', [], quiet);
      expect(summary['visa.seeded']).toEqual({ statuses: 11 });
      expect(await VisaCountry.countDocuments()).toBe(0);
      expect(await VisaApplication.countDocuments()).toBe(0);
    });

    it('refuses clear and reset unless it is told twice', async () => {
      await expect(run('clear', [], quiet)).rejects.toThrow(/will not run in production/);
      await expect(run('reset', [], quiet)).rejects.toThrow(/will not run in production/);
      await expect(run('clear', [], { ...quiet, allowProduction: true })).resolves.toBeTruthy();
    });
  });
});
