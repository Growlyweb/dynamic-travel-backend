const request = require('supertest');

const app = require('../../app');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const VisaChecklistEntry = require('../../models/VisaChecklistEntry');
const AuditLog = require('../../models/AuditLog');
const { createUser, bearer } = require('./helpers/factory');
const { createAdmin, createCatalog } = require('./helpers/visa');

const post = (user, path, body) => request(app).post(path).set(bearer(user)).send(body);
const patch = (user, path, body) => request(app).patch(path).set(bearer(user)).send(body);
const get = (user, path) => request(app).get(path).set(bearer(user));
const del = (user, path) => request(app).delete(path).set(bearer(user));

const entry = (user, catalog, extra = {}) =>
  post(user, '/api/visa/checklist-entries', { countryId: String(catalog.country._id), visaTypeId: String(catalog.type._id), title: 'Testland Tourist Visa Document Check List', description: '<p>Bring a passport.</p>', ...extra });

describe('visa checklist pages', () => {
  it('creates a page with the next code, the processing time of the visa type, and the country and type spelled out', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog({ type: { processingTime: '5-7 working days', entries: 'multiple' } });
    const res = await entry(admin, catalog, { media: [{ name: 'Specimen', type: 'image', url: 'https://example.com/specimen.png' }] });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      code: 'VI0001',
      title: 'Testland Tourist Visa Document Check List',
      description: '<p>Bring a passport.</p>',
      processingTime: '5-7 working days',
      status: 'active',
      displayOrder: 1,
      country: String(catalog.country._id),
      countryName: catalog.country.name,
      countryCode: 'TL',
      visaType: String(catalog.type._id),
      visaTypeName: 'Tourist Visa',
      entries: 'multiple'
    });
    expect(res.body.data.media).toMatchObject([{ name: 'Specimen', type: 'image', url: 'https://example.com/specimen.png' }]);

    const second = await createCatalog();
    expect((await entry(admin, second)).body.data).toMatchObject({ code: 'VI0002', displayOrder: 2 });
    expect(await AuditLog.countDocuments({ action: 'VISA_CATALOG_CHANGED', resource: /^visa-checklist-entry:/ })).toBe(2);
  });

  it('allows one page for each country and visa type, and a visa type of the right country', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    expect((await entry(admin, catalog)).status).toBe(201);
    const again = await entry(admin, catalog);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CHECKLIST_ENTRY_EXISTS');

    const other = await createCatalog();
    const mixed = await post(admin, '/api/visa/checklist-entries', { countryId: String(catalog.country._id), visaTypeId: String(other.type._id), title: 'Mixed' });
    expect(mixed.status).toBe(404);
    expect(mixed.body.code).toBe('VISA_TYPE_NOT_FOUND');
    expect((await post(admin, '/api/visa/checklist-entries', { countryId: '6ac0a5f0eebc510147c67250', visaTypeId: String(other.type._id), title: 'Nowhere' })).body.code).toBe('COUNTRY_NOT_FOUND');
  });

  it('needs a title, and refuses a bad status, order or sample link', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    expect((await entry(admin, catalog, { title: '  ' })).status).toBe(422);
    expect((await entry(admin, catalog, { status: 'paused' })).status).toBe(422);
    expect((await entry(admin, catalog, { displayOrder: 0 })).status).toBe(422);
    expect((await entry(admin, catalog, { media: [{ name: 'Bad', url: 'javascript:alert(1)' }] })).status).toBe(422);
    expect(await VisaChecklistEntry.countDocuments()).toBe(0);
  });

  it('cleans the rich text: formatting stays, scripts and event handlers go', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const res = await entry(admin, catalog, { description: '<h2>Documents</h2><p onclick="x()">Passport <strong>copy</strong></p><script>alert(1)</script><img src="https://example.com/a.png" onerror="x()">' });
    expect(res.body.data.description).toContain('<h2>Documents</h2>');
    expect(res.body.data.description).toContain('<strong>copy</strong>');
    expect(res.body.data.description).not.toMatch(/script|onclick|onerror|alert/);
    expect(res.body.data.description).toContain('<img src="https://example.com/a.png"');
  });

  it('lists in display order with search, entry type, status and country filters', async () => {
    const admin = await createAdmin();
    const single = await createCatalog({ type: { entries: 'single' } });
    const multiple = await createCatalog({ type: { entries: 'multiple' } });
    await entry(admin, single, { title: 'Alpha list', displayOrder: 2 });
    const second = (await entry(admin, multiple, { title: 'Beta list', displayOrder: 1, status: 'inactive' })).body.data;

    const all = await get(admin, '/api/visa/checklist-entries');
    expect(all.body.data.map((e) => e.title)).toEqual(['Beta list', 'Alpha list']);
    expect(all.body.meta).toMatchObject({ total: 2 });
    expect((await get(admin, '/api/visa/checklist-entries?search=alpha')).body.data.map((e) => e.title)).toEqual(['Alpha list']);
    expect((await get(admin, `/api/visa/checklist-entries?search=${encodeURIComponent(single.country.name)}`)).body.data.map((e) => e.title)).toEqual(['Alpha list']);
    expect((await get(admin, `/api/visa/checklist-entries?search=${second.code}`)).body.data.map((e) => e.title)).toEqual(['Beta list']);
    expect((await get(admin, '/api/visa/checklist-entries?entries=multiple')).body.data.map((e) => e.title)).toEqual(['Beta list']);
    expect((await get(admin, '/api/visa/checklist-entries?status=active')).body.data.map((e) => e.title)).toEqual(['Alpha list']);
    expect((await get(admin, `/api/visa/checklist-entries?countryId=${multiple.country._id}`)).body.data).toHaveLength(1);
    expect((await get(admin, '/api/visa/checklist-entries?search=.*')).body.data).toHaveLength(0);
  });

  it('reads one page, changes it, and keeps the country and visa type', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = (await entry(admin, catalog)).body.data;

    expect((await get(admin, `/api/visa/checklist-entries/${made._id}`)).body.data.code).toBe('VI0001');
    const changed = await patch(admin, `/api/visa/checklist-entries/${made._id}`, { title: 'New title', status: 'inactive', displayOrder: 4, description: '<p>Updated</p><script>x</script>', countryId: String(catalog.country._id) });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ title: 'New title', status: 'inactive', displayOrder: 4, description: '<p>Updated</p>', visaTypeName: 'Tourist Visa' });
    expect((await get(admin, '/api/visa/checklist-entries/6ac0a5f0eebc510147c67250')).status).toBe(404);
    expect((await get(admin, '/api/visa/checklist-entries/not-an-id')).status).toBe(422);
  });

  it('deletes a page, and goes with its visa type and its country', async () => {
    const admin = await createAdmin();
    const first = await createCatalog();
    const second = await createCatalog();
    const third = await createCatalog();
    const one = (await entry(admin, first)).body.data;
    await entry(admin, second);
    await entry(admin, third);

    expect((await del(admin, `/api/visa/checklist-entries/${one._id}`)).status).toBe(200);
    expect((await get(admin, `/api/visa/checklist-entries/${one._id}`)).status).toBe(404);

    expect((await del(admin, `/api/visa/types/${second.type._id}`)).status).toBe(200);
    expect((await del(admin, `/api/visa/countries/${third.country._id}`)).status).toBe(200);
    expect(await VisaChecklistEntry.countDocuments()).toBe(0);
  });

  it('is readable with VISA_VIEW, changeable only with VISA_EDIT, and closed to everybody else', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = (await entry(admin, catalog)).body.data;
    const reader = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const customer = await createUser({ role: ROLES.B2C });

    expect((await get(reader, '/api/visa/checklist-entries')).status).toBe(200);
    expect((await get(reader, `/api/visa/checklist-entries/${made._id}`)).status).toBe(200);
    expect((await patch(reader, `/api/visa/checklist-entries/${made._id}`, { title: 'x' })).status).toBe(403);
    expect((await del(reader, `/api/visa/checklist-entries/${made._id}`)).status).toBe(403);
    expect((await entry(reader, await createCatalog())).status).toBe(403);
    expect((await get(customer, '/api/visa/checklist-entries')).status).toBe(403);
    expect((await request(app).get('/api/visa/checklist-entries')).status).toBe(401);
  });
});
