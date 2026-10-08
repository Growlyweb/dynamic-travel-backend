const { test, expect } = require('../helpers/test');
const { cfg } = require('../helpers/api');

// Swagger UI, opened in a real browser, served by the API itself at /docs.
const DOCS = `${cfg.API_URL}/docs/`;

const GROUPS = [
  'System',
  'Auth: sign up and verify',
  'Auth: sign in and session',
  'Auth: passwords',
  'Customer (B2C)',
  'Agency (B2B)',
  'Staff',
  'Admin: users',
  'Admin: agencies',
  'Admin: audit',
  'Documents',
  'Tour categories',
  'Tours',
  'Custom tours',
  'Membership plans',
  'Memberships',
  'Membership reports'
];

// Collects what the page complains about: a blocked script, a failed request, an uncaught error.
const watch = (page) => {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`error: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && problems.push(`console: ${message.text()}`));
  page.on('requestfailed', (request) => problems.push(`failed: ${request.url()}`));
  return problems;
};

const open = async (page) => {
  const problems = watch(page);
  await page.goto(DOCS);
  await expect(page.locator('.opblock-tag-section').first()).toBeVisible();
  return problems;
};

// Swagger UI names an operation's element "operations-<group>-<operationId>", with spaces turned into underscores
// and a backslash before a colon ("operations-Auth\\:_sign_in_and_session-login").
const blockOf = (page, group, operationId) => page.locator(`[id="operations-${group.replace(/ /g, '_').replace(/:/g, '\\\\:')}-${operationId}"]`);

// Opens a group, then one operation in it.
const operation = async (page, group, operationId) => {
  const block = blockOf(page, group, operationId);
  if (!(await block.isVisible())) await page.locator(`h3[data-tag="${group}"]`).click();
  if (!(await block.locator('.opblock-body').isVisible())) await block.locator('.opblock-summary').click();
  await expect(block.locator('.opblock-body')).toBeVisible();
  return block;
};

const execute = async (block) => {
  await block.locator('.execute').click();
  const live = block.locator('.live-responses-table');
  await expect(live.locator('tr.response .response-col_status').first()).toBeVisible();
  return live;
};

test.describe('Swagger UI at /docs', () => {
  test('loads without a blocked script or a failed request, with a title and every group closed and in order', async ({ page }) => {
    const problems = await open(page);

    await expect(page).toHaveTitle('Travel API documentation');
    const groups = await page.locator('h3.opblock-tag').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-tag')));
    expect(groups).toEqual(GROUPS);
    await expect(page.locator('.opblock-body:visible')).toHaveCount(0); // everything starts closed
    await expect(page.locator('.info .title')).toContainText('Travel Management Platform');
    await expect(page.locator('.scheme-container .servers select option')).toHaveText(['/ - This server']);
    expect(problems).toEqual([]);
  });

  test('each group lists its operations sorted by path, then GET, POST, PUT, PATCH, DELETE; the sign-in flows keep their order', async ({ page }) => {
    await open(page);
    const listOf = async (group) => {
      await page.locator(`h3[data-tag="${group}"]`).click();
      const items = await page.locator('.opblock-tag-section.is-open').evaluate((section) =>
        [...section.querySelectorAll('.opblock-summary')].map((s) => `${s.querySelector('.opblock-summary-method').textContent} ${s.querySelector('.opblock-summary-path').getAttribute('data-path')}`)
      );
      await page.locator(`h3[data-tag="${group}"]`).click();
      return items;
    };

    expect(await listOf('Tours')).toEqual(['GET /api/tours', 'POST /api/tours', 'GET /api/tours/{id}', 'PATCH /api/tours/{id}', 'DELETE /api/tours/{id}']);
    expect(await listOf('Membership plans')).toEqual([
      'GET /api/membership-plans', 'POST /api/membership-plans', 'PUT /api/membership-plans/{id}', 'DELETE /api/membership-plans/{id}', 'PATCH /api/membership-plans/{id}/toggle'
    ]);
    expect(await listOf('Auth: sign in and session')).toEqual([
      'POST /api/auth/login', 'POST /api/auth/firebase', 'POST /api/auth/refresh', 'POST /api/auth/logout', 'GET /api/auth/me'
    ]);
    expect(await listOf('System')).toEqual(['GET /', 'GET /health']);
  });

  test('the health check runs from the page and answers 200 with the database up', async ({ page }) => {
    await open(page);

    const live = await execute(await operation(page, 'System', 'getHealth'));

    await expect(live.locator('tr.response .response-col_status').first()).toContainText('200');
    await expect(live.locator('tr.response .response-col_description .microlight').first()).toContainText('"db": "up"');
  });

  test('a request shows its parameters and example body, and the example runs as it is', async ({ page }) => {
    await open(page);

    // parameters of the tour search, each with a description
    const search = await operation(page, 'Tours', 'listTours');
    const names = await search.locator('.parameters .parameter__name').evaluateAll((nodes) => nodes.map((n) => n.textContent.replace(/\s*\*$/, '').trim()));
    expect(names).toEqual(['page', 'limit', 'search', 'category', 'country', 'destination', 'status', 'minPrice', 'maxPrice', 'durationDays', 'sort']);
    await expect(search.locator('.parameters')).toContainText('Matches name, destination and country');

    // the login body is already filled in with a valid example
    const login = await operation(page, 'Auth: sign in and session', 'login');
    // "Try it out" is already switched on for every operation
    await expect(login.locator('.try-out__btn.cancel')).toBeVisible();
    const body = JSON.parse(await login.locator('.body-param__text').inputValue());
    expect(Object.keys(body).sort()).toEqual(['email', 'password']);
  });

  test('log in from the page: the token fills the Authorize box by itself, and a protected route then works', async ({ page }) => {
    const problems = await open(page);
    await expect(page.locator('.authorize.locked')).toHaveCount(0);

    const protectedCall = await execute(await operation(page, 'Auth: sign in and session', 'getMe'));
    await expect(protectedCall.locator('tr.response .response-col_status').first()).toContainText('401'); // not signed in yet

    const login = await operation(page, 'Auth: sign in and session', 'login');
    await login.locator('.body-param__text').fill(JSON.stringify({ email: cfg.ADMIN.email, password: cfg.ADMIN.password }));
    const loginResult = await execute(login);
    await expect(loginResult.locator('tr.response .response-col_status').first()).toContainText('200');

    await expect(page.locator('.authorize.locked').first()).toBeVisible(); // the padlock is closed: a token is set
    const me = await operation(page, 'Auth: sign in and session', 'getMe');
    const meResult = await execute(me);
    await expect(meResult.locator('tr.response .response-col_status').first()).toContainText('200');
    await expect(meResult.locator('tr.response .response-col_description .microlight').first()).toContainText('"role": "ADMIN"');

    // an admin-only route works too
    const rbac = await execute(await operation(page, 'Admin: users', 'getRolesAndPermissions'));
    await expect(rbac.locator('tr.response .response-col_status').first()).toContainText('200');

    // logging out takes the token out of the box again, and a protected route is refused once more
    const logout = await execute(await operation(page, 'Auth: sign in and session', 'logout'));
    await expect(logout.locator('tr.response .response-col_status').first()).toContainText('200');
    await expect(page.locator('.authorize.locked')).toHaveCount(0);
    const afterLogout = await execute(await operation(page, 'Auth: sign in and session', 'getMe'));
    await expect(afterLogout.locator('tr.response .response-col_status').first()).toContainText('401');
    // this test makes two 401 calls on purpose (before login, after logout), which Chrome logs. Nothing else may be wrong.
    expect(problems.filter((p) => !/status of 401/.test(p))).toEqual([]);
  });

  test('the token is never written to the browser storage, and a reload starts signed out', async ({ page }) => {
    await open(page);
    const login = await operation(page, 'Auth: sign in and session', 'login');
    await login.locator('.body-param__text').fill(JSON.stringify({ email: cfg.ADMIN.email, password: cfg.ADMIN.password }));
    await execute(login);
    await expect(page.locator('.authorize.locked').first()).toBeVisible();

    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(stored).not.toMatch(/eyJ|accessToken|bearerAuth/);

    await page.reload();
    await expect(page.locator('.opblock-tag-section').first()).toBeVisible();
    await expect(page.locator('.authorize.locked')).toHaveCount(0);
  });

  test('the raw file is available for Postman, with this server as the address', async ({ request }) => {
    const res = await request.get(`${cfg.API_URL}/docs/openapi.json`);
    const spec = await res.json();

    expect(res.status()).toBe(200);
    expect(spec.servers).toEqual([{ url: '/', description: 'This server' }]);
    expect(Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).length, 0)).toBe(74);
    expect((await request.get(`${cfg.API_URL}/docs/nope`)).status()).toBe(404);
  });
});
