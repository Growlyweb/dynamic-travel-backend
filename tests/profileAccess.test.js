const request = require('supertest');

const app = require('../app');
const User = require('../models/User');
const Partner = require('../models/Partner');
const AuditLog = require('../models/AuditLog');
const { ROLES } = require('../config/constants');
const { PERMISSIONS } = require('../config/rbac');
const { createUser, createB2B, bearer } = require('./helpers/factory');

// The rule: a profile can be changed by the person themselves and by an admin. Nobody else.

const SELF_ROUTE = {
  [ROLES.B2C]: '/api/b2c/profile',
  [ROLES.B2B]: '/api/b2b/profile',
  [ROLES.STAFF]: '/api/staff/profile',
  [ROLES.ADMIN]: '/api/admin/profile'
};

const makeActors = async () => {
  const { user: b2b, partner } = await createB2B();
  return {
    b2c: await createUser({ role: ROLES.B2C, name: 'Customer One', phone: '+8801700000001' }),
    b2b,
    partner,
    staff: await createUser({ role: ROLES.STAFF, name: 'Staff One', phone: '+8801700000003', permissions: Object.values(PERMISSIONS) }),
    admin: await createUser({ role: ROLES.ADMIN, name: 'Admin One', phone: '+8801700000004' })
  };
};

const snapshot = async (user) => {
  const u = await User.findById(user._id).lean();
  return { name: u.name, phone: u.phone, email: u.email, role: u.role, status: u.status, permissions: u.permissions };
};

describe('a person can change their OWN profile', () => {
  it.each(Object.entries(SELF_ROUTE))('%s through %s', async (role, url) => {
    const actors = await makeActors();
    const me = { [ROLES.B2C]: actors.b2c, [ROLES.B2B]: actors.b2b, [ROLES.STAFF]: actors.staff, [ROLES.ADMIN]: actors.admin }[role];

    const res = await request(app).patch(url).set(bearer(me)).send({ name: 'New Name', phone: '+8801799999999' });

    expect(res.status).toBe(200);
    const after = await snapshot(me);
    expect(after).toMatchObject({ name: 'New Name', phone: '+8801799999999', role, email: me.email });
  });

  it('and cannot use the request to change anyone else: ids in the body are ignored', async () => {
    const actors = await makeActors();
    const victims = [actors.staff, actors.admin, actors.b2b];
    const before = await Promise.all(victims.map(snapshot));

    const res = await request(app)
      .patch('/api/b2c/profile')
      .set(bearer(actors.b2c))
      .send({ name: 'Hijack', _id: String(actors.admin._id), id: String(actors.staff._id), userId: String(actors.b2b._id), email: 'hijack@example.com' });

    expect(res.status).toBe(200);
    expect(await Promise.all(victims.map(snapshot))).toEqual(before);
    const me = await snapshot(actors.b2c);
    expect(me.name).toBe('Hijack'); // only the caller changed
    expect(me.email).toBe(actors.b2c.email); // and even they cannot change the email here
  });

  it('has no URL that names another person: an id on a profile path is a 404 for the right role', async () => {
    const actors = await makeActors();
    const owner = { [ROLES.B2C]: actors.b2c, [ROLES.B2B]: actors.b2b, [ROLES.STAFF]: actors.staff, [ROLES.ADMIN]: actors.admin };
    const victim = actors.b2c;

    for (const [role, url] of Object.entries(SELF_ROUTE)) {
      const target = role === ROLES.B2C ? actors.staff : victim; // never the caller's own id
      const res = await request(app).patch(`${url}/${target._id}`).set(bearer(owner[role])).send({ name: 'Valid Name' });
      expect({ url, status: res.status }).toEqual({ url, status: 404 });
    }
    expect((await snapshot(victim)).name).toBe('Customer One');
    expect((await snapshot(actors.staff)).name).toBe('Staff One');
  });

  it('cannot reach another role\'s profile route (wrong role is 403)', async () => {
    const actors = await makeActors();
    const byRole = { [ROLES.B2C]: actors.b2c, [ROLES.B2B]: actors.b2b, [ROLES.STAFF]: actors.staff, [ROLES.ADMIN]: actors.admin };

    for (const [role, user] of Object.entries(byRole)) {
      for (const [routeRole, url] of Object.entries(SELF_ROUTE)) {
        if (routeRole === role) continue;
        const res = await request(app).patch(url).set(bearer(user)).send({ name: 'Cross' });
        expect({ role, url, status: res.status }).toEqual({ role, url, status: 403 });
      }
    }
  });

  it('refuses a request with no token (401)', async () => {
    for (const url of Object.values(SELF_ROUTE)) {
      expect((await request(app).patch(url).send({ name: 'X' })).status).toBe(401);
    }
  });

  it('cannot touch role, status, permissions or partner through the profile', async () => {
    const { b2c, staff } = await makeActors();

    await request(app).patch('/api/b2c/profile').set(bearer(b2c)).send({ role: 'ADMIN', status: 'ACTIVE', permissions: ['USER_MANAGE'], partnerId: '64b7f0f0f0f0f0f0f0f0f0f0' });
    await request(app).patch('/api/staff/profile').set(bearer(staff)).send({ permissions: [], role: 'ADMIN' });

    expect((await snapshot(b2c)).role).toBe(ROLES.B2C);
    expect((await snapshot(b2c)).permissions).toEqual([]);
    const s = await snapshot(staff);
    expect(s.role).toBe(ROLES.STAFF);
    expect(s.permissions).toEqual(Object.values(PERMISSIONS));
  });
});

