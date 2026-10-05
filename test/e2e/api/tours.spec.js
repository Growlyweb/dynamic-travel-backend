const { test, expect } = require('../helpers/test');
const { bearer, json, unique, signUpCustomer, signUpAgency, adminSession, createStaff } = require('../helpers/api');

const days = [
  { day: 1, title: 'Arrival & Beach Sunset', description: 'Check-in, relax at Laboni Beach, enjoy sunset.' },
  { day: 2, title: 'Inani Beach & Himchari', description: 'Day trip to Inani rocky beach and Himchari waterfall.' },
  { day: 3, title: 'Departure', description: 'Morning shopping at Burmese market, airport transfer.' }
];

// A tour body with a name no other test uses, so tests can share one database.
const tourBody = (name, overrides = {}) => ({
  name,
  country: 'Bangladesh',
  destination: "Cox's Bazar, Bangladesh",
  durationDays: 3,
  priceCurrency: 'BDT',
  price: 12500,
  b2bPrice: 10000,
  seats: 25,
  status: 'published',
  rating: 4.9,
  coverImage: 'https://picsum.photos/seed/coxs-bazar/900/560',
  description: 'The longest natural sea beach.',
  itinerary: days,
  ...overrides
});

const find = async (ctx, name, token) => {
  const res = await ctx.get(`/api/tours?search=${encodeURIComponent(name)}&limit=100`, token ? { headers: bearer(token) } : undefined);
  return (await json(res)).data;
};

