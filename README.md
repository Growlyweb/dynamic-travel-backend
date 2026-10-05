# Express + MongoDB: Auth and RBAC backend

One central authentication and role-based access layer for the travel platform.
Four roles share one login system: **ADMIN, STAFF, B2B, B2C**.
Every request travels the same path, and every layer has one job.

```
Request -> router -> authenticate -> requireRole / requirePermission -> checkOwnership
        -> validate (zod) -> controller -> service -> model -> MongoDB
Response <- sendResponse <- controller <- service
Errors   -> throw ApiError anywhere -> errorMiddleware -> { success: false, message, code?, errors? }
```

Authentication answers *who are you?*.
Authorization answers *what may you do?*.
A role check alone is never enough: ownership is checked too, so one customer or partner can never read another's records.

What is left to build is in [`documentation/ToDo.md`](documentation/ToDo.md).
The spec this follows is [`documentation/Auth_RBAC_Backend_Implementation_Guide.md`](documentation/Auth_RBAC_Backend_Implementation_Guide.md).

## Status

| Area | State |
| --- | --- |
| Roles and permissions from `config/rbac.json` | Done |
| B2C register, email OTP, Firebase sign-in | Done (Firebase needs your service-account key) |
| B2B register (trade license required), email OTP, admin approval, document review | Done |
| Login, rotating refresh tokens with theft detection, logout (one device or all) | Done |
| Forgot, verify, reset and change password | Done |
| Admin and staff invite flow, status, role, permission and soft-delete management | Done |
| Ownership checks, private document download | Done |
| Audit log, rate limits, hardening, central errors | Done |
| EmailJS delivery | Code done, needs your keys |
| Phone OTP | Open on purpose (see `ToDo.md`) |
| Tour categories, tour packages, custom tour requests | Done (see "Tour packages" below) |
| Automated tests | 364 unit and integration (Jest), 108 end-to-end (Playwright) |
| Browser test console | Done (`npm run console`) |
| OpenAPI file for Postman | Done (`documentation/openapi.json`, `npm run openapi`) |

## Quick start

```bash
npm install
npm run setup            # creates .env if missing, and fills the three secrets that are empty or "replace-me"
npm run seed             # creates the first ADMIN from ADMIN_SEED_* (needs MongoDB running)
npm run seed:tours       # creates the 8 starting tour categories and the Cox's Bazar sample tour (safe to run again)
npm run dev              # http://localhost:5000
npm run console          # browser test page at http://localhost:5173 (needs the API running)
npm test                 # runs the whole suite against an in-memory MongoDB
```

`npm run setup` is safe to run again: it only fills secrets that are missing, empty or still `replace-me`, and leaves every other value in `.env` as it is.
Prefer to do it by hand? Copy `.env.example` to `.env` and generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The app refuses to start while `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` or `TOKEN_HASH_SECRET` is missing or still says `replace-me`.
If you see `JWT_ACCESS_SECRET is required`, you have no `.env` yet: run `npm run setup`.
Codes are never printed in the server log or returned by the API: the user types the code from their email.
Without the four `EMAILJS_*` keys no email can be sent, so sign-up answers `otpSent: false` and the server logs `EmailJS is not configured`.

## API documentation and Postman

`documentation/openapi.json` describes every endpoint: parameters, request bodies (JSON and form-data), example responses, error codes, who may call it, and the rate limit.
It is OpenAPI 3.0.3, so it also opens in Swagger UI, Insomnia and similar tools.

**Import into Postman**

1. Postman, **File > Import**, choose `documentation/openapi.json`.
2. You get a collection with 60 requests in folders (Auth, Customer, Agency, Staff, Admin, Documents, Tour categories, Tours, Custom tours, System). Request bodies are pre-filled with valid examples.
3. In the collection's **Variables**, `baseUrl` is `http://localhost:5000`. Add a variable named `bearerToken` and leave it empty.
4. Send **Auth > Log in**, copy `data.accessToken` from the response into `bearerToken`. Every request with a lock now works.
5. The token lasts 15 minutes. **Refresh tokens** issues a new one (Postman keeps the refresh cookie).

Things to know in Postman:

- The header `X-Client-Type` is present but **empty**, which means web mode (refresh token in a cookie). Type `mobile` to see the mobile mode (refresh token in the response body).
- The agency registration is form-data. Pick a file for `tradeLicense`. Add the `otherDocuments` row again for each extra file (up to 3).
- Downloading a document: use **Send and Download**.
- Public requests (login, register, ...) carry no `Authorization` header.

**Keeping it correct.** The file is generated from the real code, not written by hand.
Bodies, query strings and path parameters come from the zod schemas in `validations/`; descriptions, examples and error codes live in `scripts/openapi/endpoints.js`.

