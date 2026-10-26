const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../../app');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const { PRIVATE_ROOT } = require('../../utils/file');
const counterService = require('../../services/counterService');
const storageService = require('../../services/storageService');
const settingService = require('../../services/settingService');
const events = require('../../utils/events');
const { createUser, bearer } = require('./helpers/factory');

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)]);
const upload = (buffer, mimetype = 'application/pdf', name = 'passport.pdf') => ({ buffer, mimetype, originalname: name, size: buffer.length });
const RULES = { maxSizeMb: 1, allowedTypes: ['pdf', 'jpg', 'png', 'webp'] };

describe('counter', () => {
  it('never gives the same number twice, even when requests arrive together', async () => {
    const numbers = await Promise.all(Array.from({ length: 25 }, () => counterService.nextNumber('visa-application', { year: 2026 })));
    expect(new Set(numbers).size).toBe(25);
    expect(numbers).toContain('visa-application-2026-000001');
    expect(numbers).toContain('visa-application-2026-000025');
  });

  it('restarts every year', async () => {
    await counterService.nextNumber('QT', { year: 2026, width: 4 });
    expect(await counterService.nextNumber('QT', { year: 2027, width: 4 })).toBe('QT-2027-0001');
    expect(await counterService.nextNumber('QT', { year: 2026, width: 4 })).toBe('QT-2026-0002');
  });
});

