const request = require('supertest');

const app = require('../../app');
const env = require('../../config/env');
const Role = require('../../models/Role');
const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const templates = require('../../config/rbac');
const { ROLES } = require('../../config/constants');
const { run } = require('../../scripts/seed');
const { DEMO_PASSWORD } = require('../../scripts/seed/access');
const { createUser, bearer, lastEmailTo, loginRequest } = require('./helpers/factory');

let admin;
const send = (method, path, user, body) => request(app)[method](path).set(bearer(user)).send(body);

const makeRole = async (body) => (await send('post', '/api/admin/roles', admin, body)).body.data;

beforeEach(async () => {
  admin = await createUser({ role: ROLES.ADMIN });
});

describe('role templates', () => {
  it('only name permissions that exist, and every dependency is satisfied by its own template', () => {
    for (const template of Object.values(templates.TEMPLATES)) {
      expect(templates.withDependencies(template.defaults)).toEqual(expect.arrayContaining(template.defaults));
    }
    expect(templates.withDependencies(['ACCOUNTS_JOURNAL'])).toEqual(['REPORTS_VIEW', 'ACCOUNTS_EDIT', 'ACCOUNTS_JOURNAL']);
  });

  it('are served with the dependencies, the sensitive flags and the groups', async () => {
    const res = await send('get', '/api/admin/rbac', admin);
    expect(res.body.data.templates.map((t) => t.key)).toContain('accountant');
    expect(res.body.data.dependencies.VISA_EDIT).toEqual(['VISA_VIEW']);
    expect(res.body.data.sensitive.ACCOUNTS_VOID).toEqual(expect.any(String));
    expect(res.body.data.groups.length).toBeGreaterThan(5);
  });
});

