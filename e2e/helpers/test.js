// `test` with one extra fixture: `client()` makes an API client (own cookie jar) that is disposed
// automatically when the test ends.
const base = require('@playwright/test');
const { newClient } = require('./api');

const test = base.test.extend({
  client: async ({}, use) => {
    const made = [];
    await use(async (baseURL, options) => {
      const ctx = await newClient(baseURL, options);
      made.push(ctx);
      return ctx;
    });
    await Promise.all(made.map((ctx) => ctx.dispose()));
  }
});

module.exports = { test, expect: base.expect };
