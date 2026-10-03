const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Runs inside every test file. Requiring the app registers all models, so their indexes
// (unique email / phone / licenseNo) are built before the first test.
const env = require('../../config/env');
require('../../app');
const { outbox } = require('../../utils/mailer');

// Deletes every file but keeps the folders: multer creates them once, when the app loads.
const emptyDirectory = (dir) => {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) emptyDirectory(full);
    else fs.unlinkSync(full);
  });
};

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_TEST_URI, { dbName: `test_${process.pid}_${Date.now()}` });
  await mongoose.syncIndexes();
});

afterEach(async () => {
  outbox.length = 0;
  emptyDirectory(env.storage.privateDir);
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(path.dirname(env.storage.privateDir), { recursive: true, force: true });
});
