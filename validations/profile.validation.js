const { z } = require('zod');
const { name, phone } = require('./common');

// Profile updates may only touch these fields. role, status, permissions, partnerId, email
// are not listed, so zod strips them. Changing an email needs re-verification (see documentation/ToDo.md).
const updateProfile = z.object({
  name: name.optional(),
  phone: phone.optional()
});

// B2B owners may also edit the contact details of their business.
// companyName and licenseNo are locked: changing them needs a new admin review.
const updateB2BProfile = updateProfile.extend({
  address: z.string().trim().max(300).optional(),
  businessType: z.string().trim().max(80).optional()
});

module.exports = { updateProfile, updateB2BProfile };
