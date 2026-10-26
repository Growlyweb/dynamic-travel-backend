# Backend status for the admin dashboard

Date: 26 October 2026.
Backend repo: `dynamic-travel-backend`, branch `feat/visa-module-oct-26`, started from `origin/main`.
Nothing is pushed yet.
Dashboard repo: `dynamic-travel-admin`. No dashboard change has been made for the backend yet.

Related files in this folder:

- `ADMIN_CHANGES.md`: every planned dashboard change for the integration (rows 1 to 51).
- `BACKEND_GAP_REPORT.md`: the first analysis of what the backend lacked.
- `BACKEND_IMPLEMENTATION_PLAN.md`: the phases.
- `ACCOUNTING_DECISION.md`: the accounting decision.
- `ADMIN_DASHBOARD_BUG_REPORT.md`: the 118 dashboard bugs.

## 1. Summary

| Item | State |
|---|---|
| Visa module (catalog, applications, payments, documents, passports, messages, quotations, public status check) | Done |
| Accounting: one journal engine, the simple Accounts API, vendors | Done |
| Settings: currencies and rates, document limits, retention, duplicate window | Done |
| Dynamic roles from templates, several roles per person | Done |
| Seed commands, API documentation (178 operations), README | Done |
| Unit and integration tests | 778 tests in 37 suites, all passing at the last full run |
| End-to-end tests (Playwright) | Not run against the new code |
| Dashboard integration | Built for the visa module, accounts, vendors, tours, memberships, partners, customers, users, roles and settings. Not tried in a browser yet. See `INTEGRATION_PLAN.md` section 10. |
| Decisions | 40 decided, 23 assumed (please confirm), 5 still open (section 6) |
| People, B2B portal, tours extras, documents, notifications, marketing, dashboard numbers | Not started |

## 2. Page by page: what the dashboard can already talk to

The first column follows the sidebar of the admin dashboard.

| Sidebar | Page | Backend |
|---|---|---|
| Overview | Dashboard | **Stub.** The four `/api/dashboard/*` routes still return demo numbers. Visa and accounting data now exist to feed them. |
| Visa | Overview, Applications, Pricing, Checklists, Countries, Types, Statuses, Status board | Done (`/api/visa`) |
| Visa | Quotations | Done |
| Visa | Passport operations | Done (`PATCH /api/visa/applications/:id/passport`) |
| Visa | SMS templates, SMS logs | Done, as message templates (email and SMS) and the message log. SMS is sent by hand and marked sent. |
| Tours | Packages | Done, except image upload |
| Tours | Custom tours | Done for the customer side. Staff cannot create one for a customer yet. |
| Partners (B2B) | Partners | Done (`/api/admin/b2b`: list, approve, reject, documents) |
| Partners (B2B) | Applications, Pickup requests, Commissions, Withdrawals, Documents | **Missing**, no models |
| Customers (B2C) | Customers | **Missing** (no list with membership and spend) |
| Membership | Plans, Members, Reports | Done |
| Vendors | Vendors, Add vendor, Bills, Payments and advances | Done (`/api/vendors`) |
| Vendors | Services (with prices per country) | **Missing** |
| Accounts | Home, Sales, Client dues, Money receipts, Monthly report, Profit and expenses, Vendor payables | Done (`/api/accounts`, `/api/vendors`) |
| Clients and Partners | B2B agents, B2C clients, Partners | Done |
| Setup | Categories, Price list | Done |
| Marketing | Email and SMS | **Missing**, needs an SMS gateway and a scheduler |
| Administration | Users | Done (`/api/admin/users`) |
| Administration | Roles and permissions | Partly. Per-user permissions work. Editing a whole role needs a restart. |
| Administration | All documents | **Missing** (global list and review) |
| Administration | Notifications | **Missing** |
| Account | Profile | Done |
| Account | Settings | Partly. Currencies, document limits, retention and the duplicate window exist. |
| Account | Security | Partly. Password change exists. Active sessions and change of email are missing. |
| Not linked | The 13 advanced accounting pages (`/reports/*`) | Hidden on purpose. The server has the journals, so they can be served later. |

