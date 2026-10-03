const { test, expect } = require('../helpers/test');
const { cfg, bearer, emailFor, mailCount, waitForMail, signUpCustomer, login, json } = require('../helpers/api');

const NEW_PASSWORD = 'N3w!Passw0rd';

const askForCode = async (ctx, email) => {
  const mark = mailCount();
  const res = await ctx.post('/api/auth/forgot-password', { data: { email } });
  expect(res.status()).toBe(200);
  return (await waitForMail(email, { after: mark, subject: 'Reset' })).otp;
};

test.describe('forgot and reset password', () => {
  test('the answer is identical for a known and an unknown email', async ({ client }) => {
    const ctx = await client();
    const { email } = await signUpCustomer(ctx);

    const known = await json(await ctx.post('/api/auth/forgot-password', { data: { email } }));
    const unknown = await json(await ctx.post('/api/auth/forgot-password', { data: { email: emailFor('ghost') } }));

    expect(known).toEqual(unknown);
  });

  test('a code resets the password once, signs out every old session, and the old password stops working', async ({ client }) => {
    const device = await client();
    const stranger = await client();
    const { email, token: oldToken } = await signUpCustomer(device);

    const otp = await askForCode(stranger, email);

    // checking the code does not use it up
    for (let i = 0; i < 2; i += 1) {
      expect((await stranger.post('/api/auth/verify-reset-token', { data: { email, otp } })).status()).toBe(200);
    }

    // weak password refused, and the code survives that
    const weak = await stranger.post('/api/auth/reset-password', { data: { email, otp, newPassword: 'weak' } });
    expect(weak.status()).toBe(422);

    const mark = mailCount();
    const reset = await stranger.post('/api/auth/reset-password', { data: { email, otp, newPassword: NEW_PASSWORD } });
    expect(reset.status()).toBe(200);
    expect((await waitForMail(email, { after: mark, subject: 'password was changed' })).to_email).toBe(email);

    // old sessions are dead: the live access token and the refresh cookie
    expect((await device.get('/api/auth/me', { headers: bearer(oldToken) })).status()).toBe(401);
    expect((await device.post('/api/auth/refresh')).status()).toBe(401);

    // the old password is gone, the new one works
    expect((await login(stranger, email, cfg.PASSWORD)).res.status()).toBe(401);
    expect((await login(stranger, email, NEW_PASSWORD)).res.status()).toBe(200);

    // single use
    const again = await stranger.post('/api/auth/reset-password', { data: { email, otp, newPassword: 'An0ther!Pass' } });
    expect(again.status()).toBe(400);
    expect((await json(again)).code).toBe('INVALID_CODE');
  });

  test('five wrong tries lock the code, even for the right one', async ({ client }) => {
    const ctx = await client();
    const { email } = await signUpCustomer(ctx);
    const otp = await askForCode(ctx, email);
    const wrong = otp === '123456' ? '654321' : '123456';

    for (let i = 0; i < 5; i += 1) {
      const res = await ctx.post('/api/auth/reset-password', { data: { email, otp: wrong, newPassword: NEW_PASSWORD } });
      expect(res.status()).toBe(400);
    }

    const locked = await ctx.post('/api/auth/reset-password', { data: { email, otp, newPassword: NEW_PASSWORD } });
    expect(locked.status()).toBe(400);
    expect((await login(ctx, email, cfg.PASSWORD)).res.status()).toBe(200); // password unchanged
  });
});

test.describe('change password while logged in', () => {
  test('needs the current password, signs out other devices, and keeps this one signed in', async ({ client }) => {
    const phone = await client();
    const laptop = await client();
    const { email } = await signUpCustomer(phone);
    const onLaptop = await login(laptop, email);

    const wrong = await laptop.post('/api/auth/change-password', { headers: bearer(onLaptop.token), data: { currentPassword: 'Wrong!Pass1', newPassword: NEW_PASSWORD } });
    expect(wrong.status()).toBe(401);
    expect((await json(wrong)).code).toBe('WRONG_PASSWORD');

    const same = await laptop.post('/api/auth/change-password', { headers: bearer(onLaptop.token), data: { currentPassword: cfg.PASSWORD, newPassword: cfg.PASSWORD } });
    expect(same.status()).toBe(400);

    const changed = await laptop.post('/api/auth/change-password', { headers: bearer(onLaptop.token), data: { currentPassword: cfg.PASSWORD, newPassword: NEW_PASSWORD } });
    expect(changed.status()).toBe(200);
    const fresh = (await json(changed)).data.accessToken;

    // this device continues with the fresh token; the old one and the phone are out
    expect((await laptop.get('/api/auth/me', { headers: bearer(fresh) })).status()).toBe(200);
    expect((await laptop.get('/api/auth/me', { headers: bearer(onLaptop.token) })).status()).toBe(401);
    expect((await phone.post('/api/auth/refresh')).status()).toBe(401);

    expect((await login(laptop, email, cfg.PASSWORD)).res.status()).toBe(401);
    expect((await login(laptop, email, NEW_PASSWORD)).res.status()).toBe(200);
  });
});
