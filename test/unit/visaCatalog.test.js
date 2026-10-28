const request = require('supertest');

const app = require('../../app');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const { SYSTEM_STATUSES } = require('../../config/visa');
const { createUser, bearer } = require('./helpers/factory');
const { createAdmin, createVisaStaff, createCatalog, applicationBody } = require('./helpers/visa');

const COUNTRY = { name: 'Japan', code: 'jp', flag: '🇯🇵', description: 'Tourist visas' };

describe('visa countries', () => {
  it('creates, reads, updates and lists countries, with the standard envelope', async () => {
    const admin = await createAdmin();
    const created = await request(app).post('/api/visa/countries').set(bearer(admin)).send(COUNTRY);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: 'Japan', code: 'JP', status: 'active', displayOrder: 1 });
    expect(created.body.data.nameKey).toBeUndefined();

    const id = created.body.data._id;
    expect((await request(app).get(`/api/visa/countries/${id}`).set(bearer(admin))).body.data.name).toBe('Japan');

    const updated = await request(app).patch(`/api/visa/countries/${id}`).set(bearer(admin)).send({ status: 'paused', displayOrder: 3 });
    expect(updated.body.data).toMatchObject({ status: 'paused', displayOrder: 3 });

    const list = await request(app).get('/api/visa/countries?search=jap').set(bearer(admin));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toEqual(list.body.pagination);
    expect(list.body.meta).toMatchObject({ total: 1, page: 1 });
  });

  it('answers 404 for a missing country instead of the first one', async () => {
    const admin = await createAdmin();
    const res = await request(app).get('/api/visa/countries/6ac0a5f0eebc510147c67250').set(bearer(admin));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('COUNTRY_NOT_FOUND');
  });

  it('refuses a second country with the same name in any letter case', async () => {
    const admin = await createAdmin();
    await request(app).post('/api/visa/countries').set(bearer(admin)).send(COUNTRY);
    const res = await request(app).post('/api/visa/countries').set(bearer(admin)).send({ ...COUNTRY, name: '  JAPAN ' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('COUNTRY_EXISTS');
  });

  it('cleans the rich checklist text so a script can never be stored', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/api/visa/countries')
      .set(bearer(admin))
      .send({ ...COUNTRY, richChecklist: '<h3>Rules</h3><p onclick="x()">Bring <strong>photos</strong></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>' });
    expect(res.body.data.richChecklist).toBe('<h3>Rules</h3><p>Bring <strong>photos</strong></p><a href>bad</a>');
  });

  it('validates input and strips fields it does not know', async () => {
    const admin = await createAdmin();
    const bad = await request(app).post('/api/visa/countries').set(bearer(admin)).send({ name: '', code: 'toolong' });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e) => e.field)).toEqual(expect.arrayContaining(['body.name', 'body.code']));
  });

  it('does not delete a country that has applications, but pauses is possible', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await request(app).post('/api/visa/applications').set(bearer(admin)).send(applicationBody(catalog));
    expect(made.status).toBe(201);

    const res = await request(app).delete(`/api/visa/countries/${catalog.country._id}`).set(bearer(admin));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('COUNTRY_IN_USE');
  });

  it('deletes an unused country together with its types', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    expect((await request(app).delete(`/api/visa/countries/${catalog.country._id}`).set(bearer(admin))).status).toBe(200);
    expect((await request(app).get(`/api/visa/types/${catalog.type._id}`).set(bearer(admin))).status).toBe(404);
  });
});

describe('visa types', () => {
  const body = (countryId, extra = {}) => ({
    countryId: String(countryId),
    name: 'Business Visa',
    entries: 'multiple',
    b2cPrice: 18000,
    b2bNetPrice: 15000,
    fees: { embassy: 12000, service: 5000, vat: 1000 },
    validFrom: '2026-10-01',
    passportRequirement: 'physical_required',
    ...extra
  });

  it('creates and updates a type, and lists the types of a country', async () => {
    const admin = await createAdmin();
    const { country } = await createCatalog();
    const created = await request(app).post('/api/visa/types').set(bearer(admin)).send(body(country._id));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: 'Business Visa', currency: 'BDT', entries: 'multiple', b2cPrice: 18000 });

    const patched = await request(app).patch(`/api/visa/types/${created.body.data._id}`).set(bearer(admin)).send({ b2cPrice: 19000, fees: { embassy: 13000 } });
    expect(patched.body.data.b2cPrice).toBe(19000);

    const list = await request(app).get(`/api/visa/types?countryId=${country._id}`).set(bearer(admin));
    expect(list.body.data.map((t) => t.name).sort()).toEqual(['Business Visa', 'Tourist Visa']);
  });

  it('refuses a duplicate name inside a country, a missing country and a currency that is not enabled', async () => {
    const admin = await createAdmin();
    const { country } = await createCatalog();
    expect((await request(app).post('/api/visa/types').set(bearer(admin)).send(body(country._id, { name: 'tourist  visa' }))).body.code).toBe('VISA_TYPE_EXISTS');
    expect((await request(app).post('/api/visa/types').set(bearer(admin)).send(body('6ac0a5f0eebc510147c67250'))).status).toBe(404);
    const eur = await request(app).post('/api/visa/types').set(bearer(admin)).send(body(country._id, { currency: 'EUR' }));
    expect(eur.status).toBe(422);
    expect(eur.body.code).toBe('CURRENCY_NOT_ENABLED');
  });

  it('accepts a price in USD once USD is enabled', async () => {
    const admin = await createAdmin();
    const { country } = await createCatalog();
    const res = await request(app).post('/api/visa/types').set(bearer(admin)).send(body(country._id, { currency: 'usd', b2cPrice: 120, b2bNetPrice: 100 }));
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe('USD');
  });
});

