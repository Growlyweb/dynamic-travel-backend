const request = require('supertest');

const app = require('../../app');
const AuditLog = require('../../models/AuditLog');
const Tour = require('../../models/Tour');
const TourCategory = require('../../models/TourCategory');
const { ROLES, APPROVAL_STATUS } = require('../../config/constants');
const { createUser, createB2B, bearer } = require('./helpers/factory');

const day = (n, title = `Day ${n}`) => ({ day: n, title, description: `Plan for day ${n}` });

const tourBody = (overrides = {}) => ({
  name: "Cox's Bazar Beach Escape",
  country: 'Bangladesh',
  destination: "Cox's Bazar, Bangladesh",
  durationDays: 3,
  priceCurrency: 'BDT',
  price: 12500,
  b2bPrice: 10000,
  seats: 25,
  status: 'published',
  rating: 4.9,
  description: 'The longest natural sea beach.',
  itinerary: [day(1), day(2), day(3)],
  ...overrides
});

const send = (method, url, user, body) => {
  const req = request(app)[method](url);
  return (user ? req.set(bearer(user)) : req).send(body);
};
const create = (user, overrides) => send('post', '/api/tours', user, tourBody(overrides));

const makeCategory = (name, extra = {}) =>
  TourCategory.create({ name, nameKey: name.toLowerCase(), slug: name.toLowerCase().replace(/\W+/g, '-'), ...extra });

const names = (res) => res.body.data.map((t) => t.name).sort();

let admin;
beforeEach(async () => {
  admin = await createUser({ role: ROLES.ADMIN });
});

describe('who may change tours', () => {
  it('admin and staff holding TOUR_MANAGE can create, edit and archive; nobody else, and nothing changes', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: ['TOUR_MANAGE'] });
    const refused = {
      'staff without the permission': await createUser({ role: ROLES.STAFF, permissions: ['USER_VIEW', 'B2B_MANAGE'] }),
      'a customer': await createUser({ role: ROLES.B2C }),
      'an approved agency': (await createB2B()).user
    };

    expect((await create(admin)).status).toBe(201);
    expect((await create(staff, { name: 'By Staff' })).status).toBe(201);
    const target = await Tour.findOne({ name: 'By Staff' });

    for (const [who, user] of Object.entries(refused)) {
      const results = [
        (await create(user, { name: 'Sneaky' })).status,
        (await send('patch', `/api/tours/${target._id}`, user, { price: 1 })).status,
        (await send('delete', `/api/tours/${target._id}`, user)).status
      ];
      expect({ who, results }).toEqual({ who, results: [403, 403, 403] });
    }
    expect([(await create(null)).status, (await send('patch', `/api/tours/${target._id}`, null, { price: 1 })).status]).toEqual([401, 401]);

    const after = await Tour.findById(target._id);
    expect({ price: after.price, status: after.status }).toEqual({ price: 12500, status: 'published' });
    expect(await Tour.countDocuments({ name: 'Sneaky' })).toBe(0);
  });

  it('a wrong token is refused with 401 on a public route, never treated as an anonymous visitor', async () => {
    const res = await request(app).get('/api/tours').set('Authorization', 'Bearer not.a.token');

    expect(res.status).toBe(401);
  });
});