```bash
npm run openapi    # rewrite documentation/openapi.json
```

Run it after changing a route or a validation file.
The test suite fails if the file is stale, if a route is missing from it, if it documents a route that does not exist, or if an example body would be rejected by the API.

## Test console (browser)

`npm run console` serves `test/console/index.html` (the only HTML file in the project) at **http://localhost:5173**, a single page for trying every flow by hand.
Start the API first (`npm run dev`).

| Section | What you can do |
| --- | --- |
| Customer (B2C) | Register, enter the OTP, log in as any role |
| Firebase | Paste your Firebase web apiKey once, click "Sign in with Google", and the ID token goes to the API. A manual token box and "Sign out of Firebase" are under "More options". |
| Agency (B2B) | Register with a trade license file (multipart) |
| Session | `/me`, refresh (cookie or body), logout, change password, replay an old refresh token |
| Password reset | Request a code, check it, set a new password |
| Admin | Roles and permissions from `rbac.json`, users, staff invites, status, approvals, document review, audit log |
| Role areas | Each role's endpoints, plus the private document download |
| Tour packages | Search and filter tours, create categories and tours, edit and archive, send a custom tour request as a customer, answer it as a manager |

- The right-hand panel logs every request and response. Passwords are masked, and ids from responses become chips you can click to paste into the focused field.
- "Client" switches between **web** (refresh token in an `httpOnly` cookie) and **mobile** (refresh token in the response body).
- Codes and invite links arrive only by email. They are not printed in the API terminal and are not in any response: copy the code from your inbox and type it into the form.
- Port 5173 is the default `CLIENT_URL`, so CORS and the refresh cookie behave as they would for a real frontend. To use another port, set `TEST_CONSOLE_PORT` and add that address to `CLIENT_URL`.
- It is a development tool: it binds to localhost and serves only that one file. Do not deploy it.

## End-to-end tests (Playwright)

`npm test` checks the code in-process.
`npm run e2e` checks the product the way a user meets it: real server processes, real HTTP, real cookies and CORS, and a real browser driving the test console.

```bash
npm run e2e          # everything (108 tests, about 20 seconds on a fast disk)
npm run e2e:api      # the API only, no browser (88 tests)
npm run e2e:ui       # the browser test console only (18 tests)
```

You do not have to start anything first.
`test/e2e/stack.js` boots its own stack for the run and removes it afterwards:

| What | Where | Notes |
| --- | --- | --- |
| API with rate limits off | `:5100` | Used by almost every test |
| API with rate limits on | `:5101` | Shares the database and secrets, used only to prove the 429 behaviour |
| Test console | `:5273` | The only origin allowed by CORS, as a real front end would be |
| MongoDB | in memory | Starts empty, a fresh admin is seeded |

It never reads `.env`, never touches your database, and uses different ports from `npm run dev`, so your dev server can stay running.
Emails are not sent: the server runs with `EMAIL_PROVIDER=file`, which appends each message to `test/.output/tmp/mail.jsonl`, and the tests read the OTP or invite link from there.
That provider is refused when `NODE_ENV=production`.

| Spec | What it proves |
| --- | --- |
| `api/customer` | Register, verify, login, cookie flags, rotating refresh with theft detection, logout, forged tokens |
| `api/password` | Forgot, reset (single use, lock after 5 wrong codes), change password, old sessions die |
| `api/agency` | Registration rules, approval lifecycle, byte-for-byte document download, who may download, locked documents |
| `api/admin` | Staff invites, permissions, suspend, role change, soft delete, audit log |
| `api/profile-access` | Only the owner and an admin can change a profile, nothing can be changed through a foreign id |
| `api/rbac-matrix` | Every role against every route group, anonymous included |
| `api/tours` | Categories and tours over real HTTP: who sees the B2B price (7 kinds of caller), filters and paging, draft to archive to restore, access refusals, custom request journey and its status rules |
| `api/security` | Helmet headers, CORS allow-list, no private fields in any response, codes and invite links never in a response, no static folders, hostile input |
| `api/rate-limit` | Each limiter blocks at its limit, with `Retry-After` |
| `ui/console` | Full customer, agency and admin journeys clicked in Chrome, file upload and download, mobile mode, the 429 note |
| `ui/layout` | No overflow at 1440, 1100, 820 and 390 px, the results panel stays in place, every field has a label, text passes WCAG AA contrast in light and dark mode |

The UI tests use the installed Google Chrome.
On a machine without it, run `npx playwright install chromium` and then `PW_CHANNEL=chromium npm run e2e:ui`.
Playwright runs with one worker on purpose: the tests share one database and one mail file.
Every test creates its own users with unique emails, so tests do not depend on each other or on their order.

## Roles and permissions: `config/rbac.json`