## 3. What is done, in detail

### 3.1 Foundation

| Piece | What it does |
|---|---|
| Counter | Atomic numbers that restart each year (`VISA-2026-000001`, `QT-2026-0001`, `VF-2026-0001`) |
| Event hook | A module announces what happened and others listen. A failing listener never breaks the request. |
| Secure file storage | Files outside any public folder, random names, the real type read from the file bytes, local disk driver (a cloud driver can replace it) |
| Settings | Currencies with exchange rates (manual, or filled from open.er-api.com), document limits, retention, duplicate window |
| Permissions | New keys `VISA_PAYMENT_VOID`, `ACCOUNTS_EDIT`, `ACCOUNTS_VOID`, `VENDOR_VIEW`, `VENDOR_MANAGE` |
| Seed commands | `seed:all`, `seed:visa`, `seed:accounting`, `seed:clear`, `seed:reset`. Clear and reset refuse to run in production. |

### 3.2 Visa (49 routes under `/api/visa`)

| Area | Behaviour |
|---|---|
| Catalog | Countries, visa types with prices and fees, checklists, 11 system statuses plus custom ones. A country or type that has applications is paused, never deleted. |
| Applications | Staff create them. The server numbers each one, copies the price and rate, and calculates net, advance, due and the payment status. Duplicate passports are refused or need a confirmation note. |
| Status engine | One function checks the allowed moves and the wording each move needs, then writes the timeline, the audit log and an event. Only an admin can reopen a finished application. |
| Payments | Entered by hand. A wrong entry is voided with a reason (`VISA_PAYMENT_VOID`, grantable to staff). |
| Documents | Upload with size and type limits, download with safe headers, verify or reject, delete. |
| Passports | Submission method, pickup request and staff, status steps, limited by what the visa type allows. |
| Messages | Email templates send automatically through EmailJS at a status. SMS templates prepare a message that staff send by hand. Every message is logged. |
| Quotations | Price quotes for approved B2B partners, calculated on the server, locked once sent. |
| Public status check | An email code, then the status in the simple stages. Nothing private is shown. |
| Staff and partner lookups | `GET /api/visa/staff` and `GET /api/visa/partners`, with only id and name |

### 3.3 Accounting and vendors (38 routes)

| Area | Behaviour |
|---|---|
| Journal engine | Balanced vouchers in whole paisa, never edited, voided with a reason, idempotent by source |
| Profit rule | Revenue after discounts on the voucher date, direct costs by bill date, then office expenses. Voided vouchers and cancelled sales count for nothing. Cash is shown apart. |
| Accounts API | Sales, receipts, dues, expenses, clients, categories, monthly and yearly reports, partner capital (admin only), price list, balances |
| Receipts | Never more than what is due. Voided, never deleted. A paper receipt number can be kept. |
| Cancelling a sale | Needs `refund` or `keep` when money was received. There is no default. |
| Vendors | Vendors with opening balances, bills, payments, advances, aging from the due date |
| Visa link | A new application makes a sale file with its sale, discount and vendor costs. Payments and voids post and void receipts. Edits are replaced, never doubled. |

### 3.4 Quality

| Item | State |
|---|---|
| API documentation | 171 operations in `documentation/openapi.json`, kept in step with the real routes by a test |
| Tests | Every rule above has tests, including permissions for each route |
| Audit log | Every change to the catalog, applications, payments, messages, quotations, settings and accounting is recorded |

## 3b. Changes since the last update