describe('event hook', () => {
  afterEach(() => events.removeAllListeners());

  it('delivers the payload to a listener', async () => {
    const seen = jest.fn();
    events.on(events.EVENTS.VISA_STATUS_CHANGED, seen);
    events.emit(events.EVENTS.VISA_STATUS_CHANGED, { id: 1 });
    expect(seen).toHaveBeenCalledWith({ id: 1 });
  });

  it('keeps a failing listener away from the code that raised the event', async () => {
    events.on(events.EVENTS.VISA_STATUS_CHANGED, async () => {
      throw new Error('listener broke');
    });
    expect(() => events.emit(events.EVENTS.VISA_STATUS_CHANGED, {})).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('storage', () => {
  it('stores a real PDF under a random name outside any public folder', async () => {
    const saved = await storageService.saveUpload('visa/test', upload(PDF), RULES);
    expect(saved.storagePath).toMatch(/^visa\/test\/[0-9a-f]{32}\.pdf$/);
    expect(saved).toMatchObject({ mimeType: 'application/pdf', originalName: 'passport.pdf', size: PDF.length });
    expect(fs.existsSync(path.join(PRIVATE_ROOT, saved.storagePath))).toBe(true);
    expect((await fs.promises.stat(path.join(PRIVATE_ROOT, saved.storagePath))).mode & 0o077).toBe(0);
  });

  it('refuses a file whose content is not what it claims to be', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(40));
    await expect(storageService.saveUpload('visa/test', upload(html, 'application/pdf', 'evil.pdf'), RULES)).rejects.toMatchObject({ statusCode: 400, code: 'FILE_TYPE_NOT_ALLOWED' });
  });

  it('refuses a declared type that does not match the content', async () => {
    await expect(storageService.saveUpload('visa/test', upload(PDF, 'image/png', 'a.png'), RULES)).rejects.toMatchObject({ code: 'FILE_TYPE_MISMATCH' });
  });

  it('refuses a type that the settings do not allow', async () => {
    await expect(storageService.saveUpload('visa/test', upload(PDF), { ...RULES, allowedTypes: ['jpg'] })).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
  });

  it('refuses a file over the size limit', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 * 1024 + 10, 1)]);
    await expect(storageService.saveUpload('visa/test', upload(big), RULES)).rejects.toMatchObject({ statusCode: 413, code: 'FILE_TOO_LARGE' });
  });

  it('never reads or deletes outside its folder', () => {
    expect(() => storageService.stream('../../etc/passwd')).toThrow(/Invalid file location/);
    return expect(storageService.remove('../../package.json')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('removes a stored file', async () => {
    const saved = await storageService.saveUpload('visa/test', upload(PDF), RULES);
    await storageService.remove(saved.storagePath);
    expect(await storageService.exists(saved.storagePath)).toBe(false);
  });
});

describe('settings', () => {
  it('answers with defaults until something is saved', async () => {
    expect(await settingService.get('visa.documents')).toMatchObject({ maxSizeMb: 10, maxFilesPerItem: 5 });
    expect(await settingService.get('visa.retention')).toEqual({ days: 730 });
  });

  it('lets any internal user read the currencies, and nobody else', async () => {
    const staff = await createUser({ role: ROLES.STAFF });
    const customer = await createUser({ role: ROLES.B2C });
    const ok = await request(app).get('/api/settings/currencies').set(bearer(staff));
    expect(ok.status).toBe(200);
    expect(ok.body.data.items.map((item) => item.code)).toEqual(['BDT', 'USD']);
    expect((await request(app).get('/api/settings/currencies').set(bearer(customer))).status).toBe(403);
    expect((await request(app).get('/api/settings/currencies')).status).toBe(401);
  });

  it('lets staff with VISA_EDIT set a rate by hand, and marks it manual', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_EDIT] });
    const items = [
      { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', rateToBase: 1 },
      { code: 'USD', name: 'US Dollar', symbol: '$', rateToBase: 125.5 },
      { code: 'EUR', name: 'Euro', symbol: '€', rateToBase: 135 }
    ];
    const res = await request(app).put('/api/settings/currencies').set(bearer(staff)).send({ items });
    expect(res.status).toBe(200);
    const usd = res.body.data.items.find((item) => item.code === 'USD');
    expect(usd).toMatchObject({ rateToBase: 125.5, source: 'manual' });
    expect(res.body.data.items.find((item) => item.code === 'BDT').source).toBe('base');
  });

  it('refuses a rate change from staff without VISA_EDIT', async () => {
    const staff = await createUser({ role: ROLES.STAFF });
    const res = await request(app).put('/api/settings/currencies').set(bearer(staff)).send({ items: [{ code: 'BDT', name: 'Taka', symbol: '৳', rateToBase: 1 }] });
    expect(res.status).toBe(403);
  });

  it('refuses a currency list without the base currency at a rate of 1', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const res = await request(app)
      .put('/api/settings/currencies')
      .set(bearer(admin))
      .send({ items: [{ code: 'USD', name: 'US Dollar', symbol: '$', rateToBase: 120 }] });
    expect(res.status).toBe(422);
  });

  it('fills the default rate from the exchange rate service', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ result: 'success', rates: { BDT: 123.45 } }) });
    const res = await request(app).post('/api/settings/currencies/usd/refresh').set(bearer(admin));
    expect(spy).toHaveBeenCalledWith('https://open.er-api.com/v6/latest/USD', expect.any(Object));
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body.data.items.find((item) => item.code === 'USD')).toMatchObject({ rateToBase: 123.45, source: 'api' });
  });

  it('keeps the old rate and says so when the exchange rate service is down', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const spy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    const res = await request(app).post('/api/settings/currencies/USD/refresh').set(bearer(admin));
    spy.mockRestore();
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('RATE_SERVICE_UNAVAILABLE');
    expect((await settingService.get('currencies')).items.find((item) => item.code === 'USD').rateToBase).toBe(122);
  });

  it('lets only an admin change the document limits, and checks the value', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const staff = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.VISA_EDIT] });
    const value = { maxSizeMb: 8, allowedTypes: ['pdf'], maxFilesPerItem: 3 };

    expect((await request(app).put('/api/settings/visa.documents').set(bearer(staff)).send({ value })).status).toBe(403);
    expect((await request(app).put('/api/settings/visa.documents').set(bearer(admin)).send({ value: { ...value, maxSizeMb: 500 } })).status).toBe(422);
    expect((await request(app).put('/api/settings/visa.documents').set(bearer(admin)).send({ value })).status).toBe(200);
    expect((await request(app).put('/api/settings/nope').set(bearer(admin)).send({ value: 1 })).status).toBe(404);

    const read = await request(app).get('/api/settings').set(bearer(staff));
    expect(read.body.data['visa.documents']).toEqual(value);
  });
});