Roles and permissions are defined in one JSON file and loaded at boot by `config/rbac.js`.
Everything else reads from there: the `User` model, validation, the guards, and `GET /api/admin/rbac`.

```json
{
  "roles": {
    "STAFF": {
      "label": "Staff",
      "description": "...",
      "selfRegister": false,
      "invitable": true,
      "bypassPermissions": false,
      "assignablePermissions": true
    }
  },
  "permissions": { "VISA_VIEW": "See visa applications" }
}
```

| Role flag | Meaning |
| --- | --- |
| `selfRegister` | The role can sign itself up (B2B, B2C). |
| `invitable` | An admin can create it by invite (ADMIN, STAFF). |
| `bypassPermissions` | It passes every permission check (ADMIN). |
| `assignablePermissions` | It carries a permission list an admin edits (STAFF). |

To add a permission, add a line under `permissions` and restart.
It then appears in the API, the validation and the admin pickers.
The four role codes `ADMIN`, `STAFF`, `B2B`, `B2C` must stay, because routes and registration refer to them.
A malformed file stops the boot with a clear message instead of weakening a guard.

| Role | Created by | Can access | Must never |
| --- | --- | --- | --- |
| ADMIN | The seed script, then another Admin | Everything under `/api/admin` | Be created through an open endpoint |
| STAFF | An Admin (invite email) | Only what its `permissions[]` allow | Get Admin powers by default |
| B2B | Self-registers, then an Admin approves | Own profile and documents, operational APIs once the partner is APPROVED | See another partner's data |
| B2C | Self-registers, or signs in with Firebase | Own profile and own records | Reach Admin, Staff or B2B APIs |

Role, status, permissions and partner id are never accepted from a request body.
Registration and profile schemas strip them.

## Folder map

| Folder | Job | Rule |
| --- | --- | --- |
| `routes/` | Map URL + method to a middleware chain and a controller | No logic |
| `routes/admin`, `staff`, `b2b`, `b2c` | One router per role area, guarded once in its `index.js` | Never repeat `authenticate` per file |
| `middleware/` | Authenticate, authorize, ownership, validation, uploads, rate limits, errors | Talk to later steps through `req` |
| `validations/` | zod schemas, one file per area | Strip unknown fields |
| `controllers/` | Read `req`, call one service, send the response | Thin, always wrapped in `asyncHandler` |
| `services/` | Business rules and database access | Never touch `req` or `res` |
| `models/` | Mongoose schemas | Shape and integrity only |
| `utils/` | Small helpers (`ApiError`, `mailer`, `crypto`, `file`, ...) | No imports from higher layers |
| `config/` | `env.js` (the only place that reads `process.env`), `rbac.json`, `rbac.js`, `constants.js`, `db.js` | |
| `scripts/` | One-off CLI tasks such as seeding | |
| `test/` | Everything for testing, and nothing else lives outside it: `unit/` (Jest and supertest, in-memory MongoDB, never reads your `.env`), `e2e/` (Playwright), `console/` (the one-page browser tool, `npm run console`), `playwright.config.js`, and `.output/` (git-ignored run output) | Development only |
| `storage/private/` | Business documents, never served directly | Git-ignored |
| `documentation/` | The spec, the requirements, `User-Stories.md`, `ToDo.md` and `openapi.json` (generated, do not edit by hand) | |

Dependencies point downward only: routes -> controllers -> services -> models.

## Data models

| Model | Purpose |
| --- | --- |
| `User` | One identity for all roles. `passwordHash` is `select:false`. `tokenVersion` kills every older token when bumped. |
| `Partner` | B2B business profile, typed documents (trade license, business card, other), and `approvalStatus`. Kept apart from `User.status`. |
| `OtpToken` | Hashed one-time codes and link tokens. Single use, TTL expiry, attempt counter. |
| `RefreshSession` | One row per device. Enables logout, rotation and theft detection. |
| `AuditLog` | Append-only record of security events. |

## Registration and sign-in

| Flow | What happens |
| --- | --- |
| B2C register | `POST /api/auth/register`: validate, reject duplicates, hash, create `PENDING`, email a 6-digit OTP. `POST /api/auth/verify-otp` activates and signs in. |
| B2C with Firebase | `POST /api/auth/firebase` with the Firebase `idToken`: verify, find or create the B2C user, issue OUR tokens. |
| B2B register | `POST /api/auth/b2b/register` (multipart). Required: name, email, mobile, address, company name, license number, password and a **trade license** file. Optional: business card, other documents. Creates the user and a `PENDING` partner, then emails an OTP. After verifying, the owner can log in. Operational APIs stay closed until an Admin approves. |
| Admin or Staff | Created by an Admin (`POST /api/admin/users` or `/api/admin/staff`) without a password. The person opens the emailed link and sets one with `POST /api/auth/setup-account`. |
| Login | Email and password. The same `Invalid credentials` answer for every failure. |
| Refresh | The refresh token rotates on every use. Reusing an already-rotated one revokes every session of that user. |
| Logout | Revokes this device, or all devices with `{ "allDevices": true }`. |

