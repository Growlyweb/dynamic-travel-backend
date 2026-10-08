const request = require('supertest');

const app = require('../../app');
const AuditLog = require('../../models/AuditLog');
const Tour = require('../../models/Tour');
const TourCategory = require('../../models/TourCategory');
const { ROLES } = require('../../config/constants');
const { createUser, createB2B, bearer } = require('./helpers/factory');

const post = (user, body) => {
  const req = request(app).post('/api/tour-categories');
  return (user ? req.set(bearer(user)) : req).send(body);
};

const manager = () => createUser({ role: ROLES.STAFF, permissions: ['TOUR_MANAGE'] });

describe('who may create and remove categories', () => {
  it('admin and staff holding TOUR_MANAGE can; everyone else is refused and nothing is created', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const allowed = await manager();
    const refused = {
      'staff without the permission': await createUser({ role: ROLES.STAFF, permissions: ['USER_VIEW'] }),
      'a customer': await createUser({ role: ROLES.B2C }),
      'an approved agency': (await createB2B()).user
    };

    expect((await post(admin, { name: 'Beach & Resort' })).status).toBe(201);
    expect((await post(allowed, { name: 'City Break' })).status).toBe(201);
    for (const [who, user] of Object.entries(refused)) {
      expect({ who, status: (await post(user, { name: 'Sneaky' })).status }).toEqual({ who, status: 403 });
    }
    expect((await post(null, { name: 'Anonymous' })).status).toBe(401);

    expect((await TourCategory.find().lean()).map((c) => c.name).sort()).toEqual(['Beach & Resort', 'City Break']);
  });

  it('removing needs the same permission', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const customer = await createUser({ role: ROLES.B2C });
    const { body } = await post(admin, { name: 'Family Special' });
    const url = `/api/tour-categories/${body.data._id}`;

    expect((await request(app).delete(url)).status).toBe(401);
    expect((await request(app).delete(url).set(bearer(customer))).status).toBe(403);
    expect((await TourCategory.findById(body.data._id)).isActive).toBe(true);
  });
});

describe('a category name is unique in any letter case', () => {
  it('creating a name that exists returns the existing record with 200, however it is spelled', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const first = await post(admin, { name: 'Beach & Resort' });

    for (const spelling of ['beach & resort', 'BEACH & RESORT', '  Beach   &   Resort  ']) {
      const again = await post(admin, { name: spelling });
      expect({ spelling, status: again.status, same: again.body.data._id === first.body.data._id }).toEqual({ spelling, status: 200, same: true });
    }
    expect(first.status).toBe(201);
    expect(await TourCategory.countDocuments()).toBe(1);
  });

  it('five requests with the same name at the same moment still leave one category', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });

    const results = await Promise.all(Array.from({ length: 5 }, () => post(admin, { name: 'Luxury & Wellness' })));

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.data._id)).size).toBe(1);
    expect(await TourCategory.countDocuments()).toBe(1);
  });

  it('two different names that make the same slug both exist, with different slugs', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });

    const a = await post(admin, { name: 'Beach & Resort' });
    const b = await post(admin, { name: 'Beach and Resort' });

    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.data.slug, b.body.data.slug]).toEqual(['beach-and-resort', 'beach-and-resort-2']);
  });

  it('rejects an empty or one-letter name, and never returns the internal name key', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });

    expect((await post(admin, { name: '   ' })).status).toBe(422);
    expect((await post(admin, { name: 'A' })).status).toBe(422);
    expect((await post(admin, {})).status).toBe(422);
    expect(JSON.stringify((await post(admin, { name: 'Honeymoon & Romantic' })).body)).not.toContain('nameKey');
  });
});

describe('reading categories', () => {
  it('the public sees active categories only, a manager can ask for the rest, and an old frontend id works', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    await TourCategory.create({ name: 'Beach & Resort', nameKey: 'beach & resort', slug: 'beach-and-resort', legacyId: 'cat_beach' });
    await TourCategory.create({ name: 'Old One', nameKey: 'old one', slug: 'old-one', isActive: false });

    const publicList = await request(app).get('/api/tour-categories');
    expect(publicList.body.data.map((c) => c.name)).toEqual(['Beach & Resort']);
    expect(publicList.body.meta).toMatchObject({ total: 1, page: 1 });

    const asCustomer = await request(app).get('/api/tour-categories?includeInactive=true').set(bearer(await createUser({ role: ROLES.B2C })));
    expect(asCustomer.body.data).toHaveLength(1); // asking is not enough

    const asAdmin = await request(app).get('/api/tour-categories?includeInactive=true').set(bearer(admin));
    expect(asAdmin.body.data.map((c) => c.name)).toEqual(['Beach & Resort', 'Old One']);

    const byLegacy = await request(app).get('/api/tour-categories/cat_beach');
    expect(byLegacy.status).toBe(200);
    expect(byLegacy.body.data).toMatchObject({ name: 'Beach & Resort', legacyId: 'cat_beach' });
    expect((await request(app).get('/api/tour-categories/cat_nope')).status).toBe(404);
  });

  it('an inactive category is a 404 for the public and readable by a manager', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const off = await TourCategory.create({ name: 'Old One', nameKey: 'old one', slug: 'old-one', isActive: false });

    expect((await request(app).get(`/api/tour-categories/${off._id}`)).status).toBe(404);
    expect((await request(app).get(`/api/tour-categories/${off._id}`).set(bearer(admin))).status).toBe(200);
  });

  it('search is a plain text match, never a pattern', async () => {
    await TourCategory.create({ name: 'Beach & Resort', nameKey: 'beach & resort', slug: 'beach-and-resort' });

    expect((await request(app).get('/api/tour-categories?search=beach')).body.data).toHaveLength(1);
    expect((await request(app).get('/api/tour-categories?search=.*')).body.data).toHaveLength(0);
  });
});

