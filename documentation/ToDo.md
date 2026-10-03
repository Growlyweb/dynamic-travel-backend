# ToDo - what is left to build

Scope: the **Backend, Authentication and Authorization** part of the platform (section 30 of the requirements document), plus the B2B registration and B2C login rules that belong to it.
What is already built is described in `README.md`.
Items marked **YOU** need something from you (an account, a key, a decision).
Everything else is a code task.

## 1. Blocked on you

These stop the feature from working for real, not from being tested.

### 1.1 EmailJS

Codes and invite links are never printed in the server log or returned by the API: they reach people only by email.
Until these are set, no email can be sent: the account is still created, the response says `otpSent: false`, and the server logs `EmailJS is not configured`.
Production refuses to boot without them.

- [ ] **YOU (this is what blocks email right now):** in the EmailJS dashboard open **Account > Security** and turn on the option that allows API calls from non-browser applications. Until then every send fails with `403: API access from non-browser environments is currently disabled`. Registration still succeeds (the response has `otpSent: false`), so after enabling it use **Resend code**.
- [ ] **YOU:** put the four values into `.env`:
  - `EMAILJS_SERVICE_ID` (Email Services, the Gmail service you connected)
  - `EMAILJS_TEMPLATE_ID` (set)
  - `EMAILJS_PUBLIC_KEY` (Account > General). It is not secret, but it still belongs in `.env`, not in `.env.example`.
  - `EMAILJS_PRIVATE_KEY` (Account > Security, the server-side access token)
- [x] The "One-Time Password" template works with the API: **To Email** `{{email}}`, body `{{passcode}}` and `{{time}}`. Server access is enabled and a real send returned 200.
- [ ] **YOU:** tidy that template: its image is broken, `[Company Name]` is still a placeholder, and it says "valid for 15 minutes" while codes last 10 (set `OTP_EXPIRES_MINUTES=15` in `.env`, or edit the text).
- [ ] **YOU:** staff invites and approval notices have no code, so they need a general template that shows `{{message}}`. Create it, put its id in `EMAILJS_TEMPLATE_ID`, and move the current OTP template's id to `EMAILJS_OTP_TEMPLATE_ID`. (The free plan's template limit may apply.)
- [ ] **YOU (alternative, one template for everything):** create ONE template. Set "To Email" to `{{to_email}}`, the subject to `{{subject}}`, and the body to include `{{message}}`. One template serves OTPs, resets, invites and approval notices because the wording is built in `services/notificationService.js`. Optional variables: `{{to_name}}`, `{{otp}}`, `{{app_name}}`.
- [ ] Send a real test: register a B2C user with your own address and check the inbox and the spam folder.
- [ ] Check the free plan limits (monthly emails, requests per second, template count). If they are too small, switch the provider inside `utils/mailer.js` (Nodemailer or similar). Nothing else changes.

### 1.2 Firebase (B2C sign-in)

Until these are set, `POST /api/auth/firebase` answers 503 `FIREBASE_DISABLED`.
Everything else works.

- [x] Google is enabled in the Firebase project. Decision: **Google only.** The API refuses tokens from Firebase email and password (`FIREBASE_PROVIDER_NOT_ALLOWED`); customers use this API's own register and login. Optionally leave **Email/Password** disabled in the Firebase console too. Other methods (phone) are switched on with `FIREBASE_ALLOWED_PROVIDERS`.
- [x] Service-account key for project `travelms-dev` is saved as `firebase-service-account.json` (git-ignored, owner-only) and `FIREBASE_SERVICE_ACCOUNT_PATH` points at it. Verified: the app initialises Firebase from it and Google accepts the key.
- [ ] **YOU:** the key was pasted into a chat, so treat it as exposed. In Google Cloud Console > IAM > Service accounts > Keys, delete it and generate a new one, then replace the file. For production, set the key through the host's secret store, never a file in the repo.
- [ ] Tell the frontend and mobile teams the flow: sign in with the Firebase SDK, send `{ "idToken": "..." }` to `POST /api/auth/firebase`, then use OUR `accessToken` for every call. Mobile adds the header `X-Client-Type: mobile` to get the refresh token in the body.
- [x] A real Google sign-in has been run end to end from the test console: a real ID token reached `POST /api/auth/firebase` and created a B2C account (`/me` returned 200). The automated tests still mock the token check.

