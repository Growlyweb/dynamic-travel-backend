const { ROLES } = require('../../../config/constants');
const { PERMISSIONS } = require('../../../config/rbac');
const { createUser } = require('./factory');

const ACCOUNTANT_PERMISSIONS = [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.ACCOUNTS_EDIT, PERMISSIONS.ACCOUNTS_VOID, PERMISSIONS.VENDOR_VIEW, PERMISSIONS.VENDOR_MANAGE];

const createAccountant = (permissions = ACCOUNTANT_PERMISSIONS) => createUser({ role: ROLES.STAFF, name: 'Accountant', permissions });
const createAdmin = () => createUser({ role: ROLES.ADMIN, name: 'Admin Person' });

// Days before today, as a plain day in the business time zone.
const daysAgo = (days) => require('../../../services/accounting/dates').addDays(require('../../../services/accounting/dates').todayISO(), -days);

module.exports = { createAccountant, createAdmin, daysAgo, ACCOUNTANT_PERMISSIONS };
