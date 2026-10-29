const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../../app');
const { ROLES, USER_STATUS, APPROVAL_STATUS } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const events = require('../../utils/events');
const AuditLog = require('../../models/AuditLog');
const Partner = require('../../models/Partner');
const VisaApplication = require('../../models/VisaApplication');
const publicService = require('../../services/visaPublicService');
const settingService = require('../../services/settingService');
const { createUser, createB2B, bearer } = require('./helpers/factory');
const { createAdmin, createVisaStaff, createCatalog, applicationBody } = require('./helpers/visa');

const post = (user, path, body) => request(app).post(path).set(bearer(user)).send(body);
const patch = (user, path, body) => request(app).patch(path).set(bearer(user)).send(body);
const get = (user, path) => request(app).get(path).set(bearer(user));
const create = (user, catalog, overrides) => post(user, '/api/visa/applications', applicationBody(catalog, overrides));

describe('creating an application', () => {
  it('copies the price, numbers the file and calculates the money on the server', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const res = await create(admin, catalog, { discountAmount: 1000, advancePaid: 4000, paymentMethod: 'Bank Transfer' });

    expect(res.status).toBe(201);
    const a = res.body.data;
    expect(a.number).toMatch(new RegExp(`^VISA-${new Date().getFullYear()}-000001$`));
    expect(a).toMatchObject({ status: 'submitted', channel: 'b2c', countryName: catalog.country.name, visaTypeName: 'Tourist Visa' });
    expect(a.account).toMatchObject({ totalAmount: 12000, discountAmount: 1000, netAmount: 11000, advancePaid: 4000, dueAmount: 7000, paymentStatus: 'Partial', paymentMethod: 'Bank Transfer' });
    expect(a.price).toMatchObject({ currency: 'BDT', rateToBase: 1, b2c: 12000, b2b: 10000 });
    expect(a.payments).toHaveLength(1);
    expect(a.applicant).toMatchObject({ fullName: 'Rahim Ahmed', mobile: '+8801712556340' });
    expect(a.passportStatus).toBe('not_required');
    expect(a.timeline.map((t) => t.event)).toEqual(expect.arrayContaining(['Application Created', 'Payment received']));
  });

  it('numbers files one after another', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const first = await create(admin, catalog);
    const second = await create(admin, catalog);
    expect(first.body.data.number.endsWith('000001')).toBe(true);
    expect(second.body.data.number.endsWith('000002')).toBe(true);
  });

  it('ignores money the browser should not control', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const res = await create(admin, catalog, { dueAmount: 1, netAmount: 1, paymentStatus: 'Paid', status: 'approved', number: 'VISA-1' });
    expect(res.body.data).toMatchObject({ status: 'submitted' });
    expect(res.body.data.account).toMatchObject({ netAmount: 12000, dueAmount: 12000, paymentStatus: 'Unpaid' });
    expect(res.body.data.number).not.toBe('VISA-1');
  });

  it('marks a fully paid file as Paid and a file with nothing paid as Unpaid', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const paid = await create(admin, catalog, { advancePaid: 12000, paymentMethod: 'Cash' });
    expect(paid.body.data.account).toMatchObject({ dueAmount: 0, paymentStatus: 'Paid' });
  });

  it('uses the B2B price for a partner and needs an approved partner', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { partner } = await createB2B();

    const missing = await create(admin, catalog, { clientType: 'b2b' });
    expect(missing.body.code).toBe('PARTNER_REQUIRED');

    const ok = await create(admin, catalog, { clientType: 'b2b', partnerId: String(partner._id) });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ channel: 'b2b', partnerName: partner.companyName });
    expect(ok.body.data.account.totalAmount).toBe(10000);

    await Partner.updateOne({ _id: partner._id }, { approvalStatus: APPROVAL_STATUS.PENDING });
    expect((await create(admin, catalog, { clientType: 'b2b', partnerId: String(partner._id) })).body.code).toBe('PARTNER_NOT_APPROVED');
  });

  it('needs a written reason when the total is not the list price', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const refused = await create(admin, catalog, { totalAmount: 9000 });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('OVERRIDE_REASON_REQUIRED');

    const ok = await create(admin, catalog, { totalAmount: 9000, totalOverrideReason: 'Loyal customer' });
    expect(ok.body.data.account).toMatchObject({ totalAmount: 9000, totalOverrideReason: 'Loyal customer' });
    expect(ok.body.data.timeline.some((t) => t.event === 'Price changed' && t.visibility === 'internal')).toBe(true);
  });

  it('refuses money that does not add up', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    expect((await create(admin, catalog, { discountAmount: 13000 })).body.code).toBe('DISCOUNT_TOO_HIGH');
    expect((await create(admin, catalog, { advancePaid: 12001, paymentMethod: 'Cash' })).body.code).toBe('PAYMENTS_EXCEED_NET');
    expect((await create(admin, catalog, { advancePaid: -5 })).status).toBe(422);
    expect((await create(admin, catalog, { paymentMethod: 'Gold' })).status).toBe(422);
  });

  it('prices a file in USD with the stored rate and keeps that rate on the file', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const res = await create(admin, catalog, { currency: 'USD' });
    expect(res.status).toBe(201);
    expect(res.body.data.price).toMatchObject({ currency: 'USD', rateToBase: 122, b2c: 98.36 });
    expect(res.body.data.account.totalAmount).toBe(98.36);
    expect(res.body.data.account.netAmountBase).toBeCloseTo(12000, 0);

    await settingService.set({ id: admin._id }, 'currencies', { base: 'BDT', items: [{ code: 'BDT', name: 'Taka', symbol: '৳', rateToBase: 1, source: 'base' }, { code: 'USD', name: 'US Dollar', symbol: '$', rateToBase: 130, source: 'manual' }] });
    const old = await get(admin, `/api/visa/applications/${res.body.data._id}`);
    expect(old.body.data.price.rateToBase).toBe(122);
  });

  it('refuses a paused country, an unknown country and a type of another country', async () => {
    const admin = await createAdmin();
    const paused = await createCatalog({ country: { status: 'paused' } });
    expect((await create(admin, paused)).body.code).toBe('CATALOG_PAUSED');

    const one = await createCatalog();
    const two = await createCatalog();
    expect((await create(admin, one, { visaTypeId: String(two.type._id) })).status).toBe(404);
    expect((await create(admin, one, { countryId: '6ac0a5f0eebc510147c67250' })).status).toBe(404);
  });

  it('sets the passport handling from the visa type', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog({ physical: true });
    const res = await create(admin, catalog);
    expect(res.body.data).toMatchObject({ passportSubmissionMethod: 'office', passportStatus: 'not_received', passportRequirement: 'physical_required' });
  });

  it('assigns only to an active staff member', async () => {
    const admin = await createAdmin();
    const staff = await createVisaStaff();
    const gone = await createUser({ role: ROLES.STAFF, status: USER_STATUS.SUSPENDED });
    const customer = await createUser({ role: ROLES.B2C });
    const catalog = await createCatalog();

    const ok = await create(admin, catalog, { assignedStaff: String(staff._id) });
    expect(ok.body.data.assignedStaff).toMatchObject({ _id: String(staff._id), name: 'Staff Person' });
    expect((await create(admin, catalog, { assignedStaff: String(gone._id) })).body.code).toBe('INVALID_STAFF');
    expect((await create(admin, catalog, { assignedStaff: String(customer._id) })).body.code).toBe('INVALID_STAFF');
  });

  it('records an audit entry and raises an event', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const seen = jest.fn();
    events.on(events.EVENTS.VISA_APPLICATION_CREATED, seen);
    const res = await create(admin, catalog);
    events.removeAllListeners();
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ number: res.body.data.number }));
    expect(await AuditLog.countDocuments({ action: 'VISA_APPLICATION_CREATED' })).toBe(1);
  });

  it('is closed to customers, partners and staff without VISA_EDIT', async () => {
    const catalog = await createCatalog();
    const reader = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const customer = await createUser({ role: ROLES.B2C });
    const { user: partner } = await createB2B();
    expect((await create(reader, catalog)).status).toBe(403);
    expect((await create(customer, catalog)).status).toBe(403);
    expect((await create(partner, catalog)).status).toBe(403);
    expect((await request(app).post('/api/visa/applications').send(applicationBody(catalog))).status).toBe(401);
  });
});

