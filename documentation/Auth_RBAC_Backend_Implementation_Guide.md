## Auth & RBAC Backend Implementation Guide

Travel Management Platform | Node.js + Express | Roles: Admin, Staff, B2B, B2C | For the backend team

## 1. Goal and core principle

Build one central security layer, not four separate login systems. Every request flows through the same chain: One Auth system > One User identity > Role > Permission > Ownership check > Business logic. Authentication answers who are you?; authorization answers what may you do? A role check alone is never enough: the backend must also verify the record belongs to the caller (B2C: application.userId === req.user.id, B2B: application.partnerId === req.user.partnerId).

## 2. Request pipeline

```
Request -> Express Router -> authenticate -> authorize(role/permission) -> checkOwnership
-> validate(zod) -> Controller -> Service -> Model (Mongoose) -> Database -> Response
authenticate : read token -> verify -> load user -> check status + tokenVersion -> set req.user
authorize : does req.user.role / permissions allow this route?
ownership : does the requested record belong to this user / partner?
Controller : HTTP only (read request, call service, send response). Service: all business logic.
```

## 3. Roles at a glance

| Role | Created by | Can access | Must never |
| --- | --- | --- | --- |
| ADMIN | Another Admin (no public signup; | Users, staff, B2B, B2C, visa, passport, documents, tours, | Be created via open endpoint |
|   | first admin via seed script) | flights, commission, reports, settings (permission-controlled) |   |
| STAFF | Admin creates/invites, staff | Only assigned permissions (e.g. VISA_VIEW, | Get all Admin powers by default |
|   | activates | VISA_UPDATE, DOCUMENT_VERIFY) |   |
| B2B | Self-register, then Admin | Own profile, passports, pickups, commission, withdrawals, | See another partner's data |
|   | approval | invoices |   |
| B2C | Self-register | Own profile, visa applications, documents, tours, flight | Reach Admin/Staff/B2B APIs or |
|   |   | inquiries, notifications | internal notes |

## 4. Libraries to install

| Purpose | Library | How it is used |
| --- | --- | --- |
| Server / routing | express, cors, cookie-parser | App, routers, CORS allow-list, read refresh-token cookie |
| Database / ODM | mongoose (MongoDB, MERN) | User, PasswordReset, Partner, AuditLog models. Prisma or Sequelize also |
|   |   | fine if SQL is chosen |
| Password hashing | bcrypt (or argon2) | Hash on register / reset, compare on login (cost 12) |
| Tokens | jsonwebtoken | Short-lived access token (15 min) + refresh token (7 days) |
| Secure random / | crypto (built-in Node) | randomBytes for reset token, createHash('sha256') to store token/OTP hash |
| hashing |   |   |
| Validation | zod (or joi / express-validator) | Validate body, params, query; strip unknown fields so users cannot send role |
| Security headers / input helmet, hpp, express-mongo-sanitize |   | Headers, parameter pollution, NoSQL operator injection |
| Rate limiting | express-rate-limit (+ rate-limit-redis, | Login, OTP, forgot/reset password, register |
|   | ioredis) |   |
| Email / SMS | nodemailer, SMS gateway SDK (e.g. | Send reset link, OTP, staff invite |
|   | Twilio or local BD provider) |   |
| File upload | multer | B2B business documents, with type/size checks |
| Logging | pino or winston, morgan | App logs + HTTP logs (never log passwords or raw tokens) |
| Config | dotenv | JWT secrets, DB URL, SMTP keys in environment, never in Git |
| Testing | jest, supertest, mongodb-memory-server API tests for every role combination |   |


```
src/
app.js server.js
config/ env.js db.js permissions.js (permission constants)
middleware/ authenticate.js authorize.js checkOwnership.js validate.js rateLimit.js errorHandler.js
modules/
auth/ auth.routes.js auth.controller.js auth.service.js auth.validation.js auth.utils.js
passwordReset.service.js token.service.js
users/ admin/ staff/ b2b/ b2c/ (each: routes, controller, service, model)
audit/ audit.model.js audit.service.js
utils/ ApiError.js asyncHandler.js mailer.js sms.js
```

## 6. Data models

| Model | Fields | Notes |
| --- | --- | --- |
| User | name, email (unique), phone (unique), passwordHash, role | Set select:false on passwordHash. |
|   | [ADMIN|STAFF|B2B|B2C], permissions[], status | tokenVersion++ invalidates every old |
|   | [PENDING|ACTIVE|SUSPENDED|BLOCKED|INACTIVE], emailVerified, | token |
|   | phoneVerified, tokenVersion, partnerId, lastLoginAt |   |
| Partner (B2B) | userId, companyName, licenseNo, documents[], approvalStatus | Kept separate from User.status. B2B gets |
|   | [PENDING|UNDER_REVIEW|APPROVED|REJECTED|SUSPENDED] | operational access only when |
|   |   | APPROVED |
| PasswordReset | userId, tokenHash, expiresAt, usedAt, attempts, requestMeta | Store only the hash. TTL index on |
|   |   | expiresAt. Single use |
| RefreshSession | userId, tokenHash, userAgent, ip, expiresAt, revokedAt | Enables logout and rotation |
| AuditLog | actorUserId, action, targetUserId, resource, result, ip, createdAt | LOGIN, PASSWORD_RESET, |
|   |   | ROLE_CHANGED, B2B_APPROVED ... |

