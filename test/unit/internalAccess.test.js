const request = require('supertest');

const app = require('../../app');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const { createUser, createB2B, bearer } = require('./helpers/factory');

// The admin dashboard numbers and the visa module are for internal users only. They once sat in the public
// part of the API, so anyone on the internet could read them and change visa countries and checklists.

const DASHBOARD = [
  ['get', '/api/dashboard/overview'],
  ['get', '/api/dashboard/visa-trend'],
  ['get', '/api/dashboard/tour-trend'],
  ['get', '/api/dashboard/recent-applications'],
  ['get', '/api/dashboard/recent-activities']
];

const ID = '6ac0a5f0eebc510147c67250';
const OTHER = '6ac0a5f0eebc510147c67251';

const VISA_READS = [
  ['get', '/api/visa/dashboard'],
  ['get', '/api/visa/staff'],
  ['get', '/api/visa/countries'],
  ['get', `/api/visa/countries/${ID}`],
  ['get', '/api/visa/types'],
  ['get', `/api/visa/types/${ID}`],
  ['get', `/api/visa/checklists/${ID}/${OTHER}/individual`],
  ['get', '/api/visa/statuses'],
  ['get', '/api/visa/applications'],
  ['get', `/api/visa/applications/${ID}`]
];

const VISA_WRITES = [
  ['post', '/api/visa/countries'],
  ['patch', `/api/visa/countries/${ID}`],
  ['delete', `/api/visa/countries/${ID}`],
  ['post', '/api/visa/types'],
  ['patch', `/api/visa/types/${ID}`],
  ['delete', `/api/visa/types/${ID}`],
  ['put', `/api/visa/checklists/${ID}/${OTHER}/individual`],
  ['post', '/api/visa/statuses'],
  ['patch', `/api/visa/statuses/${ID}`],
  ['delete', `/api/visa/statuses/${ID}`],
  ['post', '/api/visa/applications'],
  ['patch', `/api/visa/applications/${ID}`],
  ['post', `/api/visa/applications/${ID}/notes`],
  ['post', `/api/visa/applications/${ID}/payments`],
  ['post', `/api/visa/applications/${ID}/documents`],
  ['delete', `/api/visa/applications/${ID}/documents/${OTHER}`]
];

// Each of these needs its own permission, beyond VISA_VIEW or VISA_EDIT.
const VISA_STATUS = [['patch', `/api/visa/applications/${ID}/status`]];
const VISA_VOID = [['post', `/api/visa/applications/${ID}/payments/${OTHER}/void`]];
const VISA_REVIEW = [['patch', `/api/visa/applications/${ID}/documents/${OTHER}`]];
const VISA_FILE = [['get', `/api/visa/applications/${ID}/documents/${OTHER}/file`]];
const VISA_PASSPORT = [['patch', `/api/visa/applications/${ID}/passport`]];
const VISA_ALL = [...VISA_READS, ...VISA_WRITES, ...VISA_STATUS, ...VISA_VOID, ...VISA_REVIEW, ...VISA_FILE, ...VISA_PASSPORT];

const call = (method, path, headers = {}) => request(app)[method](path).set(headers).send({});

const statuses = async (routes, headers) => Promise.all(routes.map(([method, path]) => call(method, path, headers).then((res) => res.status)));

// "Let through" means the permission check passed. The result itself (200, 404, 422) is the module's business.
const letThrough = (results) => results.forEach((status) => expect([401, 403]).not.toContain(status));

describe('dashboard and visa routes need a login', () => {
  it.each([...DASHBOARD, ...VISA_ALL])('%s %s answers 401 without a token', async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
  });
});

describe('who may use them', () => {
  it('keeps customers and agencies out of everything', async () => {
    const b2c = await createUser({ role: ROLES.B2C });
    const { user: b2b } = await createB2B();

    for (const user of [b2c, b2b]) {
      const results = await statuses([...DASHBOARD, ...VISA_ALL], bearer(user));
      expect(new Set(results)).toEqual(new Set([403]));
    }
  });

  it('lets any staff member see the dashboard numbers, but gives them no visa access by default', async () => {
    const staff = await createUser({ role: ROLES.STAFF });

    expect(new Set(await statuses(DASHBOARD, bearer(staff)))).toEqual(new Set([200]));
    expect(new Set(await statuses(VISA_ALL, bearer(staff)))).toEqual(new Set([403]));
  });

  it('lets staff with VISA_VIEW read the visa module but not change it', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });

    letThrough(await statuses(VISA_READS, bearer(staff)));
    expect(new Set(await statuses([...VISA_WRITES, ...VISA_STATUS, ...VISA_VOID, ...VISA_REVIEW, ...VISA_PASSPORT], bearer(staff)))).toEqual(new Set([403]));
  });

  it('lets staff with VISA_EDIT change it (VISA_UPDATE, the status permission, is not enough)', async () => {
    const statusOnly = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_UPDATE] });
    const editor = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_EDIT] });

    expect(new Set(await statuses(VISA_WRITES, bearer(statusOnly)))).toEqual(new Set([403]));
    letThrough(await statuses(VISA_WRITES, bearer(editor)));
  });

  it('keeps status changes, payment voiding, document review, document download and passport updates behind their own permissions', async () => {
    const editor = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_EDIT] });
    expect(new Set(await statuses([...VISA_STATUS, ...VISA_VOID, ...VISA_REVIEW, ...VISA_FILE, ...VISA_PASSPORT], bearer(editor)))).toEqual(new Set([403]));

    const grants = [
      [PERMISSIONS.VISA_UPDATE, VISA_STATUS],
      [PERMISSIONS.VISA_PAYMENT_VOID, VISA_VOID],
      [PERMISSIONS.DOCUMENT_VERIFY, VISA_REVIEW],
      [PERMISSIONS.PASSPORT_UPDATE, VISA_PASSPORT]
    ];
    for (const [permission, routes] of grants) {
      const staff = await createUser({ role: ROLES.STAFF, permissions: [permission] });
      letThrough(await statuses(routes, bearer(staff)));
    }

    const viewerNoDocs = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const viewerWithDocs = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.DOCUMENT_VIEW] });
    expect(new Set(await statuses(VISA_FILE, bearer(viewerNoDocs)))).toEqual(new Set([403]));
    letThrough(await statuses(VISA_FILE, bearer(viewerWithDocs)));
  });

  it('lets an admin through everything', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });

    expect(new Set(await statuses(DASHBOARD, bearer(admin)))).toEqual(new Set([200]));
    letThrough(await statuses(VISA_ALL, bearer(admin)));
  });
});