describe('creating a tour', () => {
  it('saves the sample tour, sorts the itinerary, strips unknown fields and starts as a draft by default', async () => {
    const category = await makeCategory('Beach & Resort', { legacyId: 'cat_beach' });
    const res = await create(admin, {
      category: 'cat_beach', // the id the frontend used before
      status: undefined,
      itinerary: [day(3), day(1), day(2)],
      hotels: ['Ocean Paradise Hotel & Resort'],
      included: ['2 nights hotel stay'],
      role: 'ADMIN',
      _id: '64b7f0f0f0f0f0f0f0f0f0f0',
      createdAt: '2001-01-01'
    });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.itinerary.map((d) => d.day)).toEqual([1, 2, 3]);
    expect(res.body.data.category).toMatchObject({ _id: String(category._id), name: 'Beach & Resort', legacyId: 'cat_beach' });
    expect(res.body.data._id).not.toBe('64b7f0f0f0f0f0f0f0f0f0f0');
    expect(res.body.data.createdAt).not.toContain('2001');
    expect(res.body.data).not.toHaveProperty('role');
    expect(res.body.data).not.toHaveProperty('__v');
  });

  it.each([
    ['a negative price', { price: -1 }, 'price'],
    ['a negative B2B price', { b2bPrice: -1 }, 'b2bPrice'],
    ['negative seats', { seats: -5 }, 'seats'],
    ['a duration of zero', { durationDays: 0 }, 'durationDays'],
    ['a fractional duration', { durationDays: 2.5 }, 'durationDays'],
    ['a currency that is not allowed', { priceCurrency: 'GBP' }, 'priceCurrency'],
    ['a status that is not in the list', { status: 'live' }, 'status'],
    ['a rating above 5', { rating: 6 }, 'rating'],
    ['a price sent as text', { price: '100' }, 'price'],
    ['a cover image that is not a web link', { coverImage: 'javascript:alert(1)' }, 'coverImage'],
    ['a gallery image that is not a web link', { gallery: ['https://ok.example/a.jpg', 'file:///etc/passwd'] }, 'gallery.1'],
    ['two itinerary entries for the same day', { itinerary: [day(1), day(1)] }, 'itinerary'],
    ['an itinerary day of zero', { itinerary: [day(0)] }, 'itinerary.0.day'],
    ['an empty name', { name: '   ' }, 'name'],
    ['a missing description', { description: undefined }, 'description'],
    ['a missing country', { country: undefined }, 'country']
  ])('refuses %s', async (_label, overrides, field) => {
    const res = await create(admin, overrides);

    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toContain(`body.${field}`);
    expect(await Tour.countDocuments()).toBe(0);
  });

  it('a published tour needs an itinerary, and no day may be after the last day of the tour', async () => {
    const empty = await create(admin, { itinerary: [] });
    expect(empty.status).toBe(422);
    expect(empty.body.errors[0].field).toBe('body.itinerary');

    const tooLong = await create(admin, { durationDays: 2, itinerary: [day(1), day(3)] });
    expect(tooLong.status).toBe(422);

    expect((await create(admin, { status: 'draft', itinerary: [] })).status).toBe(201); // a draft may be incomplete
  });

  it('a category must exist and be switched on', async () => {
    const off = await makeCategory('Old One', { isActive: false });

    expect((await create(admin, { category: '64b7f0f0f0f0f0f0f0f0f0f0' })).status).toBe(422);
    expect((await create(admin, { category: 'cat_nope' })).status).toBe(422);
    expect((await create(admin, { category: String(off._id) })).status).toBe(422);
    expect(await Tour.countDocuments()).toBe(0);
  });

  it('records the creation in the audit log without any tour content', async () => {
    const res = await create(admin);

    const entry = await AuditLog.findOne({ action: 'TOUR_CREATED' }).lean();
    expect(entry).toMatchObject({ resource: `tour:${res.body.data._id}`, meta: { status: 'published' } });
    expect(JSON.stringify(entry)).not.toContain('Bazar');
  });
});

describe('who sees which tours', () => {
  beforeEach(async () => {
    await create(admin, { name: 'Published Tour' });
    await create(admin, { name: 'Draft Tour', status: 'draft' });
    await create(admin, { name: 'Unpublished Tour', status: 'unpublished' });
    await create(admin, { name: 'Archived Tour', status: 'archived' });
  });

  it('the public, customers and agencies see published tours only, and the others answer 404', async () => {
    const customer = await createUser({ role: ROLES.B2C });
    const { user: agency } = await createB2B();

    for (const user of [null, customer, agency]) {
      const list = await send('get', '/api/tours?limit=100', user);
      expect(names(list)).toEqual(['Published Tour']);
    }
    const hidden = await Tour.findOne({ name: 'Draft Tour' });
    expect((await send('get', `/api/tours/${hidden._id}`, null)).status).toBe(404);
    expect((await send('get', `/api/tours/${hidden._id}`, customer)).status).toBe(404);
    // a status filter does not widen what the public sees
    expect(names(await send('get', '/api/tours?status=draft', null))).toEqual(['Published Tour']);
  });

  it('a tour manager sees drafts and unpublished tours, archived ones only when asked', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: ['TOUR_MANAGE'] });

    for (const user of [admin, staff]) {
      expect(names(await send('get', '/api/tours?limit=100', user))).toEqual(['Draft Tour', 'Published Tour', 'Unpublished Tour']);
      expect(names(await send('get', '/api/tours?status=archived', user))).toEqual(['Archived Tour']);
      expect((await send('get', `/api/tours/${(await Tour.findOne({ name: 'Draft Tour' }))._id}`, user)).status).toBe(200);
    }
  });

  it('staff without TOUR_MANAGE see what the public sees', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: ['USER_VIEW'] });

    expect(names(await send('get', '/api/tours', staff))).toEqual(['Published Tour']);
  });
});

