const base = require('@playwright/test');
const { signUpCustomer, signUpAgency, createStaff, adminSession, newClient, bearer } = require('../helpers/api');

const { test, expect } = base;

// Every role against every protected route group, over real HTTP.
// 200 = allowed, 403 = signed in but the wrong role or no permission, 401 = no token.
// A B2B partner that is NOT approved is also checked against the operational route.
const MATRIX = [
  // route                      ADMIN STAFF B2B   B2C
  ['/api/auth/me', 200, 200, 200, 200],
  ['/api/admin/users', 200, 403, 403, 403],
  ['/api/admin/b2b', 200, 403, 403, 403],
  ['/api/admin/audit-logs', 200, 403, 403, 403],
  ['/api/admin/rbac', 200, 403, 403, 403],
  ['/api/admin/profile', 200, 403, 403, 403],
  ['/api/staff/profile', 403, 200, 403, 403],
  ['/api/staff/partners', 403, 403, 403, 403], // staff here have no permissions
  ['/api/b2b/profile', 403, 403, 200, 403],
  ['/api/b2b/documents', 403, 403, 200, 403],
  ['/api/b2b/overview', 403, 403, 403, 403], // this agency is still PENDING
  ['/api/b2c/profile', 403, 403, 403, 200],
  ['/api/membership-plans', 200, 403, 403, 403], // staff here have no MEMBERSHIP_MANAGE
  ['/api/memberships', 200, 403, 403, 403],
  ['/api/membership-stats', 200, 403, 403, 403],
  ['/api/membership-report/periods', 200, 403, 403, 403],
  ['/api/b2c/memberships', 403, 403, 403, 200], // a customer reads their own
  ['/api/tours/custom-requests', 200, 403, 403, 200] // admin reads all, a customer reads their own, staff here have no TOUR_MANAGE
];

test.describe('role matrix over real HTTP', () => {
  let ctx;
  let tokens;

  test.beforeAll(async () => {
    ctx = await newClient();
    const admin = await adminSession(ctx);
    tokens = {
      admin: admin.token,
      staff: (await createStaff(admin.token, { permissions: [] })).token,
      b2b: (await signUpAgency(await newClient())).token,
      b2c: (await signUpCustomer(await newClient())).token
    };
  });
  test.afterAll(async () => ctx.dispose());

  for (const [url, admin, staff, b2b, b2c] of MATRIX) {
    test(`${url}  ->  ADMIN ${admin}, STAFF ${staff}, B2B ${b2b}, B2C ${b2c}, anonymous 401`, async () => {
      const expected = { admin, staff, b2b, b2c };
      const got = {};
      for (const role of Object.keys(expected)) got[role] = (await ctx.get(url, { headers: bearer(tokens[role]) })).status();

      expect(got).toEqual(expected);
      expect((await ctx.get(url)).status()).toBe(401);
    });
  }
});
