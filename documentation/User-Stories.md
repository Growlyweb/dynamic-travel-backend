# User stories

Stories for every role in the authentication and access-control service.
Each story says who wants what and why, how it is checked, and which endpoint serves it.
Behaviour described here matches what is built and tested today.

## Roles at a glance

| Role | Who they are | How they get an account | Can reach |
| --- | --- | --- | --- |
| **B2C** | An individual traveller | Registers, or continues with Google | Their own profile and their own records |
| **B2B** | A travel agency or business partner | Registers, then waits for admin approval | Their own profile and documents. Operational features once approved. |
| **STAFF** | An internal team member | Invited by an admin | Only what the admin granted through permissions |
| **ADMIN** | A platform administrator | The first one by seed script, later ones invited by an admin | Everything under the admin area |

## How to read the status

| Status | Meaning |
| --- | --- |
| **Built** | Implemented and covered by automated tests |
| **Needs setup** | Implemented, but waits on an account or setting from the team (see `ToDo.md`) |
| **Open** | Decided as wanted, not built yet |
| **Planned** | Belongs to another module. This service already provides the guards it will reuse. |

---

## Everyone (all roles)

### EVR-1: Log in with email and password
As a registered user, I want to log in with my email and password, so that I can use the platform.

- A correct email and password returns an access token (valid 15 minutes) and a refresh token.
- A wrong password and an unknown email give the identical answer, `Invalid credentials`, so nobody can discover which emails exist.
- An account that is not active is refused: unverified (`EMAIL_NOT_VERIFIED`), suspended, blocked or inactive (`ACCOUNT_NOT_ACTIVE`).
- Ten failed tries per email and IP in 15 minutes lock the form for a while (`429`).
- Endpoint: `POST /api/auth/login`. Status: **Built**.

### EVR-2: Stay signed in without logging in again
As a signed-in user, I want my session to renew quietly, so that I am not thrown out every 15 minutes.

- The web app keeps the refresh token in an `httpOnly` cookie. A mobile app receives it in the response body.
- Each refresh issues a new pair and retires the old refresh token.
- If an old refresh token is ever replayed, the platform treats it as theft and signs that user out on every device.
- Endpoint: `POST /api/auth/refresh`. Status: **Built**.

### EVR-3: Log out
As a signed-in user, I want to log out of this device, or of all my devices, so that a lost phone or a shared computer cannot keep my session.

- "This device" retires only the current refresh token.
- "All devices" also cancels every access token still in flight.
- Endpoint: `POST /api/auth/logout` (with `{ "allDevices": true }` for all). Status: **Built**.

### EVR-4: Recover a forgotten password
As a user who forgot my password, I want a code sent to my email, so that I can set a new password.

- The request always answers the same, whether or not the email exists.
- The 6-digit code expires after 10 minutes, works once, and dies after 5 wrong tries.
- I can check the code first without using it up.
- A successful reset signs me out everywhere and sends me a "your password was changed" email.
- Endpoints: `POST /api/auth/forgot-password`, `POST /api/auth/verify-reset-token`, `POST /api/auth/reset-password`. Status: **Built** (**Needs setup** for real email delivery).

### EVR-5: Change my password while logged in
As a signed-in user, I want to change my password, so that I can keep it fresh.

- I must give my current password. A wrong one is refused.
- The new password must differ from the old one and meet the policy (8 to 64 characters with upper case, lower case, a number and a symbol).
- My other devices are signed out. This device continues with fresh tokens.
- Only 5 attempts per 15 minutes, so a stolen session cannot guess my password.
- Endpoint: `POST /api/auth/change-password`. Status: **Built**.

### EVR-6: See who I am
As a signed-in user, I want to fetch my own profile, so that the app can show my name and role and guard its screens.

- Returns my account, and my partner record if I am a B2B user.
- Never returns a password hash.
- Endpoint: `GET /api/auth/me`. Status: **Built**.

### EVR-7: Lose access the moment an admin removes it
As the platform, I want a suspension, role change or password reset to take effect immediately, so that access never lingers until a token runs out.

