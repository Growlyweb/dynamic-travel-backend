const { test, expect } = require('../helpers/test');
const {
  cfg, bearer, emailFor, mailCount, waitForMail, json,
  signUpCustomer, adminSession, createStaff, login, registerCustomer
} = require('../helpers/api');

test.describe('creating staff by invitation', () => {
  test('the invited person sets a password from the emailed link, once, and then logs in with their permissions', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const email = emailFor('invitee');

    const mark = mailCount();
    const created = await ctx.post('/api/admin/staff', { headers: bearer(admin.token), data: { name: 'Sara Staff', email, permissions: ['B2B_VIEW', 'DOCUMENT_VERIFY'] } });
    expect(created.status()).toBe(201);
    expect((await json(created)).data.user).toMatchObject({ role: 'STAFF', status: 'PENDING', permissions: ['B2B_VIEW', 'DOCUMENT_VERIFY'] });

    // no password yet: cannot log in
    expect((await login(ctx, email)).res.status()).toBe(401);

    const invite = await waitForMail(email, { after: mark });
    expect(invite.message).toMatch(/\/setup-account\?token=[0-9a-f]{64}/);
    const token = /token=([0-9a-f]+)/.exec(invite.message)[1];

    // a weak password is refused and the link survives
    expect((await ctx.post('/api/auth/setup-account', { data: { token, password: 'weak' } })).status()).toBe(422);
    expect((await ctx.post('/api/auth/setup-account', { data: { token, password: cfg.PASSWORD } })).status()).toBe(200);
    // the link works once
    expect((await ctx.post('/api/auth/setup-account', { data: { token, password: 'An0ther!Pass' } })).status()).toBe(400);

    const session = await login(ctx, email);
    expect(session.res.status()).toBe(200);
    const me = await json(await ctx.get('/api/auth/me', { headers: bearer(session.token) }));
    expect(me.data.user).toMatchObject({ role: 'STAFF', status: 'ACTIVE', emailVerified: true, permissions: ['B2B_VIEW', 'DOCUMENT_VERIFY'] });
  });

  test('a resent invitation cancels the previous link', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const email = emailFor('resend');
    const mark = mailCount();
    const created = await json(await ctx.post('/api/admin/staff', { headers: bearer(admin.token), data: { name: 'Resend Me', email } }));
    const oldToken = /token=([0-9a-f]+)/.exec((await waitForMail(email, { after: mark })).message)[1];

    const mark2 = mailCount();
    expect((await ctx.post(`/api/admin/users/${created.data.user._id}/resend-invite`, { headers: bearer(admin.token) })).status()).toBe(200);
    const newToken = /token=([0-9a-f]+)/.exec((await waitForMail(email, { after: mark2 })).message)[1];

    expect((await ctx.post('/api/auth/setup-account', { data: { token: oldToken, password: cfg.PASSWORD } })).status()).toBe(400);
    expect((await ctx.post('/api/auth/setup-account', { data: { token: newToken, password: cfg.PASSWORD } })).status()).toBe(200);
  });

  test('only ADMIN and STAFF can be created this way, and duplicates are refused', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const email = emailFor('dup');

    for (const role of ['B2B', 'B2C', 'SUPERUSER']) {
      const res = await ctx.post('/api/admin/users', { headers: bearer(admin.token), data: { name: 'Nope', email: emailFor('nope'), role } });
      expect({ role, status: res.status() }).toEqual({ role, status: 422 });
    }
    expect((await ctx.post('/api/admin/users', { headers: bearer(admin.token), data: { name: 'Second Admin', email, role: 'ADMIN' } })).status()).toBe(201);
    expect((await ctx.post('/api/admin/staff', { headers: bearer(admin.token), data: { name: 'Dup', email } })).status()).toBe(409);
  });
});