| Change | Detail |
|---|---|
| Dynamic roles | Roles are named permission sets made from templates, several per person, with dependencies and sensitive flags. Routes under `/api/admin/roles`, `PATCH /api/admin/users/:id/roles`, effective permissions on `/api/auth/me`. `npm run seed:access` makes the roles and demo accounts. Everything a developer decides about access is in `config/rbac.json`. How it works is in `RBAC.md`. |
| Page size and paging | A page can hold up to 500 rows. Sales, dues and receipts are paged in the database, and their summaries are added up over every match. Dues can be filtered by type and searched. |
| Staff invite link | It opens the dashboard (`ADMIN_APP_URL` + `/dashboard/setup-account`). The dev ports are corrected: website 5174, dashboard 5173. |
| Public status check | It follows the storefront page: link check, passport plus phone, code by email, five wrong codes lock the link for 15 minutes, the result masks the passport and the phone. |
| Visa statuses list | It returns the moves each status allows, whether it is final, the text a move needs and the reopen target. |
| Event order | The accounting events of one application run one after the other. A payment posted while the sale was still being posted used to lose its receipt. |
| Seed data | Realistic passport and mobile numbers. |
| Tests | 778 tests in 37 suites, all passing at the last full run. |

## 4. What is left on the backend

Sizes are rough: S is about a day, M a few days, L a week or more.

### 4.1 Needed for the pages you already have

| # | Work | Pages it feeds | Size | Blocked on |
|---|---|---|---|---|
| 1 | Real dashboard numbers: overview, visa and tour trends, recent applications, recent activities (the audit log can feed the last one) | Dashboard | S | Nothing |
| 2 | B2C customer list and detail, with membership badge, spend and history | Customers | S | Nothing |
| 3 | Vendor services with prices per country (the visa form uses them to fill a vendor cost) | Vendors > Services, New application | M | Nothing |
| 4 | Global document list and review, delete a partner document | All documents, Partners > Documents | M | Nothing |
| 5 | Notifications list, read and mark all read, fed by the visa and accounting events | Notifications | M | Nothing |
| 6 | Generic upload for tour images (the storage layer already exists) | Tours | S | Nothing |
| 7 | Staff create a custom tour request for a customer, edit a request beyond its status | Custom tours | S | Nothing |
| 8 | Dashboard buttons to suspend and reactivate a partner. The server already supports both through the approval route. | Partners | S | Nothing |
| 9 | Active sessions list and revoke, change email with re-verification | Security | M | Nothing |
| 10 | ~~Dynamic roles from templates~~ **Done** (`RBAC.md`) | Roles and permissions | M | |
| 36 | ~~Page size up to 500 on every list, and sales, dues and receipts paged in the database~~ **Done** | All tables | M | |
| 37 | ~~The staff invite link opens the dashboard, not the storefront~~ **Done** | Users | S | |
| 38 | ~~Adapt the public status check to the storefront page~~ **Done** | Storefront status page | M | |
| 11 | Application settings page (general settings) | Settings | S | Nothing (a small list is decided: company details, time zone, tracking link) |

### 4.2 The B2B partner portal (no models yet)

| # | Work | Size | Blocked on |
|---|---|---|---|
| 12 | Partner applications on behalf of clients at the B2B price, and the partner's own application lists (the B2B dashboard in the storefront uses them) | M | Nothing (decided: partners first) |
| 13 | Pickup requests from partners, with status, assigned staff and history | M | Nothing (decided) |
| 14 | Commissions: an amount set by the company on each passport, the completed passport count, the commission ledger | L | The rules in the requirements document are used. The rest are assumptions to confirm with the client (see 6.2). |
| 15 | Withdrawal requests, allowed after 100 completed passports: request, approve, reject, mark paid, posted to the books | L | Item 14 |
| 35 | Invoice and acknowledgement slip made automatically when the company receives a partner's passport, viewable and printable | M | Item 12 |

### 4.3 Marketing

| # | Work | Size | Blocked on |
|---|---|---|---|
| 16 | Customer lists with consent, templates, send email, bulk campaigns with a schedule, history, retry. Email first, SMS after the provider is chosen. | L | A scheduler |
| 17 | SMS sending | M | The client choosing an SMS provider |

### 4.4 Accounting follow-ups

