const { MongoMemoryServer } = require('mongodb-memory-server');

// One in-memory MongoDB for the whole run. Each test file connects to it, so nothing
// touches a real database and no local MongoDB is needed.
module.exports = async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_TEST_URI = mongod.getUri();
  global.__MONGOD__ = mongod;
};