## 7. Core middleware (reference implementation)

```
// middleware/authenticate.js
const jwt = require('jsonwebtoken'); const User = require('../modules/users/user.model');
module.exports = async (req, res, next) => {
const h = req.headers.authorization || '';
const token = h.startsWith('Bearer ') ? h.slice(7) : null;
if (!token) return next(new ApiError(401, 'Authentication required'));
let payload;
try { payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET); }
catch { return next(new ApiError(401, 'Invalid or expired token')); }
const user = await User.findById(payload.sub);
if (!user || user.tokenVersion !== payload.tv) return next(new ApiError(401, 'Session expired'));
if (user.status !== 'ACTIVE') return next(new ApiError(403, 'Account not active'));
req.user = { id: user.id, role: user.role, status: user.status,
partnerId: user.partnerId, permissions: user.permissions };
next();
};
// middleware/authorize.js
exports.requireRole = (...roles) => (req, res, next) =>
roles.includes(req.user.role) ? next() : next(new ApiError(403, 'Forbidden'));
exports.requirePermission = (...perms) => (req, res, next) => {
if (req.user.role === 'ADMIN') return next(); // or check admin permissions too
return perms.every(p => req.user.permissions.includes(p)) ? next() : next(new ApiError(403, 'Forbidden'));
};
// middleware/checkOwnership.js (B2B / B2C only; Admin and permitted Staff bypass)
exports.ownsApplication = async (req, res, next) => {
const app = await Application.findById(req.params.id);
if (!app) return next(new ApiError(404, 'Not found'));
const { role, id, partnerId } = req.user;
const ok = (role === 'B2C' && String(app.userId) === id) ||
(role === 'B2B' && String(app.partnerId) === String(partnerId)) ||
['ADMIN', 'STAFF'].includes(role);
if (!ok) return next(new ApiError(404, 'Not found')); // non-disclosing
req.resource = app; next();
};
// usage
router.patch('/visa/applications/:id/status', authenticate,
requirePermission('VISA_UPDATE'), validate(statusSchema), visaController.updateStatus);
```


## 8. Registration, login and token flow

| Flow | Steps (backend) |
| --- | --- |
| B2C register | validate (zod) > check duplicate email/phone > bcrypt.hash > create User(role=B2C) > verify email/phone via OTP > |
|   | status=ACTIVE > return tokens. Ignore any role field in the body. |
| B2B register | validate personal + business info > multer upload documents > create User(role=B2B, status=PENDING) + |
|   | Partner(PENDING) > Admin reviews > APPROVED (access opens) or REJECTED. Audit-log the decision. |
| Admin create | Only POST /api/admin/users by an authorized Admin. First Admin created by a one-time seed script on deployment. |
| Staff create | Admin creates account + assigns permissions > invite email with setup token > staff sets password and activates > login. |
| Login | find user (+passwordHash) > check status > bcrypt.compare > sign access JWT (15m) + refresh token (7d, stored hashed, |
|   | httpOnly cookie) > update lastLoginAt > audit LOGIN. Always return the same generic error: Invalid credentials. |
| Refresh / logout | Refresh: verify refresh token, check RefreshSession not revoked, rotate it. Logout: revoke RefreshSession (and optionally |
|   | tokenVersion++). |

```
// token.service.js
const accessToken = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.tokenVersion },
process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
const refreshToken = (u) => jwt.sign({ sub: u.id, tv: u.tokenVersion },
process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
// auth.service.js (login)
const user = await User.findOne({ email }).select('+passwordHash');
if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new ApiError(401, 'Invalid credentials');
if (user.status !== 'ACTIVE') throw new ApiError(403, 'Account not active');
```

## 9. Forgot password, reset password and change password

| Step | Backend behavior |
| --- | --- |
| 1. Request | POST /api/auth/forgot-password {email|phone}. Always respond with a generic success message, even if the |
|   | account does not exist. Rate limit strictly. |
| 2. Generate | token = crypto.randomBytes(32).toString('hex') (or 6-digit OTP via crypto.randomInt). Store sha256 hash only, expiresAt = |
|   | now + 15 min (OTP: 5-10 min), attempts = 0. Send link/OTP by Nodemailer or SMS. |
| 3. Verify | POST /api/auth/verify-reset-token (optional for OTP). Hash input, compare, check not expired, not used, attempts |
|   | < 5. |
| 4. Reset | POST /api/auth/reset-password {token, newPassword}. Validate strength > bcrypt.hash > update passwordHash > |
|   | set usedAt > tokenVersion++ and revoke all RefreshSessions > audit PASSWORD_RESET > notify user. |
| Change password | User is logged in. Require currentPassword, verify with bcrypt.compare, validate new one, hash, update, tokenVersion++ |
|   | (other devices are logged out), audit PASSWORD_CHANGED. |