| # | Work | Size | Blocked on |
|---|---|---|---|
| 18 | Period locking and year-end close, so a closed month cannot be backdated. Two permissions, `ACCOUNTS_LOCK` and `ACCOUNTS_JOURNAL`, which an admin has by default and can give to a role. | M | Item 10 (dynamic roles) |
| 19 | Exports (CSV, print) of receipts, sales and reports | S | Nothing |
| 20 | The advanced reports (ledger, trial balance, balance sheet) as API routes, only if an accountant view is wanted later | M | A decision to show them |
| 21 | A real database transaction around a posting, instead of undoing earlier steps by hand | M | A MongoDB replica set |
| 22 | A "Create applications" shortcut on an accepted quotation (no automatic sale) | S | Dashboard integration |
| 31 | Opening balances for customers and agencies (vendors already have them) | S | Nothing |

### 4.5 Visa follow-ups

| # | Work | Size | Blocked on |
|---|---|---|---|
| 23 | Partner side first (apply from the B2B dashboard, own list), then the customer apply form in the storefront | L | Dashboard integration first |
| 24 | Automatic deletion or archive of documents after the retention period | S | The client confirming the retention |
| 25 | Emailing a quotation, and SMS delivery reports | S, M | EmailJS plan, an SMS provider |

### 4.6 Hardening and release

| # | Work | Size |
|---|---|---|
| 26 | Enforce every permission key on the older modules (about 8 of 27 were enforced before this work) | M |
| 27 | Run and update the Playwright end-to-end tests against the new routes | M |
| 28 | Seed and run the whole flow against a real MongoDB and real EmailJS keys | S |
| 29 | Push the branch, open the pull request, review | S |
| 30 | Production checklist: secrets, `TRUST_PROXY`, backups, shared storage if more than one server | S |
| 32 | A reconcile action and nightly job that post any visa application missing its sale in the books | S |
| 33 | An SMTP or transactional email driver behind the mailer, as an alternative to EmailJS | S |

## 5. The dashboard side (not started)

| Item | Where it is written |
|---|---|
| 51 planned changes: mock switch per module, response adapter, every visa page, accounts, vendors, storefront status page | `ADMIN_CHANGES.md` |
| 118 bugs found in the analysis, in phases 0 to 5 | `ADMIN_DASHBOARD_BUG_REPORT.md` |
| Decisions from section 5 of the bug report, mostly deferred | `ADMIN_DASHBOARD_BUG_REPORT.md` |

The main differences the dashboard must adapt to:

| Difference | Dashboard today | Backend |
|---|---|---|
| Answer shape | A bare object or `{items, total}` | `{success, message, data, meta, pagination}` |
| Ids | `id` | `_id` |
| Paging | `page`, `pageSize` | `page`, `limit` (maximum 100) |
| A missing record | The mock returns the first record | `404` |
| Money | Whole taka in the browser | Taka with up to two decimals, whole paisa inside |
| Totals | Calculated in the browser | Calculated on the server |
| Permission keys | 15 keys such as `visa.view` | 32 keys such as `VISA_VIEW` |

Suggested order:

1. The per-module mock switch and the response adapter.
2. The visa pages, then the Accounts and Vendors pages.
3. Delete the browser accounting (`visa.accounting.js`, `vendor.accounting.js`, the local journal store).
4. The storefront status page.

## 6. Decisions

Three lists: what was decided, what I assumed without a clear answer (the code already follows these), and what is still open.

### 6.1 Decided