describe('a ticket, a hotel booking and a tour package', () => {
  const client = { name: 'Mizanur Rahman', phone: '+880 1712 945 360', email: 'mizanur@example.com' };
  const ticket = { tripType: 'Round Way', departure: 'Dhaka (DAC)', arrival: 'Dubai (DXB)', travelClass: 'Economy' };
  const hotel = { name: 'Grand Hyatt Dubai', country: 'United Arab Emirates', countryCode: 'AE', city: 'Dubai', stay: '3 Nights' };
  const tour = { packageName: 'Dubai + Kuala Lumpur', duration: '7 Days / 6 Nights', destinations: [{ country: 'United Arab Emirates', countryCode: 'AE', city: 'Dubai' }, { country: 'Malaysia', countryCode: 'MY', city: 'Kuala Lumpur' }] };
  const make = (admin, serviceType, details, extra = {}) => post(admin, '/api/visa/applications', { ...client, serviceType, [serviceType]: details, totalAmount: 78000, ...extra });

  it('needs no visa country, visa type or passport, and keeps the details it was given', async () => {
    const admin = await createAdmin();
    const res = await make(admin, 'ticket', ticket, { discountAmount: 3000, advancePaid: 30000, paymentMethod: 'bKash / Nagad' });

    expect(res.status).toBe(201);
    const a = res.body.data;
    expect(a.number).toMatch(new RegExp(`^TKT-${new Date().getFullYear()}-000001$`));
    expect(a).toMatchObject({ serviceType: 'ticket', serviceLabel: 'Ticket', serviceSummary: 'Dhaka (DAC) to Dubai (DXB), Round Way, Economy', countryName: 'Dubai (DXB)', status: 'submitted', ticket, passportStatus: 'not_required' });
    expect(a.country).toBeUndefined();
    expect(a.passport.number).toBe('');
    expect(a.account).toMatchObject({ totalAmount: 78000, discountAmount: 3000, netAmount: 75000, advancePaid: 30000, dueAmount: 45000, paymentStatus: 'Partial' });
    expect(a.price).toMatchObject({ currency: 'BDT', rateToBase: 1, b2c: 0, b2b: 0 });
  });

  it('numbers each service on its own, and labels hotels and tours by what they are', async () => {
    const admin = await createAdmin();
    const booking = (await make(admin, 'hotel', hotel)).body.data;
    const package_ = (await make(admin, 'tour', tour)).body.data;
    expect(booking.number).toMatch(/^HTL-\d{4}-000001$/);
    expect(booking).toMatchObject({ serviceLabel: 'Hotel', serviceSummary: 'Grand Hyatt Dubai, Dubai, United Arab Emirates, 3 Nights', countryName: 'United Arab Emirates' });
    expect(package_.number).toMatch(/^TOUR-\d{4}-000001$/);
    expect(package_).toMatchObject({ serviceLabel: 'Tour Package', serviceSummary: 'Dubai + Kuala Lumpur, 7 Days / 6 Nights, Dubai + Kuala Lumpur', countryName: 'United Arab Emirates, Malaysia' });
  });

  it('needs the details of its own service and a typed total', async () => {
    const admin = await createAdmin();
    expect((await post(admin, '/api/visa/applications', { ...client, serviceType: 'ticket', totalAmount: 5000 })).body.message).toMatch(/ticket details are required/i);
    expect((await make(admin, 'hotel', hotel, { totalAmount: undefined })).body.message).toMatch(/total amount is required/i);
    expect((await make(admin, 'hotel', { ...hotel, stay: '' })).status).toBe(422);
    expect((await make(admin, 'tour', { ...tour, destinations: [] })).body.message).toMatch(/at least one destination/i);
    expect((await make(admin, 'ticket', { ...ticket, travelClass: 'Luxury' })).status).toBe(422);
    expect((await make(admin, 'cruise', ticket)).body.message).toMatch(/service must be one of/i);
    expect((await make(admin, 'ticket', ticket, { totalAmount: 0 })).body.code).toBe('INVALID_AMOUNT');
  });

  it('has no price list, so a different total needs no reason, and a passport is optional and never a duplicate', async () => {
    const admin = await createAdmin();
    const first = await make(admin, 'ticket', ticket, { passportNumber: 'BR1234567' });
    const second = await make(admin, 'ticket', ticket, { passportNumber: 'BR1234567' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.passport).toMatchObject({ number: 'BR1234567', numberKey: 'BR1234567' });

    const changed = await patch(admin, `/api/visa/applications/${first.body.data._id}`, { totalAmount: 81000 });
    expect(changed.status).toBe(200);
    expect(changed.body.data.account).toMatchObject({ totalAmount: 81000, totalOverrideReason: '' });
  });

  it('is filtered and searched with the visa files, and a file made before serviceType counts as a visa', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const visa = (await create(admin, catalog)).body.data;
    await make(admin, 'hotel', hotel);
    await make(admin, 'ticket', ticket);
    await VisaApplication.collection.updateOne({ _id: new mongoose.Types.ObjectId(visa._id) }, { $unset: { serviceType: '' } });

    const names = async (query) => (await get(admin, `/api/visa/applications?${query}`)).body.data.map((a) => a.serviceType).sort();
    expect(await names('')).toEqual(['hotel', 'ticket', 'visa']);
    expect(await names('serviceType=visa')).toEqual(['visa']);
    expect(await names('serviceType=hotel')).toEqual(['hotel']);
    expect(await names('search=hyatt')).toEqual(['hotel']);
    expect(await names('search=DXB')).toEqual(['ticket']);
  });

  it('counts the services on the dashboard and leaves them out of the visa country table', async () => {
    const admin = await createAdmin();
    await create(admin, await createCatalog());
    await make(admin, 'tour', tour);
    const { body } = await get(admin, '/api/visa/dashboard');
    expect(body.data.total).toBe(2);
    expect(body.data.services).toEqual({ visa: 1, ticket: 0, hotel: 0, tour: 1 });
    expect(body.data.countries).toHaveLength(1);
  });

  it('has no passport handling, no public status page and still takes payments and notes', async () => {
    const admin = await createAdmin();
    const made = (await make(admin, 'hotel', hotel)).body.data;

    const passport = await patch(admin, `/api/visa/applications/${made._id}/passport`, { passportSubmissionMethod: 'office' });
    expect(passport.status).toBe(409);
    expect(passport.body.message).toMatch(/visa applications only/i);
    expect(await publicService.checkLink(made.number)).toEqual({ valid: false });

    const paid = await post(admin, `/api/visa/applications/${made._id}/payments`, { amount: 20000, method: 'Cash' });
    expect(paid.status).toBe(201);
    expect(paid.body.data.account).toMatchObject({ advancePaid: 20000, dueAmount: 58000 });
    expect((await post(admin, `/api/visa/applications/${made._id}/notes`, { type: 'internal', text: 'Late check-in.' })).status).toBe(201);
  });
});