describe('the B2B price', () => {
  it.each([
    ['an anonymous visitor', async () => null, false],
    ['a customer', async () => createUser({ role: ROLES.B2C }), false],
    ['staff without TOUR_MANAGE', async () => createUser({ role: ROLES.STAFF, permissions: ['B2B_VIEW'] }), false],
    ['an agency still waiting for approval', async () => (await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING })).user, false],
    ['a rejected agency', async () => (await createB2B({ approvalStatus: APPROVAL_STATUS.REJECTED })).user, false],
    ['an approved agency', async () => (await createB2B()).user, true],
    ['staff holding TOUR_MANAGE', async () => createUser({ role: ROLES.STAFF, permissions: ['TOUR_MANAGE'] }), true],
    ['an admin', async () => createUser({ role: ROLES.ADMIN }), true]
  ])('%s %s see it, in the list and on one tour', async (_label, makeUser, sees) => {
    const user = await makeUser();
    const tour = (await create(admin)).body.data;

    const list = await send('get', '/api/tours', user);
    const one = await send('get', `/api/tours/${tour._id}`, user);

    expect([list.body.data[0].b2bPrice, one.body.data.b2bPrice]).toEqual(sees ? [10000, 10000] : [undefined, undefined]);
    expect(JSON.stringify([list.body, one.body]).includes('b2bPrice')).toBe(sees);
    // the public price is always there
    expect(one.body.data.price).toBe(12500);
  });

  it('the response of the create call to a manager has it, and the answer varies by caller', async () => {
    const res = await create(admin);
    expect(res.body.data.b2bPrice).toBe(10000);
    expect((await request(app).get('/api/tours')).headers.vary).toMatch(/Authorization/i);
  });
});