- Every request reloads the account, so a suspended user's still-valid token stops working on the very next call.
- Status: **Built**.

---

## B2C: the customer

### B2C-1: Sign up with email and password
As a traveller, I want to create an account with my email, so that I can use the services.

- I give my name, email, a password, and optionally a phone number.
- The account starts `PENDING` and a 6-digit code is emailed to me.
- I cannot choose my role. Anything I send for `role` is ignored.
- A duplicate email or phone is refused with a clear message.
- Endpoint: `POST /api/auth/register`. Status: **Built** (**Needs setup** for real email delivery).

### B2C-2: Verify my email
As a new customer, I want to enter the code I received, so that my account becomes active.

- A correct code activates the account and signs me in.
- A wrong code is refused. Five wrong tries kill that code.
- If no email arrived, I can ask for a new code. A new code replaces the old one, with a 60 second pause between requests.
- Endpoints: `POST /api/auth/verify-otp`, `POST /api/auth/resend-otp`. Status: **Built**.

### B2C-3: Continue with Google
As a traveller, I want to sign in with one click using Google, so that I do not need another password.

- The app signs in with Firebase, then sends the Firebase ID token to the API, which answers with its own tokens.
- A first-time Google sign-in creates my customer account, already verified.
- Only Google is accepted. A token from Firebase email and password, or any other method, is refused with `FIREBASE_PROVIDER_NOT_ALLOWED`.
- If I already registered with the same email, Google signs me in to that same account instead of creating a second one.
- Endpoint: `POST /api/auth/firebase`. Status: **Built**.

### B2C-4: Add a password to my Google account
As a customer who joined with Google, I want to set a password later, so that I can also log in with email and password.

- I use "forgot password" with my email and set a new one.
- Afterwards both ways in lead to the same account.
- Status: **Built**.

### B2C-5: Keep my profile up to date
As a customer, I want to change my name and phone number, so that my details stay correct.

- I can change only my name and phone.
- A changed phone number becomes unverified again.
- I cannot change my email, role, status or permissions, even if I try to send them.
- Only I can change my profile, and an admin. No other customer, agency or staff member can, however they try: there is no route that names another person, and an id in the request body is ignored.
- Endpoints: `GET /api/b2c/profile`, `PATCH /api/b2c/profile`. Status: **Built**.

### B2C-6: See only my own data
As a customer, I want my records to be invisible to everyone else, so that my private details stay private.

- I cannot reach admin, staff or agency endpoints (`403`).
- Opening somebody else's record answers `404`, the same as a record that does not exist.
- Status: **Built** for the rule. The records themselves arrive with other modules.

### B2C-7: Change the email on my account
As a customer, I want to move my account to a new email address, so that I keep my history when my address changes.

- Needs a code sent to the new address before the change counts.
- Status: **Open**.

### B2C-8: Verify my phone number
As a customer, I want to confirm my phone number, so that the platform can trust it.

- Through Firebase phone sign-in, or through an SMS gateway. The choice is still open.
- Status: **Open** (decision pending, see `ToDo.md`).

### B2C-9: My applications, documents, flight inquiries and notifications
As a customer, I want to apply for services and follow their progress, so that I can plan my trip.

- Each of these records will be locked to its owner with the ownership check.
- Status: **Planned** (other modules).

### B2C-10: Browse tour packages
As a visitor or customer, I want to search and filter published tours, so that I can find a trip that fits my budget and dates.

- No account is needed. I search by name, destination or country, filter by category, price and duration, and sort by price, duration, rating or newest.
- I only see published tours. A draft or archived tour is `404`, the same as one that does not exist.
- I never see the partner price.
- Endpoints: `GET /api/tours`, `GET /api/tours/:id`, `GET /api/tour-categories`. Status: **Built**.

### B2C-11: Ask for a custom tour
As a customer, I want to describe the trip I have in mind, so that a consultant can plan and price it for me.

