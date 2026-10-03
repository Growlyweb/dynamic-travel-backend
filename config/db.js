const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

// Throws on failure: the caller (server.js, scripts) decides how to exit.
const connectDB = async (uri = env.mongoUri) => {
  const conn = await mongoose.connect(uri);
  logger.info(`MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
  return conn;
};

module.exports = connectDB;