describe('visa checklists', () => {
  it('answers the default list until one is saved, then the saved list', async () => {
    const admin = await createAdmin();
    const { country, type } = await createCatalog();
    const url = `/api/visa/checklists/${country._id}/${type._id}/individual`;

    const fallback = await request(app).get(url).set(bearer(admin));
    expect(fallback.body.data.isDefault).toBe(true);
    expect(fallback.body.data.items.length).toBeGreaterThan(0);

    const items = [{ label: 'Passport', requirement: 'required', submissionMode: 'both', maxSizeMb: 5 }, { label: 'Photo' }];
    const saved = await request(app).put(url).set(bearer(admin)).send({ items });
    expect(saved.status).toBe(200);
    expect(saved.body.data.items.map((i) => i.label)).toEqual(['Passport', 'Photo']);

    const again = await request(app).get(url).set(bearer(admin));
    expect(again.body.data).toMatchObject({ isDefault: false });
    expect(again.body.data.items[0]).toMatchObject({ maxSizeMb: 5, requirement: 'required' });
  });

  it('answers 404 when the visa type does not belong to the country', async () => {
    const admin = await createAdmin();
    const one = await createCatalog();
    const two = await createCatalog();
    const res = await request(app).get(`/api/visa/checklists/${one.country._id}/${two.type._id}/individual`).set(bearer(admin));
    expect(res.status).toBe(404);
  });
});

describe('visa statuses', () => {
  it('lists the 11 system statuses, created on first use', async () => {
    const admin = await createAdmin();
    const res = await request(app).get('/api/visa/statuses').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.key)).toEqual(SYSTEM_STATUSES.map((s) => s.key));
    expect(res.body.data.every((s) => s.isSystem)).toBe(true);
  });

  it('lets staff edit the wording of a system status but not remove, switch off or recategorise it', async () => {
    const admin = await createAdmin();
    const list = await request(app).get('/api/visa/statuses').set(bearer(admin));
    const approved = list.body.data.find((s) => s.key === 'approved');

    const ok = await request(app).patch(`/api/visa/statuses/${approved._id}`).set(bearer(admin)).send({ customerMessage: 'Great news.' });
    expect(ok.body.data.customerMessage).toBe('Great news.');
    expect((await request(app).patch(`/api/visa/statuses/${approved._id}`).set(bearer(admin)).send({ active: false })).body.code).toBe('STATUS_LOCKED');
    expect((await request(app).patch(`/api/visa/statuses/${approved._id}`).set(bearer(admin)).send({ category: 'failed' })).body.code).toBe('STATUS_LOCKED');
    expect((await request(app).delete(`/api/visa/statuses/${approved._id}`).set(bearer(admin))).body.code).toBe('STATUS_LOCKED');
  });

  it('creates a custom status with a generated key, refuses a clash and deletes an unused one', async () => {
    const admin = await createAdmin();
    const created = await request(app).post('/api/visa/statuses').set(bearer(admin)).send({ displayName: 'Waiting for Embassy Slot', category: 'in_progress' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ key: 'waiting_for_embassy_slot', isSystem: false, active: true });

    const clash = await request(app).post('/api/visa/statuses').set(bearer(admin)).send({ displayName: 'Processing', key: 'processing', category: 'in_progress' });
    expect(clash.body.code).toBe('STATUS_EXISTS');

    expect((await request(app).delete(`/api/visa/statuses/${created.body.data._id}`).set(bearer(admin))).status).toBe(200);
  });
});

describe('permissions on the catalog', () => {
  it('lets staff with VISA_VIEW read but not write, and gives staff without it nothing', async () => {
    const reader = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const nobody = await createUser({ role: ROLES.STAFF });
    const editor = await createVisaStaff();

    expect((await request(app).get('/api/visa/countries').set(bearer(reader))).status).toBe(200);
    expect((await request(app).post('/api/visa/countries').set(bearer(reader)).send(COUNTRY)).status).toBe(403);
    expect((await request(app).get('/api/visa/countries').set(bearer(nobody))).status).toBe(403);
    expect((await request(app).post('/api/visa/countries').set(bearer(editor)).send(COUNTRY)).status).toBe(201);
  });
});