describe('the duplicate rule', () => {
  it('refuses a second open application for the same passport, country and type, whatever the spacing', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    await create(admin, catalog, { passportNumber: 'AB 123-456' });
    const again = await create(admin, catalog, { passportNumber: 'ab123456', confirmDuplicate: 'It is fine' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DUPLICATE_OPEN_APPLICATION');
  });

  it('asks for a confirmation note when the same passport and country had a file recently, and keeps the note', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const other = await createCatalog({ country: { name: 'Testland X' }, type: {} });
    const first = await create(admin, catalog, { passportNumber: 'ZZ900001' });
    await patch(admin, `/api/visa/applications/${first.body.data._id}/status`, { status: 'cancelled', internalReason: 'Withdrawn' });

    const refused = await create(admin, catalog, { passportNumber: 'ZZ900001' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('DUPLICATE_RECENT_APPLICATION');

    const ok = await create(admin, catalog, { passportNumber: 'ZZ900001', confirmDuplicate: 'Customer changed travel dates' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.duplicateNote).toBe('Customer changed travel dates');

    // another country is a different application
    expect((await create(admin, other, { passportNumber: 'ZZ900001' })).status).toBe(201);
  });

  it('always allows a new application after a rejection', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const first = await create(admin, catalog, { passportNumber: 'RJ100001' });
    await patch(admin, `/api/visa/applications/${first.body.data._id}/status`, { status: 'rejected', customerReason: 'Refused', internalReason: 'No funds' });
    expect((await create(admin, catalog, { passportNumber: 'RJ100001' })).status).toBe(201);
  });

  it('follows the window in the settings', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const first = await create(admin, catalog, { passportNumber: 'WN500001' });
    await patch(admin, `/api/visa/applications/${first.body.data._id}/status`, { status: 'cancelled', internalReason: 'x' });
    await settingService.set({ id: admin._id }, 'visa.duplicateWindowDays', { days: 0 });
    expect((await create(admin, catalog, { passportNumber: 'WN500001' })).status).toBe(201);
  });
});

describe('reading applications', () => {
  it('lists with filters, search and paging, and leaves out the long lists', async () => {
    const admin = await createAdmin();
    const staff = await createVisaStaff();
    const a = await createCatalog();
    const b = await createCatalog();
    await create(admin, a, { name: 'Karim Uddin', passportNumber: 'KU111111', assignedStaff: String(staff._id) });
    await create(admin, a, { name: 'Salma Begum', passportNumber: 'SB222222' });
    await create(admin, b, { name: 'Salma Khatun', passportNumber: 'SK333333', advancePaid: 12000, paymentMethod: 'Cash' });

    const all = await get(admin, '/api/visa/applications');
    expect(all.body.data).toHaveLength(3);
    expect(all.body.data[0]).not.toHaveProperty('timeline');
    expect(all.body.data[0]).toHaveProperty('documentCount', 0);
    expect(all.body.meta).toMatchObject({ total: 3, page: 1, totalPages: 1 });

    const names = async (q) => (await get(admin, `/api/visa/applications?${q}`)).body.data.map((x) => x.applicant.fullName).sort();
    expect(await names('search=salma')).toEqual(['Salma Begum', 'Salma Khatun']);
    expect(await names('search=ku 111')).toEqual(['Karim Uddin']);
    expect(await names('search=ku111')).toEqual(['Karim Uddin']);
    expect(await names(`countryId=${b.country._id}`)).toEqual(['Salma Khatun']);
    expect(await names(`staff=${staff._id}`)).toEqual(['Karim Uddin']);
    expect(await names('staff=unassigned')).toEqual(['Salma Begum', 'Salma Khatun']);
    expect(await names('paymentStatus=Paid')).toEqual(['Salma Khatun']);
    expect(await names('status=submitted&channel=b2c')).toHaveLength(3);
    expect((await get(admin, '/api/visa/applications?limit=2&page=2')).body.data).toHaveLength(1);
  });

  it('does not treat search text as a pattern', async () => {
    const admin = await createAdmin();
    const res = await get(admin, '/api/visa/applications?search=.*');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('answers 404 for a missing application and 400-level for a bad id', async () => {
    const admin = await createAdmin();
    expect((await get(admin, '/api/visa/applications/6ac0a5f0eebc510147c67250')).status).toBe(404);
    expect((await get(admin, '/api/visa/applications/va_101')).status).toBe(422);
  });

  it('gives the full application with the newest timeline entry first', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    await patch(admin, `/api/visa/applications/${made.body.data._id}/status`, { status: 'under_review' });
    const full = await get(admin, `/api/visa/applications/${made.body.data._id}`);
    expect(full.body.data.timeline[0].event).toBe('Under Review');
    expect(full.body.data.timeline.at(-1).event).toBe('Application Created');
  });
});

describe('editing an application', () => {
  it('changes details, recalculates the money and logs it', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog, { advancePaid: 5000, paymentMethod: 'Cash' });
    const id = made.body.data._id;

    const res = await patch(admin, `/api/visa/applications/${id}`, { name: 'Rahim Uddin', discountAmount: 2000, vendorList: [{ name: 'V', service: 'visa', price: 7000 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.applicant.fullName).toBe('Rahim Uddin');
    expect(res.body.data.account).toMatchObject({ discountAmount: 2000, netAmount: 10000, advancePaid: 5000, dueAmount: 5000, paymentStatus: 'Partial', costPrice: 7000, profit: 3000 });
    expect(res.body.data.timeline.map((t) => t.event)).toEqual(expect.arrayContaining(['Discount changed', 'Details updated']));
  });

  it('refuses a change that would leave the payments above the amount to pay', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog, { advancePaid: 11000, paymentMethod: 'Cash' });
    const res = await patch(admin, `/api/visa/applications/${made.body.data._id}`, { discountAmount: 5000 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PAYMENTS_EXCEED_NET');
  });

  it('assigns and unassigns staff, and refuses to change status or payments through this route', async () => {
    const admin = await createAdmin();
    const staff = await createVisaStaff();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    const id = made.body.data._id;

    const assigned = await patch(admin, `/api/visa/applications/${id}`, { assignedStaff: String(staff._id), status: 'approved', advancePaid: 99, dueAmount: 0 });
    expect(assigned.body.data.assignedStaff.name).toBe('Staff Person');
    expect(assigned.body.data.status).toBe('submitted');
    expect(assigned.body.data.account.advancePaid).toBe(0);

    const cleared = await patch(admin, `/api/visa/applications/${id}`, { assignedStaff: null });
    expect(cleared.body.data.assignedStaff).toBeFalsy();
  });

  it('refuses a passport that another open application of the same visa already uses', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    await create(admin, catalog, { passportNumber: 'XX777777' });
    const second = await create(admin, catalog, { passportNumber: 'XX888888' });
    const res = await patch(admin, `/api/visa/applications/${second.body.data._id}`, { passportNumber: 'xx 777777' });
    expect(res.status).toBe(409);
  });

  it('adds internal and customer notes', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    const id = made.body.data._id;
    await post(admin, `/api/visa/applications/${id}/notes`, { type: 'internal', text: 'Call him tomorrow' });
    const res = await post(admin, `/api/visa/applications/${id}/notes`, { type: 'customer', text: 'We will call you' });
    expect(res.body.data.internalNotes).toHaveLength(1);
    expect(res.body.data.customerNotes[0]).toMatchObject({ text: 'We will call you', by: 'Admin Person' });
    const entry = res.body.data.timeline.find((t) => t.event === 'Customer Note Added');
    expect(entry.visibility).toBe('customer');
    expect((await post(admin, `/api/visa/applications/${id}/notes`, { type: 'other', text: 'x' })).status).toBe(422);
  });
});

describe('status changes', () => {
  const change = (user, id, body) => patch(user, `/api/visa/applications/${id}/status`, body);

  it('follows the allowed moves and writes the timeline with the person who did it', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    const id = made.body.data._id;

    const bad = await change(admin, id, { status: 'approved' });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('INVALID_STATUS_CHANGE');

    for (const status of ['under_review', 'processing', 'submitted_to_embassy', 'approved', 'passport_ready', 'completed']) {
      const res = await change(admin, id, { status });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
    }
    const full = await get(admin, `/api/visa/applications/${id}`);
    expect(full.body.data.timeline[0]).toMatchObject({ event: 'Completed', by: 'Admin Person', visibility: 'both' });
  });

  it('needs the wording each status requires', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    const id = made.body.data._id;
    await change(admin, id, { status: 'under_review' });

    const noMessage = await change(admin, id, { status: 'action_required' });
    expect(noMessage.status).toBe(422);
    expect(noMessage.body.code).toBe('STATUS_TEXT_REQUIRED');

    const asked = await change(admin, id, { status: 'action_required', customerMessage: 'Send a clearer photo' });
    expect(asked.body.data.actionRequired).toMatchObject({ message: 'Send a clearer photo', requestedBy: 'Admin Person' });
    const back = await change(admin, id, { status: 'under_review' });
    expect(back.body.data.actionRequired).toBeNull();

    expect((await change(admin, id, { status: 'rejected', internalReason: 'x' })).body.code).toBe('STATUS_TEXT_REQUIRED');
    const rejected = await change(admin, id, { status: 'rejected', customerReason: 'Not enough funds', internalReason: 'Statement was forged' });
    expect(rejected.body.data.rejection).toMatchObject({ customerReason: 'Not enough funds', internalReason: 'Statement was forged' });
    const entries = rejected.body.data.timeline.filter((t) => t.event.startsWith('Rejected'));
    expect(entries.find((t) => t.visibility === 'both').message).toBe('Not enough funds');
    expect(entries.find((t) => t.visibility === 'internal').message).toBe('Statement was forged');
  });

  it('keeps a finished application closed to staff and lets only an admin reopen it', async () => {
    const admin = await createAdmin();
    const staff = await createVisaStaff();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    const id = made.body.data._id;
    await change(admin, id, { status: 'cancelled', internalReason: 'Withdrawn' });

    expect((await change(staff, id, { status: 'under_review', internalReason: 'Back' })).status).toBe(409);
    expect((await change(admin, id, { status: 'processing', internalReason: 'Back' })).status).toBe(409);
    expect((await change(admin, id, { status: 'under_review' })).body.code).toBe('STATUS_TEXT_REQUIRED');

    const reopened = await change(admin, id, { status: 'under_review', internalReason: 'Client paid again' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe('under_review');
  });

  it('needs VISA_UPDATE, and rejects unknown statuses', async () => {
    const admin = await createAdmin();
    const editor = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_EDIT] });
    const updater = await createVisaStaff();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    const id = made.body.data._id;

    expect((await change(editor, id, { status: 'under_review' })).status).toBe(403);
    expect((await change(updater, id, { status: 'under_review' })).status).toBe(200);
    expect((await change(admin, id, { status: 'nonsense' })).body.code).toBe('UNKNOWN_STATUS');
    expect((await change(admin, id, { status: 'under_review' })).status).toBe(409);
  });

  it('supports a custom status and refuses to leave it for the first status', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    await post(admin, '/api/visa/statuses', { displayName: 'Waiting for Slot', category: 'in_progress' });
    const made = await create(admin, catalog);
    const id = made.body.data._id;
    await change(admin, id, { status: 'under_review' });

    const custom = await change(admin, id, { status: 'waiting_for_slot' });
    expect(custom.body.data.status).toBe('waiting_for_slot');
    expect((await change(admin, id, { status: 'submitted' })).status).toBe(409);
    expect((await change(admin, id, { status: 'processing' })).status).toBe(200);

    const used = await get(admin, '/api/visa/statuses');
    const row = used.body.data.find((s) => s.key === 'waiting_for_slot');
    await change(admin, id, { status: 'waiting_for_slot' });
    expect((await request(app).delete(`/api/visa/statuses/${row._id}`).set(bearer(admin))).body.code).toBe('STATUS_IN_USE');
  });

  it('raises an event and writes an audit entry', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    const seen = jest.fn();
    events.on(events.EVENTS.VISA_STATUS_CHANGED, seen);
    await change(admin, made.body.data._id, { status: 'under_review' });
    events.removeAllListeners();
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ from: 'submitted', to: 'under_review' }));
    expect(await AuditLog.countDocuments({ action: 'VISA_STATUS_CHANGED' })).toBe(1);
  });
});

