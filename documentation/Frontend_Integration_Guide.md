# Frontend integration guide

Questions a frontend developer is likely to ask while connecting the web apps to this API, each with the answer from the code.

**Scope.** Web only (the customer site and the admin dashboard).
Mobile is not part of this phase, so this guide leaves out mobile token handling.

**Where the full detail lives**

| What | Where |
| --- | --- |
| Every endpoint, body, query, example response and error code | `documentation/openapi.json` (import into Postman, steps in `README.md`) |
| Every flow clickable in a browser | `npm run console`, then open http://localhost:5173 |
| Who may do what | `documentation/User-Stories.md` and the `config/rbac.json` file |
| What is built and what is open | `documentation/ToDo.md` |

Nothing here has been tried against a real frontend yet.
Section 14 lists what still needs confirming with the frontend developer.

---

## 1. Setup

### Q1.1 What is the base URL, and why do I get a CORS error?

In development the API runs on `http://localhost:5000`, and every route starts with `/api`.
The browser's origin must be listed in the API's `CLIENT_URL` (customer site, default `http://localhost:5173`) or `ADMIN_URL` (dashboard, default `http://localhost:5174`).
Several origins can be listed, separated by commas.
A page opened straight from disk has the origin `null`, which is always refused.
CORS allows credentials, so the browser may send the refresh cookie.
The API exposes the headers `Retry-After`, `RateLimit`, `RateLimit-Policy` and `Content-Disposition` to the page.

### Q1.2 Do I need `credentials: 'include'`?

Yes, on every call to `/api/auth/*`.
The refresh token is an `httpOnly` cookie, and the browser only sends it when credentials are included.
With `fetch` that is `credentials: 'include'`, and with axios it is `withCredentials: true`.

### Q1.3 What does the backend need me to tell it?

- The exact origin of each frontend, for `CLIENT_URL` and `ADMIN_URL`.
- The address of the page that handles the staff invitation link (Q4.5).
  That becomes `APP_URL`.
- Whether the frontend and the API will be on the same site.
  If not, the cookie settings change (`COOKIE_SAME_SITE=none` needs HTTPS) and a CSRF check has to be added.
  See `ToDo.md`, sections 2 and 3.

---

## 2. Signing in and staying signed in

### Q2.1 What does a login return?

```json
{
  "success": true,
  "message": "Login successful.",
  "data": {
    "accessToken": "eyJ...",
    "expiresIn": "15m",
    "user": { "_id": "...", "name": "...", "role": "B2C", "permissions": [], "status": "ACTIVE" }
  }
}
```

The refresh token is not in the body.
It arrives as a cookie named `refreshToken`.

### Q2.2 Where do I keep the tokens?

- **Access token:** in memory (a variable or store state), not in `localStorage`.
  It lasts 15 minutes.
  Send it as `Authorization: Bearer <accessToken>`.
- **Refresh token:** nowhere.
  It is an `httpOnly` cookie that JavaScript cannot read.
  It lasts 7 days, is limited to the path `/api/auth`, and is sent only to the refresh and logout calls.

### Q2.3 What happens when I reload the page?

The access token in memory is gone, but the cookie is still there.
On start-up call `POST /api/auth/refresh` with credentials and no body.
If it answers `200` the user is still signed in, and the answer carries a new access token.
If it answers `401` show the login screen.

### Q2.4 When and how do I refresh?

