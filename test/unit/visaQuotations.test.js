const request = require('supertest');

const app = require('../../app');
const { ROLES, APPROVAL_STATUS } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const events = require('../../utils/events');
const AuditLog = require('../../models/AuditLog');
const VisaType = require('../../models/VisaType');
const { createUser, createB2B, bearer } = require('./helpers/factory');
const { createAdmin, createCatalog } = require('./helpers/visa');

const post = (user, path, body) => request(app).post(path).set(bearer(user)).send(body);
const patch = (user, path, body) => request(app).patch(path).set(bearer(user)).send(body);
const get = (user, path) => request(app).get(path).set(bearer(user));
const DAY = 24 * 60 * 60 * 1000;
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

const body = (partner, catalog, extra = {}) => ({
  partnerId: String(partner._id),
  clientName: 'Rahim Ahmed',
  countryId: String(catalog.country._id),
  visaTypeId: String(catalog.type._id),
  ...extra
});
const create = (user, partner, catalog, extra) => post(user, '/api/visa/quotations', body(partner, catalog, extra));

describe('creating a quotation', () => {
  it('copies the partner net price and calculates the total on the server', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    const res = await create(admin, partner, catalog, { quantity: 3, additionalFee: 1500, notes: 'Group booking' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      number: expect.stringMatching(new RegExp(`^QT-${new Date().getFullYear()}-0001$`)),
      partnerName: partner.companyName,
      clientName: 'Rahim Ahmed',
      countryName: catalog.country.name,
      visaTypeName: 'Tourist Visa',
      quantity: 3,
      currency: 'BDT',
      rateToBase: 1,
      netPrice: 10000,
      additionalFee: 1500,
      total: 31500,
      totalBase: 31500,
      status: 'draft',
      storedStatus: 'draft',
      notes: 'Group booking',
      createdByName: 'Admin Person'
    });
    expect(await AuditLog.countDocuments({ action: 'VISA_QUOTATION_CREATED' })).toBe(1);
  });

  it('defaults to one visa, no extra fee and 14 days of validity', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    const res = await create(admin, partner, catalog, { validUntil: '' });
    expect(res.body.data).toMatchObject({ quantity: 1, additionalFee: 0, total: 10000 });
    const days = (new Date(res.body.data.validUntil) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
  });

  it('numbers quotations one after another', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    const first = await create(admin, partner, catalog);
    const second = await create(admin, partner, catalog);
    expect(first.body.data.number.endsWith('-0001')).toBe(true);
    expect(second.body.data.number.endsWith('-0002')).toBe(true);
  });

  it('ignores a price sent by the browser and never loses a cent', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog({ type: { b2bNetPrice: 0.1 } });
    const { partner } = await createB2B();
    const res = await create(admin, partner, catalog, { quantity: 3, additionalFee: 0.2, netPrice: 1, total: 1, status: 'accepted', number: 'QT-1' });
    expect(res.body.data).toMatchObject({ netPrice: 0.1, total: 0.5, status: 'draft' });
    expect(res.body.data.number).not.toBe('QT-1');
  });

  it('uses the currency and rate of the visa type', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog({ type: { currency: 'USD', b2bNetPrice: 100, b2cPrice: 120 } });
    const { partner } = await createB2B();
    const res = await create(admin, partner, catalog, { quantity: 2 });
    expect(res.body.data).toMatchObject({ currency: 'USD', rateToBase: 122, netPrice: 100, total: 200, totalBase: 24400 });
  });

  it('needs an approved partner, an existing catalog and an active country and type', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    const { partner: pending } = await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING });
    const other = await createCatalog();
    const paused = await createCatalog({ country: { status: 'paused' } });

    expect((await create(admin, pending, catalog)).body.code).toBe('PARTNER_NOT_APPROVED');
    expect((await create(admin, { _id: '6ac0a5f0eebc510147c67250' }, catalog)).body.code).toBe('PARTNER_NOT_FOUND');
    expect((await create(admin, partner, catalog, { countryId: '6ac0a5f0eebc510147c67250' })).body.code).toBe('COUNTRY_NOT_FOUND');
    expect((await create(admin, partner, catalog, { visaTypeId: String(other.type._id) })).body.code).toBe('VISA_TYPE_NOT_FOUND');
    expect((await create(admin, partner, paused)).body.code).toBe('CATALOG_PAUSED');
  });

  it('validates the input', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    for (const extra of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: 5000 }, { additionalFee: -1 }, { clientName: '' }, { validUntil: 'tomorrow' }]) {
      expect((await create(admin, partner, catalog, extra)).status).toBe(422);
    }
    expect((await post(admin, '/api/visa/quotations', {})).status).toBe(422);
  });
});

