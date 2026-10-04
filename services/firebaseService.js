const fs = require('fs');
const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

// Thin wrapper over firebase-admin so the rest of the app (and the tests) can
// swap it out. Initialised lazily: the server boots fine without Firebase configured.
let app;

const credentialFromEnv = () => {
  if (env.firebase.serviceAccountPath) {
    const json = fs.readFileSync(path.resolve(env.firebase.serviceAccountPath), 'utf8');
    return cert(JSON.parse(json));
  }
  return cert({
    projectId: env.firebase.projectId,
    clientEmail: env.firebase.clientEmail,
    privateKey: env.firebase.privateKey
  });
};

const getFirebaseAuth = () => {
  if (!env.firebase.enabled) {
    throw new ApiError(503, 'Firebase sign-in is not configured on this server.', { code: 'FIREBASE_DISABLED' });
  }
  if (!app) {
    app = getApps()[0] || initializeApp({ credential: credentialFromEnv() });
  }
  return getAuth(app);
};

// Returns the decoded Firebase ID token ({ uid, email, email_verified, phone_number, name, firebase }).
// checkRevoked=true also rejects tokens of disabled users or sessions revoked in Firebase.
const verifyIdToken = async (idToken) => {
  const auth = getFirebaseAuth();
  try {
    return await auth.verifyIdToken(idToken, true);
  } catch (err) {
    logger.warn(`Firebase token rejected: ${err.code || err.message}`);
    throw new ApiError(401, 'Invalid or expired Firebase token.', { code: 'FIREBASE_TOKEN_INVALID' });
  }
};

module.exports = { verifyIdToken };
