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
- [x] **Interactive API documentation:** Swagger UI at `/docs`, served from the same OpenAPI file, with the groups and operations in a fixed order and an Authorize box that fills itself after a login. Never served in production (404, and no setting turns it on); `swagger-ui-express` is a dev dependency. Possible extra: a link to it from the test console.
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

## 4. Tour packages module (built)

Source: `documentation/Dynamic_Travel_Tour_Package_Backend_Handoff.md`.
It replaces the frontend mock stores for tour categories, tour packages and custom tour requests with persistent REST APIs.
The module reuses the guards from the auth layer and follows the same layering (route, middleware, zod validation, controller, service, model).
It is built and tested on branch `feat/tourPackage-oct-05`; section 4.1 records what was done and where the build differs from the first plan.

### 4.1 Plan and what was built

| Step | Work | Notes |
| --- | --- | --- |
| 1 | `TourCategory` model, with `name`, `nameKey` (lower-cased, unique index), `slug`, `legacyId` (the frontend's `cat_beach` style id), `isActive` | Case-insensitive uniqueness comes from the `nameKey` index, so it holds under concurrent requests. |
| 2 | `Tour` model with an embedded `itinerary` array (`day`, `title`, `description`) | `status` enum: `draft`, `published`, `unpublished`, `archived`. Itinerary days must be unique positive integers and are returned in ascending order. |
| 3 | `CustomTourRequest` model | Fields from handoff section 8, plus `userId` when the sender is signed in, and a `status` workflow. Proposed statuses: `NEW`, `IN_REVIEW`, `QUOTED`, `CONFIRMED`, `CANCELLED`. |
| 4 | `validations/tour.validation.js` | zod schemas strip unknown fields. No negative `price`, `b2bPrice`, `seats` or `durationDays`. `endDate` on or after `startDate`. `travelers` at least 1. Status from the enum only. |
| 5 | Services: `tourCategoryService`, `tourService`, `customTourService` | No `req` or `res` inside. List filters: `search`, `category`, `country`, `destination`, `status`, `minPrice`, `maxPrice`, `durationDays`, `page`, `limit`, `sort`, using `utils/pagination.js`. |
| 6 | Controllers and routes | Public reads, writes behind `authenticate` and `requirePermission(TOUR_MANAGE)`. See question Q1 for the URL layout. |
| 7 | Visibility rules in the service layer, not the route | The public sees only `published` tours. `b2bPrice` is removed from the response unless the caller is ADMIN, STAFF with `TOUR_MANAGE`, or a B2B user with an APPROVED partner. |
| 8 | Delete means archive | Tours become `archived`, categories become `isActive: false`. A category that still has tours cannot be removed. |
| 9 | Audit log | New actions for tour and category create, update, archive, and for custom request status changes. Field names only, never values, as for profile edits. |
| 10 | Seed script `npm run seed:tours` | Idempotent. Creates the 8 default categories (keeping their `cat_` ids in `legacyId`) and the Cox's Bazar Beach Escape sample tour. |
| 11 | Tests | Jest: one case per role per route, duplicate category, invalid dates and prices, missing tour id, `b2bPrice` hidden or shown, archived tours hidden. Playwright: add the new routes to the role matrix, a manage-and-publish journey, a custom request journey. |
| 12 | Docs | Endpoints in `scripts/openapi/endpoints.js` then `npm run openapi`. README endpoint tables, user stories for each role, and the test console gets a Tours section. |

Permission keys: `TOUR_MANAGE` already existed in `config/rbac.json` and is reused for categories, tours and custom requests. No new key was added.

Where the build differs from the plan:

- Steps 1 to 12 are done. Lists carry both `meta` and `pagination`, see 4.2.
- `PUT` is not offered, only `PATCH` (a partial update). The handoff said "PUT/PATCH"; one verb avoids two meanings.
- A tour also carries `legacyId` (for `tour_205`), not only categories. `GET` accepts either id.
- An empty query value (`?status=`) counts as not given, for every route that validates a query. Postman sends blank filters.
- `GET` routes with an optional token treat a header with nothing after `Bearer ` as a visitor (Postman sends that for an empty variable).
- Re-creating the name of a removed category switches that category on again instead of adding a second one.

### 4.2 Response shape

Decided: every list answers with both `meta` and `pagination`, the same object `{ total, page, limit, totalPages }`.
`meta` is what the rest of the API already used, `pagination` is the name the handoff asked for, and both come from the one shared `sendResponse`, so the auth lists (users, partners, audit logs) have it too. Nothing existing breaks.

### 4.3 Questions and decisions

- [x] **Q1. URL layout.** Decided: flat URLs as in the handoff (`/api/tour-categories`, `/api/tours`), public reads, writes behind `authenticate` and `requirePermission(TOUR_MANAGE)`.
- [x] **Q2. Who writes.** Decided: admin, and staff holding `TOUR_MANAGE`. No new permission.
- [x] **Q3. Read-only permission.** Decided: not needed, so no `TOUR_VIEW`. Draft, unpublished and archived tours are visible to admin and `TOUR_MANAGE` staff only.
- [x] **Q4. Who sends a custom request.** Decided: B2C users only (signed in). Anonymous visitors, B2B, staff and admin cannot submit. Every request has a `userId`.
- [x] **Q5. Who reads and updates.** Decided: a B2C user reads only their own requests. Admin and `TOUR_MANAGE` staff list all and change status. The customer may cancel their own request while it is `NEW`.
- [x] **Q6. Statuses.** Decided: `NEW`, `IN_REVIEW`, `QUOTED`, `CONFIRMED`, `CANCELLED`. Transitions to be fixed in the validation file and tested.
- [x] **Q7. `b2bPrice`.** Decided: only admin, `TOUR_MANAGE` staff and B2B users with an APPROVED partner. Never in a public response.
- [x] **Q8. Public visibility.** Decided: the public sees `published` tours only. An unpublished tour is not reachable by direct link either.
- [x] **Q9. Duplicate category name.** Decided: no two categories share a name in any letter case. Creating a duplicate returns the existing record with 200, as the frontend mock does.
- [x] **Q10. `seats`.** Decided: total capacity, a plain number set by staff. Availability is a booking-module concern later.
- [x] **Q11. `rating`.** Decided: optional, staff-editable, validated 0 to 5.
- [x] **Q12. Currency.** Decided: fixed list `BDT`, `USD`, `EUR`, kept in config.
- [x] **Q13. Images.** Decided: `coverImage` and `gallery` are http(s) URL strings only. Upload is a later task.
- [x] **Q14. Itinerary.** Decided: no count rule. Days are unique positive integers. A published tour needs at least one day, and no day above `durationDays`.
- [x] **Q15. Filters.** Decided: `search` matches name, destination and country (case-insensitive). Default sort is newest first, and `sort` accepts `price`, `durationDays`, `rating`, `createdAt` with a leading minus for descending. `category` takes one id or several, comma separated. `minPrice` and `maxPrice` filter the public price. `durationDays` is an exact match. Page size is 10 by default and 100 at most.
- [x] **Q16. Category ids.** Decided: the frontend's `cat_...` ids are kept in `legacyId`, and `GET` accepts either id. Responses carry the new id and `legacyId`.
- [x] **Q17. Ownership.** Decided: built in this repository on `feat/tourPackage-oct-05`, branched from `main` after PR #1 was merged.

### 4.4 Left to do in this module

- [ ] **Frontend hand-over:** lists carry `meta` and `pagination` (the same object), `b2bPrice` is absent for anyone not allowed to see it (do not treat a missing field as 0), and either id form is accepted while the `cat_` and `tour_` ids are phased out.
- [ ] **Emails for custom requests:** tell the customer when the status changes (a quote is waiting), and tell the consultants when a new request arrives. The audit entries already exist; only the trigger and the wording in `services/notificationService.js` are missing. Needs the general EmailJS template from section 1.1.
- [ ] **Image upload** for `coverImage` and `gallery` (today they are http or https links). Needs a public image store, separate from `storage/private`.
- [ ] **Booking and seat availability.** `seats` is total capacity. When a booking module exists it must track availability on its own.
- [ ] **Reviews and rating.** `rating` is staff-edited until a review module can compute it.
- [ ] **Limits on tour writes.** Create, edit and archive rely on the general 300 per 15 minutes per IP, like the other signed-in writes (see section 2).
- [ ] **Text search at scale.** Search uses a case-insensitive pattern on three fields, which is fine for a catalogue of hundreds. Add a text index if the catalogue grows into the thousands.

## 5. Membership module (built)

Source: `documentation/Membership_Module_Backend_API_Spec.md` (version 1.0, 7 October 2026).
Admins sell memberships to B2C customers. A membership gives a percentage discount on tours and visa processing for a fixed period.
Payment is recorded by hand (bKash, Nagad, bank, cash), so there is no payment gateway.
The module reuses the guards from the auth layer and the layering of the tour module (route, middleware, zod validation, controller, service, model).
It is built and tested on branch `feat/membership-oct-07`. Section 5.1 records what was done and where the build differs from the spec.

### 5.1 Plan and what was built

| Step | Work | Notes |
| --- | --- | --- |
| 1 | Permission `MEMBERSHIP_MANAGE` in `config/rbac.json` | Admin always passes; staff only when an admin grants it. |
| 2 | `MembershipPlan` model | Case-insensitive unique name (a `nameKey` index), `sortOrder` = highest + 1, a cap of 0 saved as `null`, features trimmed and empties dropped. |
| 3 | `Membership` model | Embedded `planSnapshot` and `payment`. A partial unique index allows one stored-active membership per customer (rule R1). `isDeleted` and `deletedAt` for the soft delete. The customer is the existing `User` with role `B2C`; there is no separate customer model. |
| 4 | `validations/membership.validation.js` | zod schemas that strip unknown fields. The dashboard sends whole plan objects, so `id`, `sortOrder` and timestamps are ignored. |
| 5 | Dates in Asia/Dhaka (`services/membershipDates.js`) | From `APP_TIMEZONE`. `dayjs` with the utc and timezone plugins, which clamps month ends. |
| 6 | Services: `membershipPlanService`, `membershipService`, `membershipReportService` | Effective status on every read (R4), `daysLeft` computed, the create steps in the spec's order, a duplicate-key race answered with the same 409. |
| 7 | Routes and controllers | Paths from the spec under `/api`, guards on each route. Answers in the spec's shapes, see 5.2. |
| 8 | `GET /api/b2c/memberships` | A customer reads only their own, read-only, without the admin's cancel reason. |
| 9 | `getActiveMembership` and `membershipDiscount` | Section 8 of the spec. Built and tested so the booking module can call them. Nothing applies a discount yet. |
| 10 | Nightly expiry | `node-cron` at 00:05 Dhaka time, and once at start (decision Q5). `MEMBERSHIP_EXPIRY_JOB=false` turns it off. |
| 11 | Audit log | `MEMBERSHIP_PLAN_*` and `MEMBERSHIP_*` actions. Field names and ids only, never prices or transaction ids. |
| 12 | `npm run seed:membership` | The four plans from the spec, idempotent. The prices are placeholders (see 5.4). |
| 13 | Tests and docs | Jest (83 new), Playwright (15 new), the role matrix, OpenAPI (14 new operations), README, user stories, a Membership section in the test console. |

Where the build differs from the spec:

- **End date.** Decision Q7: the start day counts as day 1, so a 15-day plan from 1 Oct ends on 15 Oct (the spec's R3 says 16 Oct). The spec's worked examples change with it.
- **Delete.** Decision Q4: a soft delete instead of the spec's hard delete (its own recommendation D3).
- **Permission.** The spec says admin only; `MEMBERSHIP_MANAGE` lets an admin hand the work to staff (Q2).
- **Customer read.** `GET /api/b2c/memberships` is an addition for the customer's own view (Q3).
- **Paths** are under `/api`, not `/api/v1`.
- **Messages.** The duplicate-membership message uses a plain hyphen where the spec has an en dash.
- **Time of the job.** Besides 00:05, the job also runs once when the server starts, so a night the server slept through is caught up.

### 5.2 Response shapes (decision Q1)

The membership routes follow the spec exactly, so the dashboard works without a frontend change.

- Lists: `{ "items": [...], "total": n }` with no pagination. The customer history list has `items` only.
- Ids are strings in a field called `id` (not `_id`), also `customerId` and `planId`.
- Single answers are the object itself, not wrapped. Create is `201`, the rest `200`.
- Delete answers `{ "success": true, "id": "..." }`.
- Errors keep the API's usual shape, which already carries the `message` the dashboard shows: `{ success: false, message, code?, errors? }`. A failed validation on these routes is `400` (the rest of the API uses `422`), as the spec asks.
- This is a deliberate exception to the `{ success, message, data, meta, pagination }` envelope. The tour and auth routes are not touched.

### 5.3 Decisions

- [x] **Q1. Response shape.** Follow the spec exactly (5.2).
- [x] **Q2. Who manages.** Admin, and staff holding the new `MEMBERSHIP_MANAGE` permission.
- [x] **Q3. Customer view.** A B2C customer reads their own memberships through `GET /api/b2c/memberships` (read-only).
- [x] **Q4. D3, deleting a membership.** Soft delete. The row leaves lists and counts, its payment still counts in revenue, and a deleted membership no longer blocks a new one.
- [x] **Q5. R5, storing the expired status.** An in-process `node-cron` job at 00:05 Dhaka time, as the spec sketches. The API is correct between runs anyway, because every read reports the effective status.
- [x] **Q6. D1, future start date.** Always `active` on creation, as the dashboard does. `pending` is never created in phase 1.
- [x] **Q7. D8, end date.** The start day counts as day 1: the end is the start plus the duration minus one day, at the end of that day. Month-end clamping comes before the minus one day (31 Jan plus 1 month is 28 Feb, so the end is 27 Feb).
- [x] **Q8. D2, transaction id.** Always optional. Payments are recorded by hand, so the id is kept for the record only and nothing validates it.
- [x] **D5. Stale customer copy.** The name, phone and email are copied at creation, and the copies are updated when the customer's own details change (their profile, or an admin's edit).
- [x] **D7. Refunds.** Cancelling does not touch `payment.status`, and there is no refund endpoint in phase 1.
- [x] **What a customer sees.** The same fields as the admin, except `cancelReason` (an internal note).
- [ ] **Corporate subscription.** Section 25 of the requirements also names it. The spec covers memberships only, so it stays out of scope until it has its own document.

### 5.4 Needs you

- [ ] **Real plan prices, durations and discounts.** The four plans from the spec (Starter 15 days BDT 500, Basic 30 days 900, Silver 6 months 2500, Gold 1 year 4500) are placeholders. They will be given later. Until then `npm run seed:membership` loads them as they are, and any plan can be edited from the dashboard.
- [ ] **Confirm with the frontend developer** that the dashboard's `apiClient` returns `response.data` directly (the spec asks for this), and that the API base is `/api`, not `/api/v1`.
- [ ] **Run the job on one server or several.** The nightly job is idempotent, so both are safe. A host that puts the app to sleep (cPanel, Passenger) can miss 00:05, but the start-up run and the effective status keep everything correct.

### 5.5 Left to do in this module

- [ ] **Apply the discount when booking.** Needs the booking module. It should call `getActiveMembership(userId)` and `membershipDiscount(...)`, and store the membership id and the discount amount on the booking, so reports can show the discount given (spec section 8).
- [ ] **Public purchase flow.** `source: 'online'` is reserved in the model. A customer cannot buy a membership themselves yet, and no payment gateway exists.
- [ ] **Refund endpoint.** `payment.status` can be `refunded`, but nothing sets it.
- [ ] **Emails.** Tell the customer when a membership is sold, is about to expire, or ends. Needs the general EmailJS template from section 1.1.
- [ ] **Pagination** of the membership list (spec D6). The dashboard loads every row today.
- [ ] **Limits on writes.** Selling, cancelling and extending rely on the general 300 per 15 minutes per IP, like the other signed-in writes (see section 2).

## 6. Outside this part (other modules)

None of this exists yet, and none of it is part of the auth work.
When these modules are built they reuse the guards from this layer (`authenticate`, `requireRole`, `requirePermission`, `checkOwnership`, `requireApprovedPartner`).
Section numbers refer to `Dynamic Travel Agency web - Google Docs.md`.

| Module | Section | Guard to reuse |
| --- | --- | --- |
| Public website content | 13 | none (public) |
| Visa processing, checklist, apply, status check, notifications | 14 to 17 | B2C: ownership by user. Staff: `VISA_VIEW`, `VISA_UPDATE`. |
| Dedicated tours and custom tour requests (built, see section 4), flight inquiries | 18, 19 | Staff: `TOUR_MANAGE`, `FLIGHT_INQUIRY_MANAGE`. |
| B2B dashboard, passport pickup, commission and wallet, invoices | 21 to 24 | `requireApprovedPartner` plus ownership by `partnerId`. Staff: `PASSPORT_VIEW`, `PASSPORT_UPDATE`. |
| Membership (built, see section 5) and corporate subscription | 25 | Staff: `MEMBERSHIP_MANAGE`. Customers: ownership by user. |
| Admin dashboard, reports | 27 | `requireRole(ADMIN)`, or `REPORT_VIEW` for staff. |
| General document management (visa documents, B2C uploads) | 29 | Reuse `privateFields()` in `middleware/uploadMiddleware.js` and the private download pattern in `routes/documentRoutes.js`. |
| Notification catalogue (SMS and email triggers) | 31 | Use `services/notificationService.js` and `utils/mailer.js`. |
| Deployment, hosting, backups | 35, 36 | Not backend code. |

## 7. Removed on purpose

Kept out of this project because they are not part of the auth work.
They were removed from the code base and can be rebuilt from this list if a module needs them.

- The sample `Post` feature (model, service, routes, tests), `slugify`, and the public `/uploads` image folder.
- The platform-wide design files (`01-features.md`, `02-api-documentation.md`, `03-database.dbml.md`), which describe a PostgreSQL and TypeScript design for the whole product. The decision is to stay on Express and MongoDB.
- The PDF copy of the Auth guide. The Markdown copy stays.
