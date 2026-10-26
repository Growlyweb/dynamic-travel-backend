// Loads config/roleTemplates.json: the blueprints a role is made from, the permissions that need another
// permission, the sensitive ones, and how the permission screen groups them.
// Every key named in the file must exist in config/rbac.json, so a typo stops the boot.
const raw = require('./roleTemplates.json');
const { ALL_PERMISSIONS } = require('./rbac');

const known = new Set(ALL_PERMISSIONS);

const check = (where, keys) =>
  keys.forEach((key) => {
    if (!known.has(key)) throw new Error(`config/roleTemplates.json: ${where} names unknown permission "${key}".`);
  });

Object.entries(raw.templates).forEach(([code, template]) => {
  check(`template "${code}"`, [...template.defaults, ...template.optional]);
});
Object.entries(raw.dependencies).forEach(([key, needs]) => check(`dependency of "${key}"`, [key, ...needs]));
check('sensitive', Object.keys(raw.sensitive));
raw.groups.forEach((group) => check(`group "${group.key}"`, group.permissions));

const grouped = new Set(raw.groups.flatMap((group) => group.permissions));
const ungrouped = ALL_PERMISSIONS.filter((key) => !grouped.has(key));
if (ungrouped.length) throw new Error(`config/roleTemplates.json: permissions without a group: ${ungrouped.join(', ')}.`);

// The list with everything it depends on added, unique, in the order of config/rbac.json.
const withDependencies = (permissions) => {
  const result = new Set(permissions);
  const queue = [...result];
  while (queue.length) {
    (raw.dependencies[queue.pop()] || []).forEach((needed) => {
      if (!result.has(needed)) {
        result.add(needed);
        queue.push(needed);
      }
    });
  }
  return ALL_PERMISSIONS.filter((key) => result.has(key));
};

const SYSTEM_TEMPLATE = 'no_access';

module.exports = {
  TEMPLATES: raw.templates,
  DEPENDENCIES: raw.dependencies,
  SENSITIVE: raw.sensitive,
  GROUPS: raw.groups,
  SYSTEM_TEMPLATE,
  withDependencies,
  describe: () => ({
    templates: Object.entries(raw.templates).map(([key, template]) => ({ key, ...template })),
    dependencies: raw.dependencies,
    sensitive: raw.sensitive,
    groups: raw.groups
  })
};