test.describe('permissions are checked on every request', () => {
  test('staff start with nothing, a granted permission works at once, a revoked one stops at once', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const staff = await createStaff(admin.token, { permissions: [] });
    const list = () => ctx.get('/api/staff/partners', { headers: bearer(staff.token) });
    const staffId = (await json(await ctx.get('/api/auth/me', { headers: bearer(staff.token) }))).data.user._id;

    expect((await list()).status()).toBe(403);

    const grant = await ctx.patch(`/api/admin/users/${staffId}/permissions`, { headers: bearer(admin.token), data: { permissions: ['B2B_VIEW'] } });
    expect(grant.status()).toBe(200);
    expect((await list()).status()).toBe(200); // same token, no new login

    await ctx.patch(`/api/admin/users/${staffId}/permissions`, { headers: bearer(admin.token), data: { permissions: [] } });
    expect((await list()).status()).toBe(403);
  });

  test('unknown permissions are refused and a customer cannot hold any', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const staff = await createStaff(admin.token);
    const customer = await signUpCustomer(await client());
    const staffId = (await json(await ctx.get('/api/auth/me', { headers: bearer(staff.token) }))).data.user._id;

    expect((await ctx.patch(`/api/admin/users/${staffId}/permissions`, { headers: bearer(admin.token), data: { permissions: ['DELETE_EVERYTHING'] } })).status()).toBe(422);
    const notStaff = await ctx.patch(`/api/admin/users/${customer.user._id}/permissions`, { headers: bearer(admin.token), data: { permissions: ['B2B_VIEW'] } });
    expect(notStaff.status()).toBe(409);
    expect((await json(notStaff)).code).toBe('PERMISSIONS_NOT_ASSIGNABLE');
  });
});

test.describe('account status', () => {
  test('a suspension cuts the live token, the refresh token and login at once; reactivation restores access', async ({ client }) => {
    const adminCtx = await client();
    const personCtx = await client();
    const admin = await adminSession(adminCtx);
    const person = await signUpCustomer(personCtx);
    const me = () => personCtx.get('/api/auth/me', { headers: bearer(person.token) });

    expect((await me()).status()).toBe(200);

    const suspend = await adminCtx.patch(`/api/admin/users/${person.user._id}/status`, { headers: bearer(admin.token), data: { status: 'SUSPENDED', reason: 'Chargeback dispute' } });
    expect(suspend.status()).toBe(200);

    expect((await me()).status()).toBe(401); // the token still has minutes left, and is already dead
    expect((await personCtx.post('/api/auth/refresh')).status()).toBe(401);
    const denied = await login(personCtx, person.email);
    expect(denied.res.status()).toBe(403);
    expect(denied.body.code).toBe('ACCOUNT_NOT_ACTIVE');

    await adminCtx.patch(`/api/admin/users/${person.user._id}/status`, { headers: bearer(admin.token), data: { status: 'ACTIVE' } });
    const back = await login(personCtx, person.email);
    expect(back.res.status()).toBe(200);
    expect((await personCtx.get('/api/auth/me', { headers: bearer(back.token) })).status()).toBe(200);
  });

  test('an admin cannot change their own status or role, and cannot activate a never-verified account', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const pending = await registerCustomer(await client());
    const pendingId = (await json(pending.res)).data.user._id;

    const self = await ctx.patch(`/api/admin/users/${admin.user._id}/status`, { headers: bearer(admin.token), data: { status: 'SUSPENDED' } });
    expect(self.status()).toBe(409);
    expect((await json(self)).code).toBe('SELF_CHANGE');
    expect((await ctx.patch(`/api/admin/users/${admin.user._id}/role`, { headers: bearer(admin.token), data: { role: 'STAFF' } })).status()).toBe(409);

    const unverified = await ctx.patch(`/api/admin/users/${pendingId}/status`, { headers: bearer(admin.token), data: { status: 'ACTIVE' } });
    expect(unverified.status()).toBe(409);
    expect((await json(unverified)).code).toBe('NOT_VERIFIED');
  });

  test('changing a role cancels the old tokens, and customers keep the role they registered as', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const staff = await createStaff(admin.token, { permissions: ['REPORT_VIEW'] });
    const customer = await signUpCustomer(await client());
    const staffId = (await json(await ctx.get('/api/auth/me', { headers: bearer(staff.token) }))).data.user._id;

    const promote = await ctx.patch(`/api/admin/users/${staffId}/role`, { headers: bearer(admin.token), data: { role: 'ADMIN' } });
    expect(promote.status()).toBe(200);
    expect((await json(promote)).data).toMatchObject({ role: 'ADMIN', permissions: [] });
    expect((await ctx.get('/api/staff/profile', { headers: bearer(staff.token) })).status()).toBe(401); // the old token is dead

    const reLogin = await login(ctx, staff.email);
    expect((await ctx.get('/api/admin/users', { headers: bearer(reLogin.token) })).status()).toBe(200); // now an admin

    const locked = await ctx.patch(`/api/admin/users/${customer.user._id}/role`, { headers: bearer(admin.token), data: { role: 'ADMIN' } });
    expect(locked.status()).toBe(409);
    expect((await json(locked)).code).toBe('ROLE_LOCKED');
  });

  test('deleting an account deactivates it and cuts its access', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const staff = await createStaff(admin.token);
    const staffId = (await json(await ctx.get('/api/auth/me', { headers: bearer(staff.token) }))).data.user._id;

    expect((await ctx.delete(`/api/admin/users/${staffId}`, { headers: bearer(admin.token) })).status()).toBe(200);

    const record = await json(await ctx.get(`/api/admin/users/${staffId}`, { headers: bearer(admin.token) }));
    expect(record.data.status).toBe('INACTIVE'); // soft delete: the record stays
    expect((await ctx.get('/api/staff/profile', { headers: bearer(staff.token) })).status()).toBe(401);
  });
});