describe('nobody but an admin can change ANOTHER person\'s profile', () => {
  it.each([ROLES.B2C, ROLES.B2B, ROLES.STAFF])('%s is refused on every admin edit route, and nothing changes', async (role) => {
    const actors = await makeActors();
    const caller = { [ROLES.B2C]: actors.b2c, [ROLES.B2B]: actors.b2b, [ROLES.STAFF]: actors.staff }[role];
    const victim = role === ROLES.B2C ? actors.admin : actors.b2c;
    const beforeUser = await snapshot(victim);
    const beforePartner = await Partner.findById(actors.partner._id).lean();

    const editUser = await request(app).patch(`/api/admin/users/${victim._id}`).set(bearer(caller)).send({ name: 'Defaced' });
    const editPartner = await request(app).patch(`/api/admin/b2b/${actors.partner._id}`).set(bearer(caller)).send({ companyName: 'Defaced Ltd' });
    const adminProfile = await request(app).patch('/api/admin/profile').set(bearer(caller)).send({ name: 'Defaced' });
    const readOther = await request(app).get(`/api/admin/users/${victim._id}`).set(bearer(caller));

    expect([editUser.status, editPartner.status, adminProfile.status, readOther.status]).toEqual([403, 403, 403, 403]);
    expect(await snapshot(victim)).toEqual(beforeUser);
    expect((await Partner.findById(actors.partner._id).lean()).companyName).toBe(beforePartner.companyName);
  });

  it('staff are refused even when they hold every permission', async () => {
    const { staff, b2c } = await makeActors();
    expect(staff.permissions).toEqual(Object.values(PERMISSIONS));

    const res = await request(app).patch(`/api/admin/users/${b2c._id}`).set(bearer(staff)).send({ name: 'Defaced' });
    expect(res.status).toBe(403);
  });

  it('an anonymous caller is refused (401)', async () => {
    const { b2c, partner } = await makeActors();
    expect((await request(app).patch(`/api/admin/users/${b2c._id}`).send({ name: 'X' })).status).toBe(401);
    expect((await request(app).patch(`/api/admin/b2b/${partner._id}`).send({ companyName: 'X' })).status).toBe(401);
  });
});

