const { ROLES } = require('./rbac');

// Shared enums. Models, validators and services all import from here
// so a value is never spelled two different ways.
// ROLES (and the permission list) come from config/rbac.json.

// PENDING  : account exists but the email is not verified yet (cannot log in)
// ACTIVE   : normal access
// SUSPENDED: temporarily denied, an Admin can reactivate
// BLOCKED / INACTIVE: login denied
const USER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
  INACTIVE: 'INACTIVE'
});

// B2B approval lives on Partner, not on User.status.
// A B2B user can log in once verified, but operational APIs need APPROVED.
const APPROVAL_STATUS = Object.freeze({
  PENDING: 'PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
});

// What a B2B document is. The upload field name decides it (see services/partnerService.js).
// A trade license is mandatory at registration; a business card is optional.
const DOCUMENT_TYPE = Object.freeze({
  TRADE_LICENSE: 'TRADE_LICENSE',
  BUSINESS_CARD: 'BUSINESS_CARD',
  OTHER: 'OTHER'
});

const AUTH_PROVIDERS = Object.freeze({
  LOCAL: 'local',
  FIREBASE: 'firebase'
});

// What a one-time code or link token is for.
const OTP_PURPOSE = Object.freeze({
  EMAIL_VERIFY: 'EMAIL_VERIFY',
  PASSWORD_RESET: 'PASSWORD_RESET',
  STAFF_INVITE: 'STAFF_INVITE'
});

// Tour packages. Values are lower case because the handoff and the frontend use them that way.
const TOUR_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  UNPUBLISHED: 'unpublished',
  ARCHIVED: 'archived'
});

// Allowed values of Tour.priceCurrency. Adding one is an edit here and a restart.
const TOUR_CURRENCIES = Object.freeze(['BDT', 'USD', 'EUR']);

// A B2C customer's custom tour request. The allowed moves between them are in services/customTourService.js.
const CUSTOM_REQUEST_STATUS = Object.freeze({
  NEW: 'NEW',
  IN_REVIEW: 'IN_REVIEW',
  QUOTED: 'QUOTED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED'
});

const AUDIT_ACTIONS = Object.freeze({
  REGISTER: 'REGISTER',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  USER_CREATED: 'USER_CREATED',
  ACCOUNT_ACTIVATED: 'ACCOUNT_ACTIVATED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_STATUS_CHANGED: 'ACCOUNT_STATUS_CHANGED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',
  B2B_APPROVED: 'B2B_APPROVED',
  B2B_REJECTED: 'B2B_REJECTED',
  B2B_STATUS_CHANGED: 'B2B_STATUS_CHANGED',
  DOCUMENT_REVIEWED: 'DOCUMENT_REVIEWED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_DEACTIVATED: 'CATEGORY_DEACTIVATED',
  TOUR_CREATED: 'TOUR_CREATED',
  TOUR_UPDATED: 'TOUR_UPDATED',
  TOUR_ARCHIVED: 'TOUR_ARCHIVED',
  CUSTOM_TOUR_REQUESTED: 'CUSTOM_TOUR_REQUESTED',
  CUSTOM_TOUR_STATUS_CHANGED: 'CUSTOM_TOUR_STATUS_CHANGED'
});

module.exports = {
  ROLES,
  USER_STATUS,
  APPROVAL_STATUS,
  DOCUMENT_TYPE,
  AUTH_PROVIDERS,
  OTP_PURPOSE,
  TOUR_STATUS,
  TOUR_CURRENCIES,
  CUSTOM_REQUEST_STATUS,
  AUDIT_ACTIONS
};
