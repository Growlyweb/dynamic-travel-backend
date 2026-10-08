// One entry per route. Bodies, query strings and path parameters reference the zod schemas in
// validations/, so they stay in step with the real validation. Everything a person reads (summary,
// description, who may call it, rate limit, examples, error codes) is written here.
const auth = require('../../validations/auth.validation');
const user = require('../../validations/user.validation');
const partner = require('../../validations/partner.validation');
const profile = require('../../validations/profile.validation');
const tours = require('../../validations/tour.validation');
const { obj, str, bool, ref, arrayOf, exUser, exDocument, exPartner, exSession, exMeta, exCategory, exTour, exCustomRequest, exItinerary, NOW, ID } = require('./shared');

// ---- tags (order = order in Postman folders)
const TAGS = [
  { name: 'Auth', description: 'Registration, OTP, login, tokens, passwords. Public unless noted.' },
  { name: 'Customer (B2C)', description: 'Endpoints for signed-in customers.' },
  { name: 'Agency (B2B)', description: 'Endpoints for signed-in agencies. Operational routes need an APPROVED partner.' },
  { name: 'Staff', description: 'Endpoints for staff. Each feature needs a permission an admin granted.' },
  { name: 'Admin: users', description: 'ADMIN only. Accounts, invites, status, roles, permissions, roles catalog.' },
  { name: 'Admin: agencies', description: 'ADMIN only. Review B2B applications and their documents.' },
  { name: 'Admin: audit', description: 'ADMIN only. Security event log.' },
  { name: 'Documents', description: 'Private business documents, served only after an ownership check.' },
  { name: 'Tour categories', description: 'Reading is public. Changing needs ADMIN, or STAFF with TOUR_MANAGE.' },
  { name: 'Tours', description: 'Reading is public (published tours; the B2B price only for admin, TOUR_MANAGE staff and approved agencies). Changing needs ADMIN, or STAFF with TOUR_MANAGE.' },
  { name: 'Custom tours', description: 'A B2C customer sends and follows their own request; tour managers answer it.' },
  { name: 'System', description: 'Health and version.' }
];

// ---- rate limit sentences
const RATE = {
  api: 'Every `/api` route is also limited to 300 requests per 15 minutes per IP.',
  register: 'Rate limit: 10 requests per hour per IP (one quota shared with the other register endpoint).',
  otp: 'Rate limit: 5 requests per 15 minutes per IP + email (one quota shared by verify-otp, resend-otp, verify-reset-token, reset-password and setup-account).',
  login: 'Rate limit: 10 requests per 15 minutes per IP + email.',
  firebase: 'Rate limit: 30 requests per 15 minutes per IP.',
  refresh: 'Rate limit: 30 requests per 15 minutes per IP.',
  forgot: 'Rate limit: 3 requests per hour per IP + email.',
  change: 'Rate limit: 5 requests per 15 minutes per signed-in user.'
};

const SESSION_NOTE =
  'Tokens: the response carries a short-lived `accessToken`. The refresh token arrives as an **httpOnly cookie** (path `/api/auth`) for web clients. ' +
  'Send the header `X-Client-Type: mobile` to get it in the JSON body as `refreshToken` instead.';

const ok = (status, message, schema, example, opts = {}) => ({ status, message, schema, example, ...opts });

// shared success shapes
const SESSION = ref('Session');