describe('payments', () => {
  it('recalculates the advance, the amount due and the status after every entry', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    const id = made.body.data._id;

    const first = await post(admin, `/api/visa/applications/${id}/payments`, { amount: 5000, method: 'bKash / Nagad', note: 'trx 123' });
    expect(first.status).toBe(201);
    expect(first.body.data.account).toMatchObject({ advancePaid: 5000, dueAmount: 7000, paymentStatus: 'Partial', paymentMethod: 'bKash / Nagad' });

    const second = await post(admin, `/api/visa/applications/${id}/payments`, { amount: 7000, method: 'Cash' });
    expect(second.body.data.account).toMatchObject({ advancePaid: 12000, dueAmount: 0, paymentStatus: 'Paid' });
    expect(second.body.data.payments).toHaveLength(2);
    expect(second.body.data.payments[0]).toMatchObject({ enteredByName: 'Admin Person', voided: false });
  });

  it('refuses a payment above the amount due or below zero', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog, { advancePaid: 12000, paymentMethod: 'Cash' });
    const id = made.body.data._id;
    expect((await post(admin, `/api/visa/applications/${id}/payments`, { amount: 1, method: 'Cash' })).body.code).toBe('PAYMENT_EXCEEDS_DUE');
    expect((await post(admin, `/api/visa/applications/${id}/payments`, { amount: 0, method: 'Cash' })).status).toBe(422);
    expect((await post(admin, `/api/visa/applications/${id}/payments`, { amount: -3, method: 'Cash' })).status).toBe(422);
  });

  it('never loses a cent to floating point', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog({ type: { b2cPrice: 0.3 } });
    const made = await create(admin, catalog);
    const id = made.body.data._id;
    await post(admin, `/api/visa/applications/${id}/payments`, { amount: 0.1, method: 'Cash' });
    const res = await post(admin, `/api/visa/applications/${id}/payments`, { amount: 0.2, method: 'Cash' });
    expect(res.body.data.account).toMatchObject({ advancePaid: 0.3, dueAmount: 0, paymentStatus: 'Paid' });
  });

  it('voids a wrong entry with a reason, keeps it in the history and recalculates', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog, { advancePaid: 5000, paymentMethod: 'Cash' });
    const id = made.body.data._id;
    const paymentId = made.body.data.payments[0]._id;

    expect((await post(admin, `/api/visa/applications/${id}/payments/${paymentId}/void`, {})).status).toBe(422);
    const res = await post(admin, `/api/visa/applications/${id}/payments/${paymentId}/void`, { reason: 'Typed the wrong amount' });
    expect(res.status).toBe(200);
    expect(res.body.data.account).toMatchObject({ advancePaid: 0, dueAmount: 12000, paymentStatus: 'Unpaid' });
    expect(res.body.data.payments[0]).toMatchObject({ voided: true, voidReason: 'Typed the wrong amount', voidedByName: 'Admin Person' });
    expect((await post(admin, `/api/visa/applications/${id}/payments/${paymentId}/void`, { reason: 'again' })).body.code).toBe('PAYMENT_ALREADY_VOIDED');
  });

  it('lets only an admin, or staff an admin gave VISA_PAYMENT_VOID, void a payment', async () => {
    const admin = await createAdmin();
    const plain = await createVisaStaff();
    const trusted = await createVisaStaff([PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_EDIT, PERMISSIONS.VISA_PAYMENT_VOID]);
    const catalog = await createCatalog();
    const made = await create(admin, catalog, { advancePaid: 4000, paymentMethod: 'Cash' });
    const id = made.body.data._id;
    const paymentId = made.body.data.payments[0]._id;

    expect((await post(plain, `/api/visa/applications/${id}/payments/${paymentId}/void`, { reason: 'x' })).status).toBe(403);
    expect((await post(trusted, `/api/visa/applications/${id}/payments/${paymentId}/void`, { reason: 'Wrong amount' })).status).toBe(200);
    expect((await post(plain, `/api/visa/applications/${id}/payments`, { amount: 100, method: 'Cash' })).status).toBe(201);
  });

  it('raises payment events and audit entries', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog);
    const id = made.body.data._id;
    const recorded = jest.fn();
    const voided = jest.fn();
    events.on(events.EVENTS.VISA_PAYMENT_RECORDED, recorded);
    events.on(events.EVENTS.VISA_PAYMENT_VOIDED, voided);
    const paid = await post(admin, `/api/visa/applications/${id}/payments`, { amount: 100, method: 'Cash' });
    await post(admin, `/api/visa/applications/${id}/payments/${paid.body.data.payments[0]._id}/void`, { reason: 'oops' });
    events.removeAllListeners();
    expect(recorded).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, currency: 'BDT' }));
    expect(voided).toHaveBeenCalled();
    expect(await AuditLog.countDocuments({ action: { $in: ['VISA_PAYMENT_RECORDED', 'VISA_PAYMENT_VOIDED'] } })).toBe(2);
  });
});

