const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const mongoose = require('mongoose');

const env = require('./config/env');
const logger = require('./utils/logger');
const { version } = require('./package.json');
const { apiLimiter } = require('./middleware/rateLimitMiddleware');
const errorMiddleware = require('./middleware/errorMiddleware');
const { notFound } = require('./middleware/errorMiddleware');

const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes');
const tourRoutes = require('./routes/tourRoutes');
const tourCategoryRoutes = require('./routes/tourCategoryRoutes');
const membershipRoutes = require('./routes/membershipRoutes');
const adminRoutes = require('./routes/admin');
const staffRoutes = require('./routes/staff');
const b2bRoutes = require('./routes/b2b');
const b2cRoutes = require('./routes/b2c');
const dashboardRoutes = require('./routes/dashboardRoutes');
const visaRoutes = require('./routes/visaRoutes');

const app = express();

// Behind a reverse proxy, req.ip (used by rate limits and audit logs) is only correct when this matches.
if (env.trustProxy) app.set('trust proxy', env.trustProxy);

// ============================================================
// SECURITY & PARSING (order matters)
// ============================================================

app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

app.use(helmet());

// Strict allow-list. credentials:true lets the browser send the httpOnly refresh cookie.
app.use(
  cors({
    origin: env.corsOrigins,
    credentials: true,
    // Browsers hide these from a frontend on another origin unless they are exposed. Without it a
    // client cannot read how long to wait after a 429, or the file name of a document download.
    exposedHeaders: ['Retry-After', 'RateLimit', 'RateLimit-Policy', 'Content-Disposition'],
    optionsSuccessStatus: 200
  })
);

// Interactive API documentation (Swagger UI). Never in production: nothing here runs, and the documentation code is
// not even loaded, so /docs answers 404 like any unknown URL.
if (env.apiDocsOverrideIgnored) logger.warn('API_DOCS_ENABLED=true is ignored: the API documentation is never served in production.');
if (env.apiDocsEnabled) {
  try {
    require('./utils/apiDocs').mount(app);
  } catch (err) {
    // swagger-ui-express is a dev dependency. A server installed without dev dependencies simply has no /docs.
    if (err.code !== 'MODULE_NOT_FOUND' || !/swagger-ui-express/.test(err.message)) throw err;
    logger.warn('swagger-ui-express is not installed, so /docs is not served.');
  }
}

// Throttle BEFORE parsing bodies so abusive clients do not cost parsing work.
app.use('/api', apiLimiter);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

app.use(mongoSanitize()); // strips $ and . keys: blocks NoSQL operator injection
app.use(hpp()); // collapses duplicated query parameters

// ============================================================
// ROUTES
// ============================================================
// There is no public static folder: business documents are private and are only streamed by
// routes/documentRoutes.js after an ownership check.

app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'API is running.', version });
});

app.get('/health', (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({ success: dbReady, uptime: process.uptime(), db: dbReady ? 'up' : 'down' });
});

// Public
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/visa', visaRoutes);

// Authenticated, ownership-checked file access
app.use('/api/documents', documentRoutes);

// Tour packages. Reading is public; changing needs TOUR_MANAGE; custom requests are for B2C customers.
app.use('/api/tour-categories', tourCategoryRoutes);
app.use('/api/tours', tourRoutes);

// Membership plans, memberships and reports. Mounted at /api with the guards on each route, see the file.
app.use('/api', membershipRoutes);

// Role areas (authenticate + requireRole applied once, inside each router's index)
app.use('/api/admin', adminRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/b2b', b2bRoutes);
app.use('/api/b2c', b2cRoutes);

// ============================================================
// ERROR HANDLING (must be last)
// ============================================================

app.use(notFound);
app.use(errorMiddleware);

module.exports = app;
