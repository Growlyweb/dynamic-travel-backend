# API test runner

Runs the 111 test cases from `Dynamic-Travel-API-Test-Sheet.xlsx` against your running backend, then writes:

- `results/report-<time>.html`  - open in a browser (filter by Fail / Blocked / Pass)
- `results/Dynamic-Travel-API-Test-Sheet-RESULT-<time>.xlsx` - your sheet with Actual status, Result, Notes and date filled in
- `results/results-<time>.json` - raw data

## One-time setup

1. Put this whole `api-tests` folder inside the backend project, next to `package.json`.
2. In the backend `.env` set (then restart the server):

       MONGODB_URI=<your Atlas string>/travel_db
       ADMIN_SEED_EMAIL=admin@example.com
       ADMIN_SEED_PASSWORD=Admin@12345
       EMAIL_PROVIDER=file
       MAIL_OUTBOX_FILE=./mail.jsonl
       RATE_LIMIT_ENABLED=false

3. `npm run seed` (once), then `npm run dev`.
4. In this folder: `npm install`

## Every run

    cd api-tests
    node run-tests.js

Options

    node run-tests.js --only REG,LOG        only tests whose ID starts with REG or LOG
    node run-tests.js --only SEC-02 --rate-limit
                                            rate-limit test (server must run with RATE_LIMIT_ENABLED=true)
    node run-tests.js --base-url http://localhost:5000
    node run-tests.js --sheet "C:\path\to\sheet.xlsx"

## Notes

- Every run uses new e-mail addresses (`auto.<name>.<id>@example.com`), so runs never clash. They stay in the database; delete them from Atlas when you like.
- OTP codes and invite tokens are read from `mail.jsonl` automatically.
- LOG-15 (token expiry, 15 min) is always Blocked. SEC-02 is Blocked unless you pass `--rate-limit`.
- Exit code is 1 when any test fails (useful for CI), 2 when setup fails.