| # | Topic | Decision | Decided by |
|---|---|---|---|
| 1 | Branch | `feat/visa-module-oct-26` from `origin/main`, small commits | You |
| 2 | Who adapts | The dashboard adapts to the backend: `_id`, the standard answer shape, `page` and `limit`, `404` for a missing record | You |
| 3 | Permission keys | The backend keys are the truth (`VISA_VIEW` and so on). The dashboard maps to them. | You |
| 4 | Visa module shape | One module under `/api/visa`, with the dashboard's field names where possible | You |
| 5 | Who creates applications | Staff and admins only, from the dashboard. Customers and partners do not apply yet. | You |
| 6 | SMS | Manual. A message is prepared, sent by hand and marked sent. No provider for now. | You |
| 7 | Email | EmailJS. Email templates send automatically at a status. Each template has an on/off switch and every message is logged. Test keys now, the client's later. | You |
| 8 | Public status check | An email code, not an SMS code | You |
| 9 | Message queue list in the dashboard | Not now. Kept as a to-do. | You |
| 10 | File storage | Local disk, made secure. A cloud driver can replace it later. | You |
| 11 | Payments on a visa application | Entered by hand. The server calculates net, advance, due and the payment status. The dashboard's single advance and payment method are kept. | You |
| 12 | Correcting a payment | Voided with a reason, never deleted. Admin by default, and an admin can give staff the permission `VISA_PAYMENT_VOID`. | You |
| 13 | Application number | `VISA-<year>-<6 digits>`, restarting every year | You |
| 14 | Currency | BDT is the base. Admin and staff can set the currencies and their rates. The default rate is filled from a free service and can be typed over. | You |
| 15 | Seed data | Every module has seed data, with commands to seed, clear and reset | You |
| 16 | Document limits and retention | Built as settings, not constants, because the client still has to confirm the numbers | You |
| 17 | Accounting | One journal engine on the server. The dashboard shows only the simple Accounts pages. The 13 advanced pages stay in the code, unlinked. | You |
| 18 | Approving and rejecting | Uses `VISA_UPDATE` for every status change. A stricter key can be added later in one place. | You, on my recommendation |
| 19 | Profit rule | Revenue after discounts on the sale date, direct costs by bill date, then office expenses. Kept as it is. | You |
| 20 | Who may lock a month and post manual vouchers | Not fixed to admins: two permissions that an admin has by default and can give to a role (see 28) | You |
| 21 | Financial year | Starts on 1 July. The first month in real use starts with opening vouchers. | Me, as you asked |
| 22 | Cancelled or rejected visa file with money received | Kept as it is: asked each time, no default | You |
| 23 | Accepted quotation | No automatic sale. A "Create applications" shortcut on the quotation. | Me, as you asked |
| 24 | A stricter approve and reject permission | Not now | Me, as you asked |
| 25 | Partners and customers applying | Partners log in to their own B2B dashboard after an approved registration application, and B2C users cannot become partners. Partner applications at the B2B price come first, the customer apply form later. This is what the requirements document describes. | You, with me |
| 26 | Applications with no email | A warning in the form, not a block. Staff tell the customer the status. | Me, as you asked |
| 27 | Partner suspend and reactivate, and admin-created partner accounts | Suspend and reactivate already work on the server and need dashboard buttons. An admin does not create a partner account directly: partners register with their trade license and an admin approves. | Me, as you asked |
| 28 | Roles | **Dynamic roles.** An admin creates a role from a template (for example "Accountant") with the usual permissions already ticked and options to add more, and gives it to staff. Editing the role changes every holder at once. The design is in section 5.9 of `INTEGRATION_PLAN.md`. | You |
| 29 | The advanced accounting pages | Hidden | You |
| 30 | General Settings page | Minimal: company name, address, phone, logo and tax number for printed documents, time zone, visa tracking link | Me, as you asked |
| 31 | EmailJS | The current keys are for testing. The client's keys go in at production. | You |
| 32 | Document retention | 2 years after the application is closed as the default. The deletion job is built after the client confirms the number. | Me, as you asked |
| 33 | B2B portal | Built in three stages from the requirements document: partner applications, pickups, invoice and acknowledgement first, then commissions, then withdrawals. The rules the document gives are used as written. The rest are my assumptions, listed in 6.2. | Me, as you asked |
| 34 | Marketing | Email first with a consent flag and an unsubscribe link, SMS after the provider is chosen | Me, as you asked |
| 35 | The other deferred decisions in section 5 of the bug report | The recommendations there are accepted | Me, as you asked |
| 36 | Dashboard integration | Planned in `INTEGRATION_PLAN.md` before any code | You |
| 37 | Where partners log in | The storefront's B2B dashboard is the real one. The partner pages inside the admin dashboard are removed at the end, after you see the list. | You |
| 38 | Lists and tables | Proper server pagination on every list, a fixed scrolling box, and a choice of 50 to 500 rows (default 50) | You |
| 39 | Storefront visa status page | Kept as it is (link reference, passport number, phone, code). The backend adapts to it. | You |
| 40 | Addresses | The ports are corrected (backend 5000, dashboard 5173, storefront 5174), and no server address is written in the code of either app | You |

