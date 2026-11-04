require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { performance } = require('perf_hooks');
const User = require('./models/User');

// Import routes
const authRoutes = require('./routes/auth');
const syllabusRoutes = require('./routes/syllabus');
const chatRoutes = require('./routes/chat');
const cabinetRoutes = require('./routes/cabinet');
const userRoutes = require('./routes/users');
const policiesRoutes = require('./routes/policies');
const referencesRoutes = require('./routes/references');
const { seedReferences } = require('./services/references/seed');

const Program = require('./models/Program');
const { seedPolicyLibrary } = require('./services/references/policies');
const { startBackgroundSweepers } = require('./services/syllabusCleanup');

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEFAULT_REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '20000', 10);
const AI_REQUEST_TIMEOUT_MS = parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '130000', 10);
const LONG_RUNNING_PATHS = ['/api/chat', '/api/cabinet'];
const EXAMPLE_ADMIN_PASSWORD = 'ChangeMe123!';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 10485760;

// Trust proxy setting for rate limiting
app.set('trust proxy', parseInt(process.env.TRUST_PROXY || '1', 10));

// Security middleware
app.use(helmet());

// CORS configuration FIRST, so even errors/limits include headers
const allowedOrigins = [(process.env.FRONTEND_URL || 'http://localhost:3000').trim()];
if (!IS_PRODUCTION) {
  allowedOrigins.push('http://localhost:3000', 'http://127.0.0.1:3000');
}
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser tools
    return callback(null, allowedOrigins.includes(origin));
  },
  // Авторизація через Bearer-токен, cookie не використовуються
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // allowedHeaders omitted to echo Access-Control-Request-Headers dynamically
  // Фронтенд бере ім'я файлу outputs із Content-Disposition
  exposedHeaders: ['Content-Disposition'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Загальний ліміт на IP: однаково для анонімних і авторизованих запитів
// (заголовок Authorization його не вимикає, бо токен тут не перевіряється).
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1500', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/health'
}));

// Суворий ліміт на IP для ендпоінтів, чутливих до brute-force
const strictAuthLimiter = rateLimit({
  windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10),
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' },
  skip: (req) => req.method === 'OPTIONS'
});
['login', 'forgot-password', 'reset-password'].forEach((name) => {
  app.use(`/api/auth/${name}`, strictAuthLimiter);
});

// Загальний ліміт API на IP за хвилину
app.use('/api', rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '300', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS'
}));

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Lightweight request logger + per-request timeout
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const id = Math.random().toString(36).slice(2, 8);
  res.setHeader('X-Request-Id', id);

  // Per-request timeout (avoid hanging requests)
  const url = req.originalUrl || req.url || '';
  const isLongRunningRequest = LONG_RUNNING_PATHS.some(prefix => url.startsWith(prefix));
  const timeoutMs = isLongRunningRequest ? AI_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
  res.setTimeout(timeoutMs, () => {
    if (!res.headersSent) {
      console.warn(`[timeout] ${req.method} ${url} id=${id} exceeded ${timeoutMs}ms`);
      res.status(504).json({ message: 'The request timed out', code: 'REQUEST_TIMEOUT', retryable: true });
    }
  });

  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const status = res.statusCode;
    if (durationMs > 1000) {
      console.warn(`[slow] ${req.method} ${req.originalUrl} -> ${status} in ${durationMs.toFixed(1)}ms id=${id}`);
    }
  });
  next();
});

// Short-circuit when DB is down (except health/preflight)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next(); // let CORS preflight pass
  if (mongoose.connection.readyState !== 1 && req.path !== '/health') {
    return res.status(503).json({ message: 'The service is temporarily unavailable (database)', code: 'DB_UNAVAILABLE', retryable: true });
  }
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/syllabus', syllabusRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/cabinet', cabinetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/policies', policiesRoutes);
app.use('/api/references', referencesRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'AI Syllabus Analyzer Backend',
    dbConnected: mongoose.connection.readyState === 1
  });
});