const endpoints = [
  // =============================================================== AUTH
  {
    method: 'post', path: '/api/auth/register', tag: 'Auth', id: 'registerCustomer',
    summary: 'Register a customer (B2C)',
    description:
      'Creates a customer account and emails a 6-digit verification code. The account is `PENDING` until the code is confirmed with **Verify email code**.\n\n' +
      'The role is always `B2C`. There is no `role` field: anything extra in the body is ignored.\n\n' + RATE.register,
    access: 'Public', body: auth.registerB2C,
    bodyExample: { name: 'Rahim Uddin', email: 'rahim@example.com', phone: '+8801712345678', password: 'Str0ng!Pass' },
    success: ok(201, 'Account created. Enter the verification code we emailed you.', obj({ user: ref('User'), otpSent: bool(true) }), { user: exUser({ status: 'PENDING', emailVerified: false, lastLoginAt: undefined }), otpSent: true }),
    errors: { 403: ['REGISTRATION_CLOSED'], 409: ['EMAIL_TAKEN', 'PHONE_TAKEN'], 422: true, 429: true },
    notes: '`otpSent: false` means the account exists but the email could not be delivered. Use **Resend verification code**.'
  },
  {
    method: 'post', path: '/api/auth/b2b/register', tag: 'Auth', id: 'registerAgency',
    summary: 'Register an agency (B2B)',
    description:
      'Creates an agency user (`PENDING`) and a partner record (`PENDING`), stores the uploaded documents privately, and emails a verification code.\n\n' +
      'After verifying the email the owner can log in, but operational routes stay closed (`PARTNER_NOT_APPROVED`) until an admin approves the partner.\n\n' +
      '**Form-data.** A `tradeLicense` file is required. Allowed file types: PDF, JPEG, PNG, WEBP, up to 5 MB each.\n\n' + RATE.register,
    access: 'Public',
    multipart: {
      zod: auth.registerB2B,
      files: {
        tradeLicense: { description: 'Trade license (required). PDF, JPEG, PNG or WEBP, max 5 MB.' },
        businessCard: { description: 'Business card (optional).' },
        otherDocuments: { description: 'Up to 3 further documents (optional).', multiple: true, maxItems: 3 }
      },
      required: ['tradeLicense'],
      example: { name: 'Karim Hossain', email: 'karim@agency.com', phone: '+8801811111111', password: 'Str0ng!Pass', companyName: 'Sky Travels Ltd', licenseNo: 'TL-2024-0042', businessType: 'Travel agency', address: '45 Motijheel, Dhaka' }
    },
    success: ok(201, 'Business account created. Verify your email; an administrator will then review your application.', obj({ user: ref('User'), partner: ref('Partner'), otpSent: bool(true) }), { user: exUser({ _id: '6ac0a5f0eebc510147c6722e', name: 'Karim Hossain', email: 'karim@agency.com', phone: '+8801811111111', role: 'B2B', status: 'PENDING', emailVerified: false, partnerId: '6ac0a5f0eebc510147c6722f', lastLoginAt: undefined }), partner: exPartner(), otpSent: true }),
    errors: { 400: ['FILE_TYPE_NOT_ALLOWED'], 403: ['REGISTRATION_CLOSED'], 409: ['EMAIL_TAKEN', 'PHONE_TAKEN', 'LICENSE_TAKEN'], 413: true, 422: ['VALIDATION_ERROR'], 429: true },
    notes: 'A missing trade license answers 422 with `errors[0].field = "tradeLicense"`. If any check fails, no file is kept.'
  },
  {
    method: 'post', path: '/api/auth/verify-otp', tag: 'Auth', id: 'verifyEmailCode',
    summary: 'Verify email code',
    description:
      'Confirms the 6-digit code from the registration email. Activates the account and **signs the user in**. The code is valid 10 minutes, works once, and dies after 5 wrong tries.\n\n' +
      SESSION_NOTE + '\n\n' + RATE.otp,
    access: 'Public', mobileHeader: true, body: auth.verifyOtp, bodyExample: { email: 'rahim@example.com', otp: '482913' },
    success: ok(200, 'Email verified.', SESSION, exSession(), { setsCookie: true }),
    errors: { 400: ['INVALID_CODE'], 403: ['ACCOUNT_NOT_ACTIVE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/resend-otp', tag: 'Auth', id: 'resendEmailCode',
    summary: 'Resend verification code',
    description: 'Sends a new code and cancels the previous one. At least 60 seconds must pass between sends. The answer is identical whether or not the email exists, so it cannot be used to find registered addresses.\n\n' + RATE.otp,
    access: 'Public', body: auth.resendOtp, bodyExample: { email: 'rahim@example.com' },
    success: ok(200, 'If that account is waiting for verification, a new code was sent.'),
    errors: { 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/login', tag: 'Auth', id: 'login',
    summary: 'Log in (email and password)',
    description:
      'Works for every role. The answer is the same `Invalid credentials` whether the email is unknown, has no password, or the password is wrong.\n\n' +
      '**After this call, put `data.accessToken` into the collection variable `bearerToken`.**\n\n' + SESSION_NOTE + '\n\n' + RATE.login,
    access: 'Public', mobileHeader: true, body: auth.login, bodyExample: { email: 'rahim@example.com', password: 'Str0ng!Pass' },
    success: ok(200, 'Login successful.', SESSION, exSession(), { setsCookie: true }),
    errors: { 401: ['INVALID_CREDENTIALS'], 403: ['EMAIL_NOT_VERIFIED', 'ACCOUNT_NOT_ACTIVE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/firebase', tag: 'Auth', id: 'loginWithGoogle',
    summary: 'Continue with Google (Firebase ID token)',
    description:
      'The client signs in with Google through the Firebase SDK, then sends the Firebase **ID token** here. The API verifies it and answers with its own tokens.\n\n' +
      '- Only **Google** is accepted. A token from Firebase email and password, phone or any other method is refused with `FIREBASE_PROVIDER_NOT_ALLOWED`.\n' +
      '- A first sign-in creates an already-verified `B2C` account. If a customer account with the same verified email exists, it is linked instead of duplicated.\n' +
      '- An email that belongs to an admin, staff or agency account answers `ACCOUNT_TYPE_MISMATCH`.\n\n' + SESSION_NOTE + '\n\n' + RATE.firebase,
    access: 'Public', mobileHeader: true, body: auth.firebaseLogin,
    bodyExample: { idToken: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vdHJhdmVsbXMtZGV2In0.signature' },
    success: ok(200, 'Login successful.', SESSION, exSession(), { setsCookie: true }),
    errors: { 401: ['FIREBASE_TOKEN_INVALID'], 403: ['FIREBASE_PROVIDER_NOT_ALLOWED', 'FIREBASE_UNVERIFIED', 'ACCOUNT_NOT_ACTIVE', 'REGISTRATION_CLOSED'], 409: ['ACCOUNT_TYPE_MISMATCH'], 422: true, 429: true, 503: ['FIREBASE_DISABLED'] }
  },
  {
    method: 'post', path: '/api/auth/refresh', tag: 'Auth', id: 'refreshTokens',
    summary: 'Refresh tokens',
    description:
      'Swaps the refresh token for a new access token **and a new refresh token** (rotation). The old refresh token stops working.\n\n' +
      '- **Web:** send nothing. The browser sends the `refreshToken` cookie, and Postman does too once a login has set it.\n' +
      '- **Mobile:** send the header `X-Client-Type: mobile` and put the token in the body.\n\n' +
      'Replaying an already-used refresh token is treated as theft and signs the user out on every device.\n\n' + RATE.refresh,
    access: 'Refresh token (cookie or body)', mobileHeader: true, body: auth.refresh, bodyExample: { refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2YWMwYTVmMCJ9.signature' }, bodyRequired: false,
    success: ok(200, 'Token refreshed.', SESSION, exSession(), { setsCookie: true }),
    errors: { 401: ['SESSION_EXPIRED', 'TOKEN_INVALID'], 403: ['ACCOUNT_NOT_ACTIVE'], 429: true }
  },
  {
    method: 'post', path: '/api/auth/logout', tag: 'Auth', id: 'logout',
    summary: 'Log out',
    description: 'Ends this device\'s session. Set `allDevices` to `true` to end every session and cancel all live access tokens. The refresh token is read from the cookie (web) or the body (mobile).',
    access: 'Signed in (any role)', needsAuth: true, body: auth.logout, bodyExample: { allDevices: false }, bodyRequired: false,
    success: ok(200, 'Logged out.'),
    errors: { 401: true }
  },
  {
    method: 'post', path: '/api/auth/forgot-password', tag: 'Auth', id: 'forgotPassword',
    summary: 'Forgot password: request a code',
    description: 'Emails a 6-digit reset code to an active account. The answer is identical whether or not the email exists.\n\n' + RATE.forgot,
    access: 'Public', body: auth.forgotPassword, bodyExample: { email: 'rahim@example.com' },
    success: ok(200, 'If an account exists for that email, a reset code was sent.'),
    errors: { 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/verify-reset-token', tag: 'Auth', id: 'checkResetCode',
    summary: 'Forgot password: check the code',
    description: 'Checks a reset code **without using it up**, so a screen can validate it before asking for the new password. It still counts as one of the 5 attempts.\n\n' + RATE.otp,
    access: 'Public', body: auth.verifyResetToken, bodyExample: { email: 'rahim@example.com', otp: '482913' },
    success: ok(200, 'Code is valid.'),
    errors: { 400: ['INVALID_CODE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/reset-password', tag: 'Auth', id: 'resetPassword',
    summary: 'Forgot password: set the new password',
    description: 'Uses the code (once) and sets the new password. Every session and token issued before is cancelled, and the user gets a "password changed" email. A customer who joined with Google can use this to add a password.\n\n' + RATE.otp,
    access: 'Public', body: auth.resetPassword, bodyExample: { email: 'rahim@example.com', otp: '482913', newPassword: 'N3w!Passw0rd' },
    success: ok(200, 'Password reset. Please log in with your new password.'),
    errors: { 400: ['INVALID_CODE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/setup-account', tag: 'Auth', id: 'setupInvitedAccount',
    summary: 'Invited staff or admin: set the first password',
    description: 'An admin creates staff and admin accounts without a password. The invitation email carries a link with a token; this call spends it, sets the password and activates the account. The token works once and expires after 48 hours.\n\n' + RATE.otp,
    access: 'Public (invite token)', body: auth.setupAccount, bodyExample: { token: 'a3f1c9d27b8e4f60a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718', password: 'Sara@Pass12' },
    success: ok(200, 'Account activated. You can now log in.'),
    errors: { 400: ['INVALID_INVITE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/change-password', tag: 'Auth', id: 'changePassword',
    summary: 'Change password (signed in)',
    description: 'Requires the current password. Other devices are signed out; this device continues with the **fresh tokens in the response**, so store them.\n\n' + SESSION_NOTE + '\n\n' + RATE.change,
    access: 'Signed in (any role)', needsAuth: true, mobileHeader: true, body: auth.changePassword, bodyExample: { currentPassword: 'Str0ng!Pass', newPassword: 'N3w!Passw0rd' },
    success: ok(200, 'Password updated. Your other devices were signed out.', obj({ accessToken: str(), expiresIn: str('15m'), refreshToken: str() }, ['accessToken', 'expiresIn']), exSession(false), { setsCookie: true }),
    errors: { 400: ['NO_PASSWORD_SET'], 401: ['WRONG_PASSWORD'], 422: true, 429: true }
  },
  {
    method: 'get', path: '/api/auth/me', tag: 'Auth', id: 'getMe',
    summary: 'Who am I',
    description: 'Returns the signed-in account with its role and permissions, plus the partner record for agencies. Use it to guard screens and menus. Never includes a password hash.',
    access: 'Signed in (any role)', needsAuth: true,
    success: ok(200, 'Current user profile.', obj({ user: ref('User'), partner: ref('Partner') }, ['user']), { user: exUser() }),
    errors: { 401: true, 403: ['ACCOUNT_NOT_ACTIVE'] }
  },

  // =============================================================== CUSTOMER
  {
    method: 'get', path: '/api/b2c/profile', tag: 'Customer (B2C)', id: 'getCustomerProfile',
    summary: 'My profile', description: 'The signed-in customer\'s own record. The id always comes from the token, never from the URL.',
    access: 'B2C', needsAuth: true,
    success: ok(200, 'Profile fetched.', obj({ user: ref('User') }), { user: exUser() }), errors: { 401: true, 403: true }
  },
  {
    method: 'patch', path: '/api/b2c/profile', tag: 'Customer (B2C)', id: 'updateCustomerProfile',
    summary: 'Update my profile',
    description: 'Only `name` and `phone` can be changed. A changed phone becomes unverified again. `email`, `role`, `status`, `permissions` and `partnerId` are ignored if sent.\n\nA profile can be changed only by its owner (this route, which always acts on the signed-in person) and by an admin (`PATCH /api/admin/users/{id}`).',
    access: 'B2C', needsAuth: true, body: profile.updateProfile, bodyExample: { name: 'Rahim U.', phone: '+8801712345678' },
    success: ok(200, 'Profile updated.', obj({ user: ref('User') }), { user: exUser({ name: 'Rahim U.' }) }), errors: { 401: true, 403: true, 409: true, 422: true }
  },

  // =============================================================== AGENCY
  {
    method: 'get', path: '/api/b2b/profile', tag: 'Agency (B2B)', id: 'getAgencyProfile',
    summary: 'My profile and partner record', description: 'Available while the application is being reviewed.',
    access: 'B2B', needsAuth: true,
    success: ok(200, 'Profile fetched.', obj({ user: ref('User'), partner: ref('Partner') }), { user: exUser({ role: 'B2B', partnerId: '6ac0a5f0eebc510147c6722f' }), partner: exPartner() }), errors: { 401: true, 403: true }
  },
  {
    method: 'patch', path: '/api/b2b/profile', tag: 'Agency (B2B)', id: 'updateAgencyProfile',
    summary: 'Update my profile',
    description: 'Change `name`, `phone`, `address` or `businessType`. `companyName` and `licenseNo` are locked, because changing them needs a new review.\n\nA profile can be changed only by its owner (this route, which always acts on the signed-in person) and by an admin (`PATCH /api/admin/users/{id}` and `PATCH /api/admin/b2b/{id}`).',
    access: 'B2B', needsAuth: true, body: profile.updateB2BProfile, bodyExample: { address: '12 Gulshan Avenue, Dhaka', businessType: 'Travel agency' },
    success: ok(200, 'Profile updated.', obj({ user: ref('User'), partner: ref('Partner') }), { user: exUser({ role: 'B2B' }), partner: exPartner({ address: '12 Gulshan Avenue, Dhaka' }) }), errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'get', path: '/api/b2b/documents', tag: 'Agency (B2B)', id: 'listMyDocuments',
    summary: 'My documents and their review status', description: 'Each document shows its type, review status and the reviewer\'s note. The internal storage path is never shown.',
    access: 'B2B', needsAuth: true,
    success: ok(200, 'Documents fetched.', arrayOf(ref('PartnerDocument')), [exDocument({ status: 'REJECTED', reviewNote: 'Image is blurry' })]), errors: { 401: true, 403: true, 404: true }
  },
  {
    method: 'post', path: '/api/b2b/documents', tag: 'Agency (B2B)', id: 'uploadMoreDocuments',
    summary: 'Upload more documents',
    description: 'Allowed while the application is `PENDING`, `UNDER_REVIEW` or `REJECTED`. After approval the set is locked (`DOCUMENTS_LOCKED`). A partner can hold at most 10 documents.\n\n**Form-data.** Send at least one file. PDF, JPEG, PNG or WEBP, 5 MB each.',
    access: 'B2B', needsAuth: true,
    multipart: {
      zod: null,
      files: {
        tradeLicense: { description: 'Trade license.' },
        businessCard: { description: 'Business card.' },
        otherDocuments: { description: 'Up to 3 further documents.', multiple: true, maxItems: 3 }
      },
      required: [], example: {}
    },
    success: ok(201, 'Documents uploaded.', arrayOf(ref('PartnerDocument')), [exDocument(), exDocument({ _id: '6ac0a5f0eebc510147c67231', type: 'BUSINESS_CARD', originalName: 'card.png', mimeType: 'image/png' })]),
    errors: { 400: ['FILE_TYPE_NOT_ALLOWED'], 401: true, 403: true, 409: ['DOCUMENTS_LOCKED'], 413: true, 422: ['VALIDATION_ERROR'] }
  },
  {
    method: 'get', path: '/api/b2b/overview', tag: 'Agency (B2B)', id: 'getAgencyOverview',
    summary: 'Operational overview (approved agencies only)',
    description: 'The first route behind the approval gate. Every future operational route (passports, pickups, commission, withdrawals, invoices) sits behind the same gate. Before approval it answers `403 PARTNER_NOT_APPROVED`.',
    access: 'B2B with an APPROVED partner', needsAuth: true,
    success: ok(200, 'Partner overview.', obj({ companyName: str('Sky Travels Ltd'), approvalStatus: str('APPROVED') }), { companyName: 'Sky Travels Ltd', approvalStatus: 'APPROVED' }),
    errors: { 401: true, 403: ['PARTNER_NOT_APPROVED', 'FORBIDDEN'] }
  },

  // =============================================================== STAFF
  {
    method: 'get', path: '/api/staff/profile', tag: 'Staff', id: 'getStaffProfile',
    summary: 'My profile', description: 'The signed-in staff member\'s own record, including their permissions.',
    access: 'STAFF', needsAuth: true,
    success: ok(200, 'Profile fetched.', obj({ user: ref('User') }), { user: exUser({ role: 'STAFF', name: 'Sara Staff', email: 'sara@example.com', permissions: ['B2B_VIEW', 'DOCUMENT_VERIFY'] }) }), errors: { 401: true, 403: true }
  },
  {
    method: 'patch', path: '/api/staff/profile', tag: 'Staff', id: 'updateStaffProfile',
    summary: 'Update my profile', description: 'Only `name` and `phone`. Permissions can only be changed by an admin.\n\nA profile can be changed only by its owner (this route, which always acts on the signed-in person) and by an admin (`PATCH /api/admin/users/{id}`).',
    access: 'STAFF', needsAuth: true, body: profile.updateProfile, bodyExample: { name: 'Sara A. Staff' },
    success: ok(200, 'Profile updated.', obj({ user: ref('User') }), { user: exUser({ role: 'STAFF', name: 'Sara A. Staff' }) }), errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'get', path: '/api/staff/partners', tag: 'Staff', id: 'staffListPartners',
    summary: 'List agencies (read only)', description: 'Needs the permission `B2B_VIEW`. Staff cannot approve or reject: that is an admin decision.',
    access: 'STAFF with B2B_VIEW', needsAuth: true, query: partner.listPartners, queryExample: { page: '1', limit: '10', approvalStatus: 'PENDING' },
    success: ok(200, 'Partners fetched.', arrayOf(ref('Partner')), [exPartner()], { paginated: true }), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'patch', path: '/api/staff/partners/{id}/documents/{docId}', tag: 'Staff', id: 'staffReviewDocument',
    summary: 'Verify or reject an agency document',
    description: 'Needs the permission `DOCUMENT_VERIFY`. Reviewing a document does **not** approve the agency. The reviewer\'s `note` is shown to the agency owner.',
    access: 'STAFF with DOCUMENT_VERIFY', needsAuth: true, params: partner.reviewParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f', docId: '6ac0a5f0eebc510147c67230' },
    body: partner.reviewDocument, bodyExample: { status: 'VERIFIED', note: 'License checked against the registry.' },
    success: ok(200, 'Document reviewed.', arrayOf(ref('PartnerDocument')), [exDocument({ status: 'VERIFIED', reviewNote: 'License checked against the registry.' })]), errors: { 401: true, 403: true, 404: true, 422: true }
  },

  // =============================================================== ADMIN: USERS
  {
    method: 'get', path: '/api/admin/rbac', tag: 'Admin: users', id: 'getRolesAndPermissions',
    summary: 'Roles and permissions catalog', description: 'The roles and permissions defined in `config/rbac.json`, with each role\'s flags. Use it to fill role and permission pickers so screens never drift from the rules.',
    access: 'ADMIN', needsAuth: true,
    success: ok(200, 'Roles and permissions fetched.', ref('RbacCatalog'), {
      roles: [{ code: 'STAFF', label: 'Staff', description: 'Internal team member.', selfRegister: false, invitable: true, bypassPermissions: false, assignablePermissions: true }],
      permissions: [{ code: 'VISA_VIEW', description: 'See visa applications' }]
    }), errors: { 401: true, 403: true }
  },
  {
    method: 'get', path: '/api/admin/profile', tag: 'Admin: users', id: 'getAdminProfile',
    summary: 'My profile (admin)', description: 'The signed-in admin\'s own record. The person always comes from the token, never from the URL or body.',
    access: 'ADMIN', needsAuth: true,
    success: ok(200, 'Profile fetched.', obj({ user: ref('User') }), { user: exUser({ role: 'ADMIN', name: 'Super Admin', email: 'boss@example.com' }) }), errors: { 401: true, 403: true }
  },
  {
    method: 'patch', path: '/api/admin/profile', tag: 'Admin: users', id: 'updateAdminProfile',
    summary: 'Update my profile (admin)', description: 'Change your own `name` or `phone`. Send at least one. Email, role, status and permissions cannot be changed here.',
    access: 'ADMIN', needsAuth: true, body: profile.adminUpdateUser, bodyExample: { name: 'Super Admin', phone: '+8801712345678' },
    success: ok(200, 'Profile updated.', obj({ user: ref('User') }), { user: exUser({ role: 'ADMIN', name: 'Super Admin', email: 'boss@example.com' }) }), errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'patch', path: '/api/admin/users/{id}', tag: 'Admin: users', id: 'adminUpdateUserProfile',
    summary: 'Edit someone else\'s profile (name, phone)',
    description: 'The only way to change another person\'s profile. Every other role is refused (`403`), including staff holding every permission. Only `name` and `phone` can be changed; the email, role, status and permissions are ignored here and have their own admin actions. A changed phone becomes unverified again. The audit log records which fields changed, never their values. Send at least one field.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: profile.adminUpdateUser, bodyExample: { name: 'Edited By Admin', phone: '+8801788888888' },
    success: ok(200, 'Profile updated.', ref('User'), exUser({ name: 'Edited By Admin', phone: '+8801788888888', phoneVerified: false })), errors: { 401: true, 403: true, 404: true, 409: true, 422: true }
  },
  {
    method: 'get', path: '/api/admin/users', tag: 'Admin: users', id: 'listUsers',
    summary: 'List users', description: 'Search and filter every account, with pages. Responses never include password hashes.',
    access: 'ADMIN', needsAuth: true, query: user.listUsers, queryExample: { page: '1', limit: '10', role: 'B2C', status: 'ACTIVE', search: 'rahim' },
    success: ok(200, 'Users fetched.', arrayOf(ref('User')), [exUser()], { paginated: true }), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'post', path: '/api/admin/users', tag: 'Admin: users', id: 'createInternalUser',
    summary: 'Create an admin or staff account (sends an invite)',
    description: 'Creates the account **without a password** and emails an invite link. Only the roles marked `invitable` in `rbac.json` (ADMIN, STAFF) can be created here; customers and agencies register themselves. `permissions` apply to STAFF only.',
    access: 'ADMIN', needsAuth: true, body: user.createUser, bodyExample: { name: 'Second Admin', email: 'admin2@example.com', role: 'ADMIN' },
    success: ok(201, 'Account created and invitation sent.', obj({ user: ref('User'), inviteSent: bool(true) }), { user: exUser({ _id: ID, name: 'Second Admin', email: 'admin2@example.com', role: 'ADMIN', status: 'PENDING', emailVerified: false, lastLoginAt: undefined }), inviteSent: true }),
    errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'post', path: '/api/admin/staff', tag: 'Admin: users', id: 'createStaff',
    summary: 'Create a staff account (sends an invite)',
    description: 'Same as creating a user, but always `STAFF`. Staff start with **no** permissions: they get exactly the list you send.',
    access: 'ADMIN', needsAuth: true, body: user.createStaff, bodyExample: { name: 'Sara Staff', email: 'sara@example.com', permissions: ['B2B_VIEW', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY'] },
    success: ok(201, 'Staff account created and invitation sent.', obj({ user: ref('User'), inviteSent: bool(true) }), { user: exUser({ _id: ID, name: 'Sara Staff', email: 'sara@example.com', role: 'STAFF', status: 'PENDING', emailVerified: false, permissions: ['B2B_VIEW', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY'], lastLoginAt: undefined }), inviteSent: true }),
    errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'get', path: '/api/admin/users/{id}', tag: 'Admin: users', id: 'getUser',
    summary: 'Get one user', description: 'One account by id.',
    access: 'ADMIN', needsAuth: true, params: user.idParam,
    success: ok(200, 'User fetched.', ref('User'), exUser()), errors: { 401: true, 403: true, 404: true, 422: true }
  },
  {
    method: 'delete', path: '/api/admin/users/{id}', tag: 'Admin: users', id: 'deactivateUser',
    summary: 'Deactivate a user (soft delete)', description: 'Sets the account to `INACTIVE`, cancels its sessions, and keeps the record for the audit trail. You cannot deactivate yourself, and the last active admin cannot be removed.',
    access: 'ADMIN', needsAuth: true, params: user.idParam,
    success: ok(200, 'Account deactivated.'), errors: { 401: true, 403: true, 404: true, 409: ['SELF_CHANGE', 'LAST_ADMIN'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/users/{id}/status', tag: 'Admin: users', id: 'updateUserStatus',
    summary: 'Change account status',
    description: 'ACTIVE, SUSPENDED, BLOCKED or INACTIVE. Anything other than ACTIVE cancels the person\'s tokens at once. You cannot change your own status, the last active admin is protected, and a never-verified account cannot be activated by hand. The change and the optional `reason` are written to the audit log.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: user.updateStatus, bodyExample: { status: 'SUSPENDED', reason: 'Chargeback dispute' },
    success: ok(200, 'Account status updated.', ref('User'), exUser({ status: 'SUSPENDED' })), errors: { 401: true, 403: true, 404: true, 409: ['SELF_CHANGE', 'LAST_ADMIN', 'NOT_VERIFIED'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/users/{id}/role', tag: 'Admin: users', id: 'updateUserRole',
    summary: 'Change role (admin or staff only)',
    description: 'Moves an account between the invitable roles (ADMIN and STAFF). Customers and agencies keep what they registered as (`ROLE_LOCKED`). Moving someone to ADMIN clears their permission list; to STAFF it sets the list you send. The person\'s old tokens stop working.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: user.updateRole, bodyExample: { role: 'STAFF', permissions: ['REPORT_VIEW'] },
    success: ok(200, 'Role updated.', ref('User'), exUser({ role: 'STAFF', permissions: ['REPORT_VIEW'] })), errors: { 401: true, 403: true, 404: true, 409: ['ROLE_LOCKED', 'SELF_CHANGE', 'LAST_ADMIN'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/users/{id}/permissions', tag: 'Admin: users', id: 'updateUserPermissions',
    summary: 'Set staff permissions',
    description: 'Replaces the permission list of a STAFF account (duplicates are removed). Takes effect on the next request. Roles without a permission list answer `PERMISSIONS_NOT_ASSIGNABLE`.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: user.updatePermissions, bodyExample: { permissions: ['B2B_VIEW', 'DOCUMENT_VIEW'] },
    success: ok(200, 'Permissions updated.', ref('User'), exUser({ role: 'STAFF', permissions: ['B2B_VIEW', 'DOCUMENT_VIEW'] })), errors: { 401: true, 403: true, 404: true, 409: ['PERMISSIONS_NOT_ASSIGNABLE'], 422: true }
  },
  {
    method: 'post', path: '/api/admin/users/{id}/resend-invite', tag: 'Admin: users', id: 'resendInvite',
    summary: 'Resend an invitation', description: 'For an admin or staff account that has not set a password yet. The previous link stops working.',
    access: 'ADMIN', needsAuth: true, params: user.idParam,
    success: ok(200, 'Invitation sent again.', obj({ user: ref('User'), inviteSent: bool(true) }), { user: exUser({ role: 'STAFF', status: 'PENDING' }), inviteSent: true }), errors: { 401: true, 403: true, 404: true, 409: true, 422: true }
  },

  // =============================================================== ADMIN: AGENCIES
  {
    method: 'get', path: '/api/admin/b2b', tag: 'Admin: agencies', id: 'adminListPartners',
    summary: 'List agencies', description: 'Filter by approval status or search by company name and license number. `userId` is expanded to the owner\'s name, email, phone and status.',
    access: 'ADMIN', needsAuth: true, query: partner.listPartners, queryExample: { page: '1', limit: '10', approvalStatus: 'PENDING', search: 'sky' },
    success: ok(200, 'Partners fetched.', arrayOf(ref('Partner')), [exPartner({ userId: { _id: '6ac0a5f0eebc510147c6722e', name: 'Karim Hossain', email: 'karim@agency.com', phone: '+8801811111111', status: 'ACTIVE' } })], { paginated: true }), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'get', path: '/api/admin/b2b/{id}', tag: 'Admin: agencies', id: 'adminGetPartner',
    summary: 'Get one agency', description: 'One partner record with its documents.',
    access: 'ADMIN', needsAuth: true, params: partner.partnerParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f' },
    success: ok(200, 'Partner fetched.', ref('Partner'), exPartner()), errors: { 401: true, 403: true, 404: true, 422: true }
  },
  {
    method: 'patch', path: '/api/admin/b2b/{id}', tag: 'Admin: agencies', id: 'adminUpdatePartner',
    summary: 'Edit an agency\'s business record',
    description: 'Change `companyName`, `licenseNo`, `businessType` or `address` (send at least one). An agency owner can only change the last two themselves; an admin, as the reviewer, may change all four. The approval status is not touched. A license number that belongs to another agency answers `409`. The audit log records which fields changed, never their values.',
    access: 'ADMIN', needsAuth: true, params: partner.partnerParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f' },
    body: profile.adminUpdatePartner, bodyExample: { companyName: 'Sky Travels International Ltd', address: '9 Dhanmondi, Dhaka' },
    success: ok(200, 'Partner updated.', ref('Partner'), exPartner({ companyName: 'Sky Travels International Ltd', address: '9 Dhanmondi, Dhaka' })), errors: { 401: true, 403: true, 404: true, 409: true, 422: true }
  },
  {
    method: 'patch', path: '/api/admin/b2b/{id}/approval', tag: 'Admin: agencies', id: 'decidePartner',
    summary: 'Approve, reject, review or suspend an agency',
    description: '`APPROVED` opens the operational routes and **needs a trade license on file** (`TRADE_LICENSE_MISSING`). `REJECTED` and `SUSPENDED` close them. None of these change the owner\'s login. The decision, your id and the old and new status are audit-logged, and the owner is emailed with your `note`.',
    access: 'ADMIN', needsAuth: true, params: partner.partnerParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f' },
    body: partner.decide, bodyExample: { decision: 'APPROVED', note: 'Documents verified' },
    success: ok(200, 'Partner status is now APPROVED.', ref('Partner'), exPartner({ approvalStatus: 'APPROVED', reviewNote: 'Documents verified', reviewedBy: '6ac0a5f0eebc510147c6722a', reviewedAt: '2026-10-03T07:10:00.000Z' })),
    errors: { 401: true, 403: true, 404: true, 409: ['TRADE_LICENSE_MISSING'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/b2b/{id}/documents/{docId}', tag: 'Admin: agencies', id: 'adminReviewDocument',
    summary: 'Verify or reject an agency document', description: 'Marks one uploaded document `VERIFIED` or `REJECTED`. The `note` is shown to the agency owner.',
    access: 'ADMIN', needsAuth: true, params: partner.reviewParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f', docId: '6ac0a5f0eebc510147c67230' },
    body: partner.reviewDocument, bodyExample: { status: 'REJECTED', note: 'Image is blurry, please upload a clearer scan.' },
    success: ok(200, 'Document reviewed.', arrayOf(ref('PartnerDocument')), [exDocument({ status: 'REJECTED', reviewNote: 'Image is blurry, please upload a clearer scan.' })]), errors: { 401: true, 403: true, 404: true, 422: true }
  },

  // =============================================================== ADMIN: AUDIT
  {
    method: 'get', path: '/api/admin/audit-logs', tag: 'Admin: audit', id: 'listAuditLogs',
    summary: 'Audit log', description: 'Security-relevant events, newest first: sign-ups, logins and failed logins, logouts, password changes and resets, account, role and permission changes, partner decisions, document reviews and token-theft detection. Passwords and tokens are never recorded.',
    access: 'ADMIN', needsAuth: true, query: user.listAuditLogs, queryExample: { page: '1', limit: '20', action: 'ROLE_CHANGED' },
    success: ok(200, 'Audit logs fetched.', arrayOf(ref('AuditLog')), [{ _id: ID, actorUserId: '6ac0a5f0eebc510147c6722a', action: 'ROLE_CHANGED', targetUserId: '6ac0a5f0eebc510147c6722e', resource: '', result: 'SUCCESS', ip: '::1', meta: { from: 'STAFF', to: 'ADMIN', permissions: [] }, createdAt: '2026-10-03T07:10:00.000Z' }], { paginated: true }),
    errors: { 401: true, 403: true, 422: true }
  },

  // =============================================================== DOCUMENTS
  {
    method: 'get', path: '/api/documents/partners/{partnerId}/{docId}', tag: 'Documents', id: 'downloadPartnerDocument',
    summary: 'Download a private document',
    description:
      'Streams the file **only after an ownership check**:\n\n' +
      '- an ADMIN, or STAFF with `DOCUMENT_VIEW`: any partner\'s documents\n' +
      '- a B2B user: only their own partner\'s documents\n' +
      '- anyone else: `404`, exactly as if the document did not exist\n\n' +
      'The file arrives as an attachment and is never cached. In Postman use **Send and Download**.',
    access: 'Owner, ADMIN, or STAFF with DOCUMENT_VIEW', needsAuth: true, params: partner.documentParam, paramExamples: { partnerId: '6ac0a5f0eebc510147c6722f', docId: '6ac0a5f0eebc510147c67230' },
    binary: true, errors: { 401: true, 404: true, 422: true }
  },

  // =============================================================== TOUR CATEGORIES
  {
    method: 'get', path: '/api/tour-categories', tag: 'Tour categories', id: 'listTourCategories',
    summary: 'List tour categories',
    description: 'Active categories, sorted by name. A tour manager can add `includeInactive=true` to see the removed ones too; for anyone else the parameter changes nothing.\n\nA token is optional. ' + RATE.api,
    access: 'Public', optionalAuth: true, query: tours.listCategories, queryBlank: ['search', 'includeInactive'], queryDocs: { search: 'Part of the category name, ignoring letter case.', includeInactive: '`true` adds removed categories. Only tour managers get them.' }, queryExample: { page: '1', limit: '20' },
    success: ok(200, 'Categories fetched.', arrayOf(ref('TourCategory')), [exCategory()], { paginated: true }), errors: { 401: true, 422: true }
  },
  {
    method: 'get', path: '/api/tour-categories/{id}', tag: 'Tour categories', id: 'getTourCategory',
    summary: 'Get one tour category',
    description: 'The `id` is this API\'s id (24 hex characters) **or** the id the frontend used before, such as `cat_beach`. A removed category answers `404` unless the caller is a tour manager.',
    access: 'Public', optionalAuth: true, params: tours.categoryParam,
    success: ok(200, 'Category fetched.', ref('TourCategory'), exCategory()), errors: { 401: true, 404: true, 422: true }
  },
  {
    method: 'post', path: '/api/tour-categories', tag: 'Tour categories', id: 'createTourCategory',
    summary: 'Create a tour category',
    description: 'Category names are unique in any letter case and with any spacing. Sending a name that already exists is **not an error**: the existing category is returned with `200` instead of `201`, and no second one is made. If that category had been removed it is switched on again.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, body: tours.createCategory, bodyExample: { name: 'Beach & Resort' },
    success: ok(201, 'Category created.', ref('TourCategory'), exCategory()), errors: { 401: true, 403: true, 422: true },
    notes: 'The `200` answer for an existing name has the message "A category with this name already exists."'
  },
  {
    method: 'delete', path: '/api/tour-categories/{id}', tag: 'Tour categories', id: 'removeTourCategory',
    summary: 'Remove a tour category',
    description: 'Switches the category off (`isActive: false`); nothing is deleted. It disappears from the public list. A category that active tours still use cannot be removed (`CATEGORY_IN_USE`): move or archive those tours first. Repeating the call is harmless.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, params: tours.categoryParam,
    success: ok(200, 'Category removed.', ref('TourCategory'), exCategory({ isActive: false })), errors: { 401: true, 403: true, 404: true, 409: ['CATEGORY_IN_USE'], 422: true }
  },

  // =============================================================== TOURS
  {
    method: 'get', path: '/api/tours', tag: 'Tours', id: 'listTours',
    summary: 'List and search tours',
    description:
      'The public sees **published** tours only (a `status` they send is ignored). A tour manager also sees drafts and unpublished tours, and archived ones with `status=archived`.\n\n' +
      '- `search` matches name, destination and country, ignoring letter case. Special characters are plain text.\n' +
      '- `category` takes one id or several separated by commas, as this API\'s ids or old frontend ids (`cat_beach,cat_city`).\n' +
      '- `minPrice` and `maxPrice` filter the public price. `durationDays` is an exact match.\n' +
      '- `sort` is `createdAt`, `price`, `durationDays` or `rating`; a leading `-` means descending. Default `-createdAt` (newest first).\n\n' +
      '**`b2bPrice` is only in the answer for** an admin, staff with TOUR_MANAGE, and a B2B user whose partner is APPROVED. Everyone else never receives the field.\n\n' +
      'A token is optional. With a token the answer is shaped for that person; a wrong token is `401`, not anonymous. An empty query value counts as not given. In Postman, set the request\'s Authorization to Bearer Token `{{bearerToken}}` to see the signed-in view. ' + RATE.api,
    access: 'Public', optionalAuth: true, query: tours.listTours,
    queryDocs: {
      search: 'Matches name, destination and country, ignoring letter case. Special characters are plain text.',
      category: 'One category id, or several separated by commas. This API\'s id or an old frontend id such as `cat_beach`.',
      country: 'Exact country name, ignoring letter case.',
      destination: 'Part of the destination text.',
      status: 'Tour managers only: draft, published, unpublished or archived. Ignored for the public, who see published tours. Managers see everything except archived when it is empty.',
      minPrice: 'Lowest public price (inclusive).',
      maxPrice: 'Highest public price (inclusive).',
      durationDays: 'Exact number of days.',
      sort: 'createdAt, price, durationDays or rating. A leading `-` sorts descending. Empty means `-createdAt` (newest first).'
    },
    queryBlank: ['search', 'category', 'country', 'destination', 'status', 'minPrice', 'maxPrice', 'durationDays', 'sort'],
    queryExample: { page: '1', limit: '10' },
    success: ok(200, 'Tours fetched.', arrayOf(ref('Tour')), [exTour()], { paginated: true }), errors: { 401: true, 422: true }
  },
  {
    method: 'get', path: '/api/tours/{id}', tag: 'Tours', id: 'getTour',
    summary: 'Get one tour',
    description: 'The `id` is this API\'s id **or** the id the frontend used before, such as `tour_205`. The itinerary is in ascending day order. A tour that is not published answers `404` for the public, exactly like one that does not exist; tour managers can read it. `b2bPrice` follows the same rule as the list.\n\nA token is optional.',
    access: 'Public', optionalAuth: true, params: tours.tourParam,
    success: ok(200, 'Tour fetched.', ref('Tour'), exTour()), errors: { 401: true, 404: true, 422: true }
  },
  {
    method: 'post', path: '/api/tours', tag: 'Tours', id: 'createTour',
    summary: 'Create a tour',
    description:
      'Prices and counts cannot be negative. `priceCurrency` is `BDT`, `USD` or `EUR`. `status` defaults to `draft`. `category` is optional and may be this API\'s id or an old frontend id; it must exist and be active. ' +
      'Itinerary days are unique, from 1, and no day may be after `durationDays`. A **published** tour needs at least one itinerary day; a draft may be incomplete. ' +
      '`coverImage` and `gallery` are http or https links. Unknown fields are ignored.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, body: tours.createTour,
    bodyExample: {
      name: "Cox's Bazar Beach Escape", country: 'Bangladesh', destination: "Cox's Bazar, Bangladesh", category: 'cat_beach', durationDays: 3, priceCurrency: 'BDT',
      price: 12500, b2bPrice: 10000, seats: 25, status: 'published', rating: 4.9, coverImage: 'https://picsum.photos/seed/coxs-bazar/900/560',
      description: 'Experience the world longest natural sea beach with luxury resort stay and fresh seafood.',
      included: ['2 nights hotel stay', 'Breakfast included'], excluded: ['Personal expenses'], hotels: ['Ocean Paradise Hotel & Resort'],
      itinerary: exItinerary, terms: 'Standard cancellation rules apply.'
    },
    success: ok(201, 'Tour created.', ref('Tour'), exTour({ b2bPrice: 10000 })), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'patch', path: '/api/tours/{id}', tag: 'Tours', id: 'updateTour',
    summary: 'Edit a tour',
    description: 'Send only the fields to change (at least one). The rules are checked against the whole tour as it would be saved, so publishing a tour with no itinerary, or shortening `durationDays` below an existing itinerary day, is refused. Setting `status` to `published` publishes it; setting it back from `archived` restores it. The audit log records which fields changed, never their values.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, params: tours.tourParam,
    body: tours.updateTour, bodyExample: { price: 13000, seats: 30 },
    success: ok(200, 'Tour updated.', ref('Tour'), exTour({ price: 13000, seats: 30, b2bPrice: 10000 })), errors: { 401: true, 403: true, 404: true, 422: true }
  },
  {
    method: 'delete', path: '/api/tours/{id}', tag: 'Tours', id: 'archiveTour',
    summary: 'Archive a tour',
    description: 'Sets `status` to `archived`. The tour leaves every public list and nothing is deleted, so records that point at it keep working. Repeating the call is harmless. A manager can publish it again with **Edit a tour**.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, params: tours.tourParam,
    success: ok(200, 'Tour archived.', ref('Tour'), exTour({ status: 'archived', b2bPrice: 10000 })), errors: { 401: true, 403: true, 404: true, 422: true }
  },

  // =============================================================== CUSTOM TOURS
  {
    method: 'post', path: '/api/tours/custom-requests', tag: 'Custom tours', id: 'createCustomTourRequest',
    summary: 'Send a custom tour request',
    description:
      'Only a signed-in **B2C customer** can send one. Agencies, staff and admins get `403`.\n\n' +
      'The owner is always the signed-in customer. `userId`, `status` and review fields in the body are ignored. The request starts as `NEW`. `endDate` must not be before `startDate`; `travelers` is at least 1; `transportation` defaults to `Private car`. ' +
      'Dates are `YYYY-MM-DD` or a full ISO date-time.',
    access: 'B2C', needsAuth: true, body: tours.createCustomRequest,
    bodyExample: { customer: 'Rahim Uddin', phone: '+8801712345678', destination: 'Sajek Valley', travelers: 4, startDate: '2026-12-01', endDate: '2026-12-05', hotel: '3-star', transportation: 'Private car', activities: ['Trekking', 'Bonfire'], requirements: 'Vegetarian meals', itinerary: [{ day: 1, title: 'Arrival', description: 'Check in' }] },
    success: ok(201, 'Your custom tour request was received.', ref('CustomTourRequest'), exCustomRequest()), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'get', path: '/api/tours/custom-requests', tag: 'Custom tours', id: 'listCustomTourRequests',
    summary: 'List custom tour requests',
    description: 'A B2C customer receives **their own** requests. A tour manager receives everyone\'s, with `userId` expanded to the customer\'s name, email and phone. Filter by `status`, search the customer name or destination. Newest first.',
    access: 'B2C (own requests), or ADMIN / STAFF with TOUR_MANAGE (all)', needsAuth: true, query: tours.listCustomRequests, queryBlank: ['status', 'search'], queryDocs: { status: 'NEW, IN_REVIEW, QUOTED, CONFIRMED or CANCELLED.', search: 'Part of the customer name or destination.' }, queryExample: { page: '1', limit: '10' },
    success: ok(200, 'Custom tour requests fetched.', arrayOf(ref('CustomTourRequest')), [exCustomRequest()], { paginated: true }), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'get', path: '/api/tours/custom-requests/{id}', tag: 'Custom tours', id: 'getCustomTourRequest',
    summary: 'Get one custom tour request',
    description: 'A customer can read only their own request. Someone else\'s answers `404`, exactly like one that does not exist. The consultant\'s `reviewNote` (for example the quote) appears here.',
    access: 'B2C (own request), or ADMIN / STAFF with TOUR_MANAGE', needsAuth: true, params: tours.customRequestParam,
    success: ok(200, 'Custom tour request fetched.', ref('CustomTourRequest'), exCustomRequest()), errors: { 401: true, 403: true, 404: true, 422: true }
  },
  {
    method: 'patch', path: '/api/tours/custom-requests/{id}/status', tag: 'Custom tours', id: 'setCustomTourRequestStatus',
    summary: 'Change the status of a custom tour request',
    description:
      'Allowed moves: `NEW` to `IN_REVIEW` or `CANCELLED`; `IN_REVIEW` to `QUOTED` or `CANCELLED`; `QUOTED` to `IN_REVIEW`, `CONFIRMED` or `CANCELLED`; `CONFIRMED` to `CANCELLED`. `CANCELLED` is final. Any other move answers `409 INVALID_TRANSITION`.\n\n' +
      'A **tour manager** can make any allowed move and may add a `note` (for example the quote), shown to the customer. A **customer** can only cancel their own request, and only while it is `NEW`; any other change is `403`.',
    access: 'ADMIN / STAFF with TOUR_MANAGE (any allowed move), or B2C (cancel own NEW request)', needsAuth: true, params: tours.customRequestParam,
    body: tours.setCustomRequestStatus, bodyExample: { status: 'QUOTED', note: 'Total BDT 85,000 for four travelers.' },
    success: ok(200, 'Request status is now QUOTED.', ref('CustomTourRequest'), exCustomRequest({ status: 'QUOTED', reviewNote: 'Total BDT 85,000 for four travelers.', reviewedBy: '6ac0a5f0eebc510147c6722b', reviewedAt: NOW })),
    errors: { 401: true, 403: true, 404: true, 409: ['INVALID_TRANSITION'], 422: true }
  },

  // =============================================================== SYSTEM
  {
    method: 'get', path: '/', tag: 'System', id: 'getVersion',
    summary: 'API version', description: 'A simple "is it up" check that also returns the version.', access: 'Public',
    success: ok(200, 'API is running.', obj({}), undefined, { raw: { success: true, message: 'API is running.', version: '1.0.0' }, rawSchema: obj({ success: bool(true), message: str('API is running.'), version: str('1.0.0') }) }), errors: {}
  },
  {
    method: 'get', path: '/health', tag: 'System', id: 'getHealth',
    summary: 'Health check', description: 'Answers `200` when the database is connected and `503` when it is not. Not rate limited. Use it for uptime monitors.', access: 'Public',
    success: ok(200, 'Healthy.', obj({}), undefined, { raw: { success: true, uptime: 1234.56, db: 'up' }, rawSchema: obj({ success: bool(true), uptime: { type: 'number', example: 1234.56 }, db: { type: 'string', enum: ['up', 'down'], example: 'up' } }) }),
    errors: { 503: ['DB_DOWN'] }, healthDown: true
  }
];

module.exports = { endpoints, TAGS };