On any `401` from a normal route (not login or refresh), call refresh once, then repeat the failed request once with the new token.
If refresh itself answers `401`, send the user to login.
The 401 codes you can see are `AUTH_REQUIRED` (no token), `TOKEN_INVALID` (bad or expired token) and `SESSION_EXPIRED` (the account's tokens were cancelled, for example after a password change or a role change).

### Q2.5 Can two refresh calls run at the same time?

No.
This is the most important rule.
Every refresh rotates the token: the old one stops working and a new cookie is set.
If a second call arrives with the old token, the API treats it as theft and signs the user out on every device.
So refreshes must go through one shared promise: if a refresh is already running, every other request waits for that same result instead of starting its own.
This also matters when two browser tabs are open: the first one to refresh wins, and the other tab has to read the new cookie rather than refresh again.

### Q2.6 How do I log out?

`POST /api/auth/logout` ends this browser's session and clears the cookie.
Send `{ "allDevices": true }` to end every session of the user and cancel all live access tokens.
Always throw away the access token in memory too.

### Q2.7 How does the frontend know what the user may see?

Call `GET /api/auth/me` after login and on start-up.
It returns the account with its `role` and `permissions` (and the partner record for an agency).
Use it to decide which menus and routes to show.
A role, status or permission change by an admin takes effect on the person's next request, so a menu that was hidden by the frontend can still be refused by the API with `403`.
The API is the real guard.
The frontend only hides what the person cannot use.
For the admin screens that pick roles and permissions, `GET /api/admin/rbac` returns the full list from `config/rbac.json`.

### Q2.8 Why was a valid user answered with `403`?

`403` means the token is valid but not allowed.
The usual codes are `FORBIDDEN` (wrong role or missing permission), `ACCOUNT_NOT_ACTIVE` (suspended, blocked, inactive or not verified yet) and `PARTNER_NOT_APPROVED` (an agency before approval).

---

## 3. Answer shapes, ids and errors

### Q3.1 What does a normal answer look like?

Most routes (auth, users, agencies, tours, categories, custom tour requests, audit log) answer:

```json
{ "success": true, "message": "Tour fetched.", "data": { ... } }
```

A list adds the page information:

```json
{
  "success": true,
  "message": "Tours fetched.",
  "data": [ ... ],
  "meta": { "total": 25, "page": 2, "limit": 10, "totalPages": 3 },
  "pagination": { "total": 25, "page": 2, "limit": 10, "totalPages": 3 }
}
```

`meta` and `pagination` are the same object under two names.
Read either.

### Q3.2 Why are the membership answers different?

The membership spec asked for the shapes the admin dashboard already expects, so the membership routes (and only those) answer without the envelope:

| Case | Answer |
| --- | --- |
| A list | `{ "items": [ ... ], "total": 7 }` |
| One plan or membership | the object itself, with no `data` around it |
| A delete | `{ "success": true, "id": "..." }` |
| One customer's membership history | `{ "items": [ ... ] }` with no `total` |

A shared API client therefore needs two ways to unwrap an answer.
Errors have the same shape everywhere (Q3.4).

### Q3.3 Is the id `_id` or `id`?

`_id` everywhere, except membership plans and memberships, which use `id` (as their spec asks).
On a membership, `customerId` and `planId` are plain strings.
When the Add membership dialog needs a customer, take the customer's `_id` from the users list and send it as `customerId`.
A component shared between tours and memberships can read `item.id ?? item._id`.

### Q3.4 What does an error look like?

```json
{
  "success": false,
  "message": "Another plan already uses this name.",
  "code": "PLAN_NAME_TAKEN",
  "errors": [ { "field": "body.name", "message": "..." } ]
}
```

- `message` is written for a person and can be shown as it is.
- `code` is for the program.
  Branch on `code`, never on the text of `message`.
- `errors` appears on validation failures only, one entry per bad field.
  The `field` is prefixed with where it came from (`body.`, `query.` or `params.`), so show it next to the input named after the part after the dot.
- The status for a failed validation is `422` on most routes and `400` on the membership routes.
  Treat both as "show the field errors".

### Q3.5 Which error codes should I handle?

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 or 400 | One or more fields are wrong. See `errors`. |
| `AUTH_REQUIRED`, `TOKEN_INVALID`, `SESSION_EXPIRED` | 401 | Not signed in, or the token is no good. Try one refresh. |
| `FORBIDDEN` | 403 | Signed in but not allowed. |
| `ACCOUNT_NOT_ACTIVE`, `EMAIL_NOT_VERIFIED` | 403 | The account cannot sign in yet or any more. |
| `PARTNER_NOT_APPROVED` | 403 | An agency whose application is not approved yet. |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password. The text is always the same on purpose. |
| `INVALID_CODE` | 400 | The email code is wrong, expired or used up. |
| `EMAIL_TAKEN`, `PHONE_TAKEN`, `LICENSE_TAKEN` | 409 | Already registered. |
| `FILE_TYPE_NOT_ALLOWED` | 400 | Only PDF, JPEG, PNG and WEBP are accepted. |
| `DOCUMENTS_LOCKED` | 409 | An approved agency can no longer change its documents. |
| `CATEGORY_IN_USE` | 409 | A tour category that active tours still use cannot be removed. |
| `INVALID_TRANSITION` | 409 | A custom tour request cannot move to that status from where it is. |
| `PLAN_NAME_TAKEN`, `PLAN_IN_USE` | 409 | Duplicate plan name, or a plan that has memberships cannot be deleted. |
| `ALREADY_ACTIVE`, `INVALID_STATE` | 409 | The customer already has an active membership, or the membership is not in a state that allows this change. |
| `NOT_B2C`, `PLAN_NOT_AVAILABLE` | 400 | A membership can only be sold to a B2C customer, and only from an active plan. |
| `RATE_LIMITED` | 429 | Too many tries. Read the `Retry-After` header. |
| `FIREBASE_DISABLED` | 503 | Google sign-in is not set up on this server. |

The full list with example messages is in `openapi.json`.

---

## 4. Sign-up, passwords and invitations

### Q4.1 How does a customer sign up with email and password?

1. `POST /api/auth/register` with `{ name, email, password, phone? }`.
   The role is always B2C.
   A `role` in the body is ignored.
2. The account is created as `PENDING` and a 6-digit code is emailed.
3. The user types the code.
   `POST /api/auth/verify-otp` with `{ email, otp }`.
   This activates the account and signs the user in (the same answer as a login, with the cookie).

The code is valid for 10 minutes, works once, and is locked after 5 wrong tries.
The API never returns the code and never prints it.
It reaches the user by email only.

### Q4.2 What if the email did not arrive?

Registration still succeeds, and the answer has `data.otpSent: false`.
Show a "Resend code" button, which calls `POST /api/auth/resend-otp` with `{ email }`.
At least 60 seconds must pass between two codes for the same account, and a new code cancels the old one.
The answer is identical whether or not the email exists, so do not promise "a code was sent".
Say "if the account is waiting for verification, a new code was sent".

### Q4.3 What are the field rules?

| Field | Rule |
| --- | --- |
| `password` | 8 to 64 characters, with an upper case letter, a lower case letter, a number and a symbol |
| `email` | A valid address, up to 254 characters. It is stored in lower case. |
| `phone` | Optional for customers, required for agencies. Digits only with an optional leading `+`, 8 to 15 digits, with no spaces or dashes. |
| `name` | 2 to 100 characters |

Sign-up and reset forms can use the same rules as live hints.
A login accepts any non-empty password, so a wrong password always fails the same way.

### Q4.4 How does Google sign-in work?

1. The frontend signs in with the Firebase SDK and gets an ID token.
2. It sends `POST /api/auth/firebase` with `{ idToken }`.
3. The API verifies the token and answers with its own tokens, the same shape as a login.
4. From then on use only this API's `accessToken`.
   The Firebase token is not used again.

Only Google is accepted.
Firebase email-and-password tokens are refused with `FIREBASE_PROVIDER_NOT_ALLOWED`.
A first Google sign-in creates a verified B2C account.
If a customer account with the same verified email exists, it is linked.
An email that belongs to an admin, staff or agency account answers `409 ACCOUNT_TYPE_MISMATCH`: ask the person to sign in with their password.
The frontend needs the Firebase web `apiKey` and project settings.
The backend needs its own service-account key.
These are two different things.

### Q4.5 How do invited staff and admins set their password?

An admin creates the account with `POST /api/admin/staff` (or `/api/admin/users`) and no password.
The person receives an email with a link in the form `<APP_URL>/setup-account?token=<token>`.
The frontend needs a page at that address that reads `token` from the query string, asks for a new password, and calls `POST /api/auth/setup-account` with `{ token, password }`.
The link works once and expires after 48 hours.
A used, expired or made-up token is refused.
After success the person signs in normally.

### Q4.6 How does password recovery work?

1. `POST /api/auth/forgot-password` with `{ email }`.
   The answer is always the same, even for an unknown email.
2. The user receives a code.
   Optionally check it first with `POST /api/auth/verify-reset-token` with `{ email, otp }`.
   This does not use the code up.
3. `POST /api/auth/reset-password` with `{ email, otp, newPassword }`.

A successful reset signs the person out everywhere, so send them to login afterwards.
Limit: 3 requests per hour per email for step 1.

### Q4.7 How does a signed-in user change their password?

`POST /api/auth/change-password` with `{ currentPassword, newPassword }`.
Other devices are signed out, but this one continues: the answer carries a **new access token** (and a new cookie), so store the new token.
Limit: 5 tries per 15 minutes per user.

### Q4.8 Can the user change their email or phone?

- **Name and phone:** yes, through the profile routes (Q5.2).
  A changed phone is marked unverified again.
- **Email:** not yet.
  It needs a re-verification flow that is not built (see `ToDo.md`).
- **Phone verification:** not built.
  The provider is undecided.

---

## 5. Roles, profiles and the admin screens

### Q5.1 Which role sees which part of the API?

| Role | How they get in | Works with |
| --- | --- | --- |
| ADMIN | Created by the seed script or by another admin | Everything under `/api/admin`, plus tours and memberships |
| STAFF | Invited by an admin | Only what the permissions granted allow |
| B2B (agency) | Registers, then waits for approval | Own profile and documents. Operational routes once approved. |
| B2C (customer) | Registers or signs in with Google | Own profile, tours, custom tour requests, own memberships |

Permissions come from `config/rbac.json`.
Staff routes: `/api/staff/profile`, `/api/staff/partners` (needs `B2B_VIEW`) and document review (needs `DOCUMENT_VERIFY`).
Tour management needs `TOUR_MANAGE`, and membership management needs `MEMBERSHIP_MANAGE`.

### Q5.2 How does a person edit their own profile?

| Role | Route | Fields |
| --- | --- | --- |
| Customer | `PATCH /api/b2c/profile` | `name`, `phone` |
| Agency | `PATCH /api/b2b/profile` | `name`, `phone`, `address`, `businessType` |
| Staff | `PATCH /api/staff/profile` | `name`, `phone` |
| Admin | `PATCH /api/admin/profile` | `name`, `phone` |

The person always comes from the token.
There is no id in the URL, and an id in the body is ignored.
Role, status, permissions and email cannot be changed here, and unknown fields are dropped without an error.
Only an admin can edit someone else: `PATCH /api/admin/users/:id` (`name`, `phone`) and `PATCH /api/admin/b2b/:id` (company details).

### Q5.3 What can an admin do with users?

| Action | Route |
| --- | --- |
| List and filter | `GET /api/admin/users` with `role`, `status`, `search`, `page`, `limit` |
| Read one, deactivate | `GET`, `DELETE /api/admin/users/:id` (deactivate is a soft delete) |
| Invite an admin or staff member | `POST /api/admin/users`, `POST /api/admin/staff` |
| Change status | `PATCH /api/admin/users/:id/status` (ACTIVE, SUSPENDED, BLOCKED, INACTIVE, with an optional `reason`) |
| Change role | `PATCH /api/admin/users/:id/role` (admin or staff only) |
| Set staff permissions | `PATCH /api/admin/users/:id/permissions` |
| Send an invitation again | `POST /api/admin/users/:id/resend-invite` |
| Security events | `GET /api/admin/audit-logs` |

Guards the screens should expect: an admin cannot change their own status or role (`SELF_CHANGE`), the last active admin is protected (`LAST_ADMIN`), customers and agencies cannot change role (`ROLE_LOCKED`), and a never-verified account cannot be activated by hand (`NOT_VERIFIED`).
A suspension or role change takes effect on the person's next request.

---

## 6. Agencies and documents

### Q6.1 How does an agency register?

`POST /api/auth/b2b/register` as `multipart/form-data` (not JSON).

| Field | Notes |
| --- | --- |
| `name`, `email`, `phone`, `password`, `companyName`, `licenseNo`, `address` | Required. `address` is at least 5 characters. |
| `businessType` | Optional |
| `tradeLicense` | **File, required** |
| `businessCard` | File, optional |
| `otherDocuments` | Files, optional, up to 3. Repeat the same field name for each file. |

Files must be PDF, JPEG, PNG or WEBP, up to 5 MB each.
Do not set the `Content-Type` header by hand: the browser adds the boundary itself.
A failed registration leaves no account and no files behind.
Then the agency verifies its email code, exactly like a customer.

### Q6.2 What can an agency do before it is approved?

It can log in, read its profile, add documents and read the review result.
Operational routes answer `403 PARTNER_NOT_APPROVED`.
The partner's `approvalStatus` is one of `PENDING`, `UNDER_REVIEW`, `APPROVED`, `REJECTED` and `SUSPENDED`.
Show the reviewer's `reviewNote` when there is one.
A rejected agency can upload more documents and can still be approved later.
After approval the documents are locked (`409 DOCUMENTS_LOCKED`).

### Q6.3 How do I download a document?

A plain link or `<a href>` will not work, because the download needs the `Authorization` header.
Fetch `GET /api/documents/partners/:partnerId/:docId` with the token, read the answer as a blob, take the file name from the `Content-Disposition` header, and start the download from the blob.
The owner, an admin, and staff with `DOCUMENT_VIEW` can download.
For anyone else the answer is `404`, the same as for a document that does not exist.
The internal storage path is never in any response.

---

## 7. Tours and categories

### Q7.1 Do I need to be signed in to show tours?

No.
`GET /api/tours`, `GET /api/tours/:id`, `GET /api/tour-categories` and `GET /api/tour-categories/:id` are public.
A token is optional and shapes the answer for that person.
A header with a token that is wrong is `401` (it is not treated as anonymous), and a header with nothing after `Bearer ` counts as a visitor.

### Q7.2 What does the tour list accept?

| Query | Meaning |
| --- | --- |
| `search` | Matches name, destination and country, ignoring letter case. Special characters are plain text. |
| `category` | One id, or several separated by commas. Either an id from this API or an old frontend id such as `cat_beach`. |
| `country`, `destination` | Country is an exact match, destination is part of the text |
| `minPrice`, `maxPrice` | Limits on the public price (inclusive) |
| `durationDays` | Exact number of days |
| `status` | For tour managers only. The public always gets published tours. |
| `sort` | `createdAt`, `price`, `durationDays` or `rating`. A leading `-` means descending. Default is newest first. |
| `page`, `limit` | Default 10, at most 100 |

A blank value (`?search=&sort=`) counts as not given, so a form can send every field.

### Q7.3 Where is `b2bPrice`?

It is present only for an admin, staff with `TOUR_MANAGE`, and a B2B user whose partner is approved.
For everyone else the field is **absent**, not zero and not null.
Do not show "0" when it is missing.
`price` is the public price and is always there.

### Q7.4 Why does a tour return 404 when I know it exists?

The public sees published tours only.
A draft, unpublished or archived tour answers `404`, the same as one that does not exist.
Tour managers can read all of them, and can ask for archived ones with `status=archived`.

### Q7.5 How do the old `cat_` and `tour_` ids work?

The ids the frontend used before the backend existed are kept.
Wherever a category or tour id is accepted, either form works: in the URL (`/api/tours/tour_205`), in the `category` filter, and in the `category` field when creating or editing a tour.
Responses carry the new `_id` and also `legacyId`.
Move the frontend to the new ids at its own pace.

### Q7.6 What are the tour fields and rules?

- `status` is `draft`, `published`, `unpublished` or `archived`.
  A new tour starts as `draft`.
- `priceCurrency` is `BDT`, `USD` or `EUR`.
- Prices, `seats` and `durationDays` cannot be negative, and `durationDays` is a whole number.
- `itinerary` is a list of `{ day, title, description }`.
  Days are unique whole numbers, none may be after `durationDays`, and the answer always comes back in ascending day order.
- A **published** tour needs at least one itinerary day.
  A draft may be incomplete.
- `rating` is between 0 and 5.
- `coverImage` and `gallery` are `http` or `https` links.
  There is no image upload yet.
- Editing is a partial update (`PATCH`): send only the fields to change, and at least one.
  There is no `PUT` for tours.
- `DELETE` archives the tour.
  Nothing is removed, and a manager can publish it again with a `PATCH`.

### Q7.7 How do categories work?

- A category name is unique in any letter case and spacing.
- Creating a name that exists is **not an error**: the answer is `200` with the existing category (a new one is `201`).
  If that category had been removed, it is switched on again.
- `DELETE` switches a category off (`isActive: false`).
  Removing one that active tours still use answers `409 CATEGORY_IN_USE`.
- Only managers can send `includeInactive=true` to list removed categories.

---

## 8. Custom tour requests

### Q8.1 Who can send one, and who can read it?

Only a signed-in **B2C customer** can send one (`POST /api/tours/custom-requests`).
Agencies, staff and admins get `403`, and a visitor gets `401`.
A customer reads only their own.
Admins and `TOUR_MANAGE` staff read all of them, with the customer's name, email and phone in `userId`.
Someone else's request answers `404`.

### Q8.2 What does the request contain?

`customer`, `phone`, `destination`, `travelers` (at least 1), `startDate`, `endDate`, `hotel`, `transportation` (default `Private car`), `activities`, `requirements` and `itinerary` (the draft the frontend generated).
Dates are `YYYY-MM-DD` or a full ISO date-time.
`endDate` cannot be before `startDate`, and a one-day trip is fine.
The owner is always the signed-in customer.
`userId`, `status` and review fields in the body are ignored.

### Q8.3 What are the statuses?

`NEW`, `IN_REVIEW`, `QUOTED`, `CONFIRMED`, `CANCELLED`.

| From | Can go to |
| --- | --- |
| `NEW` | `IN_REVIEW`, `CANCELLED` |
| `IN_REVIEW` | `QUOTED`, `CANCELLED` |
| `QUOTED` | `IN_REVIEW`, `CONFIRMED`, `CANCELLED` |
| `CONFIRMED` | `CANCELLED` |
| `CANCELLED` | nothing (final) |

Managers move a request along with `PATCH /api/tours/custom-requests/:id/status` and may add a `note`, such as the quote, which the customer can read in `reviewNote`.
A customer can only cancel their own request, and only while it is `NEW`.
Any other move answers `409 INVALID_TRANSITION`, and a customer trying a move they are not allowed gets `403`.

---

## 9. Membership

Membership is for **B2C customers only** and is sold by an admin (or `MEMBERSHIP_MANAGE` staff) after the customer pays offline.
There is no payment gateway and no purchase flow for the customer yet.

### Q9.1 Which screens use which routes?

| Screen | Routes |
| --- | --- |
| Plans | `GET`, `POST /api/membership-plans`, `PUT /api/membership-plans/:id`, `PATCH /api/membership-plans/:id/toggle`, `DELETE /api/membership-plans/:id` |
| Members | `GET`, `POST /api/memberships`, `PATCH /api/memberships/:id/cancel`, `PATCH /api/memberships/:id/extend`, `DELETE /api/memberships/:id` |
| Reports and cards | `GET /api/membership-stats`, `GET /api/membership-report/periods` |
| A customer's page (admin view) | `GET /api/customers/:customerId/memberships` |
| The customer's own page | `GET /api/b2c/memberships` (add `?status=active` for the current one) |

The Add membership dialog lists customers from `GET /api/admin/users?role=B2C&search=...`.

### Q9.2 What is a plan?

`name` (unique in any letter case), `durationValue` (whole number, at least 1), `durationUnit` (`day`, `month` or `year`, singular and lower case), `price` (BDT), `tourDiscountPercent` and `visaDiscountPercent` (0 to 100, separate), `maxDiscountAmount` (a cap per booking, `null` means no cap, and `0` is saved as `null`), `description`, `features`, `isActive` and `sortOrder`.
The list comes back sorted by `sortOrder`, includes inactive plans, and has no pagination.
Editing with `PUT` accepts the whole plan object back: `id`, `sortOrder` and the timestamps are ignored.
`name`, `durationValue`, `durationUnit` and `price` are required on `PUT`.
Anything else that is left out stays as it was.
`PATCH .../toggle` needs no body and returns the plan.
A plan that any membership used cannot be deleted (`409 PLAN_IN_USE`): deactivate it.
An inactive plan cannot be sold.

### Q9.3 How do I sell a membership?

`POST /api/memberships` with `{ customerId, planId, paymentMethod, trxId?, startDate? }`.

- `paymentMethod` is `bkash`, `nagad`, `bank`, `cash` or `online`.
- `trxId` is typed in for the record.
  It is optional, may be empty, and nothing checks it.
- `startDate` is `YYYY-MM-DD` and defaults to today in Dhaka.
  A future start date is still `active` right away.
- The **amount is not sent**.
  It always comes from the plan, and the payment is saved as `paid`.

It answers `201` with the membership.
Errors the dialog should show: `404` customer not found, `400` for a customer who is not B2C or a plan that is not available, and `409` when the customer already has an active membership.
That `409` also happens when two admins press the button at the same moment: only one wins.

### Q9.4 What does a membership look like?

It carries the customer's name, email and phone (a copy, kept current when the customer edits them), the `planSnapshot` (the plan as it was when sold), `startDate`, `endDate`, `status`, `daysLeft`, `payment` (`method`, `amount`, `trxId`, `status`, `paidAt`), `source`, `cancelledAt` and `cancelReason`.
Read discounts from `planSnapshot`, never from the live plan.
Editing a plan never changes a membership already sold.
A customer reading their own list does not receive `cancelReason`.

### Q9.5 What do `status` and `daysLeft` mean?

`status` is the **effective** status: a membership whose end date has passed is returned as `expired` straight away, even if the nightly job has not saved that yet.
`daysLeft` is computed on every read, counted up (3.2 days left is 4), and negative once the end has passed.
Filters follow the same rule: `?status=active` leaves out lapsed rows, and `?status=expired` includes them.
`?expiringIn=7` keeps active memberships with 0 to 7 days left.
Lists have no pagination: filter in the browser or with `status`, `planId`, `expiringIn` and `search` (name, phone and email, plain text).

### Q9.6 Which actions can be taken on a membership?

| Action | Rule |
| --- | --- |
| Cancel (`PATCH .../cancel`, optional `reason` up to 500 characters) | Active or pending only. The payment status is left as it is: refunds are handled by hand. |
| Extend (`PATCH .../extend`, `{ days: 1 to 3650 }`) | Active only. Adds whole days to the end date. |
| Delete (`DELETE`) | A soft delete. It leaves lists and counts, but its payment stays in revenue. |

Show Extend only on active rows, and Cancel only on active or pending ones.
A change that is not allowed answers `409 INVALID_STATE`.

### Q9.7 What do the cards and reports return?

`GET /api/membership-stats` returns `total`, `active`, `expiringIn7`, `expiredThisMonth`, `revenueThisMonth`, `revenueByMonth` (always exactly 6 entries, oldest first, `0` for an empty month, labels like `Oct`) and `planDistribution` (one entry per plan, including plans with 0).
`GET /api/membership-report/periods` returns `items`: the last 6 periods, oldest first.
`?mode=monthly` (the default) gives calendar months, and the current one is labelled "(to date)".
`?mode=half` gives 15-day periods (the 1st to the 15th, the 16th to the end of the month).
Each period has `id`, `label`, `start`, `end` (as `YYYY-MM-DD`), `newCount`, `revenue`, `expiredCount` and `cancelledCount`.
Deleted memberships leave the counts, but their payments stay in the revenue.

### Q9.8 What time zone do the dates use?

Every moment is returned as an ISO UTC string.
Day boundaries, "today", "this month" and the end of a membership are worked out in **Asia/Dhaka (UTC+6)**.
So an end date such as `2026-10-15T17:59:59.999Z` is the end of 15 October in Dhaka.
The start day counts as day 1: a 15-day plan starting on 1 October ends on 15 October.
Convert to Dhaka time when you display a date, or the end date will look like the day before.

---

## 10. Lists, filters, dates and money

### Q10.1 How does paging work?

Most lists take `page` and `limit`: the default limit is 10 and the maximum is 100.
A page past the end is an empty list with `200`, not an error.
`page=0` and `limit=0` fall back to the defaults, and a negative or fractional value is a validation error.
The membership lists have no paging.

### Q10.2 Can a filter be left blank?

Yes.
On every route that takes a query, an empty value (`?status=&search=`) is treated as not given.
A form can therefore send all its filters every time.
In a search box, special characters are plain text, never patterns.

### Q10.3 How are dates, numbers and money sent?

- Dates in a request body are `YYYY-MM-DD` (custom tour requests also accept a full ISO date-time).
- Dates in a response are ISO 8601 UTC strings.
- Money is a plain number in BDT.
  There are no symbols or strings.
- Numbers must be sent as numbers in JSON (`"price": 4500`, not `"4500"`).
  A number sent as text is a validation error.

### Q10.4 What gets ignored?

Unknown fields in a body are dropped without an error.
This is on purpose: `role`, `status`, `permissions`, an owner id or an amount can never be set by a client.
So if a saved record does not show a field you sent, check whether it is a field the route accepts.

---

## 11. Rate limits

### Q11.1 What are the limits, and what do I show?

| Route | Limit |
| --- | --- |
| Every `/api` route | 300 requests per 15 minutes per address |
| Login | 10 per 15 minutes per address and email |
| Register (customer and agency share it) | 10 per hour per address |
| Verify code, resend code, check or reset password, set up account | 5 per 15 minutes per address and email, all counted together |
| Forgot password | 3 per hour per address and email |
| Change password | 5 per 15 minutes per signed-in user |
| Refresh | 30 per 15 minutes per address |
| Google sign-in | 30 per 15 minutes per address |

An answer over the limit is `429` with `code: RATE_LIMITED`, the header `Retry-After` (seconds to wait) and the `RateLimit` header.
Show "Try again in N minutes" and disable the button until then.
A blocked login stays blocked for the right password too.

---

## 12. Things that behave in a way you may not expect

- **A deleted record may still be there.** Tours and categories are archived or switched off, memberships are soft deleted, and users are deactivated.
  Nothing disappears from the database, so the same name can still clash.
- **`404` can mean "not yours".** For documents, custom tour requests and another customer's data, the API answers `404` exactly as it does for a record that does not exist.
- **Edits are partial where the route says so.** Tours use `PATCH` with only the changed fields.
  Membership plans use `PUT` with the whole object.
- **A `201` is not always a creation.** Creating a category with an existing name answers `200` with that category.
- **Sign-up emails depend on EmailJS.** Until the four `EMAILJS_*` values are set on the server, no email is sent and registration answers `otpSent: false`.
- **Search and filters are by plain text.** There is no fuzzy search or full-text index.

---

## 13. Not built in this phase

| Missing | Effect on the frontend |
| --- | --- |
| Mobile apps | Out of scope for this phase. The API has a mobile token mode, which this guide does not cover. |
| Phone OTP and phone login | Login and recovery are email only. |
| Changing the account email | The profile form cannot edit it. |
| Image upload for tours | `coverImage` and `gallery` are links. |
| Emails about tour requests and memberships | The customer is not told when a request is quoted or a membership ends, so the page has to show the status. |
| Booking and the membership discount | The helpers exist, but nothing applies a discount yet. |
| Buying a membership online, refunds | An admin sells a membership, and `refunded` is never set. |
| Admin two-factor sign-in | Not built. |
| Visa, passports, commission, invoices, flight inquiries | Other modules. They will reuse the same guards. |

---

## 14. To confirm with the frontend developer

These affect the code on both sides, and none of them has been tested against a real frontend.

1. **Does the dashboard's API client return `response.data` directly?** The membership spec says it reads `result.items` straight from the answer.
   The other routes answer `{ success, message, data }`, so the client must handle both.
2. **Is the API base `/api` or `/api/v1`?** Every route here is under `/api`.
3. **How should `_id` and `id` be handled?** Membership uses `id` and everything else uses `_id` (Q3.3).
4. **Which origins will the frontends use?** They must be listed in `CLIENT_URL` and `ADMIN_URL`.
5. **Where will the invitation page live?** The backend builds the link as `<APP_URL>/setup-account?token=...` (Q4.5).
6. **Same site or different sites?** Different sites change the cookie settings and need a CSRF check (Q1.3).
7. **Is one shared refresh promise in place?** Without it, two simultaneous refreshes sign the user out everywhere (Q2.5).
8. **Are dates shown in Dhaka time?** Membership end dates look wrong if they are shown in the browser's own zone (Q9.8).
9. **Is a missing `b2bPrice` handled as "not allowed to see"?** It must not be shown as 0 (Q7.3).
10. **Does anything still depend on the old `cat_` and `tour_` ids?** They keep working for now (Q7.5).
