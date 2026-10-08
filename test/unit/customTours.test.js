const request = require('supertest');

const app = require('../../app');
const AuditLog = require('../../models/AuditLog');
const CustomTourRequest = require('../../models/CustomTourRequest');
const { ROLES } = require('../../config/constants');
const { createUser, createB2B, bearer } = require('./helpers/factory');

const URL = '/api/tours/custom-requests';

const requestBody = (overrides = {}) => ({
  customer: 'Rahim Uddin',
  phone: '+8801712345678',
  destination: 'Sajek Valley',
  travelers: 4,
  startDate: '2026-12-01',
  endDate: '2026-12-05',
  hotel: '3-star',
  activities: ['Trekking', 'Bonfire'],
  requirements: 'Vegetarian meals',
  itinerary: [{ day: 1, title: 'Arrival', description: 'Check in' }],
  ...overrides
});

const send = (method, url, user, body) => {
  const req = request(app)[method](url);
  return (user ? req.set(bearer(user)) : req).send(body);
};

let customer;
let manager;
beforeEach(async () => {
  customer = await createUser({ role: ROLES.B2C });
  manager = await createUser({ role: ROLES.STAFF, permissions: ['TOUR_MANAGE'] });
});

const submit = async (user = customer, overrides) => (await send('post', URL, user, requestBody(overrides))).body.data;

describe('sending a custom tour request', () => {
  it('a B2C customer can; the request belongs to them and starts as NEW', async () => {
    const res = await send('post', URL, customer, requestBody());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      userId: String(customer._id),
      customer: 'Rahim Uddin',
      destination: 'Sajek Valley',
      travelers: 4,
      transportation: 'Private car', // the default
      status: 'NEW',
      activities: ['Trekking', 'Bonfire']
    });
    expect(await AuditLog.countDocuments({ action: 'CUSTOM_TOUR_REQUESTED', actorUserId: customer._id })).toBe(1);
  });

  it('nobody else can: not an agency, an admin, staff (even with TOUR_MANAGE) or a visitor, and nothing is saved', async () => {
    const others = {
      'an approved agency': (await createB2B()).user,
      'an admin': await createUser({ role: ROLES.ADMIN }),
      'staff with TOUR_MANAGE': manager
    };

    for (const [who, user] of Object.entries(others)) {
      expect({ who, status: (await send('post', URL, user, requestBody())).status }).toEqual({ who, status: 403 });
    }
    expect((await send('post', URL, null, requestBody())).status).toBe(401);
    expect(await CustomTourRequest.countDocuments()).toBe(0);
  });

  it('the owner, status and review fields in the body are ignored', async () => {
    const stranger = await createUser({ role: ROLES.B2C });

    const res = await send('post', URL, customer, requestBody({ userId: String(stranger._id), status: 'CONFIRMED', reviewNote: 'Approved', reviewedBy: String(manager._id) }));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: String(customer._id), status: 'NEW', reviewNote: '' });
    expect(res.body.data.reviewedBy).toBeUndefined();
  });

  it.each([
    ['an end date before the start date', { startDate: '2026-12-05', endDate: '2026-12-01' }, 'endDate'],
    ['zero travelers', { travelers: 0 }, 'travelers'],
    ['half a traveler', { travelers: 1.5 }, 'travelers'],
    ['a date that is not a date', { startDate: 'tomorrow' }, 'startDate'],
    ['a date sent as a number', { endDate: 1764547200 }, 'endDate'],
    ['a missing hotel preference', { hotel: '' }, 'hotel'],
    ['a bad phone number', { phone: '12-34' }, 'phone'],
    ['a missing destination', { destination: undefined }, 'destination'],
    ['an itinerary with the same day twice', { itinerary: [{ day: 1, title: 'a', description: 'b' }, { day: 1, title: 'c', description: 'd' }] }, 'itinerary']
  ])('refuses %s', async (_label, overrides, field) => {
    const res = await send('post', URL, customer, requestBody(overrides));

    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toContain(`body.${field}`);
    expect(await CustomTourRequest.countDocuments()).toBe(0);
  });

  it('accepts a one-day trip (end date equal to start date)', async () => {
    expect((await send('post', URL, customer, requestBody({ startDate: '2026-12-01', endDate: '2026-12-01' }))).status).toBe(201);
  });
});

