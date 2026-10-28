const VisaCountry = require('../../../models/VisaCountry');
const VisaType = require('../../../models/VisaType');
const { ROLES } = require('../../../config/constants');
const { PERMISSIONS } = require('../../../config/rbac');
const { createUser } = require('./factory');

let counter = 0;

// One country with one visa type (BDT 12000 for a customer, 10000 for a partner).
const createCatalog = async ({ physical = false, pickup = false, country = {}, type = {} } = {}) => {
  counter += 1;
  const name = `Testland ${counter}`;
  const visaCountry = await VisaCountry.create({ name, nameKey: name.toLowerCase(), code: 'TL', ...country });
  const visaType = await VisaType.create({
    country: visaCountry._id,
    name: 'Tourist Visa',
    nameKey: 'tourist visa',
    b2cPrice: 12000,
    b2bNetPrice: 10000,
    fees: { embassy: 8000, service: 3500, vat: 500 },
    passportRequirement: physical ? 'physical_required' : 'online_processing',
    pickupAvailable: pickup,
    officeSubmissionAvailable: physical,
    ...type
  });
  return { country: visaCountry, type: visaType };
};

let passportCounter = 0;
const passport = () => `BR${String(1000000 + ++passportCounter)}`;

// A body for POST /api/visa/applications that passes validation.
const applicationBody = (catalog, overrides = {}) => ({
  name: 'Rahim Ahmed',
  phone: '+880 1712 556 340',
  email: 'rahim@example.com',
  passportNumber: passport(),
  countryId: String(catalog.country._id),
  visaTypeId: String(catalog.type._id),
  ...overrides
});

const VISA_STAFF_PERMISSIONS = [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_EDIT, PERMISSIONS.VISA_UPDATE, PERMISSIONS.DOCUMENT_VIEW, PERMISSIONS.DOCUMENT_VERIFY, PERMISSIONS.PASSPORT_UPDATE];

const createAdmin = () => createUser({ role: ROLES.ADMIN, name: 'Admin Person' });
const createVisaStaff = (permissions = VISA_STAFF_PERMISSIONS) => createUser({ role: ROLES.STAFF, name: 'Staff Person', permissions });

module.exports = { createCatalog, applicationBody, createAdmin, createVisaStaff, VISA_STAFF_PERMISSIONS };