```
const raw = crypto.randomBytes(32).toString('hex');
const hash = crypto.createHash('sha256').update(raw).digest('hex');
await PasswordReset.create({ userId: user.id, tokenHash: hash, expiresAt: Date.now() + 15*60*1000 });
await mailer.send(user.email, `${process.env.APP_URL}/reset-password?token=${raw}`); // never store or log raw
```

## 10. Account status and B2B approval rules

| Status | Login / access |
| --- | --- |
| ACTIVE | Allowed |
| PENDING | Limited by business rule (B2B: login allowed, operational APIs blocked until Partner is APPROVED) |
| SUSPENDED | Denied or restricted; Admin can reactivate |
| BLOCKED / INACTIVE | Login denied |

Role change: only Admin, via PATCH /api/admin/users/:id/role, always audit-logged. Registration and profile-update schemas must never accept role, status, permissions or partnerId.


## 11. API groups and required guards

| Group | Endpoints | Guard |
| --- | --- | --- |
| Auth (public) | POST /api/auth/register, login, refresh, verify-otp, resend-otp, forgot-password, | rateLimit + validate |
|   | verify-reset-token, reset-password |   |
| Auth (logged in) | POST /api/auth/logout, change-password; GET /api/auth/me | authenticate |
| Admin | GET/POST /api/admin/users; GET/PATCH/DELETE /api/admin/users/:id; PATCH | authenticate + requireRole(ADMIN) + |
|   | .../status; PATCH .../role; POST /api/admin/staff; PATCH | requirePermission |
|   | /api/admin/b2b/:id/approval |   |
| Staff | GET/PATCH /api/staff/profile; GET /api/staff/tasks; GET | authenticate + requireRole(STAFF) + |
|   | /api/staff/assigned-records; visa/passport/document operational routes | requirePermission(...) |
| B2B | GET/PATCH /api/b2b/profile; GET /api/b2b/passports(/:id); POST/GET | authenticate + requireRole(B2B) + |
|   | pickup-requests; GET commission(/history); GET/POST withdrawals; GET | partner APPROVED + ownership by |
|   | invoices, acknowledgements | partnerId |
| B2C | GET/PATCH /api/b2c/profile; GET applications(/:id); GET documents, tours, | authenticate + requireRole(B2C) + |
|   | flight-inquiries, notifications | ownership by req.user.id (never trust an |
|   |   | id in the body) |

## 12. Permission matrix (starting point, confirm with business team)

| Permission key | Meaning | Permission key | Meaning |
| --- | --- | --- | --- |
| USER_VIEW / USER_MANAGE | See / manage user accounts | PASSPORT_VIEW / | See / update passport records |
|   |   | PASSPORT_UPDATE |   |
| VISA_VIEW / VISA_UPDATE | See / change visa application | B2B_VIEW / B2B_MANAGE | See / approve and manage |
|   | status |   | partners |
| DOCUMENT_VIEW / | See / verify uploaded documents TOUR_MANAGE, |   | Operate tours and flight inquiries |
| DOCUMENT_VERIFY |   | FLIGHT_INQUIRY_MANAGE |   |
| STAFF_CREATE | Create staff accounts | REPORT_VIEW | View reports |

## 13. Cross-cutting security rules

- Rate limits (express-rate-limit): login 5-10 per 15 min per IP+email; OTP and resend 3-5 per 15 min; forgot-password 3 per hour; register 10 per hour. Return 429.

- Errors: central errorHandler; use 400, 401, 403, 404, 409, 422, 429, 500. No stack traces, DB errors or secrets in production responses.

- Audit log: LOGIN, LOGOUT, PASSWORD_CHANGED, PASSWORD_RESET, ROLE_CHANGED, PERMISSION_CHANGED, ACCOUNT_SUSPENDED, ACCOUNT_ACTIVATED, B2B_APPROVED, B2B_REJECTED. Never log passwords or raw tokens.

- Hardening: helmet, strict CORS allow-list, HTTPS only, httpOnly + secure + sameSite refresh cookie, hpp, express-mongo-sanitize, body size limit, strong password policy, secrets only in environment variables.

- Files: B2B/B2C documents are served only through an authenticated, ownership-checked route (no public static folder). Check mime type and size in multer.

- Wrong-owner access: return 403, or 404 to avoid revealing that the record exists (be consistent).

## 14. Build order and Definition of Done

| Phase | Tasks |
| --- | --- |
| A. Foundation | 1 User model > 2 env/config > 3 password hashing > 4 register > 5 login + tokens > 6 authenticate > 7 authorize |
|   | (role) > 8 permission system |
| B. Roles | 9 Admin > 10 Staff > 11 B2B (+approval) > 12 B2C, each with ownership checks |
| C. Recovery and hardening | 13 forgot password > 14 reset password > 15 session/token invalidation > 16 audit log > 17 rate limit and security > |
|   | 18 QA with jest + supertest |

Done when: register, login, logout and refresh work; all four roles are enforced; permission and ownership checks block cross-user access; account status is respected; forgot/reset works with expiring, single-use tokens; old sessions die after reset; rate limiting, validation, consistent errors and audit logs are in place; and QA has tested every role against every protected route group.