- I send my destination, travelers, dates, hotel preference, transport, activities, requirements and a draft itinerary. The end date cannot be before the start date.
- The request is mine: nobody else can read it, and I cannot name another owner. Only customers can send one.
- I follow its status (`NEW`, `IN_REVIEW`, `QUOTED`, `CONFIRMED`) and read the consultant's note, such as the quote.
- I can cancel it while it is still `NEW`.
- Endpoints: `POST /api/tours/custom-requests`, `GET /api/tours/custom-requests`, `PATCH /api/tours/custom-requests/:id/status`. Status: **Built**.

### B2C-12: See my membership
As a customer, I want to see my membership, so that I know my discount and when it ends.

- I see my active membership and my history: plan, discounts, start and end, days left, and how I paid.
- An expired membership shows as expired the moment its end date passes, with no delay.
- I cannot buy, cancel or change one myself: an admin does it after my payment. I see only my own, and never the admin's internal notes.
- Endpoint: `GET /api/b2c/memberships` (`?status=active` for the profile page). Status: **Built**. The discount itself is applied when booking, which is **Planned** (booking module).

---

## B2B: the agency

### B2B-1: Register my agency
As an agency owner, I want to apply for a partner account, so that I can work with the platform.

- I give my name, email, mobile, password, company name, license number and address. Business type is optional.
- I upload a trade license (required). A business card and up to three other documents are optional. Allowed: PDF, JPEG, PNG, WEBP, up to 5 MB each.
- The system creates my user and a partner record in `PENDING`, and emails me a code.
- A missing license, a weak password, a duplicate email or a duplicate license number is refused, and none of my uploaded files are kept.
- Endpoint: `POST /api/auth/b2b/register`. Status: **Built** (**Needs setup** for real email delivery).

### B2B-2: Verify my email and log in while I wait
As an agency owner, I want to log in right after verifying, so that I can follow my application.

- After the code I can log in and see my profile and documents.
- Operational features stay closed with `PARTNER_NOT_APPROVED` until an admin approves me.
- Endpoints: `POST /api/auth/verify-otp`, `GET /api/b2b/overview`. Status: **Built**.

### B2B-3: Add documents to my application
As an agency owner, I want to upload further documents, so that I can complete my application or fix a rejection.

- Allowed while my application is `PENDING`, `UNDER_REVIEW` or `REJECTED`.
- Locked once approved or suspended, because a change would need a fresh review.
- A partner can hold at most 10 documents.
- Endpoints: `GET /api/b2b/documents`, `POST /api/b2b/documents`. Status: **Built**.

### B2B-4: See how my documents were reviewed
As an agency owner, I want to see whether each document was verified or rejected, and why, so that I know what to fix.

- Each document shows its type, status and the reviewer's note.
- The internal storage path is never shown.
- Status: **Built**.

### B2B-5: Update my contact details
As an agency owner, I want to edit my address and business type, so that my details stay accurate.

- My company name and license number are locked, because changing them needs a new review.
- Endpoints: `GET /api/b2b/profile`, `PATCH /api/b2b/profile`. Status: **Built**.

### B2B-6: Download my own documents
As an agency owner, I want to download what I uploaded, so that I have my copies.

- The file arrives as a download, never displayed in the browser, and is not cached.
- Another agency, a customer or a visitor gets `404`.
- Endpoint: `GET /api/documents/partners/:partnerId/:docId`. Status: **Built**.

### B2B-7: Be told the decision
As an agency owner, I want an email when my application is approved, rejected or suspended, so that I do not have to keep checking.

- The email states the new status and the reviewer's note.
- Status: **Built** (**Needs setup**: a general EmailJS template, see `ToDo.md`).

### B2B-8: Use the partner features once approved
As an approved agency, I want to submit passports, request pickups, see commission, withdraw and download invoices, so that I can run my business through the platform.

- The approval gate (`requireApprovedPartner`) is built and tested, and every record will be locked to my partner id.
- Status: **Planned** (other modules).

### B2B-9: See the partner price
As an approved agency, I want to see the partner price on every tour, so that I can quote my own customers.

- The price appears only after an admin approved my partner. While my application is pending, rejected or suspended I see the public price only.
- Endpoints: the same tour endpoints; `b2bPrice` is added for me. Status: **Built**.

---

## STAFF: the team member