describe('removing a category', () => {
  it('switches it off, refuses while active tours use it, and brings it back when the name is created again', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const created = await post(admin, { name: 'City Break' });
    const id = created.body.data._id;
    const tour = await Tour.create({ name: 'Dhaka Walk', country: 'Bangladesh', destination: 'Dhaka', category: id, durationDays: 1, priceCurrency: 'BDT', price: 1000, description: 'd' });

    const blocked = await request(app).delete(`/api/tour-categories/${id}`).set(bearer(admin));
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CATEGORY_IN_USE');
    expect((await TourCategory.findById(id)).isActive).toBe(true);

    await Tour.updateOne({ _id: tour._id }, { status: 'archived' }); // an archived tour no longer counts
    const removed = await request(app).delete(`/api/tour-categories/${id}`).set(bearer(admin));
    expect(removed.status).toBe(200);
    expect(removed.body.data.isActive).toBe(false);
    expect((await request(app).get('/api/tour-categories')).body.data).toHaveLength(0);
    expect((await request(app).delete(`/api/tour-categories/${id}`).set(bearer(admin))).status).toBe(200); // repeating is harmless

    const again = await post(admin, { name: 'city break' });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ _id: id, isActive: true });
    expect(await TourCategory.countDocuments()).toBe(1);
  });

  it('a missing or malformed id answers 404 or 422', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });

    expect((await request(app).delete('/api/tour-categories/64b7f0f0f0f0f0f0f0f0f0f0').set(bearer(admin))).status).toBe(404);
    expect((await request(app).delete('/api/tour-categories/x').set(bearer(admin))).status).toBe(422);
  });

  it('writes an audit entry for each change and none for a repeat', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const { body } = await post(admin, { name: 'Adventure & Trekking' });
    await post(admin, { name: 'Adventure & Trekking' });
    await request(app).delete(`/api/tour-categories/${body.data._id}`).set(bearer(admin));
    await request(app).delete(`/api/tour-categories/${body.data._id}`).set(bearer(admin));

    const actions = (await AuditLog.find({ resource: `tour-category:${body.data._id}` }).sort({ createdAt: 1 }).lean()).map((a) => a.action);
    expect(actions).toEqual(['CATEGORY_CREATED', 'CATEGORY_DEACTIVATED']);
  });
});

describe('the seed script (npm run seed:tours)', () => {
  const { seedTours, CATEGORIES } = require('../../scripts/seedTours');

  it('creates the 8 starting categories and the sample tour once, keeping the old frontend ids', async () => {
    const first = await seedTours();

    expect(first.categories).toHaveLength(8);
    expect(first.tours).toEqual(["Cox's Bazar Beach Escape"]);
    expect(await TourCategory.countDocuments()).toBe(8);
    expect((await TourCategory.find().lean()).map((c) => c.legacyId).sort()).toEqual(CATEGORIES.map(([id]) => id).sort());

    const sample = await request(app).get('/api/tours/tour_205');
    expect(sample.status).toBe(200);
    expect(sample.body.data).toMatchObject({ name: "Cox's Bazar Beach Escape", status: 'published', price: 12500, durationDays: 3 });
    expect(sample.body.data.category).toMatchObject({ legacyId: 'cat_beach' });
    expect(sample.body.data.itinerary.map((d) => d.day)).toEqual([1, 2, 3]);
    expect(sample.body.data).not.toHaveProperty('b2bPrice'); // public view
  });

  it('running it again changes nothing, and leaves an edited tour as it is', async () => {
    await seedTours();
    await Tour.updateOne({ legacyId: 'tour_205' }, { price: 15000 });

    const second = await seedTours();

    expect(second).toEqual({ categories: [], tours: [] });
    expect(await TourCategory.countDocuments()).toBe(8);
    expect(await Tour.countDocuments()).toBe(1);
    expect((await Tour.findOne({ legacyId: 'tour_205' })).price).toBe(15000);
  });

  it('does not add a second copy of a category an admin already made by name', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    await post(admin, { name: 'beach & resort' });

    const result = await seedTours();

    expect(result.categories).toHaveLength(7);
    expect(await TourCategory.countDocuments()).toBe(8);
  });
});
