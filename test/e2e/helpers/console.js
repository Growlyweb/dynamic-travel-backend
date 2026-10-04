// Helpers for driving the test console (test/console/index.html) like a person would.
const { expect } = require('@playwright/test');
const cfg = require('../config');

const ENTRIES = '#entries .entry';

// Opens the console, points it at an API, and collects uncaught page errors.
const openConsole = async (page, { api = cfg.API_URL, mobile = false, colorScheme } = {}) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (colorScheme) await page.emulateMedia({ colorScheme });
  await page.addInitScript(([url]) => localStorage.setItem('base', url), [api]);
  await page.goto('/');
  await expect(page.locator('#who')).toHaveText('Not signed in');
  if (mobile) await page.locator('#client').selectOption('mobile');
  return { pageErrors };
};

const form = (page, route) => page.locator(`form[data-route="${route}"]`);

// Runs `click`, waits for exactly one new line in the request log, and reads it back.
const act = async (page, click) => {
  const before = await page.locator(ENTRIES).count();
  await click();
  await expect(page.locator(ENTRIES)).toHaveCount(before + 1);
  const entry = page.locator(ENTRIES).first();
  const badge = (await entry.locator('.badge').innerText()).trim();
  const text = await entry.locator('pre:not(.req)').innerText();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: Number(badge), body, text, entry };
};

// Fills the named fields of one form, presses its submit button, returns what the log shows.
const submitForm = (page, route, values = {}) =>
  act(page, async () => {
    const f = form(page, route);
    for (const [name, value] of Object.entries(values)) await f.locator(`[name="${name}"]`).fill(value);
    await f.locator('button:not([type="button"])').first().click();
  });

// A one-click button such as "Who am I".
const press = (page, call) => act(page, () => page.locator(`[data-call="${call}"]`).first().click());

const login = (page, email, password = cfg.PASSWORD) => submitForm(page, 'POST /api/auth/login', { email, password });

module.exports = { ENTRIES, openConsole, form, act, submitForm, press, login };