describe('reading quotations', () => {
  it('lists with search, partner and status filters, and pages', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    const { partner: second } = await createB2B();
    const a = await create(admin, partner, catalog, { clientName: 'Karim Uddin' });
    await create(admin, second, catalog, { clientName: 'Salma Begum' });
    await create(admin, partner, catalog, { clientName: 'Third Client' });
    await patch(admin, `/api/visa/quotations/${a.body.data._id}/status`, { status: 'sent' });

    const names = async (query) => (await get(admin, `/api/visa/quotations?${query}`)).body.data.map((q) => q.clientName).sort();
    expect(await names('')).toEqual(['Karim Uddin', 'Salma Begum', 'Third Client']);
    expect(await names('search=salma')).toEqual(['Salma Begum']);
    expect(await names(`search=${a.body.data.number}`)).toEqual(['Karim Uddin']);
    expect(await names(`partnerId=${partner._id}`)).toEqual(['Karim Uddin', 'Third Client']);
    expect(await names('status=sent')).toEqual(['Karim Uddin']);
    expect(await names('status=draft')).toEqual(['Salma Begum', 'Third Client']);
    const page = await get(admin, '/api/visa/quotations?limit=2&page=2');
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toEqual(page.body.pagination);
    expect(page.body.meta).toMatchObject({ total: 3, totalPages: 2 });
  });

  it('answers 404 for a missing quotation', async () => {
    const admin = await createAdmin();
    const res = await get(admin, '/api/visa/quotations/6ac0a5f0eebc510147c67250');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('QUOTATION_NOT_FOUND');
  });

  it('shows a quotation past its date as expired, and brings it back when the date moves', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    const made = await create(admin, partner, catalog, { validUntil: day(-3) });
    expect(made.body.data).toMatchObject({ status: 'expired', storedStatus: 'draft' });

    expect((await get(admin, '/api/visa/quotations?status=expired')).body.data).toHaveLength(1);
    expect((await get(admin, '/api/visa/quotations?status=draft')).body.data).toHaveLength(0);

    const extended = await patch(admin, `/api/visa/quotations/${made.body.data._id}`, { validUntil: day(10) });
    expect(extended.body.data).toMatchObject({ status: 'draft' });
    expect((await get(admin, '/api/visa/quotations?status=expired')).body.data).toHaveLength(0);
  });

  it('lists only approved partners, with nothing but id and company name', async () => {
    const admin = await createAdmin();
    const { partner } = await createB2B();
    await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING });
    const res = await get(admin, '/api/visa/partners');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['_id', 'companyName']);
    expect((await get(admin, `/api/visa/partners?search=${encodeURIComponent(partner.companyName.slice(0, 5))}`)).body.data).toHaveLength(1);
    expect((await get(admin, '/api/visa/partners?search=zzzz')).body.data).toHaveLength(0);
  });
});

describe('changing a draft', () => {
  it('recalculates the total and keeps the saved net price when the visa type is the same', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    const made = await create(admin, partner, catalog, { quantity: 2 });
    await VisaType.updateOne({ _id: catalog.type._id }, { b2bNetPrice: 99999 });

    const res = await patch(admin, `/api/visa/quotations/${made.body.data._id}`, { quantity: 4, additionalFee: 500, clientName: 'New Client' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ netPrice: 10000, quantity: 4, additionalFee: 500, total: 40500, clientName: 'New Client' });
    expect(await AuditLog.countDocuments({ action: 'VISA_QUOTATION_UPDATED' })).toBe(1);
  });

  it('copies the price again when the visa type changes, and can move to another partner', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const other = await createCatalog({ type: { b2bNetPrice: 4000 } });
    const { partner } = await createB2B();
    const { partner: second } = await createB2B();
    const made = await create(admin, partner, catalog);

    const res = await patch(admin, `/api/visa/quotations/${made.body.data._id}`, { countryId: String(other.country._id), visaTypeId: String(other.type._id), partnerId: String(second._id), quantity: 2 });
    expect(res.body.data).toMatchObject({ netPrice: 4000, total: 8000, countryName: other.country.name, partnerName: second.companyName });
    expect((await patch(admin, `/api/visa/quotations/${made.body.data._id}`, { visaTypeId: String(catalog.type._id) })).body.code).toBe('VISA_TYPE_NOT_FOUND');
  });

  it('is locked once the quotation is sent', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    const made = await create(admin, partner, catalog);
    const id = made.body.data._id;
    await patch(admin, `/api/visa/quotations/${id}/status`, { status: 'sent' });

    const res = await patch(admin, `/api/visa/quotations/${id}`, { quantity: 9 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('QUOTATION_LOCKED');
    expect((await request(app).delete(`/api/visa/quotations/${id}`).set(bearer(admin))).body.code).toBe('QUOTATION_LOCKED');
  });
});

