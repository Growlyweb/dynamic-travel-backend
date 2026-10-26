// Loads roles and permissions from config/rbac.json and checks the file is well formed.
// Everything about access that a developer decides is in that one file: the account types, the permission keys, the
// templates a role is started from, which permission needs which, the sensitive ones, and how the screen groups them.
// Edit the JSON, then restart the server. The roles an admin hands to staff are data, made in the dashboard (Role model).
//
// The code relies on four role codes existing (ADMIN, STAFF, B2B, B2C): routes, registration and
// the seed script refer to them by name. Everything else (labels, who can be invited, who bypasses
// permission checks, which roles can hold permissions, the permission list) comes from the JSON.
const raw = require('./rbac.json');

const REQUIRED_ROLES = ['ADMIN', 'STAFF', 'B2B', 'B2C'];
const ROLE_FLAGS = ['selfRegister', 'invitable', 'bypassPermissions', 'assignablePermissions'];
// The template of the built-in role that a new staff account gets until an admin decides.
const SYSTEM_TEMPLATE = 'no_access';
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
  validateRoleParts(config);
};

// The parts that roles are made from. Every permission named here must exist, so a typo stops the boot.
const validateRoleParts = (config) => {
  ['templates', 'dependencies', 'sensitive'].forEach((key) => {
    if (!isPlainObject(config[key])) throw new Error(`config/rbac.json: "${key}" must be an object.`);
  });
  if (!Array.isArray(config.groups)) throw new Error('config/rbac.json: "groups" must be a list.');

  const known = new Set(Object.keys(config.permissions));
  const check = (where, keys) =>
    keys.forEach((key) => {
      if (!known.has(key)) throw new Error(`config/rbac.json: ${where} names unknown permission "${key}".`);
    });

  Object.entries(config.templates).forEach(([code, template]) => {
    if (!template || typeof template.label !== 'string' || !Array.isArray(template.defaults) || !Array.isArray(template.optional)) {
      throw new Error(`config/rbac.json: template "${code}" needs a label, defaults and optional.`);
    }
    check(`template "${code}"`, [...template.defaults, ...template.optional]);
  });
  if (!config.templates[SYSTEM_TEMPLATE]) throw new Error(`config/rbac.json: the template "${SYSTEM_TEMPLATE}" is required: it is the built-in role for new staff.`);
  Object.entries(config.dependencies).forEach(([key, needs]) => check(`dependency of "${key}"`, [key, ...needs]));
  check('sensitive', Object.keys(config.sensitive));
  config.groups.forEach((group) => check(`group "${group.key}"`, group.permissions || []));
};

// Builds the helpers from a config object (exported separately so tests can try bad files).
const build = (config) => {
  validate(config);

  const roleCodes = Object.keys(config.roles);
  const ROLES = Object.freeze(Object.fromEntries(roleCodes.map((code) => [code, code])));
  const PERMISSIONS = Object.freeze(Object.fromEntries(Object.keys(config.permissions).map((code) => [code, code])));
  const rolesWith = (flag) => roleCodes.filter((code) => config.roles[code][flag]);
  const permissionOrder = Object.keys(config.permissions);

  // A permission that no group lists still shows on the role screen, in a group of its own at the end.
  const listed = new Set(config.groups.flatMap((group) => group.permissions || []));
  const unlisted = permissionOrder.filter((key) => !listed.has(key));
  const groups = unlisted.length ? [...config.groups, { key: 'other', label: 'Other', permissions: unlisted }] : config.groups;

  // The list with everything it depends on added, unique, in the order of the permission list.
  const withDependencies = (permissions) => {
    const result = new Set(permissions);
    const queue = [...result];
    while (queue.length) {
      (config.dependencies[queue.pop()] || []).forEach((needed) => {
        if (!result.has(needed)) {
          result.add(needed);
          queue.push(needed);
        }
      });
    }
    return permissionOrder.filter((key) => result.has(key));
  };

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
    // STAFF-like roles get their permissions from the roles an admin gives them (see services/roleService.js and
    // the templates in this file), plus the old per-person list on accounts made before roles existed.
    canHavePermissions: (role) => Boolean(config.roles[role] && config.roles[role].assignablePermissions),

    // The blueprints a role is made from, the permissions that need another, the sensitive ones, and the screen groups.
    TEMPLATES: Object.freeze(config.templates),
    DEPENDENCIES: Object.freeze(config.dependencies),
    SENSITIVE: Object.freeze(config.sensitive),
    GROUPS: Object.freeze(groups),
    SYSTEM_TEMPLATE,
    withDependencies,

    // Plain shape for the admin UI (GET /api/admin/rbac).
    describe: () => ({
      roles: roleCodes.map((code) => ({ code, ...config.roles[code] })),
      permissions: Object.entries(config.permissions).map(([code, description]) => ({ code, description })),
      templates: Object.entries(config.templates).map(([key, template]) => ({ key, ...template })),
      dependencies: config.dependencies,
      sensitive: config.sensitive,
      groups
    })
  });
};

module.exports = { ...build(raw), build };