**How B2C and B2B map to registration.** There are two endpoints, and the endpoint decides the role. The request body never does.

| Endpoint | Body | Role set by the server | Creates |
| --- | --- | --- | --- |
| `POST /api/auth/register` | JSON | `B2C` | a `User` |
| `POST /api/auth/b2b/register` | multipart | `B2B` | a `User` and a `Partner` (company, license, documents) |
| `POST /api/auth/firebase` (first Google sign-in) | JSON | `B2C` | a `User` |

- Neither registration schema has a `role` field, and unknown fields are dropped, so a client cannot ask for `ADMIN`, or for B2B through the B2C endpoint.
- Both share one `User` collection, the same email OTP, `/verify-otp` and `/login`. They differ only in approval: a B2B user cannot reach operational routes until an admin approves the `Partner`.
- ADMIN and STAFF are never created through a registration endpoint (see "Admin or Staff" above).
- **Closing sign-up:** set `"selfRegister": false` for a role in `config/rbac.json` and restart. That role's registration answers `403 REGISTRATION_CLOSED` (for B2C this also covers a first-time Google sign-in). Existing accounts are unaffected.

Multipart field names for B2B documents: `tradeLicense` (one, required at registration), `businessCard` (one), `otherDocuments` (up to three).
Allowed types are PDF, JPEG, PNG and WEBP, up to 5 MB each.

Web clients receive the refresh token as an `httpOnly` cookie scoped to `/api/auth`.
Mobile clients send the header `X-Client-Type: mobile` and receive and send the refresh token in the JSON body.
Send the access token as `Authorization: Bearer <accessToken>`.

| Account status | Meaning |
| --- | --- |
| PENDING | Email not verified yet. Cannot log in. |
| ACTIVE | Normal access. |
| SUSPENDED | Denied. An Admin can reactivate. |
| BLOCKED, INACTIVE | Login denied. |

A suspension, role change or password change takes effect at once: `authenticate` reloads the user on every request and compares `tokenVersion`.

## Tour packages

Categories, tours and custom tour requests (spec: `documentation/Dynamic_Travel_Tour_Package_Backend_Handoff.md`, decisions: `documentation/ToDo.md` section 4).
Run `npm run seed:tours` once to load the 8 starting categories (their old frontend ids `cat_beach` and so on are kept in `legacyId`) and the sample tour `tour_205`.

| Who | Can |
| --- | --- |
| Anyone, no token | Read published tours and active categories |
| Admin, staff with `TOUR_MANAGE` | Create, edit and archive tours and categories; see drafts, unpublished and archived tours; read and answer every custom request |
| Approved B2B partner | Read tours **with `b2bPrice`** |
| B2C customer | Send a custom tour request, read their own, cancel their own while it is `NEW` |
| Staff without `TOUR_MANAGE`, B2B, admin | Cannot send a custom request (admin and TOUR_MANAGE staff manage them instead) |

- **`b2bPrice` never leaves the API for anyone else.** It is removed in one place (`present()` in `services/tourService.js`), so no route can forget to. A B2B user still waiting for approval does not get it.
- Reads accept an optional token: no token is a visitor, a wrong token is `401`, and a header with nothing after `Bearer ` (what Postman sends for an empty variable) is a visitor.
- A tour that is not published is a `404` for the public, the same as one that does not exist.
- **Delete means archive.** Tours become `archived` and categories get `isActive: false`. Nothing is removed. A category that active tours use cannot be removed (`CATEGORY_IN_USE`).
- Category names are unique in any letter case and spacing, enforced by a unique index. Creating a name that exists returns the existing category with `200`.
- Either id works wherever an id is accepted: the new one (24 hex characters) or the old frontend one (`cat_beach`, `tour_205`).
- A published tour needs at least one itinerary day, no day may be after `durationDays`, days are unique and always returned in ascending order. Currency is `BDT`, `USD` or `EUR`. Prices, seats and durations cannot be negative. `coverImage` and `gallery` are http or https links.
- Tour list: `search` (name, destination, country), `category` (one id or several, comma separated), `country`, `destination`, `status` (managers), `minPrice`, `maxPrice`, `durationDays`, `sort` (`createdAt`, `price`, `durationDays`, `rating`, a leading `-` for descending), `page`, `limit`. Newest first by default. A blank value counts as not given.
- Custom request moves: `NEW` to `IN_REVIEW` or `CANCELLED`; `IN_REVIEW` to `QUOTED` or `CANCELLED`; `QUOTED` to `IN_REVIEW`, `CONFIRMED` or `CANCELLED`; `CONFIRMED` to `CANCELLED`. `CANCELLED` is final. Anything else is `409 INVALID_TRANSITION`.
- The list envelope is the one the rest of this API uses: `{ success, message, data, meta: { total, page, limit, totalPages } }`. The handoff called the object `pagination`; it is `meta` here so every list looks the same.
- Edits write the audit log (`TOUR_CREATED`, `TOUR_UPDATED`, `TOUR_ARCHIVED`, `CATEGORY_CREATED`, `CATEGORY_DEACTIVATED`, `CUSTOM_TOUR_REQUESTED`, `CUSTOM_TOUR_STATUS_CHANGED`) with field names or status moves, never prices or text.

