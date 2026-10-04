// Shared by the E2E stack, the Playwright config and the tests.
// Ports differ from the dev servers (5000 / 5173), so the tests never disturb a running `npm run dev`.
const path = require('path');

const ports = {
  api: Number(process.env.E2E_API_PORT) || 5100,
  // Second copy of the API with rate limiting ON. The main one has it off so the suite is not throttled.
  limitedApi: Number(process.env.E2E_LIMITED_API_PORT) || 5101,
  console: Number(process.env.E2E_CONSOLE_PORT) || 5273
};

module.exports = {
  ports,
  API_URL: `http://localhost:${ports.api}`,
  LIMITED_API_URL: `http://localhost:${ports.limitedApi}`,
  // The browser console is the only origin the API accepts (CORS allow-list)
  CONSOLE_URL: `http://localhost:${ports.console}`,
  // Everything a run writes lives in test/.output (git-ignored): `tmp` here, Playwright's results beside it.
  TMP_DIR: path.join(__dirname, '..', '.output', 'tmp'),
  MAIL_FILE: path.join(__dirname, '..', '.output', 'tmp', 'mail.jsonl'),
  ADMIN: { email: 'admin@e2e.test', password: 'Admin@E2E123', name: 'E2E Admin' },
  PASSWORD: 'Str0ng!Pass'
};
