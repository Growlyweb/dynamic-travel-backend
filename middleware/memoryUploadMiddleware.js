const multer = require('multer');

// Holds an uploaded file in memory so services/storageService.js can check its real type and the size limit from the
// settings BEFORE anything is written to disk. The hard cap below only stops absurd uploads; the real limit
// (10 MB by default) is a setting.
const HARD_LIMIT_BYTES = 25 * 1024 * 1024;

const single = (fieldName) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: HARD_LIMIT_BYTES, files: 1 } }).single(fieldName);

module.exports = { single };