## Rules worth knowing

**OTPs and links**

- A code is 6 digits, valid for 10 minutes, usable once, and dead after 5 wrong tries.
- Asking for a new code replaces the old one. Resend has a 60 second cooldown.
- `resend-otp` and `forgot-password` answer the same whether or not the email exists, so they cannot be used to find registered addresses.
- `verify-reset-token` checks a code without using it up. `reset-password` then consumes it.
- An invite link is valid for 48 hours and works once. Resending an invite cancels the previous link.

**Passwords**

- Resetting or changing a password signs out every other device. Changing it keeps the current device signed in with fresh tokens.
- Accounts created through Firebase have no password. If they have an email, they can set one with forgot-password. Phone-only Firebase accounts have no email, so they cannot use any email flow.

**Admin safeguards** (`services/userService.js`)

- An admin cannot change their own status or role.
- The last active admin cannot be suspended, deactivated or demoted.
- Only the `invitable` roles (ADMIN, STAFF) can be created by an admin or switched between each other. B2B and B2C stay what they registered as.
- Permissions can only be given to roles with `assignablePermissions`. Moving someone to ADMIN clears their list.
- A never-verified account cannot be activated by an admin. It becomes active when the person verifies.
- Every one of these changes is written to the audit log with the old and new value.

**Profiles.** A profile can be changed by exactly two parties: **the person themselves, and an admin.** Nobody else.

| Who changes | Route | Fields |
| --- | --- | --- |
| The person, any role | `PATCH /api/b2c/profile`, `/api/b2b/profile`, `/api/staff/profile`, `/api/admin/profile` | `name`, `phone` (agency owners also `address`, `businessType`) |
| An admin, for someone else | `PATCH /api/admin/users/:id` | `name`, `phone` |
| An admin, for an agency | `PATCH /api/admin/b2b/:id` | `companyName`, `licenseNo`, `businessType`, `address` |

- **The person always comes from the token**, never from the URL or body. There is no route that names another person, and a foreign `id`, `_id` or `userId` in the body is ignored.
- Two layers enforce this: zod drops unknown fields, and the controller takes the id from the token. Removing one layer alone opens nothing; the tests fail if both go.
- Every other role gets `403` on the admin routes, including staff who hold every permission.
- A changed phone is marked unverified again.
- Agency owners cannot change `companyName` or `licenseNo` (a change needs a new review). An admin, as the reviewer, can.
- Email, role, status, permissions and partner id cannot be changed through any profile route. Roles, status and permissions have their own admin actions. Changing an email needs a re-verification flow that is not built yet (see `documentation/ToDo.md`).
- An admin edit is written to the audit log (`PROFILE_UPDATED`) with the field names, never the values.

**B2B documents**

- Owners can add documents while the application is `PENDING`, `UNDER_REVIEW` or `REJECTED`. After approval the set is locked.
- A partner can hold at most 10 documents.
- Reviewing a document (`VERIFIED` or `REJECTED`) is separate from approving the partner. Approval is always an admin decision.

## Environment variables