describe('an ADMIN can change another person\'s profile', () => {
  let actors;
  let auth;
  beforeEach(async () => {
    actors = await makeActors();
    auth = bearer(actors.admin);
  });

  it.each([['b2c'], ['b2b'], ['staff']])('the name and phone of a %s account', async (key) => {
    const target = actors[key];

    const res = await request(app).patch(`/api/admin/users/${target._id}`).set(auth).send({ name: 'Edited By Admin', phone: '+8801788888888' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Edited By Admin', phone: '+8801788888888', role: target.role });
    expect(await snapshot(target)).toMatchObject({ name: 'Edited By Admin', phone: '+8801788888888', email: target.email, role: target.role });
  });

  it('another admin as well', async () => {
    const other = await createUser({ role: ROLES.ADMIN });
    const res = await request(app).patch(`/api/admin/users/${other._id}`).set(auth).send({ name: 'Second Admin' });
    expect(res.status).toBe(200);
    expect((await snapshot(other)).name).toBe('Second Admin');
  });

  it('marks a changed phone as unverified again', async () => {
    const target = await createUser({ role: ROLES.B2C, phone: '+8801711111111', phoneVerified: true });
    const res = await request(app).patch(`/api/admin/users/${target._id}`).set(auth).send({ phone: '+8801722222222' });
    expect(res.body.data).toMatchObject({ phone: '+8801722222222', phoneVerified: false });
  });

  it('can only change name and phone: email, role, status and permissions in the body are ignored', async () => {
    const target = actors.b2c;
    const before = await snapshot(target);

    await request(app)
      .patch(`/api/admin/users/${target._id}`)
      .set(auth)
      .send({ name: 'Only This', email: 'takeover@example.com', role: 'ADMIN', status: 'SUSPENDED', permissions: ['USER_MANAGE'], passwordHash: 'x' });

    expect(await snapshot(target)).toEqual({ ...before, name: 'Only This' });
  });

  it('writes an audit entry with the field names but not the values', async () => {
    await request(app).patch(`/api/admin/users/${actors.b2c._id}`).set(auth).send({ name: 'Audited', phone: '+8801766666666' });

    const log = await AuditLog.findOne({ action: 'PROFILE_UPDATED' }).lean();
    expect(String(log.actorUserId)).toBe(String(actors.admin._id));
    expect(String(log.targetUserId)).toBe(String(actors.b2c._id));
    expect(log.meta.fields).toEqual(['name', 'phone']);
    expect(JSON.stringify(log)).not.toContain('+8801766666666');
    expect(JSON.stringify(log)).not.toContain('Audited');
  });

  it('refuses an empty change, a malformed id, an unknown id and a phone that is already taken', async () => {
    expect((await request(app).patch(`/api/admin/users/${actors.b2c._id}`).set(auth).send({})).status).toBe(422);
    expect((await request(app).patch('/api/admin/users/not-an-id').set(auth).send({ name: 'Valid Name' })).status).toBe(422);
    expect((await request(app).patch('/api/admin/users/64b7f0f0f0f0f0f0f0f0f0f0').set(auth).send({ name: 'Valid Name' })).status).toBe(404);
    expect((await request(app).patch(`/api/admin/users/${actors.b2c._id}`).set(auth).send({ name: 'X' })).status).toBe(422); // too short
    expect((await request(app).patch(`/api/admin/users/${actors.b2c._id}`).set(auth).send({ phone: actors.staff.phone })).status).toBe(409);
    expect((await request(app).patch(`/api/admin/users/${actors.b2c._id}`).set(auth).send({ phone: 'abc' })).status).toBe(422);
  });

  it('changes an agency\'s business record, including the company name and license an owner cannot change', async () => {
    const res = await request(app)
      .patch(`/api/admin/b2b/${actors.partner._id}`)
      .set(auth)
      .send({ companyName: 'Renamed Ltd', licenseNo: 'NEW-LIC-1', businessType: 'Tour operator', address: '9 Dhanmondi, Dhaka' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ companyName: 'Renamed Ltd', licenseNo: 'NEW-LIC-1', businessType: 'Tour operator', address: '9 Dhanmondi, Dhaka' });
    const log = await AuditLog.findOne({ action: 'PROFILE_UPDATED', resource: `partner:${actors.partner._id}` }).lean();
    expect(log.meta.fields).toEqual(['companyName', 'licenseNo', 'businessType', 'address']);
  });

  it('keeps the approval state untouched when it edits the business record', async () => {
    const before = (await Partner.findById(actors.partner._id).lean()).approvalStatus;
    await request(app).patch(`/api/admin/b2b/${actors.partner._id}`).set(auth).send({ address: '1 New Street, Dhaka', approvalStatus: 'REJECTED' });
    expect((await Partner.findById(actors.partner._id).lean()).approvalStatus).toBe(before);
  });

  it('refuses a license number that belongs to another agency, and an empty change', async () => {
    const { partner: other } = await createB2B();

    expect((await request(app).patch(`/api/admin/b2b/${actors.partner._id}`).set(auth).send({ licenseNo: other.licenseNo })).status).toBe(409);
    expect((await request(app).patch(`/api/admin/b2b/${actors.partner._id}`).set(auth).send({})).status).toBe(422);
    expect((await request(app).patch('/api/admin/b2b/64b7f0f0f0f0f0f0f0f0f0f0').set(auth).send({ address: '1 New Street' })).status).toBe(404);
  });
});

describe('an ADMIN\'s own profile', () => {
  it('can be read and changed through /api/admin/profile', async () => {
    const admin = await createUser({ role: ROLES.ADMIN, name: 'Admin One' });

    const read = await request(app).get('/api/admin/profile').set(bearer(admin));
    expect(read.status).toBe(200);
    expect(read.body.data.user).toMatchObject({ role: ROLES.ADMIN, email: admin.email });

    const write = await request(app).patch('/api/admin/profile').set(bearer(admin)).send({ name: 'Renamed Admin' });
    expect(write.status).toBe(200);
    expect((await snapshot(admin)).name).toBe('Renamed Admin');
  });

  it('cannot be used to change a role or an email', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    await request(app).patch('/api/admin/profile').set(bearer(admin)).send({ name: 'Fine', role: 'STAFF', email: 'new@example.com', status: 'SUSPENDED' });

    expect(await snapshot(admin)).toMatchObject({ name: 'Fine', role: ROLES.ADMIN, email: admin.email, status: 'ACTIVE' });
  });
});
