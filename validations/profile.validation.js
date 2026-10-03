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

const atLeastOne = (value) => Object.values(value).some((v) => v !== undefined);
const ATLEAST_MESSAGE = 'Send at least one field to change.';

// ADMIN editing someone else's profile (or their own through /api/admin/profile).
// Same fields as a person may edit about themselves. The email is an identity, so nobody edits it here.
const adminUpdateUser = updateProfile.refine(atLeastOne, ATLEAST_MESSAGE);

// ADMIN editing an agency's business record. An admin is the reviewer, so unlike the owner they
// may also change the company name and license number.
const adminUpdatePartner = z
  .object({
    companyName: z.string().trim().min(2).max(150).optional(),
    licenseNo: z.string().trim().min(2).max(60).optional(),
    businessType: z.string().trim().max(80).optional(),
    address: z.string().trim().min(5).max(300).optional()
  })
  .refine(atLeastOne, ATLEAST_MESSAGE);

module.exports = { updateProfile, updateB2BProfile, adminUpdateUser, adminUpdatePartner };