All are read in `config/env.js`.
`.env.example` holds the variables you normally set; every other variable here is optional and has a default.

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV`, `PORT` | Mode and port | `development`, `5000` |
| `MONGODB_URI` | Database (required in production) | local MongoDB |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOKEN_HASH_SECRET` | Three different secrets | none, required |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Token lifetimes | `15m`, `7d` |
| `CLIENT_URL`, `ADMIN_URL` | CORS origins (comma separated lists work) | `localhost:5173`, `localhost:5174` |
| `APP_URL` | Base URL in emailed links | first `CLIENT_URL` |
| `TRUST_PROXY` | Number of reverse proxies in front of the app | off |
| `COOKIE_SAME_SITE`, `COOKIE_SECURE`, `COOKIE_DOMAIN` | Refresh cookie settings | `lax`, on in production |
| `OTP_EXPIRES_MINUTES`, `STAFF_INVITE_EXPIRES_HOURS` | Code and invite lifetime | `10`, `48` |
| `OTP_RESEND_COOLDOWN_SECONDS` | Minimum gap between two codes for the same account | `60` |
| `BCRYPT_COST` | Password hashing cost | `12` |
| `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`, `APP_NAME` | Email delivery | none |
| `EMAILJS_OTP_TEMPLATE_ID` | Optional separate template for emails that carry a code | uses `EMAILJS_TEMPLATE_ID` |
| `APP_TIMEZONE` | Time zone for the `{{time}}` value in emails | `Asia/Dhaka` |
| `EMAIL_PROVIDER` | `emailjs`, or `file` (appends emails to `MAIL_OUTBOX_FILE`, used by the E2E tests only; refused in production). No provider prints an email. | `emailjs` |
| `MAIL_OUTBOX_FILE` | File that receives the emails when `EMAIL_PROVIDER=file` | none |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` or `FIREBASE_SERVICE_ACCOUNT_PATH` | Firebase sign-in | disabled |
| `FIREBASE_ALLOWED_PROVIDERS` | Firebase sign-in methods the API accepts (comma separated) | `google.com` |
| `ADMIN_SEED_NAME`, `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | First admin for `npm run seed` | none |
| `PRIVATE_STORAGE_DIR`, `LOG_LEVEL`, `LOG_PRETTY` | Document folder, log level, colored logs | `storage/private`, `info`, on in a dev terminal |
| `RATE_LIMIT_ENABLED` | Turn rate limiting on or off (it is off only under test) | `true` |
| `SKIP_DOTENV` | `true` stops the server from reading `.env` (set by the E2E stack so a developer's own keys never leak into a test run) | off |

Production refuses to boot without a real `MONGODB_URI`, two different JWT secrets of at least 32 characters, and EmailJS configured.

## Operations

- Logs are structured JSON (`pino`). In a development terminal they are colored and readable (`pino-pretty`, loaded inside the logger, no pipe needed). Set `LOG_PRETTY=false` for plain JSON. Authorization headers, cookies, passwords, tokens and OTPs are redacted, at the top level of a log object and one level down.
- `GET /health` answers 503 while the database is down.
- On start the server builds the database indexes (unique email, phone and license number).
- `SIGTERM` and `SIGINT` close the server and the database, with a 10 second force-exit.
- An unhandled error is logged and the process exits, so a supervisor (pm2, Docker, systemd) restarts a clean one.

## Response envelope

```json
{ "success": true, "message": "Users fetched.", "data": [], "meta": { "total": 0, "page": 1, "limit": 10, "totalPages": 1 } }
{ "success": false, "message": "Password needs a number.", "code": "VALIDATION_ERROR", "errors": [{ "field": "body.password", "message": "Password needs a number." }] }
```

Status codes: 400 bad request, 401 not signed in, 403 forbidden, 404 not found (also used for records that belong to someone else), 409 conflict, 413 too large, 422 validation, 429 rate limited, 500 server error.
Production never returns stack traces or internal messages.

## Endpoints

### Auth (`/api/auth`)

| Method | Path | Access |
| --- | --- | --- |
| POST | `/register` | Public (B2C), rate limited |
| POST | `/b2b/register` | Public (B2B), multipart, rate limited |
| POST | `/verify-otp`, `/resend-otp` | Public, rate limited |
| POST | `/login` | Public, rate limited by IP and email |
| POST | `/firebase` | Public (B2C) |
| POST | `/refresh` | Refresh token (cookie or body) |
| POST | `/forgot-password`, `/verify-reset-token`, `/reset-password` | Public, rate limited |
| POST | `/setup-account` | Invite token |
| POST | `/logout`, `/change-password` | Logged in |
| GET | `/me` | Logged in |

### Admin (`/api/admin`, ADMIN only)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/rbac` | Roles and permissions from `config/rbac.json` |
| GET, POST | `/users` | List (filter by `role`, `status`, `search`) and create an invitable role |
| GET, DELETE | `/users/:id` | Read, or deactivate (soft delete) |
| PATCH | `/users/:id` | Edit someone's `name` and `phone` |
| GET, PATCH | `/profile` | An admin's own profile |
| PATCH | `/users/:id/status` | ACTIVE, SUSPENDED, BLOCKED, INACTIVE |
| PATCH | `/users/:id/role` | Between the invitable roles only |
| PATCH | `/users/:id/permissions` | Roles with `assignablePermissions` only |
| POST | `/users/:id/resend-invite` | Send the invite again |
| POST | `/staff` | Create STAFF with permissions |
| GET | `/b2b`, `/b2b/:id` | List and read partners |
| PATCH | `/b2b/:id` | Edit an agency's company name, license number, business type and address |
| PATCH | `/b2b/:id/approval` | `APPROVED` (needs a trade license), `REJECTED`, `UNDER_REVIEW`, `SUSPENDED` |
| PATCH | `/b2b/:id/documents/:docId` | Mark a document `VERIFIED` or `REJECTED` |
| GET | `/audit-logs` | Security events |

### Tour packages (`/api/tour-categories`, `/api/tours`)

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/tour-categories`, `/api/tour-categories/:id` | Public (optional token) |
| POST, DELETE | `/api/tour-categories`, `/api/tour-categories/:id` | ADMIN, or STAFF with `TOUR_MANAGE` |
| GET | `/api/tours`, `/api/tours/:id` | Public (optional token; the B2B price only for admin, `TOUR_MANAGE` staff and approved agencies) |
| POST, PATCH, DELETE | `/api/tours`, `/api/tours/:id` | ADMIN, or STAFF with `TOUR_MANAGE` (DELETE archives) |
| POST | `/api/tours/custom-requests` | B2C only |
| GET | `/api/tours/custom-requests`, `/api/tours/custom-requests/:id` | B2C (own), ADMIN / `TOUR_MANAGE` staff (all) |
| PATCH | `/api/tours/custom-requests/:id/status` | ADMIN / `TOUR_MANAGE` staff (any allowed move), B2C (cancel own `NEW` request) |

### Role areas

| Method | Path | Access |
| --- | --- | --- |
| GET, PATCH | `/api/staff/profile` | STAFF |
| GET | `/api/staff/partners` | STAFF with `B2B_VIEW` |
| PATCH | `/api/staff/partners/:id/documents/:docId` | STAFF with `DOCUMENT_VERIFY` |
| GET, PATCH | `/api/b2b/profile` | B2B |
| GET, POST | `/api/b2b/documents` | B2B (upload only while the application is open) |
| GET | `/api/b2b/overview` | B2B with an APPROVED partner (operational routes go below it) |
| GET, PATCH | `/api/b2c/profile` | B2C |
| GET | `/api/documents/partners/:partnerId/:docId` | Owner, ADMIN, or STAFF with `DOCUMENT_VIEW` |
| GET | `/health` | Public, reports database status |

## Email (EmailJS)

`utils/mailer.js` sends through the EmailJS REST API.
All wording lives in `services/notificationService.js`.

Variables a template can use:

| Variable | Value |
| --- | --- |
| `{{email}}` or `{{to_email}}` | Recipient. Put one of these in the template's **To Email** field, or EmailJS answers `422 The recipients address is empty`. |
| `{{name}}` or `{{to_name}}` | Recipient name |
| `{{title}}` or `{{subject}}` | Subject line (ignored if the template has a fixed subject) |
| `{{message}}` | The full sentence(s) for that email, including the code when there is one |
| `{{passcode}}` or `{{otp}}` | The 6-digit code, empty for emails without one |
| `{{time}}` | When the code or link stops working, for example `12:46 PM GMT+6` (zone from `APP_TIMEZONE`) |
| `{{app_name}}` | `APP_NAME` |

- One template can serve everything (`EMAILJS_TEMPLATE_ID`).
- If you have a code-only template, set its id as `EMAILJS_OTP_TEMPLATE_ID`: emails that carry a code use it, and all other emails (staff invites, approval notices) use `EMAILJS_TEMPLATE_ID`.
- A code is valid for `OTP_EXPIRES_MINUTES` (default 10). If your template text says "15 minutes", set `OTP_EXPIRES_MINUTES=15` or edit the text.
- The free EmailJS plan has a monthly request limit (200 on yours): every OTP, reset and invite is one request.
Setup steps are in `documentation/ToDo.md`.
OTPs and tokens are stored only as keyed hashes, expire after 10 minutes (invites after 48 hours), work once, and lock after 5 wrong tries.

## Firebase (B2C)

**Only Google sign-in is accepted.** Firebase email and password is not used: customers who want a password register through this API (`/register`, `/verify-otp`, `/login`), which also serves B2B and staff.
A token from any other Firebase sign-in method is refused with `403 FIREBASE_PROVIDER_NOT_ALLOWED`, and nothing is created.
The allowed methods are the setting `FIREBASE_ALLOWED_PROVIDERS` (default `google.com`), so enabling Firebase phone sign-in later is `FIREBASE_ALLOWED_PROVIDERS=google.com,phone` with no code change.
You can also leave **Email/Password** disabled in the Firebase console (Authentication, Sign-in method).
A customer who signed up with Google can add a password later with forgot-password, and then use both ways in; it stays one account.

The client signs in with the Firebase SDK and sends the `idToken` to `POST /api/auth/firebase`.
The server verifies it with `firebase-admin`, finds or creates the B2C user, and returns its own access and refresh tokens.
A Firebase identity is only ever linked to a B2C account, and only when Firebase confirms the email.
An unverified account that someone registered with a password is stripped of that password when the real owner links Firebase, so it cannot be hijacked.

**What a frontend does** (the Firebase web `apiKey`, `authDomain` and `projectId` live in the frontend's own config, never on the server):

```js
const result = await signInWithPopup(getAuth(app), new GoogleAuthProvider());
const idToken = await result.user.getIdToken();

const res = await fetch(`${API}/api/auth/firebase`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // web: lets the refresh-token cookie be stored
  body: JSON.stringify({ idToken })
});
const { data } = await res.json(); // data.accessToken goes in "Authorization: Bearer ..." on every call
```

A mobile app also sends `X-Client-Type: mobile` and receives the refresh token in `data.refreshToken` instead of a cookie.
The web `apiKey` is a public identifier, not a secret, but you can limit it to your own domains in Google Cloud (APIs and Services, Credentials).

**Giving the server its Firebase key** (Firebase console, Project settings, Service accounts, Generate new private key). Pick one:

| Method | How | Best for |
| --- | --- | --- |
| File (recommended locally) | Save the downloaded JSON as `firebase-service-account.json` in the project root (git-ignored) and set `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json`. No `\n` to worry about. | Development |
| Three variables | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` on **one line**, with the `\n` kept exactly as it appears in the JSON, optionally inside double quotes. | Hosts that only take environment variables |

