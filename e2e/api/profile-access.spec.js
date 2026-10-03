const { test, expect } = require('../helpers/test');
const { bearer, phoneFor, json, signUpCustomer, signUpAgency, createStaff, adminSession } = require('../helpers/api');

// The rule: a profile can be changed by the person themselves and by an admin. Nobody else.

const SELF = { B2C: '/api/b2c/profile', B2B: '/api/b2b/profile', STAFF: '/api/staff/profile', ADMIN: '/api/admin/profile' };

const meOf = async (ctx, token) => (await json(await ctx.get('/api/auth/me', { headers: bearer(token) }))).data.user;

const makeActors = async (client) => {
  const ctx = await client();
  const admin = await adminSession(ctx);
  const customer = await signUpCustomer(await client(), { name: 'Customer One', phone: phoneFor() });
  const agency = await signUpAgency(await client());
  const staff = await createStaff(admin.token, { permissions: ['USER_VIEW', 'USER_MANAGE', 'B2B_MANAGE', 'B2B_VIEW'] });
  return { ctx, admin, customer, agency, staff };
};

test.describe('a person changes their own profile, and only their own', () => {
  test('every role can, through its own route', async ({ client }) => {
    const { ctx, admin, customer, agency, staff } = await makeActors(client);
    const tokens = { B2C: customer.token, B2B: agency.token, STAFF: staff.token, ADMIN: admin.token };

    for (const [role, url] of Object.entries(SELF)) {
      const res = await ctx.patch(url, { headers: bearer(tokens[role]), data: { name: `Renamed ${role}` } });
      expect({ role, status: res.status() }).toEqual({ role, status: 200 });
      expect((await meOf(ctx, tokens[role])).name).toBe(`Renamed ${role}`);
    }
  });

  test('an id in the body or the URL never reaches another person', async ({ client }) => {
    const { ctx, admin, customer, agency, staff } = await makeActors(client);
    const before = [await meOf(ctx, staff.token), await meOf(ctx, agency.token), await meOf(ctx, admin.token)];

    // body: foreign ids and an email are ignored; only the caller changes
    const res = await ctx.patch(SELF.B2C, {
      headers: bearer(customer.token),
      data: { name: 'Hijack', _id: before[2]._id, id: before[0]._id, userId: before[1]._id, email: 'hijack@e2e.test' }
    });
    expect(res.status()).toBe(200);
    const me = await meOf(ctx, customer.token);
    expect(me.name).toBe('Hijack');
    expect(me.email).toBe(customer.email);

    // URL: no route names another person. The answer is 404, or 403 where a router-level guard
    // (a still-pending agency) stops the request first. It is never a success.
    const tokens = { B2C: customer.token, B2B: agency.token, STAFF: staff.token, ADMIN: admin.token };
    for (const [role, url] of Object.entries(SELF)) {
      const res = await ctx.patch(`${url}/${before[0]._id}`, { headers: bearer(tokens[role]), data: { name: 'Valid Name' } });
      expect({ role, refused: [403, 404].includes(res.status()) }).toEqual({ role, refused: true });
    }

    // nobody else changed
    expect([await meOf(ctx, staff.token), await meOf(ctx, agency.token), await meOf(ctx, admin.token)]).toEqual(before);
  });

  test('role, status, permissions and partner cannot be changed through any profile', async ({ client }) => {
    const { ctx, customer, staff } = await makeActors(client);
    const staffBefore = await meOf(ctx, staff.token);

    await ctx.patch(SELF.B2C, { headers: bearer(customer.token), data: { role: 'ADMIN', status: 'ACTIVE', permissions: ['USER_MANAGE'], partnerId: '64b7f0f0f0f0f0f0f0f0f0f0' } });
    await ctx.patch(SELF.STAFF, { headers: bearer(staff.token), data: { role: 'ADMIN', permissions: [] } });

    expect(await meOf(ctx, customer.token)).toMatchObject({ role: 'B2C', permissions: [] });
    expect(await meOf(ctx, staff.token)).toMatchObject({ role: 'STAFF', permissions: staffBefore.permissions });
  });

  test('every role is refused on the other roles\' profile routes', async ({ client }) => {
    const { ctx, admin, customer, agency, staff } = await makeActors(client);
    const actors = { B2C: customer.token, B2B: agency.token, STAFF: staff.token, ADMIN: admin.token };

    for (const [role, token] of Object.entries(actors)) {
      for (const [routeRole, url] of Object.entries(SELF)) {
        if (routeRole === role) continue;
        const res = await ctx.patch(url, { headers: bearer(token), data: { name: 'Cross Role' } });
        expect({ role, url, status: res.status() }).toEqual({ role, url, status: 403 });
      }
    }
  });
});