### 6.2 Assumed, please confirm

I chose these because no answer was given.
They are in the code now.
Each one is a small change if you decide otherwise.

| # | Topic | What the code does | Where to change it |
|---|---|---|---|
| 1 | Duplicate applications | The same passport, country and visa type with an open application is refused. The same passport and country in the last 90 days needs a confirmation note. A rejected application never blocks a new one. | Setting `visa.duplicateWindowDays`, `visaApplicationService.js` |
| 2 | Reopening | Only an admin can reopen a completed, rejected or cancelled application, back to Under Review, with a reason | `visaStatusService.js` |
| 3 | What partners see | Reserved for later: timeline entries are marked internal, customer or both. The public check shows only customer and both. | `visaPresenter.js`, `visaPublicService.js` |
| 4 | Document defaults | 10 MB, PDF, JPG, PNG or WEBP, 5 files per checklist item, kept 2 years | Settings `visa.documents`, `visa.retention` |
| 5 | Price changes | A visa type's price change never alters an existing application. It keeps the price and rate it was made with. | Built in |
| 6 | Quotations | Only approved partners, valid 14 days unless a date is given, locked once sent, a late one shows as expired. Accepting a quotation creates nothing in the books. | `visaQuotationService.js` |
| 7 | Staff and partner lookups | `GET /api/visa/staff` and `GET /api/visa/partners` return only id and name, for `VISA_VIEW` | `visaApplicationService.js` |
| 8 | Automatic messages | A template for `submitted` also fires when an application is created. Email goes at once. A failed email is logged with its reason and can be sent again. | `visaMessageService.js` |
| 9 | Overdue | Past the due date of the file. The due date is 7 days for visas, 15 for tours, 3 for air tickets and transport. | `config/accounting.js` |
| 10 | Profit rule | Revenue after discounts on the sale date, direct costs by bill date, then office expenses. Unallocated costs are shown apart. | `services/accounting/reports.js` |
| 11 | Cancelled sale with money received | The request must say `refund` or `keep`. There is no default. | `books.js` |
| 12 | Cancelled or rejected visa application | Nothing is cancelled in the books automatically. A person decides from the sale. | `visaLink.js` |
| 13 | Receipts and vendor payments | A receipt can never be more than what is due. A vendor payment can never be more than what is owed, so the extra is an advance. | `books.js`, `vendorService.js` |
| 14 | Vendor cost with no vendor | Posted on a supplier called "Unassigned supplier", so every payable has a name | `books.js` |
| 15 | Agency credit limit | 100,000 taka unless one is sent | `books.js` |
| 16 | New permission keys | `ACCOUNTS_EDIT`, `ACCOUNTS_VOID`, `VENDOR_VIEW`, `VENDOR_MANAGE` and the names I gave them | `config/rbac.json` |
| 17 | Partner capital | Only an admin can record money in or out for a partner | `accountRoutes.js` |
| 18 | Public status check | It needs the email on the application, so an application with no email cannot use it. A token lasts 15 minutes. | `visaPublicService.js` |
| 19 | The seed | Sample vendors, sales, expenses and capital, and the books of the sample visa applications, outside production only | `scripts/seed/accounting.js` |
| 20 | How dynamic roles work | A role is a named list of permissions, made from a template whose defaults are ticked. A person may hold several roles and the server adds them together. There are no per-person extras on the screens: an exception is a new role. Edit implies view. Sensitive permissions are flagged. An admin always has everything. A new staff account must be given a role, with a built-in "No access yet" role. (Waiting for your yes, question 1 in section 9.3 of the plan.) | New, in the plan |
| 21 | Lock and voucher permissions | Named `ACCOUNTS_LOCK` and `ACCOUNTS_JOURNAL`. A locked month refuses new vouchers, and only a person with `ACCOUNTS_LOCK` can reopen it, with a reason. | New, in the plan |
| 22 | Financial year | 1 July to 30 June. Change it in one place if the company uses another. | New |
| 23 | B2B wallet and commission | The partner's wallet is the commission earned and not yet paid out. A passport counts as completed when its visa application is completed. A commission is earned on a passport when it is completed, in the amount the company set when the passport was submitted. A partner sees only their own. These follow the requirements document where it speaks and are my reading where it does not. | New |