### STAFF-1: Activate my account from an invite
As a new staff member, I want to set my own password from an emailed link, so that I can start without anyone knowing my password.

- The link works once and expires after 48 hours.
- Setting the password activates the account and confirms my email.
- A reused, expired or invented link is refused.
- Endpoint: `POST /api/auth/setup-account`. Status: **Built** (**Needs setup** for real email delivery).

### STAFF-2: Do only what I was given permission to do
As a staff member, I want my access to match my job, so that I can work without seeing what I should not.

- I start with no permissions. I get only those an admin lists.
- A route that needs a permission I lack answers `403`.
- If an admin removes a permission, it stops working immediately.
- Status: **Built**.

### STAFF-3: See and update my own profile
As a staff member, I want to manage my name and phone, so that my details are right.

- Endpoints: `GET /api/staff/profile`, `PATCH /api/staff/profile`. Status: **Built**.

### STAFF-4: Look up agencies
As a staff member with `B2B_VIEW`, I want to list partners, so that I can support them.

- Read-only. I cannot approve or reject anyone.
- Endpoint: `GET /api/staff/partners`. Status: **Built**.

### STAFF-5: Check agency documents
As a staff member with `DOCUMENT_VERIFY`, I want to mark a partner's document verified or rejected with a note, so that approval can proceed.

- With `DOCUMENT_VIEW` I can also download the file.
- Without these permissions I get `403` (review) or `404` (download).
- Reviewing a document does not approve the agency. That stays an admin decision.
- Endpoint: `PATCH /api/staff/partners/:id/documents/:docId`. Status: **Built**.

### STAFF-7: Manage tour packages
As a staff member with the tour permission, I want to create categories and tours, publish or unpublish them and answer custom tour requests, so that the catalogue stays current.

- I need `TOUR_MANAGE`. Without it I see what the public sees and every change is `403`.
- I can see drafts, unpublished and archived tours and the partner price.
- "Delete" archives a tour or switches a category off. Nothing is lost.
- I read every custom request with the customer's contact details, move it along (`IN_REVIEW`, `QUOTED`, `CONFIRMED`, `CANCELLED`) and leave a note.
- Status: **Built**.

### STAFF-8: Sell and manage memberships
As a staff member with the membership permission, I want to sell memberships and keep the plans current, so that customers get their discount.

- I need `MEMBERSHIP_MANAGE`. Without it every membership route is `403`.
- I create and edit plans, switch them on and off, and delete a plan nobody used.
- I assign a plan to a B2C customer and record the payment (method and transaction id, for the record). The amount comes from the plan, and an agency or admin cannot be sold one.
- A customer can have only one active membership. I can cancel (with a reason), extend by days, or delete one.
- I read the numbers: active, expiring in 7 days, expired this month, revenue by month, and sales by period.
- Status: **Built**.

### STAFF-6: My daily tasks and assigned records
As a staff member, I want to see the visa, passport and document items assigned to me, so that I know what to work on.

- Will use the permission guards already in place (`VISA_VIEW`, `VISA_UPDATE`, `PASSPORT_VIEW`, `PASSPORT_UPDATE`).
- Status: **Planned** (other modules).

---

## ADMIN: the administrator

### ADMIN-1: Start the platform with a first admin
As the person deploying the platform, I want a first admin created from a script, so that nobody can create one through an open endpoint.

- `npm run seed` creates one admin from `ADMIN_SEED_*`, and refuses a weak password.
- Running it again does nothing if an admin already exists.
- Status: **Built**.

### ADMIN-2: Create staff and other admins
As an admin, I want to create staff and admin accounts, so that my team can work.

- I enter name, email and, for staff, a permission list. No password: the person gets an invite link.
- Staff get exactly the permissions I list. Admins need no list.
- I can resend an invite. Resending cancels the previous link.
- Only the roles marked invitable in `rbac.json` (ADMIN, STAFF) can be created this way. B2B and B2C only register themselves.
- Endpoints: `POST /api/admin/staff`, `POST /api/admin/users`, `POST /api/admin/users/:id/resend-invite`. Status: **Built**.

### ADMIN-3: Find and inspect users
As an admin, I want to search and filter accounts, so that I can answer support questions.