// 404 handler
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Route not found', code: 'ROUTE_NOT_FOUND' });
});
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found', code: 'ROUTE_NOT_FOUND' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  let status = err.statusCode || err.status || 500;
  let message;
  let code = err.statusCode && err.code ? err.code : undefined;

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      message = `The file is too large. The maximum size is ${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB.`;
      code = 'FILE_TOO_LARGE';
    } else {
      status = 400;
      message = 'Invalid file upload.';
      code = 'INVALID_UPLOAD';
    }
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON in the request body.';
    code = 'INVALID_JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'The request body is too large.';
    code = 'BODY_TOO_LARGE';
  } else if (status < 500) {
    message = err.message;
  }

  if (status >= 500) {
    console.error('Error stack:', err.stack);
    return res.status(status).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
  res.status(status).json({ message, code: code || 'BAD_REQUEST' });
});

// Initialize admin user
async function initializeAdmin() {
  try {
    const adminExists = await User.findOne({ email: process.env.ADMIN_EMAIL });

    if (!adminExists) {
      const admin = new User({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
        firstName: process.env.ADMIN_FIRST_NAME || 'System',
        lastName: process.env.ADMIN_LAST_NAME || 'Administrator',
        role: 'admin',
        isActive: true
      });

      await admin.save();
      console.log('✅ Admin user created successfully');
      console.log(`📧 Admin email: ${process.env.ADMIN_EMAIL}`);
    } else {
      console.log('ℹ️ Admin user already exists');
    }
  } catch (error) {
    console.error('❌ Error initializing admin:', error);
  }

  try {
    await Program.seedDefaults();
    console.log('✅ Programs seeded');
  } catch (error) {
    console.error('❌ Error seeding programs:', error);
  }

  try {
    const stats = await seedPolicyLibrary();
    console.log('✅ Policy library seeded', stats);
    if (stats.conflicts.length) console.warn('⚠️ Блоки довідника політик з адмінськими правками не оновлено (нова версія фікстури):', stats.conflicts.map((c) => c.key).join(', '));
  } catch (error) {
    console.error('❌ Error seeding policy library:', error);
  }

  // Після політик: getRefs підтягує policyLibrary, а сід довідників скидає кеш
  try {
    await seedReferences();
    console.log('✅ References seeded');
  } catch (error) {
    console.error('❌ Error seeding references:', error);
  }
}

// Fail-fast: без цих змінних сервер не має сенсу
function assertRequiredEnv() {
  const missing = ['JWT_SECRET', 'MONGODB_URI', require('./services/ai/client').apiKeyName].filter((k) => !String(process.env[k] || '').trim());
  if (missing.length) {
    console.error(`❌ Не задано обов'язкові змінні середовища: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.ADMIN_PASSWORD === EXAMPLE_ADMIN_PASSWORD) {
    console.warn('⚠️ ADMIN_PASSWORD збігається зі значенням із example.env — змініть його.');
  }
}

async function start() {
  assertRequiredEnv();

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
  });

  mongoose.connection.on('connected', () => console.log('ℹ️ Mongoose connection state: connected'));
  mongoose.connection.on('disconnected', () => console.warn('⚠️ Mongoose connection state: disconnected'));
  mongoose.connection.on('error', (err) => console.error('🛑 Mongoose error:', err.message));

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      autoIndex: !IS_PRODUCTION
    });
    console.log('✅ MongoDB connected successfully');
    await initializeAdmin();
    startBackgroundSweepers();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Tighten HTTP server timeouts to avoid resource leaks
  const serverRequestTimeout = Math.max(DEFAULT_REQUEST_TIMEOUT_MS, AI_REQUEST_TIMEOUT_MS);
  server.requestTimeout = serverRequestTimeout;
  server.headersTimeout = Math.max(serverRequestTimeout + 1000, 25000); // ms
  server.keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT_MS || '65000', 10);

  // Event loop delay monitor (warn if > 200ms)
  let lastTs = performance.now();
  setInterval(() => {
    const now = performance.now();
    const drift = now - lastTs - 500;
    lastTs = now;
    if (drift > 200) {
      console.warn(`⚠️ Event loop delay detected: ~${Math.round(drift)}ms`);
    }
  }, 500).unref();

  return server;
}

if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
