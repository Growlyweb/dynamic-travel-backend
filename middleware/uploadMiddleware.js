const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const ApiError = require('../utils/ApiError');
const { PRIVATE_ROOT } = require('../utils/file');

const MB = 1024 * 1024;

// The stored extension comes from the validated MIME type, never from the client's file name.
// Otherwise "evil.html" sent as application/pdf would be served back as text/html.
const DOCUMENT_TYPES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};
const DOCUMENT_MAX_SIZE = 5 * MB;

// Files land in storage/private/<subfolder>/ (NOT web-accessible) with a name nobody can guess.
// They are only streamed through an authenticated, ownership-checked route.
const makeDiskStorage = (subfolder) => {
  const dir = path.join(PRIVATE_ROOT, subfolder);
  fs.mkdirSync(dir, { recursive: true });

  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const base = path
        .basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 40);

      cb(null, `${base}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${DOCUMENT_TYPES[file.mimetype]}`);
    }
  });
};

const documentFilter = (req, file, cb) => {
  if (!DOCUMENT_TYPES[file.mimetype]) {
    return cb(new ApiError(400, 'Only PDF, JPEG, PNG and WEBP files are allowed.', { code: 'FILE_TYPE_NOT_ALLOWED' }));
  }
  cb(null, true);
};

// Add another upload type with one call:
//   const uploadX = privateFields('x-folder', [{ name: 'file', maxCount: 1 }]);
// Multer puts the files on req.files as { fieldName: [file, ...] }.
const privateFields = (subfolder, fields) =>
  multer({
    storage: makeDiskStorage(subfolder),
    fileFilter: documentFilter,
    limits: { fileSize: DOCUMENT_MAX_SIZE, files: fields.reduce((sum, f) => sum + f.maxCount, 0) }
  }).fields(fields);

// B2B registration and later uploads. Field name decides the document type (see partnerService).
const uploadPartnerDocuments = privateFields('partners', [
  { name: 'tradeLicense', maxCount: 1 },
  { name: 'businessCard', maxCount: 1 },
  { name: 'otherDocuments', maxCount: 3 }
]);

module.exports = { privateFields, uploadPartnerDocuments };