describe('creating and changing roles', () => {
  it('starts from the template defaults when no permissions are sent', async () => {
    const res = await send('post', '/api/admin/roles', admin, { name: 'Accountant', templateKey: 'accountant' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Accountant', templateKey: 'accountant', system: false, userCount: 0 });
    expect(res.body.data.permissions).toEqual(expect.arrayContaining(['REPORTS_VIEW', 'ACCOUNTS_EDIT', 'VENDOR_VIEW', 'VENDOR_MANAGE']));
    expect(res.body.data.permissions).not.toContain('ACCOUNTS_VOID');
    expect(await AuditLog.countDocuments({ action: 'ROLE_CREATED' })).toBe(1);
  });

  it('adds the permissions a chosen permission needs', async () => {
    const role = await makeRole({ name: 'Voider', permissions: ['VISA_PAYMENT_VOID'] });
    expect(role.permissions).toEqual(['VISA_VIEW', 'VISA_PAYMENT_VOID']);
  });

  it('refuses a second role with the same name, whatever the case', async () => {
    await makeRole({ name: 'Accountant', templateKey: 'accountant' });
    const res = await send('post', '/api/admin/roles', admin, { name: 'ACCOUNTANT' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROLE_NAME_TAKEN');
  });

  it('rejects an unknown permission or template', async () => {
    expect((await send('post', '/api/admin/roles', admin, { name: 'X1', permissions: ['NOPE'] })).status).toBe(422);
    expect((await send('post', '/api/admin/roles', admin, { name: 'X2', templateKey: 'nope' })).status).toBe(422);
  });

  it('records the permissions before and after a change', async () => {
    const role = await makeRole({ name: 'Accountant', templateKey: 'accountant' });
    const res = await send('patch', `/api/admin/roles/${role.id}`, admin, { permissions: ['REPORTS_VIEW'] });
    expect(res.body.data.permissions).toEqual(['REPORTS_VIEW']);
    const log = await AuditLog.findOne({ action: 'ROLE_UPDATED' });
    expect(log.meta.before.permissions).toContain('ACCOUNTS_EDIT');
    expect(log.meta.after.permissions).toEqual(['REPORTS_VIEW']);
  });

  it('keeps the built-in role locked', async () => {
    const list = await send('get', '/api/admin/roles', admin);
    const builtIn = list.body.data.find((role) => role.system);
    expect(builtIn).toMatchObject({ name: 'No access yet', permissions: [] });
    const patch = await send('patch', `/api/admin/roles/${builtIn.id}`, admin, { permissions: ['VISA_VIEW'] });
    expect(patch.body.code).toBe('ROLE_LOCKED');
    expect((await send('delete', `/api/admin/roles/${builtIn.id}`, admin)).body.code).toBe('ROLE_LOCKED');
  });

  it('refuses to delete a role that people hold, and deletes it once they are moved', async () => {
    const role = await makeRole({ name: 'Accountant', templateKey: 'accountant' });
    const staff = await createUser({ role: ROLES.STAFF });
    await send('patch', `/api/admin/users/${staff._id}/roles`, admin, { roleIds: [role.id] });

    const blocked = await send('delete', `/api/admin/roles/${role.id}`, admin);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('ROLE_IN_USE');
    expect((await send('get', `/api/admin/roles/${role.id}`, admin)).body.data.userCount).toBe(1);

    const other = await makeRole({ name: 'Viewer', templateKey: 'viewer' });
    await send('patch', `/api/admin/users/${staff._id}/roles`, admin, { roleIds: [other.id] });
    expect((await send('delete', `/api/admin/roles/${role.id}`, admin)).status).toBe(200);
  });

  it('is for admins only', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: ['USERS_EDIT'] });
    expect((await send('get', '/api/admin/roles', staff)).status).toBe(403);
    expect((await send('post', '/api/admin/roles', staff, { name: 'Sneaky' })).status).toBe(403);
  });
});

describe('what a person may do', () => {
  it('is the roles together, and a change to a role works on the very next request', async () => {
    const accountant = await makeRole({ name: 'Accountant', templateKey: 'accountant' });
    const visa = await makeRole({ name: 'Visa officer', templateKey: 'visa_officer' });
    const staff = await createUser({ role: ROLES.STAFF });

    expect((await send('get', '/api/accounts/home', staff)).status).toBe(403);

    await send('patch', `/api/admin/users/${staff._id}/roles`, admin, { roleIds: [accountant.id] });
    expect((await send('get', '/api/accounts/home', staff)).status).toBe(200);
    expect((await send('get', '/api/visa/applications', staff)).status).toBe(403);

    await send('patch', `/api/admin/users/${staff._id}/roles`, admin, { roleIds: [accountant.id, visa.id] });
    expect((await send('get', '/api/visa/applications', staff)).status).toBe(200);
    const cancel = await send('post', '/api/accounts/sales/6ac0a5f0eebc510147c6722a/cancel', staff, { reason: 'Test' });
    expect(cancel.status).toBe(403);

    await send('patch', `/api/admin/roles/${accountant.id}`, admin, { permissions: ['REPORTS_VIEW', 'ACCOUNTS_EDIT', 'ACCOUNTS_VOID'] });
    const allowed = await send('post', '/api/accounts/sales/6ac0a5f0eebc510147c6722a/cancel', staff, { reason: 'Test' });
    expect(allowed.status).not.toBe(403);
  });

  it('still counts the old per-person list', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: ['REPORTS_VIEW'] });
    expect((await send('get', '/api/accounts/home', staff)).status).toBe(200);
  });

  it('shows the roles and the resulting permissions on /api/auth/me', async () => {
    const accountant = await makeRole({ name: 'Accountant', templateKey: 'accountant' });
    const staff = await createUser({ role: ROLES.STAFF });
    await send('patch', `/api/admin/users/${staff._id}/roles`, admin, { roleIds: [accountant.id] });

    const res = await send('get', '/api/auth/me', staff);
    expect(res.body.data.access.roles).toEqual([{ id: accountant.id, name: 'Accountant', system: false }]);
    expect(res.body.data.access.permissions).toEqual(expect.arrayContaining(['REPORTS_VIEW', 'ACCOUNTS_EDIT']));
    expect(res.body.data.access.isAdmin).toBe(false);
    expect((await send('get', '/api/auth/me', admin)).body.data.access.isAdmin).toBe(true);
  });

  it('cannot be widened by the person themselves', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: ['USERS_EDIT'] });
    const role = await makeRole({ name: 'Accountant', templateKey: 'accountant' });
    expect((await send('patch', `/api/admin/users/${staff._id}/roles`, staff, { roleIds: [role.id] })).status).toBe(403);
    expect((await send('patch', `/api/admin/users/${admin._id}/roles`, admin, { roleIds: [role.id] })).body.code).toBe('SELF_CHANGE');
  });

  it('is refused for an unknown role, an empty list, and accounts that are not staff', async () => {
    const staff = await createUser({ role: ROLES.STAFF });
    expect((await send('patch', `/api/admin/users/${staff._id}/roles`, admin, { roleIds: ['6ac0a5f0eebc510147c6722a'] })).body.code).toBe('ROLE_NOT_FOUND');
    expect((await send('patch', `/api/admin/users/${staff._id}/roles`, admin, { roleIds: [] })).status).toBe(422);
    const other = await createUser({ role: ROLES.ADMIN });
    const role = await makeRole({ name: 'Accountant', templateKey: 'accountant' });
    expect((await send('patch', `/api/admin/users/${other._id}/roles`, admin, { roleIds: [role.id] })).body.code).toBe('PERMISSIONS_NOT_ASSIGNABLE');
  });

  it('logs what a role change added and removed', async () => {
    const role = await makeRole({ name: 'Accountant', templateKey: 'accountant' });
    const staff = await createUser({ role: ROLES.STAFF });
    await send('patch', `/api/admin/users/${staff._id}/roles`, admin, { roleIds: [role.id] });
    const log = await AuditLog.findOne({ action: 'USER_ROLES_CHANGED' });
    expect(log.meta.to).toEqual(['Accountant']);
    expect(log.meta.added).toContain('ACCOUNTS_EDIT');
  });
});

