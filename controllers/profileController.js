const profileService = require('../services/profileService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// One pair of handlers behind /api/staff/profile, /api/b2b/profile and /api/b2c/profile.
// The user id always comes from the token (req.user.id), never from the URL or body.

// GET /api/<role>/profile
exports.getProfile = asyncHandler(async (req, res) => {
  const { user, partner } = await profileService.get(req.user.id);
  sendResponse(res, 200, true, 'Profile fetched.', { user, ...(partner ? { partner } : {}) });
});

// PATCH /api/<role>/profile
exports.updateProfile = asyncHandler(async (req, res) => {
  const { user, partner } = await profileService.update(req.user.id, req.body);
  sendResponse(res, 200, true, 'Profile updated.', { user, ...(partner ? { partner } : {}) });
});