### 1.3 Decisions

- [ ] **Phone OTP provider (kept open on purpose).**
  - Option A: Firebase Phone Auth for B2C only. The client verifies the number, then calls `/api/auth/firebase`, which already sets `phoneVerified`. The only backend step is allowing it: `FIREBASE_ALLOWED_PROVIDERS=google.com,phone` (Google only is the default).
  - Option B: an SMS gateway (Twilio or a local BD provider). Needs `utils/sms.js` implemented, a `PHONE_VERIFY` entry in `OTP_PURPOSE` (`config/constants.js`), `verify-phone` and `resend-phone-otp` routes, and per-phone rate limits.
  - B2B and staff cannot use Firebase, so they need option B if phone verification is wanted for them.
- [ ] Confirm the **authentication method** for customers. The requirements say it "should be confirmed before implementation" (section 26). Built today: email and password with email OTP, plus Firebase for one-click style sign-in.
- [ ] Confirm the **permission list** and the **admin roles** with the business team (items 18 and 20 of the decision log). They live in `config/rbac.json`, so a change is a JSON edit and a restart.
- [ ] Should phone number work as a login identifier and for forgot-password? Today login and reset are email only.
- [ ] Should repeated failed logins lock the account (for example 5 failures, 15 minutes), on top of the current per-IP and per-email rate limit?
- [ ] Should unverified accounts expire? Today a PENDING account keeps its email address until it verifies or an admin removes it.
- [ ] Should admins have two-factor authentication?
- [ ] B2B: may a rejected partner re-apply with the same account? Today they can upload more documents, and an admin can approve later.
- [ ] B2B: is a "request re-review" flow needed after approval? Today documents are locked once approved.

## 2. Left to build in the auth part

Ordered by value.

- [ ] **Document access history.** Section 29 asks for "document history". Add an audit entry (or a small `DocumentAccessLog`) every time a private document is downloaded.
- [ ] **Email change with re-verification.** Profile updates deliberately cannot change the email today. Needs an OTP to the new address, then `tokenVersion++`.
- [ ] **Account notifications.** Email the user when an admin suspends, reactivates or changes the role of their account. The audit entries already exist, only the trigger is missing.
- [ ] **Welcome and "new login" emails** (optional, depends on the notification catalogue the team agrees).
- [ ] **Magic-byte file sniffing** on upload. Today the type comes from the client's MIME header, and the stored extension is derived from it, which already stops `.html` being served back.
- [ ] **Queue for emails.** Today forgot-password sends in the background, but the database work still differs slightly for known and unknown emails.
- [ ] **Audit retention and alerts.** TTL or archiving for `AuditLog`, and an alert on repeated `LOGIN_FAILED` or any `TOKEN_REUSE_DETECTED`.
- [ ] **Per-user limits on authenticated writes.** Only `change-password` has its own limiter today. Other signed-in routes (document upload, profile update, admin actions) rely on the general 300 per 15 minutes per IP. Add per-user limits if the team wants them (the requirements ask for upload limits).
- [ ] **CSRF note.** The refresh cookie is `SameSite=lax` and scoped to `/api/auth`, which is enough for a same-site frontend. If you move to `COOKIE_SAME_SITE=none` (frontend on another site), add a CSRF token or an `Origin` check on `/refresh` and `/logout`.
- [ ] **Shared rate-limit store** (Redis) once more than one instance runs. Pass a `store` to `makeLimiter` in `middleware/rateLimitMiddleware.js`.
- [x] **OpenAPI file for the frontend teams and Postman:** `documentation/openapi.json`, generated by `npm run openapi` and guarded by tests. Possible extra: a ready Postman collection with a script that saves the access token after login automatically.
- [x] **End-to-end tests:** Playwright, 95 tests (`npm run e2e`): the API over real HTTP and the test console in Chrome. See the README.
- [ ] **ESLint, Prettier and CI** that runs `npm test` and `npm run e2e`. The E2E run needs Chrome on the runner, or `npx playwright install --with-deps chromium` with `PW_CHANNEL=chromium`.
- [ ] Phone OTP, after decision 1.3.

