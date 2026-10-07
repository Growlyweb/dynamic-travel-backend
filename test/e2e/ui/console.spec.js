const fs = require('fs');
const { test, expect } = require('../helpers/test');
const { cfg, emailFor, unique, mailCount, waitForMail, agencyForm, signUpCustomer, signUpAgency } = require('../helpers/api');
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

test.describe('tour packages in the test console', () => {
  test('an admin builds a category and a tour, the public view hides the B2B price, a customer sends a request and the admin answers it', async ({ page, client }) => {
    const { pageErrors } = await openConsole(page);
    const tag = unique('ui').replace(/-/g, '');
    const categoryName = `Beach ${tag}`;
    const tourName = `Cox ${tag}`;
    const customer = await signUpCustomer(await client());

    // --- admin: category (a repeat in other letters returns the same one), then a published tour
    expect((await login(page, cfg.ADMIN.email, cfg.ADMIN.password)).status).toBe(200);
    const category = await submitForm(page, 'POST /api/tour-categories', { name: categoryName });
    expect(category.status).toBe(201);
    const repeat = await submitForm(page, 'POST /api/tour-categories', { name: categoryName.toUpperCase() });
    expect(repeat.status).toBe(200);
    expect(repeat.body.data._id).toBe(category.body.data._id);

    const created = await submitForm(page, 'POST /api/tours', { name: tourName, category: category.body.data._id, status: 'published' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: tourName, price: 12500, durationDays: 3, status: 'published', b2bPrice: 10000 }); // numbers went as numbers
    expect(created.body.data.itinerary.map((d) => d.day)).toEqual([1, 2]);
    const tourId = created.body.data._id;

    // a bad itinerary is shown as the API's own 422
    const broken = await submitForm(page, 'POST /api/tours', { name: `${tourName} bad`, itinerary: '[{"day":1}' });
    expect(broken.status).toBe(422);

    // --- signed out: the tour is there, the B2B price is not
    await page.locator('#clearSession').click();
    const publicView = await submitForm(page, 'GET /api/tours', { search: tourName });
    expect(publicView.status).toBe(200);
    expect(publicView.body.data.map((t) => t.name)).toEqual([tourName]);
    expect(publicView.text).not.toContain('b2bPrice');
    expect(publicView.body.data[0].price).toBe(12500);
    expect((await submitForm(page, 'POST /api/tour-categories', { name: 'Sneaky' })).status).toBe(401);

    // --- a customer: cannot change tours, can send a request, cannot name another owner
    expect((await login(page, customer.email)).status).toBe(200);
    expect((await submitForm(page, 'POST /api/tours', { name: `${tourName} 2` })).status).toBe(403);
    const sent = await submitForm(page, 'POST /api/tours/custom-requests', { destination: `Sajek ${tag}` });
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ status: 'NEW', travelers: 4, activities: ['Trekking', 'Bonfire'], userId: customer.user._id });
    const requestId = sent.body.data._id;
    const backwards = await submitForm(page, 'POST /api/tours/custom-requests', { startDate: '2026-12-05', endDate: '2026-12-01' });
    expect(backwards.status).toBe(422);
    expect(backwards.text).toContain('End date cannot be before the start date.');
    expect((await submitForm(page, 'PATCH /api/tours/custom-requests/{id}/status', { id: requestId, status: 'CONFIRMED' })).status).toBe(403);

    // --- admin: edits, answers the request with a quote, archives the tour
    expect((await login(page, cfg.ADMIN.email, cfg.ADMIN.password)).status).toBe(200);
    const edited = await submitForm(page, 'PATCH /api/tours/{id}', { id: tourId, price: '13000' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ price: 13000, name: tourName });

    const skipped = await submitForm(page, 'PATCH /api/tours/custom-requests/{id}/status', { id: requestId, status: 'QUOTED' });
    expect(skipped.status).toBe(409); // NEW cannot jump to QUOTED
    expect(skipped.body.code).toBe('INVALID_TRANSITION');
    expect((await submitForm(page, 'PATCH /api/tours/custom-requests/{id}/status', { id: requestId, status: 'IN_REVIEW' })).status).toBe(200);
    const quoted = await submitForm(page, 'PATCH /api/tours/custom-requests/{id}/status', { id: requestId, status: 'QUOTED', note: 'Total BDT 85,000' });
    expect(quoted.body.data).toMatchObject({ status: 'QUOTED', reviewNote: 'Total BDT 85,000' });
    const requests = await press(page, 'GET /api/tours/custom-requests');
    expect(requests.body.data.some((r) => r._id === requestId)).toBe(true);

    const archived = await submitForm(page, 'DELETE /api/tours/{id}', { id: tourId });
    expect(archived.body.data.status).toBe('archived');
    await page.locator('#clearSession').click();
    expect((await submitForm(page, 'GET /api/tours', { search: tourName })).body.data).toEqual([]);

    expect(pageErrors).toEqual([]);
  });

  test('the quick buttons list categories and tours without signing in, and a blank filter is not an error', async ({ page }) => {
    await openConsole(page);

    expect((await press(page, 'GET /api/tour-categories')).status).toBe(200);
    expect((await press(page, 'GET /api/tours')).status).toBe(200);
    expect((await submitForm(page, 'GET /api/tours', {})).status).toBe(200); // the whole form left blank
    expect((await press(page, 'GET /api/tours/custom-requests')).status).toBe(401);
  });
});