- Filters: role, status, free-text search, with pages.
- Search treats special characters literally, and filter values are validated.
- Responses never include password hashes.
- Endpoints: `GET /api/admin/users`, `GET /api/admin/users/:id`. Status: **Built**.

### ADMIN-3a: Correct someone's profile details
As an admin, I want to fix a person's name or phone number, so that I can help when they cannot do it themselves.

- This is the only way to change another person's profile. Every other role is refused (`403`), including staff who hold every permission.
- I can change only `name` and `phone`. A changed phone becomes unverified again.
- The email, role, status and permissions are ignored here and have their own actions, or none.
- A phone number that belongs to another account is refused (`409`). An empty change is refused (`422`).
- The audit log records that I changed the profile and which fields, never the values.
- Endpoint: `PATCH /api/admin/users/:id`. Status: **Built**.

### ADMIN-3b: Correct an agency's business record
As an admin, I want to edit an agency's company name, license number, business type and address, so that the record matches the documents I reviewed.

- The agency owner can change only the business type and address. As the reviewer I can change all four.
- A license number that belongs to another agency is refused (`409`).
- The approval status is not affected, and the change is audit-logged by field name.
- Endpoint: `PATCH /api/admin/b2b/:id`. Status: **Built**.

### ADMIN-3c: Manage my own profile
As an admin, I want to update my own name and phone, so that my details are right.

- Works like every other role's profile route: the person comes from my token, and I cannot name anyone else there.
- Endpoints: `GET /api/admin/profile`, `PATCH /api/admin/profile`. Status: **Built**.

### ADMIN-4: Suspend, block, reactivate or deactivate an account
As an admin, I want to control whether an account can sign in, so that I can stop misuse quickly.

- The change takes effect on the next request, and the person's refresh tokens are cancelled.
- I can add a reason. Old and new status are written to the audit log.
- Safeguards: I cannot change my own status. The last active admin cannot be removed. A never-verified account cannot be activated by hand.
- "Delete" deactivates, so the audit trail stays.
- Endpoints: `PATCH /api/admin/users/:id/status`, `DELETE /api/admin/users/:id`. Status: **Built**.

### ADMIN-5: Change someone's role or permissions
As an admin, I want to promote or demote team members and adjust what staff may do, so that access follows responsibility.

- A role change is limited to ADMIN and STAFF. Customers and agencies keep what they registered as.
- Moving someone to ADMIN clears their list. Moving to STAFF sets the list I give.
- I cannot change my own role. Their old tokens stop working at once.
- Permissions can only go to roles that carry a permission list.
- Endpoints: `PATCH /api/admin/users/:id/role`, `PATCH /api/admin/users/:id/permissions`. Status: **Built**.

### ADMIN-6: Decide on an agency application
As an admin, I want to approve, reject, put under review or suspend an agency, so that only vetted partners operate.

- Approval needs a trade license on file, otherwise `TRADE_LICENSE_MISSING`.
- I can add a note. The agency is emailed the outcome.
- Approval opens the partner features. Rejection or suspension closes them. Neither changes the owner's login.
- Every decision is audit-logged with my id and the old and new status.
- Endpoints: `GET /api/admin/b2b`, `GET /api/admin/b2b/:id`, `PATCH /api/admin/b2b/:id/approval`. Status: **Built**.

### ADMIN-7: Review an agency's documents
As an admin, I want to verify or reject each uploaded document and download it, so that I can judge the application on evidence.

- A rejection note is shown to the agency.
- Endpoints: `PATCH /api/admin/b2b/:id/documents/:docId`, `GET /api/documents/partners/:partnerId/:docId`. Status: **Built**.

### ADMIN-8: Read the audit trail
As an admin, I want a record of security-relevant events, so that I can investigate and prove who did what.

- Covers sign-ups, verification, logins and failed logins, logouts, password changes and resets, account, role and permission changes, partner decisions, document reviews and token-theft detection.
- Filter by action, actor or target. Passwords and tokens are never recorded.
- Endpoint: `GET /api/admin/audit-logs`. Status: **Built**.