Frontend rules to hand over:

- [ ] Never send two refresh calls at once. A second call with an already-rotated token is treated as theft and signs the user out everywhere. Serialise refreshes.
- [ ] Send the access token as `Authorization: Bearer ...`. The web refresh token is an `httpOnly` cookie scoped to `/api/auth`.
- [ ] Use `GET /api/admin/rbac` to fill role and permission pickers in the admin UI, and `GET /api/auth/me` for route guards.

## 3. Before production

- [ ] Three different secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOKEN_HASH_SECRET`. The app refuses placeholders.
- [ ] Run `npm run seed` once, log in, then change the seeded admin password.
- [ ] Real `CLIENT_URL`, `ADMIN_URL`, `APP_URL`.
- [ ] `TRUST_PROXY=1` (or the real proxy count) behind nginx or a PaaS. Otherwise rate limits and audit logs see the proxy's IP.
- [ ] `COOKIE_SAME_SITE=none` and HTTPS when the frontend and API are on different sites.
- [ ] Shared storage for `storage/private` if more than one instance runs, and back it up together with the database.
- [ ] `npm audit` reports moderate issues that come from `firebase-admin` through packages we do not use (Firestore, Storage), and a high one in `braces` (dev only, via nodemon). Re-check when `firebase-admin` releases a fix.

## 4. Outside this part (other modules)

None of this exists yet, and none of it is part of the auth work.
When these modules are built they reuse the guards from this layer (`authenticate`, `requireRole`, `requirePermission`, `checkOwnership`, `requireApprovedPartner`).
Section numbers refer to `Dynamic Travel Agency web - Google Docs.md`.

| Module | Section | Guard to reuse |
| --- | --- | --- |
| Public website content | 13 | none (public) |
| Visa processing, checklist, apply, status check, notifications | 14 to 17 | B2C: ownership by user. Staff: `VISA_VIEW`, `VISA_UPDATE`. |
| Dedicated and custom tours, flight inquiries | 18, 19 | Staff: `TOUR_MANAGE`, `FLIGHT_INQUIRY_MANAGE`. |
| B2B dashboard, passport pickup, commission and wallet, invoices | 21 to 24 | `requireApprovedPartner` plus ownership by `partnerId`. Staff: `PASSPORT_VIEW`, `PASSPORT_UPDATE`. |
| Membership and corporate subscription | 25 | Ownership by user. |
| Admin dashboard, reports | 27 | `requireRole(ADMIN)`, or `REPORT_VIEW` for staff. |
| General document management (visa documents, B2C uploads) | 29 | Reuse `privateFields()` in `middleware/uploadMiddleware.js` and the private download pattern in `routes/documentRoutes.js`. |
| Notification catalogue (SMS and email triggers) | 31 | Use `services/notificationService.js` and `utils/mailer.js`. |
| Deployment, hosting, backups | 35, 36 | Not backend code. |

## 5. Removed on purpose

Kept out of this project because they are not part of the auth work.
They were removed from the code base and can be rebuilt from this list if a module needs them.

- The sample `Post` feature (model, service, routes, tests), `slugify`, and the public `/uploads` image folder.
- The platform-wide design files (`01-features.md`, `02-api-documentation.md`, `03-database.dbml.md`), which describe a PostgreSQL and TypeScript design for the whole product. The decision is to stay on Express and MongoDB.
- The PDF copy of the Auth guide. The Markdown copy stays.