describe('finding tours', () => {
  beforeEach(async () => {
    const beach = await makeCategory('Beach & Resort', { legacyId: 'cat_beach' });
    const city = await makeCategory('City Break', { legacyId: 'cat_city' });
    await makeCategory('Family Special', { legacyId: 'cat_family' });
    await create(admin, { name: "Cox's Bazar Beach Escape", category: String(beach._id), price: 12500, durationDays: 3 });
    await create(admin, { name: 'Dhaka City Weekend', country: 'Bangladesh', destination: 'Dhaka', category: String(city._id), price: 6000, durationDays: 2, itinerary: [day(1)], rating: undefined });
    await create(admin, { name: 'Bangkok Highlights', country: 'Thailand', destination: 'Bangkok', category: String(city._id), price: 45000, durationDays: 5, itinerary: [day(1)], rating: 4.2 });
  });

  it('searches name, destination and country without caring about letter case', async () => {
    expect(names(await request(app).get('/api/tours?search=BEACH'))).toEqual(["Cox's Bazar Beach Escape"]);
    expect(names(await request(app).get('/api/tours?search=dhaka'))).toEqual(['Dhaka City Weekend']);
    expect(names(await request(app).get('/api/tours?search=thailand'))).toEqual(['Bangkok Highlights']);
    expect(names(await request(app).get('/api/tours?search=nothing'))).toEqual([]);
  });

  it('search is plain text: a pattern matches nothing, and a query operator is stripped', async () => {
    expect(names(await request(app).get('/api/tours?search=.*'))).toEqual([]);
    // the operator is stripped, what is left is not text, so the request is refused rather than applied
    expect((await request(app).get('/api/tours?search[$ne]=x')).status).toBe(422);
  });

  it('filters by one category or several, by this API\'s id or the old frontend id', async () => {
    const beach = await TourCategory.findOne({ legacyId: 'cat_beach' });

    expect(names(await request(app).get(`/api/tours?category=${beach._id}`))).toEqual(["Cox's Bazar Beach Escape"]);
    expect(names(await request(app).get('/api/tours?category=cat_city'))).toEqual(['Bangkok Highlights', 'Dhaka City Weekend']);
    expect(names(await request(app).get('/api/tours?category=cat_beach,cat_city')).length).toBe(3);
    expect(names(await request(app).get('/api/tours?category=cat_family'))).toEqual([]);
    expect(names(await request(app).get('/api/tours?category=cat_unknown'))).toEqual([]);
  });

  it('filters by country, destination, price range and duration', async () => {
    expect(names(await request(app).get('/api/tours?country=bangladesh'))).toEqual(["Cox's Bazar Beach Escape", 'Dhaka City Weekend']);
    expect(names(await request(app).get('/api/tours?destination=bangkok'))).toEqual(['Bangkok Highlights']);
    expect(names(await request(app).get('/api/tours?minPrice=10000&maxPrice=20000'))).toEqual(["Cox's Bazar Beach Escape"]);
    expect(names(await request(app).get('/api/tours?maxPrice=6000'))).toEqual(['Dhaka City Weekend']);
    expect(names(await request(app).get('/api/tours?durationDays=5'))).toEqual(['Bangkok Highlights']);
  });

  it('sorts newest first by default, and by price, duration or rating in either direction', async () => {
    const order = async (query) => (await request(app).get(`/api/tours?${query}`)).body.data.map((t) => t.name);

    expect((await order('')).at(0)).toBe('Bangkok Highlights'); // created last
    expect(await order('sort=price')).toEqual(['Dhaka City Weekend', "Cox's Bazar Beach Escape", 'Bangkok Highlights']);
    expect(await order('sort=-price')).toEqual(['Bangkok Highlights', "Cox's Bazar Beach Escape", 'Dhaka City Weekend']);
    expect((await order('sort=-durationDays')).at(0)).toBe('Bangkok Highlights');
    expect(await order('sort=-rating')).toEqual(["Cox's Bazar Beach Escape", 'Bangkok Highlights', 'Dhaka City Weekend']);
  });

  it('pages the answer, with the same meta as the rest of the API, and caps the page size', async () => {
    const first = await request(app).get('/api/tours?limit=2&sort=price');
    const second = await request(app).get('/api/tours?limit=2&page=2&sort=price');

    expect(first.body.data).toHaveLength(2);
    expect(second.body.data).toHaveLength(1);
    expect(first.body.meta).toEqual({ total: 3, page: 1, limit: 2, totalPages: 2 });
    expect((await request(app).get('/api/tours?limit=5000')).body.meta.limit).toBe(100);
    expect((await request(app).get('/api/tours')).body.meta.limit).toBe(10);
  });

  it.each([['sort=cheapest'], ['minPrice=cheap'], ['durationDays=2.5'], ['status=live'], ['page=abc']])('refuses a bad query (%s)', async (query) => {
    expect((await request(app).get(`/api/tours?${query}`)).status).toBe(422);
  });

  it('reads one tour by its id or by the old frontend id, and a missing one is 404', async () => {
    const tour = await Tour.findOne({ name: 'Dhaka City Weekend' });
    await Tour.updateOne({ _id: tour._id }, { legacyId: 'tour_205' });

    expect((await request(app).get(`/api/tours/${tour._id}`)).body.data.name).toBe('Dhaka City Weekend');
    expect((await request(app).get('/api/tours/tour_205')).body.data._id).toBe(String(tour._id));
    expect((await request(app).get('/api/tours/64b7f0f0f0f0f0f0f0f0f0f0')).status).toBe(404);
    expect((await request(app).get('/api/tours/tour_nope')).status).toBe(404);
    expect((await request(app).get('/api/tours/a')).status).toBe(422);
  });
});