test.describe('only an admin changes someone else', () => {
  test('customers, agencies and staff (even with every permission) are refused, and nothing changes', async ({ client }) => {
    const { ctx, admin, customer, agency, staff } = await makeActors(client);
    const victim = customer.user._id;
    const before = await meOf(ctx, customer.token);

    for (const who of [customer, agency, staff]) {
      const editUser = await ctx.patch(`/api/admin/users/${who === customer ? admin.user._id : victim}`, { headers: bearer(who.token), data: { name: 'Defaced' } });
      const editAgency = await ctx.patch(`/api/admin/b2b/${agency.partner._id}`, { headers: bearer(who.token), data: { companyName: 'Defaced Ltd' } });
      expect([editUser.status(), editAgency.status()]).toEqual([403, 403]);
    }
    expect((await ctx.patch(`/api/admin/users/${victim}`, { data: { name: 'Defaced' } })).status()).toBe(401);
    expect(await meOf(ctx, customer.token)).toEqual(before);
  });

  test('an admin can fix a person\'s name and phone, and the audit log records which fields', async ({ client }) => {
    const { ctx, admin, customer } = await makeActors(client);
    const newPhone = phoneFor();

    const res = await ctx.patch(`/api/admin/users/${customer.user._id}`, { headers: bearer(admin.token), data: { name: 'Edited By Admin', phone: newPhone, email: 'takeover@e2e.test', role: 'ADMIN' } });

    expect(res.status()).toBe(200);
    expect(await meOf(ctx, customer.token)).toMatchObject({ name: 'Edited By Admin', phone: newPhone, phoneVerified: false, email: customer.email, role: 'B2C' });

    const logs = await json(await ctx.get(`/api/admin/audit-logs?action=PROFILE_UPDATED&targetUserId=${customer.user._id}`, { headers: bearer(admin.token) }));
    expect(logs.data).toHaveLength(1);
    expect(logs.data[0].actorUserId).toBe(admin.user._id);
    expect(logs.data[0].meta.fields).toEqual(['name', 'phone']);
    expect(JSON.stringify(logs)).not.toContain(newPhone); // field names, never the values
  });

  test('an admin can fix an agency\'s business record, including what the owner cannot change', async ({ client }) => {
    const { ctx, admin, agency } = await makeActors(client);

    // the owner cannot rename the company or change the license
    await ctx.patch(SELF.B2B, { headers: bearer(agency.token), data: { companyName: 'Owner Rename', licenseNo: 'OWNER-LIC', address: '9 New Road, Dhaka' } });
    const afterOwner = await json(await ctx.get('/api/b2b/profile', { headers: bearer(agency.token) }));
    expect(afterOwner.data.partner).toMatchObject({ companyName: agency.form.companyName, licenseNo: agency.form.licenseNo, address: '9 New Road, Dhaka' });

    // the admin can
    const res = await ctx.patch(`/api/admin/b2b/${agency.partner._id}`, { headers: bearer(admin.token), data: { companyName: 'Admin Renamed Ltd', licenseNo: `${agency.form.licenseNo}-B` } });
    expect(res.status()).toBe(200);
    expect((await json(res)).data).toMatchObject({ companyName: 'Admin Renamed Ltd', approvalStatus: 'PENDING' });
  });

  test('duplicates, empty changes and bad ids are refused', async ({ client }) => {
    const { ctx, admin, customer, agency } = await makeActors(client);
    const other = await signUpAgency(await client());

    expect((await ctx.patch(`/api/admin/users/${customer.user._id}`, { headers: bearer(admin.token), data: {} })).status()).toBe(422);
    expect((await ctx.patch('/api/admin/users/not-an-id', { headers: bearer(admin.token), data: { name: 'Valid Name' } })).status()).toBe(422);
    expect((await ctx.patch('/api/admin/users/64b7f0f0f0f0f0f0f0f0f0f0', { headers: bearer(admin.token), data: { name: 'Valid Name' } })).status()).toBe(404);
    expect((await ctx.patch(`/api/admin/users/${customer.user._id}`, { headers: bearer(admin.token), data: { phone: agency.form.phone } })).status()).toBe(409);
    expect((await ctx.patch(`/api/admin/b2b/${agency.partner._id}`, { headers: bearer(admin.token), data: { licenseNo: other.form.licenseNo } })).status()).toBe(409);
  });
});
