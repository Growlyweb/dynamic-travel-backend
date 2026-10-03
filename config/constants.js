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
  DOCUMENT_REVIEWED: 'DOCUMENT_REVIEWED'
});

module.exports = {
  ROLES,
  USER_STATUS,
  APPROVAL_STATUS,
  DOCUMENT_TYPE,
  AUTH_PROVIDERS,
  OTP_PURPOSE,
  AUDIT_ACTIONS
};