### 6.3 Still open

These are the only open items.
Everything else was decided in 6.1, or is an assumption in 6.2.

| # | Question | Who | Blocks | My recommendation |
|---|---|---|---|---|
| 1 | Which SMS provider | Client | SMS sending, SMS marketing | Not decided yet. Choose a Bangladesh gateway with a registered sender name and delivery reports. Manual SMS keeps working until then. |
| 2 | The client's EmailJS keys, or another email service, for production | Client | Real emails in production | The current keys are for testing. A paid plan or an SMTP driver is needed before go-live, because the free plan allows about 200 emails a month. |
| 3 | The client confirms the 2 year retention and the document limits | Client | The deletion job | Keep the defaults until they confirm. |
| 4 | The client confirms the B2B assumptions in 6.2 (number 23) and the parts the requirements document does not cover: what the invoice and acknowledgement contain, how pickups are assigned | Client | The B2B portal | Show them the three stages and the assumptions on one page and ask for a yes or corrections. |
| 5 | The five points in section 9.3 of `INTEGRATION_PLAN.md`: which partner place is the real one, several roles or one, the status page wording, required role for new staff, the dev ports | You | The integration | See that file. |

## 7. Known limits

Each limit says what it means, when it would hurt, and what I recommend.
They are grouped by how soon they matter.

### 7.1 Fix before real use

| # | Limit | What it means | When it hurts | Recommendation |
|---|---|---|---|---|
| 1 | Automatic postings and messages run after the answer, inside the same server process, with no retry | When a visa application is created, the sale in the books and the status emails are made a moment later. If the server restarts at that moment, that posting or email is lost. | A restart or deploy while staff are working. The visa file exists but has no sale in Accounts. | **Add a reconcile action:** an admin button and a nightly job that find applications without a sale file, or whose numbers changed, and post them. The seed already has this logic (`syncApplication`). A failed email can already be sent again from the message log. Size: small. |
| 2 | A posting is made safe by undoing earlier steps, not by a database transaction | If the server dies between two steps of one posting, a half-posted journal can remain until it is voided by hand. | Rare, but it is a money record. | **Use a MongoDB replica set and wrap each posting in a transaction.** Managed MongoDB (Atlas and similar) is a replica set already, so this is cheap. Until then, item 1 repairs the visa side. Size: medium. |
| 3 | EmailJS free plan: about 200 requests a month | One visa file can send three or four automatic emails, and the monthly limit is shared with codes and invites. | After the first busy month. Emails then fail and are logged as failed. | **Use a paid plan, or add an SMTP or transactional email driver** behind the same mailer. Switch templates off in the meantime. |
| 4 | Uploaded files live on one server's local disk | No copy anywhere else. A second server cannot see them. | A disk failure, or a move to two servers. | **Back up the storage folder together with the database.** Add a cloud storage driver before running more than one server. |
| 5 | The retention period is a setting, but nothing deletes old documents | Passport copies stay until someone deletes them by hand. | A privacy complaint, or a legal question about how long they are kept. | **Confirm the number with the client, then build the deletion job** (small). Keep the default at 2 years after the application is closed. |
| 6 | Tests use an in-memory database and a stub for email | The seeds and the whole flow have never run against a real MongoDB or a real EmailJS account. The end-to-end tests were not run on the new routes. | The first day on real infrastructure. | **Before go-live,** seed and walk the visa and accounts flows once on a real database with real keys, and update and run the Playwright tests. Size: medium. |
| 7 | Opening balances can be entered for vendors only | What customers and agencies already owe on the first day cannot be loaded. | Starting Accounts in the middle of the year. | **Add opening balances for clients** (the same opening voucher as vendors). Size: small. |
| 8 | No period locking | A voucher can be backdated into a month that was already reported. | Once month-end reports are used for decisions or tax. | **Add locking after you answer who may lock a month** (open question 2). Admin only is my recommendation. |