describe('quotation status', () => {
  const quote = async (extra) => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();
    const made = await create(admin, partner, catalog, extra);
    return { admin, id: made.body.data._id, partner };
  };
  const change = (admin, id, status) => patch(admin, `/api/visa/quotations/${id}/status`, { status });

  it('goes draft, sent, accepted and raises an event on acceptance', async () => {
    const { admin, id, partner } = await quote({ quantity: 2 });
    const seen = jest.fn();
    events.on(events.EVENTS.VISA_QUOTATION_ACCEPTED, seen);

    expect((await change(admin, id, 'sent')).body.data).toMatchObject({ status: 'sent' });
    expect((await change(admin, id, 'accepted')).body.data).toMatchObject({ status: 'accepted' });
    await events.idle();
    events.removeAllListeners();

    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ partnerId: String(partner._id), total: 20000, currency: 'BDT' }));
    expect(await AuditLog.countDocuments({ action: 'VISA_QUOTATION_STATUS_CHANGED' })).toBe(2);
  });

  it('allows a sent quotation to be rejected, and nothing leaves a final status', async () => {
    const { admin, id } = await quote();
    await change(admin, id, 'sent');
    expect((await change(admin, id, 'rejected')).body.data.status).toBe('rejected');
    for (const status of ['draft', 'sent', 'accepted']) {
      const res = await change(admin, id, status);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_STATUS_CHANGE');
    }
  });

  it('refuses to accept a draft, or to send it twice', async () => {
    const { admin, id } = await quote();
    expect((await change(admin, id, 'accepted')).body.code).toBe('INVALID_STATUS_CHANGE');
    await change(admin, id, 'sent');
    expect((await change(admin, id, 'sent')).body.code).toBe('INVALID_STATUS_CHANGE');
    expect((await patch(admin, `/api/visa/quotations/${id}/status`, { status: 'expired' })).status).toBe(422);
  });

  it('refuses to send or accept an expired quotation until its date is extended', async () => {
    const { admin, id } = await quote({ validUntil: day(-2) });
    const sent = await change(admin, id, 'sent');
    expect(sent.status).toBe(422);
    expect(sent.body.code).toBe('QUOTATION_EXPIRED');

    await patch(admin, `/api/visa/quotations/${id}`, { validUntil: day(5) });
    expect((await change(admin, id, 'sent')).status).toBe(200);
  });

  it('deletes a draft and answers 404 afterwards', async () => {
    const { admin, id } = await quote();
    expect((await request(app).delete(`/api/visa/quotations/${id}`).set(bearer(admin))).status).toBe(200);
    expect((await get(admin, `/api/visa/quotations/${id}`)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'VISA_QUOTATION_DELETED' })).toBe(1);
  });
});

describe('quotation permissions', () => {
  it('lets staff with VISA_VIEW read and staff with VISA_EDIT change, and keeps everyone else out', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner, user: partnerUser } = await createB2B();
    const reader = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const editor = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_EDIT] });
    const customer = await createUser({ role: ROLES.B2C });

    expect((await get(reader, '/api/visa/quotations')).status).toBe(200);
    expect((await get(reader, '/api/visa/partners')).status).toBe(200);
    expect((await create(reader, partner, catalog)).status).toBe(403);
    expect((await create(editor, partner, catalog)).status).toBe(201);
    expect((await create(partnerUser, partner, catalog)).status).toBe(403);
    expect((await get(customer, '/api/visa/quotations')).status).toBe(403);
    expect((await request(app).get('/api/visa/quotations')).status).toBe(401);
    expect((await get(admin, '/api/visa/quotations')).body.data).toHaveLength(1);
  });
});