describe('dashboard and staff lookup', () => {
  it('counts applications from the database', async () => {
    const admin = await createAdmin();
    const staff = await createVisaStaff();
    const catalog = await createCatalog();
    const a = await create(admin, catalog, { assignedStaff: String(staff._id) });
    const b = await create(admin, catalog);
    const c = await create(admin, catalog);
    for (const status of ['under_review', 'processing', 'submitted_to_embassy', 'approved']) await patch(admin, `/api/visa/applications/${a.body.data._id}/status`, { status });
    for (const [status, body] of [['under_review', {}], ['rejected', { customerReason: 'No', internalReason: 'No' }]]) await patch(admin, `/api/visa/applications/${b.body.data._id}/status`, { status, ...body });

    const res = await get(admin, '/api/visa/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 3, submitted: 1, approved: 1, rejected: 1, b2c: 3, b2b: 0, unassigned: 1, decisionRate: 50 });
    expect(res.body.data.countries[0]).toMatchObject({ country: catalog.country.name, applications: 3, approved: 1, approvalRate: 50 });
    expect(res.body.data.recent).toHaveLength(3);
    expect(c.status).toBe(201);
  });

  it('lists only active admin and staff for the "assign to" drop-down, with nothing else about them', async () => {
    const admin = await createAdmin();
    const staff = await createVisaStaff();
    await createUser({ role: ROLES.STAFF, status: USER_STATUS.SUSPENDED, name: 'Gone Away' });
    await createUser({ role: ROLES.B2C, name: 'A Customer' });

    const res = await get(staff, '/api/visa/staff');
    expect(res.status).toBe(200);
    expect(res.body.data.map((u) => u.name).sort()).toEqual(['Admin Person', 'Staff Person']);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['_id', 'name', 'role']);
    expect((await get(admin, '/api/visa/staff?search=staff')).body.data).toHaveLength(1);
    expect((await get(await createUser({ role: ROLES.B2C }), '/api/visa/staff')).status).toBe(403);
  });
});