### ADMIN-9: Fill role and permission pickers
As an admin using the admin screens, I want the list of roles and permissions from the server, so that the screens never drift from the rules.

- Comes straight from `config/rbac.json`.
- Endpoint: `GET /api/admin/rbac`. Status: **Built**.

### ADMIN-10: Close or open sign-up for a role
As an admin or developer, I want to switch off self-registration for B2B or B2C, so that I can pause intake without deploying code.

- Set `"selfRegister": false` for the role in `config/rbac.json` and restart.
- Registration then answers `REGISTRATION_CLOSED`. For customers this also covers a first Google sign-in. Existing accounts are unaffected.
- Status: **Built**.

### ADMIN-11: Add a new permission
As a developer, I want to add a permission in one place, so that new features can be guarded quickly.

- Add one line to `permissions` in `config/rbac.json` and restart. It then appears in validation, the API and the admin pickers.
- A mistake in the file stops the server from starting, with a clear message.
- Status: **Built**.

### ADMIN-13: Manage tour packages
As an admin, I want to run the tour catalogue and answer custom requests, so that the website shows current trips and customers get quotes.

- Everything a `TOUR_MANAGE` staff member can do (STAFF-7), without needing the permission.
- I can hand the same work to staff by granting `TOUR_MANAGE`; I can take it back at any time and it stops at once.
- `npm run seed:tours` loads the 8 starting categories and the sample tour.
- Status: **Built**.

### ADMIN-14: Manage membership plans and sales
As an admin, I want to sell memberships and watch the sales, so that I can run the loyalty programme.

- Everything a `MEMBERSHIP_MANAGE` staff member can do (STAFF-8), without needing the permission. I can grant that permission to staff and take it back at once.
- Editing a plan never changes a membership already sold: each keeps its own copy of the plan.
- Deleting a membership hides it, but the money stays in the revenue reports.
- `npm run seed:membership` loads four starting plans. Their prices are placeholders to replace with the real ones.
- Status: **Built**.

### ADMIN-12: Two-factor sign-in for admins
As an admin, I want a second factor on my login, so that a stolen password is not enough to reach the admin area.

- Status: **Open**.

---

## Platform guarantees

Stories about the system itself, which protect every role.

### SYS-1: Keep secrets and sessions safe
As the platform, I want credentials stored and moved safely, so that a breach of one part does not expose the rest.

- Passwords are hashed. One-time codes, invite tokens and refresh tokens are stored only as keyed hashes.
- Codes are single use and expire. Refresh tokens rotate.
- Secrets must be set before the server will start, and placeholders are rejected.
- Status: **Built**.

### SYS-2: Slow down abuse
As the platform, I want limits on sensitive actions, so that guessing and spamming do not work.

- Login, code checks, forgot password, registration, refresh and change password each have their own limit.
- A blocked caller receives `429` with a `Retry-After` header.
- Status: **Built**. Counters live in memory today, so they reset on restart and are not shared between servers.

### SYS-3: Show the same, safe errors everywhere
As a frontend developer, I want one error shape, so that screens can react to a `code` rather than parse text.

- Always `{ success: false, message, code?, errors? }`. Validation problems list each field.
- Production never returns stack traces or internal details.
- Status: **Built**.

### SYS-4: Keep documents private
As the platform, I want business documents served only after an ownership check, so that a guessed link exposes nothing.

- Files live outside any public folder, with generated names and an extension taken from the checked file type.
- Status: **Built**.

### SYS-5: Try the API in a browser
As a frontend developer or tester, I want to read and try every endpoint on one page, so that I can learn the API without writing code first.

- A page at `/docs` lists every route in a fixed order: System, sign up, sign in, passwords, then the role areas, tours and membership. Inside a group the operations are sorted by path, then by method.
- Each operation shows its parameters with descriptions, an editable example body, who may call it, the rate limit, and an example answer for every status code.
- Logging in on the page fills the Authorize box by itself, so protected operations work straight away. The token is kept only on the page.
- It is served by the API itself, so no CORS setting is needed. It is on in development and **never served in production**: there `/docs` answers 404 and no setting can change that.
- Status: **Built**.
