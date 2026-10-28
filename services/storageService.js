const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PRIVATE_ROOT, isInside } = require('../utils/file');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

// File storage behind one small interface: put, stream, remove. Only the local disk driver exists today. A cloud
// driver (S3, Cloudinary) only has to offer the same three functions, and nothing that calls this service changes.
//
// Safety rules, all enforced here so no caller has to remember them:
//  - files live under PRIVATE_ROOT, which is outside any public folder, and are served only by an authenticated route
//  - the stored name is random and its extension comes from the DETECTED type, never from the client's file name
//  - the type is detected from the first bytes of the file, so "evil.html" sent as a PDF is refused
//  - a key from the database is checked to stay inside the storage root before it is opened or deleted

const TYPES = {
  pdf: { mime: 'application/pdf', ext: '.pdf', matches: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  jpg: { mime: 'image/jpeg', ext: '.jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: 'image/png', ext: '.png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  webp: { mime: 'image/webp', ext: '.webp', matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' }
};

const detectType = (buffer) => Object.keys(TYPES).find((type) => buffer.length >= 12 && TYPES[type].matches(buffer));

// ------------------------------------------------------------------ local disk driver

const FOLDER = /^[a-z0-9][a-z0-9/_-]{0,80}$/;

const resolveKey = (key) => {
  const absolute = path.resolve(PRIVATE_ROOT, String(key));
  if (!isInside(PRIVATE_ROOT, absolute)) throw new ApiError(400, 'Invalid file location.', { code: 'INVALID_STORAGE_KEY' });
  return absolute;
};

const localDriver = {
  async put(folder, buffer, ext) {
    if (!FOLDER.test(folder) || folder.includes('..')) throw new Error(`Invalid storage folder "${folder}".`);
    const key = `${folder}/${crypto.randomBytes(16).toString('hex')}${ext}`;
    const absolute = resolveKey(key);
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    // "wx" refuses to overwrite, 0o600 keeps the file readable by the server only.
    await fs.promises.writeFile(absolute, buffer, { flag: 'wx', mode: 0o600 });
    return key;
  },

  async exists(key) {
    try {
      await fs.promises.access(resolveKey(key));
      return true;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      return false;
    }
  },

  stream(key) {
    return fs.createReadStream(resolveKey(key));
  },

  async remove(key) {
    try {
      await fs.promises.unlink(resolveKey(key));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err.code !== 'ENOENT') logger.warn(`Failed to delete stored file ${key}: ${err.message}`);
    }
  }
};

const drivers = { local: localDriver };
const driver = drivers[process.env.STORAGE_DRIVER || 'local'];
if (!driver) throw new Error(`STORAGE_DRIVER "${process.env.STORAGE_DRIVER}" is not supported. Only "local" exists.`);

// ------------------------------------------------------------------ uploads

// Checks an uploaded file (multer memory file) against the rules and stores it.
//   rules = { maxSizeMb, allowedTypes: ['pdf', 'jpg', ...] }
// Returns what the database should keep about it.
const saveUpload = async (folder, file, rules) => {
  if (!file || !file.buffer) throw new ApiError(400, 'Attach a file.', { code: 'FILE_REQUIRED' });

  const maxBytes = rules.maxSizeMb * 1024 * 1024;
  if (file.size > maxBytes) throw new ApiError(413, `The file is larger than ${rules.maxSizeMb} MB.`, { code: 'FILE_TOO_LARGE' });

  const type = detectType(file.buffer);
  if (!type || !rules.allowedTypes.includes(type)) {
    const allowed = rules.allowedTypes.map((t) => t.toUpperCase()).join(', ');
    throw new ApiError(400, `Only ${allowed} files are allowed, and the file content must match its type.`, { code: 'FILE_TYPE_NOT_ALLOWED' });
  }
  if (file.mimetype !== TYPES[type].mime) {
    throw new ApiError(400, 'The file content does not match its declared type.', { code: 'FILE_TYPE_MISMATCH' });
  }

  const storagePath = await driver.put(folder, file.buffer, TYPES[type].ext);
  return {
    storagePath,
    originalName: path.basename(String(file.originalname || 'file')).replace(/[^\w.\- ]/g, '_').slice(0, 120),
    mimeType: TYPES[type].mime,
    size: file.size
  };
};

module.exports = {
  saveUpload,
  detectType,
  exists: (key) => driver.exists(key),
  stream: (key) => driver.stream(key),
  remove: (key) => driver.remove(key)
};
