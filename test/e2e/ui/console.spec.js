const fs = require('fs');
const { test, expect } = require('../helpers/test');
const { cfg, emailFor, mailCount, waitForMail, agencyForm, signUpCustomer } = require('../helpers/api');
const { ENTRIES, openConsole, form, act, submitForm, press, login } = require('../helpers/console');

test.describe('test console, as a person uses it', () => {
  test('a customer registers, verifies with the e-mailed code, reads the account and signs out', async ({ page }) => {
    const { pageErrors } = await openConsole(page);
    const email = emailFor('ui');
    const mark = mailCount();

    const registered = await submitForm(page, 'POST /api/auth/register', { name: 'UI Customer', email, password: cfg.PASSWORD });
    expect(registered.status).toBe(201);
    // the request log never shows a password
    await expect(registered.entry.locator('pre.req')).toContainText('********');
    await expect(registered.entry.locator('pre.req')).not.toContainText(cfg.PASSWORD);

    const { otp } = await waitForMail(email, { after: mark });
    const wrong = await submitForm(page, 'POST /api/auth/verify-otp', { email, otp: otp === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    await expect(page.locator('#who')).toHaveText('Not signed in');

    const verified = await submitForm(page, 'POST /api/auth/verify-otp', { email, otp });
    expect(verified.status).toBe(200);
    await expect(page.locator('#who')).toContainText('B2C');
    await expect(page.locator('#who')).toContainText('expires in');

    // web mode: the refresh token is an httpOnly cookie that page code can never read
    expect(await page.evaluate(() => [Boolean(sessionStorage.getItem('accessToken')), sessionStorage.getItem('refreshToken'), document.cookie])).toEqual([true, '', '']);
    const cookies = (await page.context().cookies()).filter((c) => c.path === '/api/auth');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

    const me = await press(page, 'GET /api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user).toMatchObject({ email, role: 'B2C' });

    // a customer is turned away from the admin area, and cannot sneak a role in through the profile form
    expect((await press(page, 'GET /api/admin/users')).status).toBe(403);
    expect((await submitForm(page, 'PATCH /api/b2c/profile', { name: 'Renamed In UI', role: 'ADMIN' })).status).toBe(200);
    expect((await press(page, 'GET /api/auth/me')).body.data.user).toMatchObject({ name: 'Renamed In UI', role: 'B2C' });

    // sign out, wrong password, right password
    expect((await press(page, 'POST /api/auth/logout')).status).toBe(200);
    await expect(page.locator('#who')).toHaveText('Not signed in');
    const refused = await login(page, email, 'Wrong!Pass1');
    expect(refused.status).toBe(401);
    expect(refused.body.message).toBe('Invalid credentials');
    expect((await login(page, email)).status).toBe(200);
    await expect(page.locator('#who')).toContainText('B2C');

    // "Forget tokens" clears the page state
    await page.locator('#clearSession').click();
    await expect(page.locator('#who')).toHaveText('Not signed in');
    expect(await page.evaluate(() => sessionStorage.getItem('accessToken'))).toBe('');

    expect(pageErrors).toEqual([]);
  });

  test('an agency registers with a file, waits, is approved by an admin, and the admin downloads the document', async ({ page }) => {
    const { pageErrors } = await openConsole(page);
    const agency = agencyForm();
    const { tradeLicense, ...fields } = agency;
    const mark = mailCount();

    // --- the agency form, with a real file chosen in the file input
    const reg = form(page, 'POST /api/auth/b2b/register');
    await reg.locator('[name="tradeLicense"]').setInputFiles(tradeLicense);
    const registered = await submitForm(page, 'POST /api/auth/b2b/register', fields);
    expect(registered.status).toBe(201);
    const partnerId = registered.body.data.partner._id;
    const docId = registered.body.data.partner.documents[0]._id;
    expect(registered.body.data.partner.documents[0]).toMatchObject({ type: 'TRADE_LICENSE', originalName: 'trade-license.pdf' });

    const { otp } = await waitForMail(agency.email, { after: mark });
    expect((await submitForm(page, 'POST /api/auth/verify-otp', { email: agency.email, otp })).status).toBe(200);
    await expect(page.locator('#who')).toContainText('B2B');

    // --- signed in, but the operational area stays closed
    const closed = await press(page, 'GET /api/b2b/overview');
    expect(closed.status).toBe(403);
    expect(closed.body.code).toBe('PARTNER_NOT_APPROVED');
    expect((await press(page, 'GET /api/b2b/profile')).status).toBe(200);
    expect((await press(page, 'GET /api/admin/b2b')).status).toBe(403);

    // --- the admin signs in and approves, picking the partner id from the id chips
    expect((await login(page, cfg.ADMIN.email, cfg.ADMIN.password)).status).toBe(200);
    await expect(page.locator('#who')).toContainText('ADMIN');

    const approval = form(page, 'PATCH /api/admin/b2b/{id}/approval');
    await approval.locator('[name="id"]').click();
    await page.locator('#ids .chip', { hasText: partnerId }).click();
    await expect(approval.locator('[name="id"]')).toHaveValue(partnerId);
    const approved = await submitForm(page, 'PATCH /api/admin/b2b/{id}/approval', { note: 'Approved from the console' });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ approvalStatus: 'APPROVED', reviewNote: 'Approved from the console' });

    // --- the admin downloads the private document: right name, same bytes, never cached
    const dl = page.locator('#dlForm');
    await dl.locator('[name="partnerId"]').fill(partnerId);
    await dl.locator('[name="docId"]').fill(docId);
    const [download] = await Promise.all([page.waitForEvent('download'), dl.locator('button').click()]);
    expect(download.suggestedFilename()).toBe('trade-license.pdf');
    expect(Buffer.compare(fs.readFileSync(await download.path()), tradeLicense.buffer)).toBe(0);
    await expect(page.locator(ENTRIES).first()).toContainText('no-store');

    // --- the admin reference views
    const rbac = await press(page, 'GET /api/admin/rbac');
    expect(rbac.status).toBe(200);
    for (const role of ['ADMIN', 'STAFF', 'B2B', 'B2C']) expect(rbac.text).toContain(role);
    const audit = await press(page, 'GET /api/admin/audit-logs?limit=20');
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBeGreaterThan(0);

    // --- back as the agency: the same account is now open
    expect((await login(page, agency.email, cfg.PASSWORD)).status).toBe(200);
    const open = await press(page, 'GET /api/b2b/overview');
    expect(open.status).toBe(200);
    expect(open.body.data).toMatchObject({ companyName: agency.companyName, approvalStatus: 'APPROVED' });

    expect(pageErrors).toEqual([]);
  });

  test('mobile mode returns the refresh token in the body, and replaying an old one signs the account out everywhere', async ({ page, client }) => {
    const { email } = await signUpCustomer(await client());
    await openConsole(page, { mobile: true });

    expect((await login(page, email)).status).toBe(200);
    const first = await page.evaluate(() => sessionStorage.getItem('refreshToken'));
    expect(first).toBeTruthy();

    const refreshed = await press(page, 'POST /api/auth/refresh');
    expect(refreshed.status).toBe(200);
    const second = await page.evaluate(() => sessionStorage.getItem('refreshToken'));
    expect(second).toBeTruthy();
    expect(second).not.toBe(first); // rotated

    // replay the first (already used) token: refused, and the whole family is revoked
    await page.locator('#manualRefresh').fill(first);
    const replay = await act(page, () => form(page, 'POST /api/auth/refresh').locator('button').click());
    expect(replay.status).toBe(401);
    expect((await press(page, 'POST /api/auth/refresh')).status).toBe(401); // even the newest token is dead now
  });

  test('the console shows the server\'s rate limit: Retry-After and the 429 message, read across origins', async ({ page, client }) => {
    const { email } = await signUpCustomer(await client());
    await openConsole(page, { api: cfg.LIMITED_API_URL });

    for (let i = 1; i <= 10; i += 1) {
      const res = await login(page, email, 'Wrong!Pass1');
      expect({ attempt: i, status: res.status }).toEqual({ attempt: i, status: 401 });
    }
    const blocked = await login(page, email, 'Wrong!Pass1');

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
    await expect(blocked.entry.locator('.badge')).toHaveText('429');
    // the browser could only read this header because the API exposes it through CORS
    await expect(blocked.entry.locator('.meta')).toContainText(/Retry-After \d+s/);
  });

  test('a console that cannot reach the API says why, instead of failing silently', async ({ page }) => {
    await openConsole(page, { api: 'http://localhost:1' });

    const result = await login(page, 'nobody@e2e.test', cfg.PASSWORD);

    expect(result.status).toBeNaN(); // the badge reads ERR
    await expect(result.entry.locator('.badge')).toHaveText('ERR');
    await expect(result.entry.locator('.meta')).toContainText('Network or CORS error');
  });
});