describe('reading custom tour requests', () => {
  it('a customer sees only their own; a tour manager sees everyone\'s with who sent them', async () => {
    const other = await createUser({ role: ROLES.B2C });
    await submit(customer, { destination: 'Mine' });
    await submit(other, { destination: 'Theirs' });

    const mine = await send('get', URL, customer);
    const all = await send('get', URL, manager);
    const forAdmin = await send('get', URL, await createUser({ role: ROLES.ADMIN }));

    expect(mine.body.data.map((r) => r.destination)).toEqual(['Mine']);
    expect(all.body.data.map((r) => r.destination).sort()).toEqual(['Mine', 'Theirs']);
    expect(all.body.data[0].userId).toMatchObject({ email: expect.any(String), name: expect.any(String) });
    expect(forAdmin.body.meta.total).toBe(2);
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|tokenVersion/);
  });

  it('agencies, staff without TOUR_MANAGE and visitors cannot list or read', async () => {
    const request1 = await submit();
    const refused = [(await createB2B()).user, await createUser({ role: ROLES.STAFF, permissions: ['USER_VIEW'] })];

    for (const user of refused) {
      expect((await send('get', URL, user)).status).toBe(403);
      expect((await send('get', `${URL}/${request1._id}`, user)).status).toBe(403);
    }
    expect((await send('get', URL, null)).status).toBe(401);
  });

  it('another customer\'s request answers 404, the same as one that does not exist', async () => {
    const theirs = await submit(await createUser({ role: ROLES.B2C }));

    expect((await send('get', `${URL}/${theirs._id}`, customer)).status).toBe(404);
    expect((await send('get', `${URL}/64b7f0f0f0f0f0f0f0f0f0f0`, customer)).status).toBe(404);
    expect((await send('get', `${URL}/${theirs._id}`, manager)).status).toBe(200);
    expect((await send('get', `${URL}/not-an-id`, customer)).status).toBe(422);
  });

  it('filters by status and searches the customer name or destination, and pages the answer', async () => {
    const a = await submit(customer, { destination: 'Sajek Valley', customer: 'Alice' });
    await submit(customer, { destination: "Cox's Bazar", customer: 'Bob' });
    await send('patch', `${URL}/${a._id}/status`, manager, { status: 'IN_REVIEW' });

    expect((await send('get', `${URL}?status=IN_REVIEW`, manager)).body.data.map((r) => r.destination)).toEqual(['Sajek Valley']);
    expect((await send('get', `${URL}?search=cox`, manager)).body.data).toHaveLength(1);
    expect((await send('get', `${URL}?search=.*`, manager)).body.data).toHaveLength(0);
    expect((await send('get', `${URL}?limit=1&page=2`, manager)).body.meta).toMatchObject({ total: 2, page: 2, limit: 1, totalPages: 2 });
    expect((await send('get', `${URL}?status=DONE`, manager)).status).toBe(422);
  });
});