test.describe('the audit trail and the roles catalog', () => {
  test('security events are recorded with who did what to whom', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const person = await signUpCustomer(await client());
    await ctx.patch(`/api/admin/users/${person.user._id}/status`, { headers: bearer(admin.token), data: { status: 'SUSPENDED' } });
    await ctx.patch(`/api/admin/users/${person.user._id}/status`, { headers: bearer(admin.token), data: { status: 'ACTIVE' } });

    const logs = await json(await ctx.get(`/api/admin/audit-logs?targetUserId=${person.user._id}&limit=50`, { headers: bearer(admin.token) }));
    const actions = logs.data.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['REGISTER', 'EMAIL_VERIFIED', 'LOGIN', 'ACCOUNT_SUSPENDED', 'ACCOUNT_ACTIVATED']));

    const suspension = logs.data.find((l) => l.action === 'ACCOUNT_SUSPENDED');
    expect(suspension.actorUserId).toBe(admin.user._id);
    expect(suspension.meta).toMatchObject({ from: 'ACTIVE', to: 'SUSPENDED' });
    expect(JSON.stringify(logs)).not.toMatch(/password|refreshToken|accessToken/i);
  });

  test('failed logins are recorded, filtered by action', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const person = await signUpCustomer(await client());
    await login(ctx, person.email, 'Wrong!Pass1');

    const failed = await json(await ctx.get(`/api/admin/audit-logs?action=LOGIN_FAILED&targetUserId=${person.user._id}`, { headers: bearer(admin.token) }));
    expect(failed.data).toHaveLength(1);
    expect(failed.data[0].result).toBe('FAILURE');
  });

  test('the roles and permissions catalog comes from rbac.json and is admin-only', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const staff = await createStaff(admin.token);

    const catalog = await json(await ctx.get('/api/admin/rbac', { headers: bearer(admin.token) }));
    expect(catalog.data.roles.map((r) => r.code)).toEqual(['ADMIN', 'STAFF', 'B2B', 'B2C']);
    expect(catalog.data.roles.find((r) => r.code === 'STAFF')).toMatchObject({ invitable: true, assignablePermissions: true, bypassPermissions: false });
    expect(catalog.data.permissions.map((p) => p.code)).toContain('DOCUMENT_VERIFY');

    expect((await ctx.get('/api/admin/rbac', { headers: bearer(staff.token) })).status()).toBe(403);
    expect((await ctx.get('/api/admin/rbac')).status()).toBe(401);
  });
});
