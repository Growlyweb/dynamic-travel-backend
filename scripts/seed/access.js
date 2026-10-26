// Access seed. A role is made from every template (Accountant, Visa officer, ...) in every environment, so an admin
// starts with the usual roles and can adjust them. Outside production it also creates one active staff account per
// template with a known password, so each kind of person can be tried at once.
//
// Safe to run again: a role or account that exists is left as it is.
const Role = require('../../models/Role');
const User = require('../../models/User');
const { ROLES, USER_STATUS } = require('../../config/constants');
const templates = require('../../config/rbac');
const authService = require('../../services/authService');
const roleService = require('../../services/roleService');

const DEMO_PASSWORD = 'Demo@12345';
const DEMO_DOMAIN = '@demo.dynamictravel.test';

const DEMO_STAFF = [
  { template: 'accountant', name: 'Demo Accountant', email: `accountant${DEMO_DOMAIN}` },
  { template: 'visa_officer', name: 'Demo Visa Officer', email: `visa${DEMO_DOMAIN}` },
  { template: 'operations_manager', name: 'Demo Operations Manager', email: `operations${DEMO_DOMAIN}` },
  { template: 'viewer', name: 'Demo Viewer', email: `viewer${DEMO_DOMAIN}` },
  { template: 'no_access', name: 'Demo New Staff', email: `newstaff${DEMO_DOMAIN}` }
];

const seedRoles = async () => {
  await roleService.ensureSystemRoles();
  let created = 0;
  for (const [key, template] of Object.entries(templates.TEMPLATES)) {
    if (key === templates.SYSTEM_TEMPLATE) continue;
    const exists = await Role.exists({ nameKey: template.label.toLowerCase() });
    if (exists) continue;
    await Role.create({ name: template.label, description: template.description, templateKey: key, permissions: templates.withDependencies(template.defaults) });
    created += 1;
  }
  return created;
};

const seedStaff = async () => {
  let created = 0;
  for (const { template, name, email } of DEMO_STAFF) {
    if (await User.exists({ email })) continue;
    const role = await Role.findOne({ nameKey: templates.TEMPLATES[template].label.toLowerCase() });
    await User.create({
      name,
      email,
      passwordHash: await authService.hashPassword(DEMO_PASSWORD),
      role: ROLES.STAFF,
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      roles: [role._id]
    });
    created += 1;
  }
  return created;
};

module.exports = {
  name: 'access',

  async seed({ demo = false } = {}) {
    const result = { roles: await seedRoles() };
    if (demo) result.staff = await seedStaff();
    return result;
  },

  async clear() {
    const [roles, staff] = await Promise.all([Role.deleteMany({}), User.deleteMany({ email: new RegExp(`${DEMO_DOMAIN.replace(/\./g, '\\.')}$`) })]);
    return { roles: roles.deletedCount, staff: staff.deletedCount };
  },

  DEMO_PASSWORD,
  DEMO_DOMAIN
};