describe('moving a request along', () => {
  const setStatus = (user, id, status, note) => send('patch', `${URL}/${id}/status`, user, { status, note });

  it('a tour manager can follow NEW, IN_REVIEW, QUOTED, CONFIRMED, and the owner sees the note', async () => {
    const created = await submit();

    expect((await setStatus(manager, created._id, 'IN_REVIEW')).status).toBe(200);
    const quoted = await setStatus(manager, created._id, 'QUOTED', 'Total BDT 85,000 for four travelers.');
    expect(quoted.body.data).toMatchObject({ status: 'QUOTED', reviewNote: 'Total BDT 85,000 for four travelers.', reviewedBy: String(manager._id) });
    expect((await setStatus(manager, created._id, 'CONFIRMED')).status).toBe(200);

    const mine = await send('get', `${URL}/${created._id}`, customer);
    expect(mine.body.data).toMatchObject({ status: 'CONFIRMED', reviewNote: 'Total BDT 85,000 for four travelers.' });
    const trail = await AuditLog.find({ action: 'CUSTOM_TOUR_STATUS_CHANGED' }).sort({ createdAt: 1 }).lean();
    expect(trail.map((a) => a.meta)).toEqual([
      { from: 'NEW', to: 'IN_REVIEW' },
      { from: 'IN_REVIEW', to: 'QUOTED' },
      { from: 'QUOTED', to: 'CONFIRMED' }
    ]);
  });

  it.each([
    ['NEW', 'QUOTED'],
    ['NEW', 'CONFIRMED'],
    ['NEW', 'NEW'],
    ['IN_REVIEW', 'CONFIRMED'],
    ['CONFIRMED', 'IN_REVIEW'],
    ['CANCELLED', 'IN_REVIEW'],
    ['CANCELLED', 'CANCELLED']
  ])('%s cannot become %s', async (from, to) => {
    const created = await submit();
    await CustomTourRequest.updateOne({ _id: created._id }, { status: from });

    const res = await setStatus(manager, created._id, to);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
    expect((await CustomTourRequest.findById(created._id)).status).toBe(from);
  });

  it('a quote can go back to review, and any open request can be cancelled', async () => {
    const created = await submit();
    await CustomTourRequest.updateOne({ _id: created._id }, { status: 'QUOTED' });

    expect((await setStatus(manager, created._id, 'IN_REVIEW')).status).toBe(200);
    expect((await setStatus(manager, created._id, 'CANCELLED')).status).toBe(200);
  });

  it('a customer can cancel their own request while it is NEW, and nothing else', async () => {
    const created = await submit();
    const second = await submit();
    await CustomTourRequest.updateOne({ _id: second._id }, { status: 'IN_REVIEW' });

    expect((await setStatus(customer, created._id, 'IN_REVIEW')).status).toBe(403); // not theirs to move
    expect((await setStatus(customer, created._id, 'CONFIRMED')).status).toBe(403);
    expect((await setStatus(customer, second._id, 'CANCELLED')).status).toBe(403); // too late: already in review
    expect((await CustomTourRequest.findById(second._id)).status).toBe('IN_REVIEW');

    const cancelled = await setStatus(customer, created._id, 'CANCELLED', 'A note from the customer is not kept');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', reviewNote: '' });
    expect(cancelled.body.data.reviewedBy).toBeUndefined();
  });

  it('nobody else can change a request: other customers get 404, agencies, plain staff and visitors are refused', async () => {
    const created = await submit();
    const stranger = await createUser({ role: ROLES.B2C });

    expect((await setStatus(stranger, created._id, 'CANCELLED')).status).toBe(404);
    expect((await setStatus((await createB2B()).user, created._id, 'IN_REVIEW')).status).toBe(403);
    expect((await setStatus(await createUser({ role: ROLES.STAFF, permissions: ['USER_VIEW'] }), created._id, 'IN_REVIEW')).status).toBe(403);
    expect((await setStatus(null, created._id, 'IN_REVIEW')).status).toBe(401);
    expect((await CustomTourRequest.findById(created._id)).status).toBe('NEW');
  });

  it('refuses a status that does not exist and a missing request', async () => {
    const created = await submit();

    expect((await setStatus(manager, created._id, 'DONE')).status).toBe(422);
    expect((await setStatus(manager, '64b7f0f0f0f0f0f0f0f0f0f0', 'IN_REVIEW')).status).toBe(404);
  });
});