```bash
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvw...\n-----END PRIVATE KEY-----\n"
```

- Copy the value of `private_key` from the JSON including everything between its quotes. Do not turn the `\n` into real line breaks.
- Quoted or unquoted both work. The server turns the `\n` escapes into real line breaks.
- A key pasted over several lines is caught at boot with `FIREBASE_PRIVATE_KEY looks cut off`.
- Never commit the key. In production, set it through the host's secret store.

## Security checklist (built in)

- bcrypt (cost 12) for passwords, password policy of 8 to 64 characters with upper, lower, number and symbol.
- Short-lived access token (15 minutes) and rotating refresh token (7 days), both pinned to HS256 and carrying `tokenVersion`.
- `helmet`, strict CORS allow-list, `hpp`, `express-mongo-sanitize`, 100 kB body limit.
- Rate limits (`middleware/rateLimitMiddleware.js`), answering `429` with `Retry-After`, `RateLimit-*` headers and `code: RATE_LIMITED`:

  | Scope | Limit | Counted per |
  | --- | --- | --- |
  | Every `/api` route | 300 per 15 minutes | IP |
  | `POST /login` | 10 per 15 minutes | IP + email |
  | `POST /firebase` | 30 per 15 minutes | IP |
  | `verify-otp`, `resend-otp`, `verify-reset-token`, `reset-password`, `setup-account` (one shared quota) | 5 per 15 minutes | IP + email |
  | `POST /forgot-password` | 3 per hour | IP + email |
  | `POST /register`, `POST /b2b/register` (one shared quota) | 10 per hour | IP |
  | `POST /refresh` | 30 per 15 minutes | IP |
  | `POST /change-password` | 5 per 15 minutes | signed-in user |

  Counters are in memory (see `documentation/ToDo.md` for the Redis store when you run several instances). Behind a reverse proxy, set `TRUST_PROXY`, otherwise every client looks like the proxy's IP.