test.describe('membership in the test console', () => {
  test('an admin builds a plan, assigns it to a customer, extends and cancels it, and the customer reads their own', async ({ page, client }) => {
    const { pageErrors } = await openConsole(page);
    const tag = unique('ui').replace(/-/g, '');
    const customer = await signUpCustomer(await client());
    const agency = await signUpAgency(await client());
    const planName = `Gold ${tag}`;

    expect((await login(page, cfg.ADMIN.email, cfg.ADMIN.password)).status).toBe(200);

    // --- a plan: the numbers go as numbers, a repeat in other letters is a clash
    const plan = await submitForm(page, 'POST /api/membership-plans', { name: planName, durationValue: '15', durationUnit: 'day', price: '500', maxDiscountAmount: '0' });
    expect(plan.status).toBe(201);
    expect(plan.body).toMatchObject({ name: planName, durationValue: 15, durationUnit: 'day', price: 500, maxDiscountAmount: null, isActive: true });
    expect(plan.body.features).toEqual(['10% off tour packages', '10% off visa processing']);
    const planId = plan.body.id;
    const clash = await submitForm(page, 'POST /api/membership-plans', { name: planName.toUpperCase() });
    expect([clash.status, clash.body.message]).toEqual([409, 'Another plan already uses this name.']);
    expect((await submitForm(page, 'POST /api/membership-plans', { name: '   ' })).status).toBe(400);

    // --- assign it: the amount is the plan's, an agency is refused, a second sale is a clash
    const sold = await submitForm(page, 'POST /api/memberships', { customerId: customer.user._id, planId, paymentMethod: 'nagad', trxId: 'NG-1', startDate: '2026-10-01' });
    expect(sold.status).toBe(201);
    expect(sold.body).toMatchObject({ status: 'active', endDate: '2026-10-15T17:59:59.999Z', payment: { method: 'nagad', amount: 500, trxId: 'NG-1', status: 'paid' } });
    const membershipId = sold.body.id;
    const agencySale = await submitForm(page, 'POST /api/memberships', { customerId: agency.user._id, planId, paymentMethod: 'cash' });
    expect([agencySale.status, agencySale.body.message]).toEqual([400, 'Membership is only for B2C customers']);
    const second = await submitForm(page, 'POST /api/memberships', { customerId: customer.user._id, planId, paymentMethod: 'cash' });
    expect([second.status, second.body.message]).toEqual([409, 'Customer already has an active membership - cancel or wait for expiry first.']);

    // --- extend, search, history
    const extended = await submitForm(page, 'PATCH /api/memberships/{id}/extend', { id: membershipId, days: '7' });
    expect(extended.body.endDate).toBe('2026-10-22T17:59:59.999Z');
    const found = await submitForm(page, 'GET /api/memberships', { planId });
    expect(found.body).toMatchObject({ total: 1 });
    expect(found.body.items[0].id).toBe(membershipId);
    const history = await submitForm(page, 'GET /api/customers/{customerId}/memberships', { customerId: customer.user._id });
    expect(Object.keys(history.body)).toEqual(['items']);

    // --- the numbers
    const numbers = await press(page, 'GET /api/membership-stats');
    expect(numbers.status).toBe(200);
    expect(numbers.body.revenueByMonth).toHaveLength(6);
    expect(numbers.body.planDistribution.find((p) => p.label === planName)).toEqual({ label: planName, value: 1 });
    const periods = await press(page, 'GET /api/membership-report/periods?mode=half');
    expect(periods.body.items).toHaveLength(6);

    // --- a used plan cannot be deleted; switch it off instead
    const blocked = await submitForm(page, 'DELETE /api/membership-plans/{id}', { id: planId });
    expect([blocked.status, blocked.body.message]).toEqual([409, 'This plan has memberships. Deactivate it instead of deleting it.']);
    expect((await submitForm(page, 'PATCH /api/membership-plans/{id}/toggle', { id: planId })).body.isActive).toBe(false);
    const edited = await submitForm(page, 'PUT /api/membership-plans/{id}', { id: planId, name: planName, durationValue: '15', durationUnit: 'day', price: '600' });
    expect(edited.body).toMatchObject({ price: 600, isActive: false }); // the switch is not undone by a save

    // --- the customer: reads their own, cannot manage anything
    expect((await login(page, customer.email)).status).toBe(200);
    const mine = await press(page, 'GET /api/b2c/memberships');
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((m) => m.id)).toEqual([membershipId]);
    expect(mine.body.items[0].planSnapshot.price).toBe(500); // the plan's later price change did not touch it
    expect((await press(page, 'GET /api/membership-stats')).status).toBe(403);
    expect((await submitForm(page, 'POST /api/membership-plans', { name: `Sneaky ${tag}` })).status).toBe(403);

    // --- admin again: cancel, then delete
    expect((await login(page, cfg.ADMIN.email, cfg.ADMIN.password)).status).toBe(200);
    const cancelled = await submitForm(page, 'PATCH /api/memberships/{id}/cancel', { id: membershipId, reason: 'Customer request' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Customer request', payment: { status: 'paid' } });
    expect((await submitForm(page, 'DELETE /api/memberships/{id}', { id: membershipId })).body).toEqual({ success: true, id: membershipId });

    expect(pageErrors).toEqual([]);
  });
});
