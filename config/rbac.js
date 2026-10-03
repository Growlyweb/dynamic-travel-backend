// Loads roles and permissions from config/rbac.json and checks the file is well formed.
// Edit the JSON to add a permission or change what a role may do, then restart the server.
//
// The code relies on four role codes existing (ADMIN, STAFF, B2B, B2C): routes, registration and
// the seed script refer to them by name. Everything else (labels, who can be invited, who bypasses
// permission checks, which roles can hold permissions, the permission list) comes from the JSON.
const raw = require('./rbac.json');

const REQUIRED_ROLES = ['ADMIN', 'STAFF', 'B2B', 'B2C'];
const ROLE_FLAGS = ['selfRegister', 'invitable', 'bypassPermissions', 'assignablePermissions'];
const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Throws a clear error when the JSON is wrong, so a typo stops the boot instead of weakening a guard.
const validate = (config) => {
  if (!isPlainObject(config) || !isPlainObject(config.roles) || !isPlainObject(config.permissions)) {
    throw new Error('config/rbac.json must contain a "roles" object and a "permissions" object.');
  }

  REQUIRED_ROLES.forEach((code) => {
    if (!config.roles[code]) throw new Error(`config/rbac.json: role "${code}" is required by the code and cannot be removed.`);
  });

  Object.entries(config.roles).forEach(([code, role]) => {
    if (!CODE_PATTERN.test(code)) throw new Error(`config/rbac.json: role code "${code}" must be UPPER_SNAKE_CASE.`);
    if (!isPlainObject(role) || typeof role.label !== 'string' || !role.label) {
      throw new Error(`config/rbac.json: role "${code}" needs a "label".`);
    }
    ROLE_FLAGS.forEach((flag) => {
      if (typeof role[flag] !== 'boolean') throw new Error(`config/rbac.json: role "${code}" needs a boolean "${flag}".`);
    });
    if (role.bypassPermissions && role.assignablePermissions) {
      throw new Error(`config/rbac.json: role "${code}" cannot both bypass permissions and hold a permission list.`);
    }
  });

  const permissionCodes = Object.keys(config.permissions);
  if (permissionCodes.length === 0) throw new Error('config/rbac.json: "permissions" cannot be empty.');
  permissionCodes.forEach((code) => {
    if (!CODE_PATTERN.test(code)) throw new Error(`config/rbac.json: permission code "${code}" must be UPPER_SNAKE_CASE.`);
    if (typeof config.permissions[code] !== 'string' || !config.permissions[code]) {
      throw new Error(`config/rbac.json: permission "${code}" needs a text description.`);
    }
  });
};

// Builds the helpers from a config object (exported separately so tests can try bad files).
const build = (config) => {
  validate(config);

  const roleCodes = Object.keys(config.roles);
  const ROLES = Object.freeze(Object.fromEntries(roleCodes.map((code) => [code, code])));
  const PERMISSIONS = Object.freeze(Object.fromEntries(Object.keys(config.permissions).map((code) => [code, code])));
  const rolesWith = (flag) => roleCodes.filter((code) => config.roles[code][flag]);

  return Object.freeze({
    ROLES,
    PERMISSIONS,
    ALL_PERMISSIONS: Object.freeze(Object.values(PERMISSIONS)),

    // Roles an admin may create directly (they receive an invite email).
    INVITABLE_ROLES: Object.freeze(rolesWith('invitable')),
    // Roles that can register themselves.
    SELF_REGISTER_ROLES: Object.freeze(rolesWith('selfRegister')),

    // True when the role may be created by someone registering themselves (B2B, B2C).
    canSelfRegister: (role) => Boolean(config.roles[role] && config.roles[role].selfRegister),

    // ADMIN-like roles pass every permission check.
    bypassesPermissions: (role) => Boolean(config.roles[role] && config.roles[role].bypassPermissions),
    // STAFF-like roles carry a permission list that an admin edits.
    canHavePermissions: (role) => Boolean(config.roles[role] && config.roles[role].assignablePermissions),

    // Plain shape for the admin UI (GET /api/admin/rbac).
    describe: () => ({
      roles: roleCodes.map((code) => ({ code, ...config.roles[code] })),
      permissions: Object.entries(config.permissions).map(([code, description]) => ({ code, description }))
    })
  });
};

module.exports = { ...build(raw), build };
