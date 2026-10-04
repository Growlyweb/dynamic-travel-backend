const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const logger = require('./logger');

// Business documents live OUTSIDE any public folder and are only reachable through an
// authenticated, ownership-checked route. (default: storage/private)
const PRIVATE_ROOT = path.resolve(env.storage.privateDir);

// True when `target` resolves to a path inside `root` (path traversal guard).
const isInside = (root, target) => {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  return absoluteTarget.startsWith(absoluteRoot + path.sep);
};

const unlinkQuietly = async (absolute) => {
  try {
    await fs.promises.unlink(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(`Failed to unlink ${absolute}: ${err.message}`);
    }
  }
};

// Every file multer saved for this request, whatever shape it used:
// req.file (single), req.files as an array, or req.files as { fieldName: [files] }.
const uploadedFilesOf = (req) => {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files) Object.values(req.files).forEach((group) => files.push(...group));
  return files;
};

// If a request fails AFTER multer saved files, delete them so nothing is orphaned.
// Called once, from the error middleware, so no route has to remember it.
const cleanupUploadedFiles = async (req) => {
  await Promise.all(uploadedFilesOf(req).map((file) => unlinkQuietly(file.path)));
};

module.exports = { PRIVATE_ROOT, isInside, cleanupUploadedFiles };