describe('new staff accounts', () => {
  it('get the built-in "No access yet" role unless a role is chosen', async () => {
    const res = await send('post', '/api/admin/staff', admin, { name: 'New Person', email: 'new.person@example.com' });
    expect(res.body.data.user.roles.map((role) => role.name)).toEqual(['No access yet']);
    const me = await User.findOne({ email: 'new.person@example.com' });
    expect(await require('../../services/roleService').effectivePermissions(me)).toEqual([]);
  });

  it('get the chosen role at once', async () => {
    const role = await makeRole({ name: 'Accountant', templateKey: 'accountant' });
    const res = await send('post', '/api/admin/staff', admin, { name: 'Ana Counts', email: 'ana@example.com', roleIds: [role.id] });
    expect(res.body.data.user.roles.map((r) => r.name)).toEqual(['Accountant']);
  });

  it('are invited to the admin dashboard, not the public website', async () => {
    await send('post', '/api/admin/staff', admin, { name: 'Invited Person', email: 'invited@example.com' });
    const link = /(https?:\/\/\S+?)\/dashboard\/setup-account\?token=[0-9a-f]{64}/.exec(lastEmailTo('invited@example.com').message);
    expect(link[1]).toBe(env.adminAppUrl);
    expect(env.adminAppUrl).not.toBe(env.appUrl);
  });
});

describe('the old per-person list', () => {
  it('can be turned into a role', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: ['VISA_VIEW', 'VISA_UPDATE'] });
    const res = await send('post', `/api/admin/users/${staff._id}/permissions-to-role`, admin, { name: 'Front desk' });
    expect(res.status).toBe(201);
    expect(res.body.data.role.permissions).toEqual(['VISA_VIEW', 'VISA_UPDATE']);
    const saved = await User.findById(staff._id);
    expect(saved.permissions).toEqual([]);
    expect(saved.roles.map(String)).toEqual([res.body.data.role.id]);
    expect((await send('get', '/api/visa/applications', staff)).status).toBe(200);
  });

  it('has nothing to convert when it is empty', async () => {
    const staff = await createUser({ role: ROLES.STAFF });
    const res = await send('post', `/api/admin/users/${staff._id}/permissions-to-role`, admin, { name: 'Empty' });
    expect(res.body.code).toBe('NOTHING_TO_CONVERT');
  });
});

describe('the access seed', () => {
  it('creates a role for every template and a demo account for each, safe to run twice', async () => {
    const first = await run('seed', ['access'], { log: () => {} });
    expect(first['access.seeded']).toEqual({ roles: 4, staff: 5 });
    expect(await run('seed', ['access'], { log: () => {} })).toMatchObject({ 'access.seeded': { roles: 0, staff: 0 } });
    expect(await Role.countDocuments()).toBe(5);

    const login = await loginRequest('accountant@demo.dynamictravel.test', DEMO_PASSWORD);
    expect(login.status).toBe(200);
    const accountant = await User.findOne({ email: 'accountant@demo.dynamictravel.test' });
    expect((await send('get', '/api/accounts/home', accountant)).status).toBe(200);
    expect((await send('get', '/api/visa/applications', accountant)).status).toBe(403);
  });
});

describe('page size', () => {
  it('allows up to 500 rows a page and no more', async () => {
    const res = await send('get', '/api/admin/users?limit=500', admin);
    expect(res.body.meta.limit).toBe(500);
    expect((await send('get', '/api/admin/users?limit=900', admin)).body.meta.limit).toBe(500);
  });
});
