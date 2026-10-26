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
const { createUser, createB2B, bearer } = require('./helpers/factory');

const quiet = { log: () => {} };

describe('the seed commands (npm run seed:all, seed:clear, seed:reset)', () => {
  it('creates the visa catalog and sample applications, and the API serves them', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const staff = await createUser({ role: ROLES.STAFF, name: 'Priya Nair' });
    await createB2B();

    const summary = await run('seed', [], quiet);
    expect(summary['visa.seeded']).toMatchObject({ statuses: 11, countries: 8, types: 10, checklists: 1, applications: 8, templates: 11, messages: 2, quotations: 3 });
    expect(await MessageTemplate.countDocuments({ channel: 'email' })).toBe(4);
    expect((await VisaMessage.find().lean()).map((m) => m.status).sort()).toEqual(['pending', 'sent']);
    expect((await VisaQuotation.find().lean()).map((q) => q.status).sort()).toEqual(['accepted', 'draft', 'sent']);
    expect(await VisaApplication.countDocuments()).toBe(8);

    const statuses = (await VisaApplication.find().lean()).map((a) => a.status).sort();
    expect(statuses).toEqual(['approved', 'action_required', 'cancelled', 'completed', 'processing', 'rejected', 'submitted', 'under_review'].sort());
    expect(await VisaApplication.countDocuments({ assignedStaff: staff._id })).toBeGreaterThan(0);

    const list = await request(app).get('/api/visa/applications?limit=50').set(bearer(admin));
    expect(list.body.data).toHaveLength(8);
    expect(list.body.data.map((a) => a.number).sort()[0]).toMatch(/^VISA-\d{4}-000001$/);

    const countries = await request(app).get('/api/visa/countries').set(bearer(admin));
    expect(countries.body.data.map((c) => c.name)).toContain('Thailand');
    const dashboard = await request(app).get('/api/visa/dashboard').set(bearer(admin));
    expect(dashboard.body.data.total).toBe(8);
  });

  it('is safe to run again', async () => {
    await createUser({ role: ROLES.ADMIN });
    await createB2B();
    await run('seed', [], quiet);
    const again = await run('seed', [], quiet);
    expect(again['visa.seeded']).toMatchObject({ statuses: 11, countries: 0, types: 0, checklists: 0, applications: 0, templates: 0, messages: 0, quotations: 0 });
    expect(await MessageTemplate.countDocuments()).toBe(11);
    expect(await VisaQuotation.countDocuments()).toBe(3);
    expect(await VisaCountry.countDocuments()).toBe(8);
    expect(await VisaType.countDocuments()).toBe(10);
    expect(await VisaApplication.countDocuments()).toBe(8);
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

    const cleared = await run('clear', ['visa'], quiet);
    expect(cleared['visa.cleared']).toMatchObject({ applications: 8, countries: 8, types: 10, statuses: 11, templates: 11, messages: 2, quotations: 3 });
    expect(await VisaApplication.countDocuments()).toBe(0);
    expect(await VisaStatusConfig.countDocuments()).toBe(0);
    expect(await Counter.countDocuments({ _id: /^VISA:/ })).toBe(0);

    const reset = await run('reset', [], quiet);
    expect(reset['visa.seeded']).toMatchObject({ countries: 8, applications: 8 });
    expect(await VisaApplication.countDocuments()).toBe(8);
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
