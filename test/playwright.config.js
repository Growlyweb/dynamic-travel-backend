const { defineConfig, devices } = require('@playwright/test');
const { API_URL, CONSOLE_URL } = require('./e2e/config');

// End-to-end tests. `npm run e2e` starts the whole stack itself (test/e2e/stack.js): a real API server, a
// throwaway MongoDB and the browser test console, on ports that do not clash with `npm run dev`.
// Paths below are relative to this file.
//
//   api project : the API over real HTTP (cookies, CORS, headers, files), no browser
//   ui project  : the browser test console in Chrome
//
// Browser: the installed Google Chrome. On a machine without it, run `npx playwright install chromium`
// and set PW_CHANNEL=chromium.
//
// Output: the terminal only (no HTML report). Traces and screenshots of failures go to test/.output/results.
module.exports = defineConfig({
  testDir: './e2e',
  // One worker: all tests share one database, and a few watch the shared mail file.
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  expect: { timeout: 8000 },
  reporter: [['list']],
  outputDir: './.output/results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'api', testMatch: /api\/.*\.spec\.js/, use: { baseURL: API_URL } },
    {
      name: 'ui',
      testMatch: /ui\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || 'chrome', viewport: { width: 1440, height: 900 }, baseURL: CONSOLE_URL }
    }
  ],
  webServer: {
    command: 'node ./e2e/stack.js',
    url: CONSOLE_URL,
    timeout: 120000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