describe('editing and archiving', () => {
  it('changes only the fields sent, keeps the rest, and the audit log names the fields but not the values', async () => {
    const tour = (await create(admin)).body.data;

    const res = await send('patch', `/api/tours/${tour._id}`, admin, { price: 13000, seats: 30, role: 'ADMIN' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ price: 13000, seats: 30, name: tour.name, b2bPrice: 10000, status: 'published' });
    const entry = await AuditLog.findOne({ action: 'TOUR_UPDATED' }).lean();
    expect(entry.meta).toEqual({ fields: ['price', 'seats'] }); // "role" was stripped before it could count as a change
    expect(JSON.stringify(entry)).not.toContain('13000');
  });

  it('checks the rules against the whole tour, not just the changed fields', async () => {
    const draft = (await create(admin, { status: 'draft', itinerary: [] })).body.data;
    const published = (await create(admin, { name: 'Other' })).body.data;

    expect((await send('patch', `/api/tours/${draft._id}`, admin, { status: 'published' })).status).toBe(422); // no itinerary yet
    expect((await send('patch', `/api/tours/${published._id}`, admin, { durationDays: 2 })).status).toBe(422); // day 3 would be past the end
    expect((await send('patch', `/api/tours/${draft._id}`, admin, { itinerary: [day(1)], status: 'published' })).status).toBe(200);
  });

  it('refuses an empty change, bad values and an unknown tour', async () => {
    const tour = (await create(admin)).body.data;

    expect((await send('patch', `/api/tours/${tour._id}`, admin, {})).status).toBe(422);
    expect((await send('patch', `/api/tours/${tour._id}`, admin, { price: -3 })).status).toBe(422);
    expect((await send('patch', `/api/tours/${tour._id}`, admin, { category: 'cat_nope' })).status).toBe(422);
    expect((await send('patch', '/api/tours/64b7f0f0f0f0f0f0f0f0f0f0', admin, { price: 1 })).status).toBe(404);
    expect((await Tour.findById(tour._id)).price).toBe(12500);
  });

  it('moves a tour to another category, by this API\'s id or the old frontend id', async () => {
    await makeCategory('City Break', { legacyId: 'cat_city' });
    const tour = (await create(admin)).body.data;

    const res = await send('patch', `/api/tours/${tour._id}`, admin, { category: 'cat_city' });

    expect(res.body.data.category).toMatchObject({ name: 'City Break' });
  });

  it('DELETE archives: the tour leaves the public list, stays readable by managers, and repeating changes nothing', async () => {
    const tour = (await create(admin)).body.data;

    const res = await send('delete', `/api/tours/${tour._id}`, admin);
    const again = await send('delete', `/api/tours/${tour._id}`, admin);

    expect([res.status, res.body.data.status, again.status]).toEqual([200, 'archived', 200]);
    expect(names(await request(app).get('/api/tours'))).toEqual([]);
    expect((await request(app).get(`/api/tours/${tour._id}`)).status).toBe(404);
    expect((await send('get', `/api/tours/${tour._id}`, admin)).body.data.status).toBe('archived');
    expect(await Tour.countDocuments()).toBe(1); // nothing was deleted
    expect(await AuditLog.countDocuments({ action: 'TOUR_ARCHIVED' })).toBe(1);
  });

  it('a manager can publish an archived tour again', async () => {
    const tour = (await create(admin)).body.data;
    await send('delete', `/api/tours/${tour._id}`, admin);

    const res = await send('patch', `/api/tours/${tour._id}`, admin, { status: 'published' });

    expect(res.body.data.status).toBe('published');
    expect(names(await request(app).get('/api/tours'))).toEqual(["Cox's Bazar Beach Escape"]);
  });
});