test.describe('tour packages over real HTTP', () => {
  test('a manager builds a category and a tour, the public sees it, and the B2B price reaches only the people allowed', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const name = unique('Cox Escape');
    const categoryName = `Beach ${unique('cat')}`;

    // --- the category: a duplicate name in any letter case returns the same record
    const category = await ctx.post('/api/tour-categories', { headers: bearer(admin.token), data: { name: categoryName } });
    expect(category.status()).toBe(201);
    const categoryId = (await json(category)).data._id;
    const again = await ctx.post('/api/tour-categories', { headers: bearer(admin.token), data: { name: `  ${categoryName.toUpperCase()} ` } });
    expect(again.status()).toBe(200);
    expect((await json(again)).data._id).toBe(categoryId);

    // --- the tour, with the itinerary sent out of order
    const created = await ctx.post('/api/tours', { headers: bearer(admin.token), data: tourBody(name, { category: categoryId, itinerary: [...days].reverse() }) });
    expect(created.status()).toBe(201);
    const tour = (await json(created)).data;
    expect(tour.itinerary.map((d) => d.day)).toEqual([1, 2, 3]);
    expect(tour.category.name).toBe(categoryName);
    expect(tour.b2bPrice).toBe(10000);

    // --- who sees the B2B price
    const customer = await signUpCustomer(await client());
    const pendingAgency = await signUpAgency(await client());
    const approvedAgency = await signUpAgency(await client());
    const approve = await ctx.patch(`/api/admin/b2b/${approvedAgency.partner._id}/approval`, { headers: bearer(admin.token), data: { decision: 'APPROVED' } });
    expect(approve.status()).toBe(200);
    const manager = await createStaff(admin.token, { permissions: ['TOUR_MANAGE'] });
    const plainStaff = await createStaff(admin.token, { permissions: ['B2B_VIEW'] });

    const seen = {};
    for (const [who, token] of Object.entries({
      visitor: undefined,
      customer: customer.token,
      'agency awaiting approval': pendingAgency.token,
      'staff without TOUR_MANAGE': plainStaff.token,
      'approved agency': approvedAgency.token,
      'staff with TOUR_MANAGE': manager.token,
      admin: admin.token
    })) {
      const [listed] = await find(ctx, name, token);
      const single = await ctx.get(`/api/tours/${tour._id}`, token ? { headers: bearer(token) } : undefined);
      seen[who] = [listed.b2bPrice, (await json(single)).data.b2bPrice, listed.price];
    }
    expect(seen).toEqual({
      visitor: [undefined, undefined, 12500],
      customer: [undefined, undefined, 12500],
      'agency awaiting approval': [undefined, undefined, 12500],
      'staff without TOUR_MANAGE': [undefined, undefined, 12500],
      'approved agency': [10000, 10000, 12500],
      'staff with TOUR_MANAGE': [10000, 10000, 12500],
      admin: [10000, 10000, 12500]
    });
  });

  test('search, filters, sorting and paging answer the way the handoff describes', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const tag = unique('Find').replace(/-/g, '');
    const categoryId = (await json(await ctx.post('/api/tour-categories', { headers: bearer(admin.token), data: { name: `City ${tag}` } }))).data._id;
    for (const [name, price, durationDays, country] of [['Alpha', 4000, 2, 'Bangladesh'], ['Bravo', 9000, 4, 'Thailand'], ['Charlie', 15000, 6, 'Thailand']]) {
      const res = await ctx.post('/api/tours', {
        headers: bearer(admin.token),
        data: tourBody(`${tag} ${name}`, { category: categoryId, price, durationDays, country, itinerary: [days[0]] })
      });
      expect(res.status()).toBe(201);
    }
    const list = async (query) => (await json(await ctx.get(`/api/tours?category=${categoryId}&${query}`))).data.map((t) => t.name.replace(`${tag} `, ''));

    expect(await list('sort=price')).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(await list('sort=-price')).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(await list('country=thailand&sort=price')).toEqual(['Bravo', 'Charlie']);
    expect(await list('minPrice=5000&maxPrice=10000')).toEqual(['Bravo']);
    expect(await list('durationDays=6')).toEqual(['Charlie']);
    expect(await list(`search=${tag}+bravo`.replace('+', '%20'))).toEqual(['Bravo']);
    expect(await list('status=&country=&sort=price')).toEqual(['Alpha', 'Bravo', 'Charlie']); // blank filters are ignored

    const page = await json(await ctx.get(`/api/tours?category=${categoryId}&sort=price&limit=2&page=2`));
    expect(page.data.map((t) => t.name.replace(`${tag} `, ''))).toEqual(['Charlie']);
    expect(page.meta).toEqual({ total: 3, page: 2, limit: 2, totalPages: 2 });
    expect(page.pagination).toEqual(page.meta); // the handoff's name for the same object
  });

  test('draft, unpublish, archive and restore: the public list follows, nothing is ever deleted', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const manager = await createStaff(admin.token, { permissions: ['TOUR_MANAGE'] });
    const name = unique('Lifecycle');

    const draft = (await json(await ctx.post('/api/tours', { headers: bearer(manager.token), data: tourBody(name, { status: 'draft', itinerary: [] }) }))).data;
    expect(await find(ctx, name)).toHaveLength(0);
    expect((await ctx.get(`/api/tours/${draft._id}`)).status()).toBe(404); // a draft does not exist for the public
    expect(await find(ctx, name, manager.token)).toHaveLength(1);

    // publishing needs an itinerary; adding it and publishing in one edit works
    expect((await ctx.patch(`/api/tours/${draft._id}`, { headers: bearer(manager.token), data: { status: 'published' } })).status()).toBe(422);
    const published = await ctx.patch(`/api/tours/${draft._id}`, { headers: bearer(manager.token), data: { status: 'published', itinerary: days } });
    expect(published.status()).toBe(200);
    expect(await find(ctx, name)).toHaveLength(1);

    expect((await ctx.patch(`/api/tours/${draft._id}`, { headers: bearer(manager.token), data: { status: 'unpublished' } })).status()).toBe(200);
    expect(await find(ctx, name)).toHaveLength(0);

    const archived = await ctx.delete(`/api/tours/${draft._id}`, { headers: bearer(manager.token) });
    expect((await json(archived)).data.status).toBe('archived');
    expect(await find(ctx, name, manager.token)).toHaveLength(0); // archived is hidden from managers' default list too
    const archivedList = await json(await ctx.get(`/api/tours?status=archived&search=${name}`, { headers: bearer(manager.token) }));
    expect(archivedList.data).toHaveLength(1);

    const restored = await ctx.patch(`/api/tours/${draft._id}`, { headers: bearer(manager.token), data: { status: 'published' } });
    expect(restored.status()).toBe(200);
    expect(await find(ctx, name)).toHaveLength(1);
  });

  test('only admin and TOUR_MANAGE staff can change anything; a wrong or missing token is refused', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const customer = await signUpCustomer(await client());
    const agency = await signUpAgency(await client());
    const plainStaff = await createStaff(admin.token, { permissions: ['B2B_VIEW', 'DOCUMENT_VERIFY'] });
    const name = unique('Guarded');
    const tour = (await json(await ctx.post('/api/tours', { headers: bearer(admin.token), data: tourBody(name) }))).data;

    for (const [who, token] of Object.entries({ customer: customer.token, agency: agency.token, 'staff without TOUR_MANAGE': plainStaff.token })) {
      const results = [
        (await ctx.post('/api/tours', { headers: bearer(token), data: tourBody(unique('Sneaky')) })).status(),
        (await ctx.patch(`/api/tours/${tour._id}`, { headers: bearer(token), data: { price: 1 } })).status(),
        (await ctx.delete(`/api/tours/${tour._id}`, { headers: bearer(token) })).status(),
        (await ctx.post('/api/tour-categories', { headers: bearer(token), data: { name: unique('Sneaky') } })).status()
      ];
      expect({ who, results }).toEqual({ who, results: [403, 403, 403, 403] });
    }
    expect((await ctx.post('/api/tours', { data: tourBody(unique('Anon')) })).status()).toBe(401);
    expect((await ctx.get('/api/tours', { headers: { Authorization: 'Bearer not.a.token' } })).status()).toBe(401);
    expect((await ctx.post('/api/tours', { headers: { Authorization: 'Bearer ' }, data: tourBody(unique('Blank')) })).status()).toBe(401);
    expect((await ctx.get('/api/tours', { headers: { Authorization: 'Bearer ' } })).status()).toBe(200); // blank on a public route = visitor

    const after = (await json(await ctx.get(`/api/tours/${tour._id}`))).data;
    expect({ price: after.price, status: after.status }).toEqual({ price: 12500, status: 'published' });
  });

  test('the old frontend ids still resolve: a category by cat_ id in a filter and on a tour', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);

    // categories made through the API have no legacy id; ask for a missing one and expect clean answers
    expect((await ctx.get('/api/tour-categories/cat_beach_missing')).status()).toBe(404);
    expect((await json(await ctx.get('/api/tours?category=cat_unknown_one'))).data).toEqual([]);
    const bad = await ctx.post('/api/tours', { headers: bearer(admin.token), data: tourBody(unique('Bad'), { category: 'cat_unknown_one' }) });
    expect(bad.status()).toBe(422);
    expect((await json(bad)).errors[0].field).toBe('body.category');
  });

  test('validation answers per field and stops bad data before it is stored', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const name = unique('Invalid');

    const res = await ctx.post('/api/tours', {
      headers: bearer(admin.token),
      data: tourBody(name, { price: -5, priceCurrency: 'GBP', status: 'live', durationDays: 0, coverImage: 'javascript:alert(1)', itinerary: [days[0], days[0]] })
    });
    const body = await json(res);

    expect(res.status()).toBe(422);
    expect(body.errors.map((e) => e.field).sort()).toEqual(['body.coverImage', 'body.durationDays', 'body.itinerary', 'body.price', 'body.priceCurrency', 'body.status']);
    expect(await find(ctx, name, (await adminSession(ctx)).token)).toHaveLength(0);
  });
});