- Uploads: type and size checked, stored under a generated name with an extension derived from the MIME type, in a private folder. Documents are streamed only after an ownership check, always as attachments, never cached.
- Audit log for login, logout, failed login, password changes and resets, role, permission and status changes, B2B decisions, document reviews, and token-reuse detection. Passwords and raw tokens are never logged.

## Add a new feature (recipe)

1. **Model** in `models/Thing.js`. Put enums in `config/constants.js`. New permissions go in `config/rbac.json`.
2. **Validation** in `validations/thing.validation.js` (zod).
3. **Service** in `services/thingService.js`. Throw `ApiError` for every failure.
4. **Controller** in `controllers/thingController.js`. One service call per handler, wrapped in `asyncHandler`.
5. **Routes** inside the role area that owns it, for example `routes/b2c/thingRoutes.js`, mounted from that area's `index.js`.
6. **Guards**: the area already runs `authenticate` and `requireRole`. Add `requirePermission(...)` for staff features and `checkOwnership(...)` for single records.
7. **Tests** in `test/unit/`: one case per role, plus one for another user's record.

Route order rule: static paths (`/tree`, `/stats`) go before `/:id`, or Express will treat them as ids.

## Before production

See section 3 of `documentation/ToDo.md`.
The short version: real secrets, `TRUST_PROXY`, real origins, EmailJS and Firebase keys, change the seeded admin password, and move rate limits and uploads to shared storage if you run more than one instance.