describe('what Postman and other tools send', () => {
  it('a blank filter counts as not given, on every list that has filters', async () => {
    await create(admin);
    const blank = '?search=&category=&country=&destination=&status=&minPrice=&maxPrice=&durationDays=&sort=&page=&limit=';

    const tours = await request(app).get(`/api/tours${blank}`);
    expect(tours.status).toBe(200);
    expect(tours.body.data).toHaveLength(1);
    expect((await send('get', `/api/tour-categories?search=&includeInactive=`, null)).status).toBe(200);
    expect((await send('get', `/api/tours/custom-requests?status=&search=`, await createUser({ role: ROLES.STAFF, permissions: ['TOUR_MANAGE'] }))).status).toBe(200);
  });

  it('a Bearer header with no token after it is an anonymous visitor, but a wrong token is still refused', async () => {
    await create(admin);

    for (const header of ['Bearer ', 'Bearer', '']) {
      const res = await request(app).get('/api/tours').set('Authorization', header);
      expect({ header, status: res.status, tours: res.body.data && res.body.data.length }).toEqual({ header, status: 200, tours: 1 });
    }
    expect((await request(app).get('/api/tours').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await request(app).get('/api/tours').set('Authorization', 'Basic abc')).status).toBe(401);
    // an empty Bearer never opens a protected route
    expect((await request(app).post('/api/tours').set('Authorization', 'Bearer ').send(tourBody())).status).toBe(401);
  });
});

describe('pagination', () => {
  const insert = (count) =>
    Tour.insertMany(
      Array.from({ length: count }, (_, i) => ({
        name: `Tour ${String(i).padStart(2, '0')}`,
        country: 'Bangladesh',
        destination: 'Dhaka',
        durationDays: 1,
        priceCurrency: 'BDT',
        price: 100, // the same price on purpose: sorting by it must still give stable pages
        status: 'published',
        description: 'd',
        itinerary: [day(1)]
      }))
    );
  const page = async (query) => (await request(app).get(`/api/tours${query}`)).body;

  it('every list carries `pagination` and `meta`, and they are the same object', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: ['TOUR_MANAGE'] });
    await makeCategory('Beach & Resort');
    await create(admin);

    const lists = [
      ['/api/tours', null],
      ['/api/tour-categories', null],
      ['/api/tours/custom-requests', staff],
      ['/api/admin/users', admin],
      ['/api/admin/audit-logs', admin],
      ['/api/admin/b2b', admin]
    ];
    for (const [url, user] of lists) {
      const res = await send('get', url, user);
      expect({ url, status: res.status }).toEqual({ url, status: 200 });
      expect(res.body.pagination).toBeDefined();
      expect({ url, same: res.body.pagination }).toEqual({ url, same: res.body.meta });
      expect(Object.keys(res.body.pagination).sort()).toEqual(['limit', 'page', 'total', 'totalPages']);
    }
    // an answer that is not a list has neither
    const one = await request(app).get('/api/tours/' + (await Tour.findOne())._id);
    expect(one.body.pagination).toBeUndefined();
    expect(one.body.meta).toBeUndefined();
  });

  it('reports the right numbers on the first, middle, last and an out-of-range page', async () => {
    await insert(25);

    expect((await page('?limit=10&page=1')).pagination).toEqual({ total: 25, page: 1, limit: 10, totalPages: 3 });
    expect((await page('?limit=10&page=3')).data).toHaveLength(5);
    const beyond = await page('?limit=10&page=4');
    expect(beyond.data).toEqual([]); // an empty page, not an error
    expect(beyond.pagination).toEqual({ total: 25, page: 4, limit: 10, totalPages: 3 });
  });

  it('an empty result is total 0 on page 1 of 1', async () => {
    expect((await page('?search=nothing')).pagination).toEqual({ total: 0, page: 1, limit: 10, totalPages: 1 });
  });

  it('the page size defaults to 10, is capped at 100, and 0 falls back to the default', async () => {
    await insert(120);

    expect((await page('')).pagination.limit).toBe(10);
    expect((await page('?limit=0')).pagination.limit).toBe(10);
    const big = await page('?limit=1000');
    expect(big.pagination).toMatchObject({ limit: 100, totalPages: 2 });
    expect(big.data).toHaveLength(100);
    expect((await page('?page=0')).pagination.page).toBe(1);
  });

  it('a negative or fractional page is refused', async () => {
    for (const query of ['?page=-1', '?page=1.5', '?limit=-5', '?limit=abc']) {
      expect({ query, status: (await request(app).get(`/api/tours${query}`)).status }).toEqual({ query, status: 422 });
    }
  });

  it('paging through tours with equal prices shows every tour exactly once', async () => {
    await insert(25);

    const seen = [];
    for (let p = 1; p <= 3; p += 1) seen.push(...(await page(`?sort=price&limit=10&page=${p}`)).data.map((t) => t.name));

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });
});