### 7.2 Fine for a small team, watch as it grows

| # | Limit | What it means | When it hurts | Recommendation |
|---|---|---|---|---|
| 9 | Sales, dues and receipts lists load every match into memory before paging | Totals are exact, but each request reads all matching files. | Around ten thousand files or more. | Move the paging into the database when the lists feel slow. |
| 10 | Reports add up the journals on every request | There is no cached monthly total. | A large year of vouchers. | Add monthly summary rows when needed. The indexes are already in place. |
| 11 | A vendor typed by name on a visa application is created by that name | A typo makes a second vendor. | Until the dashboard picks vendors from the vendor list. | **Send the vendor id from the dashboard** (change 21 and 48 in `ADMIN_CHANGES.md`), and add a vendor merge tool only if duplicates appear. |
| 12 | Foreign currency: the rate is fixed when the application is made | A later payment is booked at that same rate, so no exchange gain or loss is posted. | USD files that are paid weeks later after a big move in the rate. | Accept it while foreign files are few and paid quickly. Add gain and loss posting if USD volume grows. |
| 13 | Visa amounts are in taka with two decimals, the books are in paisa | Converting a foreign amount can differ by one paisa between the visa file and the books. | Never in a way that matters. | Accept. |
| 14 | Rate limits are kept in each server's memory | Two servers each count on their own. | When you run more than one server. | Use a shared store (Redis) at that point. |
| 15 | Uploads are checked by size and by the real file type, not scanned for viruses | A harmless looking PDF could still carry something bad. | When many staff open files from outside. | Add a scan (for example ClamAV, or the cloud provider's) when you move storage. |
| 16 | One role per user | A person cannot be both staff and a partner contact. | Rarely. | Accept. Use permission presets for staff. |
| 17 | The exchange rate comes from a free service | If it is down, the old rate stays. | A day the service is unreachable. | Accept. Staff can type the rate. |

### 7.3 Accepted by design

| # | Limit | Why |
|---|---|---|
| 18 | A cancelled or rejected visa application does not change the books by itself. A person chooses refund or keep. | The business has not set a policy (open question 4). |
| 19 | The advanced accounting reports (ledger, trial balance, balance sheet) have no API | The dashboard shows only the simple pages (decided). The journals are there to build them from. |
| 20 | SMS is sent by hand and marked sent | No provider is chosen yet. |
| 21 | The audit log has no page in the dashboard | The log is written and readable by an admin through the API (`GET /api/admin/audit-logs`). |

### 7.4 Order I suggest

1. Items 1, 3 and 6 before any real data goes in.
2. Items 2, 4, 5, 7 and 8 before the first month-end.
3. The rest when the numbers grow.

## 8. How to run it

```bash
npm install
npm run setup            # creates .env if missing
npm run seed             # the first admin
npm run seed:all         # chart of accounts, statuses, demo catalog, applications, templates, quotations, vendors, sample books
npm run dev              # http://localhost:5000, API docs at /docs
npm test                 # unit and integration tests
```

`npm run seed:reset` clears and seeds again.
It refuses to run in production.