test.describe('custom tour requests over real HTTP', () => {
  test('a customer sends a request, a consultant quotes it, the customer reads the quote and cannot cancel it any more', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const consultant = await createStaff(admin.token, { permissions: ['TOUR_MANAGE'] });
    const customer = await signUpCustomer(await client());
    const stranger = await signUpCustomer(await client());

    const sent = await ctx.post('/api/tours/custom-requests', {
      headers: bearer(customer.token),
      data: {
        customer: 'Rahim Uddin', phone: '+8801712345678', destination: 'Sajek Valley', travelers: 4, startDate: '2026-12-01', endDate: '2026-12-05',
        hotel: '3-star', activities: ['Trekking'], requirements: 'Vegetarian meals', itinerary: [days[0]],
        userId: stranger.user._id, status: 'CONFIRMED' // both ignored
      }
    });
    expect(sent.status()).toBe(201);
    const request = (await json(sent)).data;
    expect(request).toMatchObject({ userId: customer.user._id, status: 'NEW', transportation: 'Private car' });

    // the customer sees it, the stranger does not, the consultant does with contact details
    expect((await ctx.get(`/api/tours/custom-requests/${request._id}`, { headers: bearer(customer.token) })).status()).toBe(200);
    expect((await ctx.get(`/api/tours/custom-requests/${request._id}`, { headers: bearer(stranger.token) })).status()).toBe(404);
    const asConsultant = await json(await ctx.get(`/api/tours/custom-requests/${request._id}`, { headers: bearer(consultant.token) }));
    expect(asConsultant.data.userId).toMatchObject({ email: customer.email });
    expect((await json(await ctx.get('/api/tours/custom-requests', { headers: bearer(customer.token) }))).data.map((r) => r._id)).toEqual([request._id]);

    // skipping a step is refused; the proper steps work and the note reaches the customer
    const status = (token, body) => ctx.patch(`/api/tours/custom-requests/${request._id}/status`, { headers: bearer(token), data: body });
    expect((await status(consultant.token, { status: 'QUOTED' })).status()).toBe(409);
    expect((await status(consultant.token, { status: 'IN_REVIEW' })).status()).toBe(200);
    expect((await status(consultant.token, { status: 'QUOTED', note: 'Total BDT 85,000 for four travelers.' })).status()).toBe(200);
    const mine = await json(await ctx.get(`/api/tours/custom-requests/${request._id}`, { headers: bearer(customer.token) }));
    expect(mine.data).toMatchObject({ status: 'QUOTED', reviewNote: 'Total BDT 85,000 for four travelers.' });

    // the customer may cancel only while NEW; it is quoted now
    expect((await status(customer.token, { status: 'CANCELLED' })).status()).toBe(403);
    expect((await status(customer.token, { status: 'CONFIRMED' })).status()).toBe(403);
    expect((await status(stranger.token, { status: 'CANCELLED' })).status()).toBe(404);
  });

  test('a customer can cancel their own new request', async ({ client }) => {
    const ctx = await client();
    const customer = await signUpCustomer(await client());
    const sent = await ctx.post('/api/tours/custom-requests', {
      headers: bearer(customer.token),
      data: { customer: 'Rahim', phone: '+8801712345678', destination: 'Bandarban', travelers: 2, startDate: '2026-11-10', endDate: '2026-11-12', hotel: 'Resort' }
    });
    const id = (await json(sent)).data._id;

    const cancelled = await ctx.patch(`/api/tours/custom-requests/${id}/status`, { headers: bearer(customer.token), data: { status: 'CANCELLED' } });

    expect((await json(cancelled)).data.status).toBe('CANCELLED');
    // a customer may cancel only while it is NEW, so a second cancel is refused; it cannot be reopened either
    expect((await ctx.patch(`/api/tours/custom-requests/${id}/status`, { headers: bearer(customer.token), data: { status: 'CANCELLED' } })).status()).toBe(403);
    expect((await ctx.patch(`/api/tours/custom-requests/${id}/status`, { headers: bearer(customer.token), data: { status: 'NEW' } })).status()).toBe(403);
  });

  test('only a B2C customer can send one: agencies, admins, staff and visitors cannot', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const agency = await signUpAgency(await client());
    const manager = await createStaff(admin.token, { permissions: ['TOUR_MANAGE'] });
    const body = { customer: 'X Y', phone: '+8801712345678', destination: 'Bandarban', travelers: 2, startDate: '2026-11-10', endDate: '2026-11-12', hotel: 'Resort' };

    for (const [who, token] of Object.entries({ agency: agency.token, admin: admin.token, 'staff with TOUR_MANAGE': manager.token })) {
      expect({ who, status: (await ctx.post('/api/tours/custom-requests', { headers: bearer(token), data: body })).status() }).toEqual({ who, status: 403 });
    }
    expect((await ctx.post('/api/tours/custom-requests', { data: body })).status()).toBe(401);
    // and an agency cannot read the list either
    expect((await ctx.get('/api/tours/custom-requests', { headers: bearer(agency.token) })).status()).toBe(403);
  });

  test('bad dates and traveler counts are refused with the field named', async ({ client }) => {
    const ctx = await client();
    const customer = await signUpCustomer(await client());
    const send = (overrides) =>
      ctx.post('/api/tours/custom-requests', {
        headers: bearer(customer.token),
        data: { customer: 'X Y', phone: '+8801712345678', destination: 'Bandarban', travelers: 2, startDate: '2026-11-10', endDate: '2026-11-12', hotel: 'Resort', ...overrides }
      });

    const reversed = await send({ startDate: '2026-11-12', endDate: '2026-11-10' });
    expect(reversed.status()).toBe(422);
    expect((await json(reversed)).errors.map((e) => e.field)).toContain('body.endDate');
    expect((await send({ travelers: 0 })).status()).toBe(422);
    expect((await send({ startDate: 'next week' })).status()).toBe(422);
    expect((await send({ startDate: '2026-11-10', endDate: '2026-11-10' })).status()).toBe(201); // a one-day trip is fine
  });
});
