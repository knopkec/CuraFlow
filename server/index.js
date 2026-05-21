import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createPool } from 'mysql2/promise';
import { parseDbToken } from './utils/crypto.js';
import { runMasterMigrations } from './utils/masterMigrations.js';
import { ensureColumns } from './utils/schema.js';
import { resolveMasterDbConfig } from './utils/mysqlConfig.js';

// Import routes
import authRouter from './routes/auth.js';
import dbProxyRouter from './routes/dbProxy.js';
import scheduleRouter from './routes/schedule.js';
import holidaysRouter from './routes/holidays.js';
import staffRouter from './routes/staff.js';
import calendarRouter from './routes/calendar.js';
import voiceRouter from './routes/voice.js';
import adminRouter from './routes/admin.js';
import atomicRouter from './routes/atomic.js';
import aiAutofillRouter from './routes/aiAutofill.js';
import masterRouter from './routes/master.js';
import certificatesRouter from './routes/certificates.js';
import { checkAndSendWishReminders } from './utils/wishReminder.js';

// Load environment variables
dotenv.config();

const DB_RETRY_DELAYS_MS = [250, 750];
const TRANSIENT_DB_ERROR_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ER_CON_COUNT_ERROR',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
]);
const TRANSIENT_DB_ERROR_PATTERNS = [
  /server has gone away/i,
  /lost connection/i,
  /connection.*closed/i,
  /closed state/i,
  /read ECONNRESET/i,
  /connect ETIMEDOUT/i,
  /can't add new command when connection is in closed state/i,
  /can't add new command when connection is closed/i,
  /the client was disconnected by the server/i,
];
const DATABASE_ERROR_PATTERNS = [
  /mysql/i,
  /sql/i,
  /database/i,
  /unknown column/i,
  /doesn't exist/i,
  /table .* doesn't exist/i,
  /ER_[A-Z_]+/i,
  ...TRANSIENT_DB_ERROR_PATTERNS,
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientDbError = (error) => {
  if (!error) return false;

  if (TRANSIENT_DB_ERROR_CODES.has(error.code)) {
    return true;
  }

  const message = `${error.message || ''} ${error.sqlMessage || ''}`.trim();
  return TRANSIENT_DB_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const isDatabaseError = (error) => {
  if (!error) return false;
  if (error.isDatabaseError) return true;
  if (isTransientDbError(error)) return true;
  if (typeof error.code === 'string' && error.code.startsWith('ER_')) return true;
  if (error.sql || error.sqlMessage || error.sqlState) return true;

  const message = `${error.message || ''} ${error.sqlMessage || ''}`.trim();
  return DATABASE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

const annotateDatabaseError = (error, meta = {}) => {
  if (!error || typeof error !== 'object') return error;

  error.isDatabaseError = true;
  if (meta.poolLabel) {
    error.poolLabel = meta.poolLabel;
  }
  if (meta.retryable !== undefined) {
    error.retryable = meta.retryable;
  } else if (error.retryable === undefined) {
    error.retryable = isTransientDbError(error);
  }

  return error;
};

const getSqlPreview = (sql) => {
  if (typeof sql !== 'string') return 'n/a';
  return sql.replace(/\s+/g, ' ').trim().slice(0, 180);
};

const sanitizeRequestPath = (requestPath) => {
  if (typeof requestPath !== 'string' || requestPath.length === 0) {
    return 'n/a';
  }

  return requestPath.split('?')[0];
};

const wrapPoolWithRetry = (pool, { poolLabel, onFinalFailure } = {}) => {
  if (!pool || pool.__curaflowRetryWrapped) {
    return pool;
  }

  const wrapMethod = (methodName) => {
    if (typeof pool[methodName] !== 'function') {
      return;
    }

    const originalMethod = pool[methodName].bind(pool);
    pool[methodName] = async (...args) => {
      let lastError;

      for (let attempt = 1; attempt <= DB_RETRY_DELAYS_MS.length + 1; attempt += 1) {
        try {
          return await originalMethod(...args);
        } catch (error) {
          lastError = error;
          const databaseError = isDatabaseError(error);
          const transient = isTransientDbError(error);
          const canRetry = transient && attempt <= DB_RETRY_DELAYS_MS.length;

          if (!databaseError) {
            throw error;
          }

          annotateDatabaseError(error, {
            poolLabel,
            retryable: canRetry,
          });

          const logPrefix = canRetry ? '[DB][Retry]' : '[DB][Failure]';
          const logger = canRetry ? console.warn : console.error;
          logger(
            `${logPrefix} ${poolLabel || 'default'} ${methodName} attempt ${attempt}/${DB_RETRY_DELAYS_MS.length + 1} failed`,
            {
              code: error.code || null,
              message: error.message,
              sql: getSqlPreview(args[0]),
            }
          );

          if (canRetry) {
            await sleep(DB_RETRY_DELAYS_MS[attempt - 1]);
            continue;
          }

          if (typeof onFinalFailure === 'function') {
            try {
              await onFinalFailure(error);
            } catch (cleanupError) {
              console.error('[DB][Cleanup] Failed to cleanup pool after error:', cleanupError.message);
            }
          }

          throw error;
        }
      }

      throw lastError;
    };
  };

  wrapMethod('execute');
  wrapMethod('query');
  Object.defineProperty(pool, '__curaflowRetryWrapped', {
    value: true,
    configurable: false,
    enumerable: false,
  });
  return pool;
};

const app = express();
const PORT = process.env.PORT || 3000;
const masterDbConfig = resolveMasterDbConfig();

// ===== Static frontend serving (Coolify / single-container deployment) =====
// Must be BEFORE helmet/CORS/auth middleware so static files are served fast and clean.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  console.log(`📁 Serving static frontend from ${distPath}`);
  app.use(express.static(distPath, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
}

// Trust proxy - Railway runs behind a reverse proxy
app.set('trust proxy', 1);

// Default MySQL Connection Pool
export const db = wrapPoolWithRetry(createPool({
  host: masterDbConfig.host,
  port: masterDbConfig.port,
  user: masterDbConfig.user,
  password: masterDbConfig.password,
  database: masterDbConfig.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // Important for DATE/DATETIME consistency
  timezone: '+00:00'
}), { poolLabel: 'default' });

// Cache for tenant database pools (Multi-Tenant Support)
const tenantPools = new Map();

// Track which tenants have been auto-migrated (resets on server restart)
const migratedTenants = new Set();
// Track in-flight migration promises to avoid duplicate runs
const migrationInFlight = new Map();

// Remove a tenant pool from cache (e.g., on connection error)
export const removeTenantPool = (dbToken) => {
  if (tenantPools.has(dbToken)) {
    const pool = tenantPools.get(dbToken);
    try {
      pool.end(); // Close connections
    } catch (e) {
      // Ignore errors during cleanup
    }
    tenantPools.delete(dbToken);
    migratedTenants.delete(dbToken);
    migrationInFlight.delete(dbToken);
    console.log(`Removed tenant pool from cache`);
  }
};

// Get or create a connection pool for a tenant
export const getTenantDb = (dbToken) => {
  if (!dbToken) return db; // Return default pool if no token
  
  // Check cache first
  if (tenantPools.has(dbToken)) {
    return tenantPools.get(dbToken);
  }
  
  try {
    // Decrypt and parse token (supports both legacy base64 and encrypted formats)
    const config = parseDbToken(dbToken);
    
    // Validate required fields
    if (!config || !config.host || !config.user || !config.database) {
      console.error('Invalid DB token: missing required fields');
      return db;
    }
    
    // Create new pool for this tenant
    const tenantPool = wrapPoolWithRetry(createPool({
      host: config.host,
      port: parseInt(config.port || '3306'),
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl || undefined,
      waitForConnections: true,
      connectionLimit: 5, // Smaller limit for tenant pools
      queueLimit: 0,
      dateStrings: true,
      timezone: '+00:00'
    }), {
      poolLabel: `tenant:${config.host}/${config.database}`,
      onFinalFailure: async (error) => {
        if (dbToken && (isTransientDbError(error) || error.code === 'ER_ACCESS_DENIED_ERROR')) {
          removeTenantPool(dbToken);
        }
      }
    });
    
    // Cache it
    tenantPools.set(dbToken, tenantPool);
    console.log(`Created new tenant pool for: ${config.host}/${config.database}`);
    
    return tenantPool;
  } catch (error) {
    console.error('Failed to parse DB token:', error.message);
    return db; // Fall back to default
  }
};

// Middleware to attach tenant DB to request + auto-run migrations
export const tenantDbMiddleware = async (req, res, next) => {
  const dbToken = req.headers['x-db-token'];
  req.db = getTenantDb(dbToken);
  req.dbToken = dbToken; // Store for error handling
  req.isCustomDb = !!dbToken && req.db !== db;

  // Auto-run tenant migrations on first access per tenant (per server lifetime)
  if (req.isCustomDb && !migratedTenants.has(dbToken)) {
    try {
      // Deduplicate: if another request already triggered migration, wait for the same promise
      if (!migrationInFlight.has(dbToken)) {
        const { runTenantMigrations } = await import('./utils/tenantMigrations.js');
        const promise = runTenantMigrations(req.db, dbToken)
          .then((results) => {
            const errors = results.filter(r => r.status === 'error');
            if (errors.length > 0) {
              console.warn(`[Auto-Migration] Tenant migration completed with ${errors.length} errors:`, errors);
            } else {
              console.log(`[Auto-Migration] Tenant migrations OK (${results.length} checked)`);
            }
            migratedTenants.add(dbToken);
          })
          .catch((err) => {
            console.error('[Auto-Migration] Failed:', err.message);
          })
          .finally(() => {
            migrationInFlight.delete(dbToken);
          });
        migrationInFlight.set(dbToken, promise);
      }
      await migrationInFlight.get(dbToken);
    } catch (err) {
      // Non-blocking: don't prevent tenant access on migration failure
      console.error('[Auto-Migration] Unexpected error:', err.message);
    }
  }

  next();
};

// CORS Configuration - MUST be before other middleware!
const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([
  'https://curaflow-production.up.railway.app',
  'https://curaflow-frontend-production.up.railway.app',
  process.env.FRONTEND_URL,
  ...configuredAllowedOrigins,
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean)));

console.log('CORS allowed origins:', allowedOrigins);
console.log('NODE_ENV:', process.env.NODE_ENV);

// Handle preflight requests explicitly
app.options('*', cors({
  origin: true, // Allow all origins for preflight
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-DB-Token']
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Allow all railway.app subdomains
    if (origin.endsWith('.railway.app')) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(null, true); // Allow anyway for debugging - change to false in production
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-DB-Token']
}));

// Multi-Tenant DB Middleware - attach tenant DB to each request
app.use(tenantDbMiddleware);// Security & Compression - AFTER CORS
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false, // CSP handled by Coolify/Traefik reverse proxy
}));
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/api/auth/events/stream') {
      return false;
    }

    return compression.filter(req, res);
  },
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting - General API
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 800, // limit each IP to 800 requests per minute
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const requestPath = req.originalUrl?.split('?')[0] || `${req.baseUrl || ''}${req.path || ''}`;
    return requestPath === '/api/auth/me'
      || requestPath === '/api/auth/presence'
      || requestPath === '/api/auth/jitsi-token'
      || requestPath.startsWith('/api/auth/cowork');
  },
});

const internalAuthLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1200,
  message: { error: 'Too many internal auth or CoWork requests from this IP, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // limit each IP to 30 login attempts per windowMs
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
});

app.use('/api/', generalLimiter);
app.use('/api/auth/me', internalAuthLimiter);
app.use('/api/auth/presence', internalAuthLimiter);
app.use('/api/auth/jitsi-token', internalAuthLimiter);
app.use('/api/auth/cowork', internalAuthLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.4' // Better error logging
  });
});

// ===== PUBLIC (no-auth) endpoint: Wish reminder acknowledgment =====
app.get('/api/wish-ack', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string' || token.length > 100) {
    return res.status(400).send(wishAckHtml('Ungültiger Link', 'Der Link ist ungültig oder abgelaufen.', false));
  }
  try {
    const [rows] = await db.execute(
      'SELECT id, doctor_id, target_month, status FROM WishReminderAck WHERE token = ?',
      [token]
    );
    if (rows.length === 0) {
      return res.status(404).send(wishAckHtml('Link nicht gefunden', 'Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.', false));
    }
    const ack = rows[0];
    if (ack.status === 'acknowledged') {
      return res.send(wishAckHtml('Bereits bestätigt', 'Sie haben bereits bestätigt, dass Sie keine Dienstwünsche haben. Vielen Dank!', true));
    }
    await db.execute(
      "UPDATE WishReminderAck SET status = 'acknowledged', acknowledged_date = NOW() WHERE id = ?",
      [ack.id]
    );
    return res.send(wishAckHtml('Vielen Dank!', 'Ihre Bestätigung wurde gespeichert. Sie haben angegeben, dass Sie keine Dienstwünsche für diesen Zeitraum haben.', true));
  } catch (err) {
    console.error('[wish-ack] Error:', err.message);
    return res.status(500).send(wishAckHtml('Fehler', 'Es ist ein technischer Fehler aufgetreten. Bitte versuchen Sie es später erneut.', false));
  }
});

function wishAckHtml(title, message, success) {
  const color = success ? '#16a34a' : '#dc2626';
  const icon = success ? '✅' : '❌';
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CuraFlow – ${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;padding:20px}
.card{background:#fff;border-radius:16px;padding:48px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);border-top:4px solid ${color}}
.icon{font-size:48px;margin-bottom:16px}.title{font-size:24px;font-weight:700;color:#1e293b;margin-bottom:12px}
.msg{font-size:16px;color:#64748b;line-height:1.6}.footer{margin-top:24px;font-size:13px;color:#94a3b8}</style></head>
<body><div class="card"><div class="icon">${icon}</div><h1 class="title">${title}</h1><p class="msg">${message}</p><p class="footer">CuraFlow Dienstplanverwaltung</p></div></body></html>`;
}

// API Routes
app.use('/api/auth/login', authLimiter); // Apply stricter limit to login
app.use('/api/auth', authRouter);
app.use('/api/db', dbProxyRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/holidays', holidaysRouter);
app.use('/api/staff', staffRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/admin', adminRouter);
app.use('/api/atomic', atomicRouter);
app.use('/api/schedule', aiAutofillRouter);
app.use('/api/master', masterRouter);
app.use('/api/certificates', certificatesRouter);

// ===== SPA fallback (Coolify / single-container deployment) =====
if (fs.existsSync(distPath)) {
  app.get(/^(?!\/api\/).*/, (req, res) => {
    const htmlFile = req.path === '/master' || req.path.startsWith('/master/')
      ? 'master.html'
      : 'index.html';
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(distPath, htmlFile));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  const databaseError = isDatabaseError(err);
  const retryable = databaseError && (err.retryable ?? isTransientDbError(err));

  if (databaseError) {
    console.error('[DB][HTTP] Request failed', {
      method: req.method,
      path: sanitizeRequestPath(req.originalUrl),
      code: err.code || null,
      retryable,
      pool: err.poolLabel || 'unknown',
      message: err.message,
    });
  } else {
    console.error('Error:', err);
  }

  const status = err.status || (databaseError && retryable ? 503 : 500);
  const message = databaseError
    ? 'Datenbankproblem auf dem Server. Bitte versuchen Sie es erneut.'
    : (process.env.NODE_ENV === 'production' && status === 500
        ? 'Internal server error'
        : err.message);

  res.status(status).json({ 
    error: message,
    ...(databaseError && {
      databaseError: true,
      retryable,
      code: err.code || null,
    }),
    ...(databaseError && process.env.NODE_ENV !== 'production' && {
      details: err.message,
      pool: err.poolLabel || 'unknown',
    }),
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  const safePath = sanitizeRequestPath(req.url);
  console.warn('404 Not Found:', req.method, safePath, 'Body:', JSON.stringify(req.body || {}).substring(0, 200));
  res.status(404).json({ error: 'Route not found', path: safePath, method: req.method });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 CuraFlow Railway Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${masterDbConfig.host}/${masterDbConfig.database}`);

  try {
    const migrationResults = await runMasterMigrations(db);
    const failedMigrations = migrationResults.filter(result => result.status === 'error');
    console.log('🔧 Master migrations on startup:', migrationResults);
    if (failedMigrations.length > 0) {
      console.error('⚠️  Some startup migrations failed:', failedMigrations);
    }
  } catch (err) {
    console.error('⚠️  Startup migration error:', err.message);
  }
  
  // Auto-create missing tables on startup
  try {
    await ensureTablesExist();
  } catch (err) {
    console.error('⚠️  Table initialization error:', err.message);
  }

  // Daily wish reminder check (runs every hour, checks internally if today is reminder day)
  const WISH_REMINDER_INTERVAL = 60 * 60 * 1000; // 1 hour
  setInterval(async () => {
    try {
      // Only trigger between 7:00 and 8:59 UTC to avoid duplicate sends
      const hour = new Date().getUTCHours();
      if (hour < 7 || hour > 8) return;

      const result = await checkAndSendWishReminders(db, 'cron-default');
      if (result.sent) {
        console.log(`📧 [Cron] Wish reminders sent for ${result.targetMonth}: ${result.sentCount} emails`);
      }
    } catch (err) {
      console.error('❌ [Cron] Wish reminder check failed:', err.message);
    }
  }, WISH_REMINDER_INTERVAL);
  console.log('⏰ Wish reminder cron enabled (hourly check, sends between 7-9 UTC)');
});

// Auto-create essential tables if missing
async function ensureTablesExist() {
  const tables = [
    {
      name: 'TeamRole',
      sql: `CREATE TABLE IF NOT EXISTS TeamRole (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        priority INT NOT NULL DEFAULT 99,
        is_specialist BOOLEAN NOT NULL DEFAULT FALSE,
        can_do_foreground_duty BOOLEAN NOT NULL DEFAULT TRUE,
        can_do_background_duty BOOLEAN NOT NULL DEFAULT FALSE,
        excluded_from_statistics BOOLEAN NOT NULL DEFAULT FALSE,
        description VARCHAR(255) DEFAULT NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'WishReminderAck',
      sql: `CREATE TABLE IF NOT EXISTS WishReminderAck (
        id VARCHAR(36) PRIMARY KEY,
        doctor_id VARCHAR(36) NOT NULL,
        target_month VARCHAR(7) NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        status ENUM('sent', 'acknowledged') NOT NULL DEFAULT 'sent',
        acknowledged_date TIMESTAMP NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_target_month (target_month),
        INDEX idx_doctor_month (doctor_id, target_month),
        INDEX idx_token (token)
      )`
    },
    {
      name: 'EmailVerification',
      sql: `CREATE TABLE IF NOT EXISTS EmailVerification (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        type ENUM('email_verify', 'password_sent') NOT NULL DEFAULT 'email_verify',
        status ENUM('pending', 'verified', 'expired') NOT NULL DEFAULT 'pending',
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_date TIMESTAMP NULL,
        expires_date TIMESTAMP NULL,
        INDEX idx_token (token),
        INDEX idx_user_id (user_id)
      )`
    },
    {
      name: 'CoWorkInvite',
      sql: `CREATE TABLE IF NOT EXISTS CoWorkInvite (
        id VARCHAR(36) PRIMARY KEY,
        room_name VARCHAR(128) NOT NULL,
        tenant_slug VARCHAR(64) NOT NULL,
        inviter_user_id VARCHAR(36) NOT NULL,
        invitee_user_id VARCHAR(36) NOT NULL,
        status ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
        responded_date TIMESTAMP NULL,
        expires_date TIMESTAMP NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_invitee_status (invitee_user_id, status),
        INDEX idx_inviter_status (inviter_user_id, status),
        INDEX idx_room_name (room_name),
        INDEX idx_expires_date (expires_date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    },
    {
      name: 'ScheduleBlock',
      sql: `CREATE TABLE IF NOT EXISTS ScheduleBlock (
        id VARCHAR(36) PRIMARY KEY,
        date DATE NOT NULL,
        position VARCHAR(255) NOT NULL,
        timeslot_id VARCHAR(36) DEFAULT NULL,
        reason VARCHAR(500) DEFAULT NULL,
        created_by VARCHAR(255) DEFAULT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_block (date, position, timeslot_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    }
  ];

  for (const table of tables) {
    try {
      await db.execute(table.sql);
      
      // Add new columns if they don't exist (migration for existing DBs)
      if (table.name === 'TeamRole') {
        try {
          await ensureColumns(db, 'TeamRole', [
            ['can_do_foreground_duty', 'BOOLEAN NOT NULL DEFAULT TRUE'],
            ['can_do_background_duty', 'BOOLEAN NOT NULL DEFAULT FALSE'],
            ['excluded_from_statistics', 'BOOLEAN NOT NULL DEFAULT FALSE'],
            ['description', 'VARCHAR(255) DEFAULT NULL'],
          ]);
        } catch (alterErr) {
          // Columns might already exist or syntax not supported
        }
      }
      
      // Seed default data for TeamRole
      if (table.name === 'TeamRole') {
        const [existing] = await db.execute('SELECT COUNT(*) as cnt FROM TeamRole');
        if (existing[0].cnt === 0) {
          const defaultRoles = [
            { id: crypto.randomUUID(), name: 'Chefarzt', priority: 0, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: 'Oberste Führungsebene' },
            { id: crypto.randomUUID(), name: 'Oberarzt', priority: 1, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: 'Kann Hintergrunddienste übernehmen' },
            { id: crypto.randomUUID(), name: 'Facharzt', priority: 2, is_specialist: true, can_do_foreground_duty: true, can_do_background_duty: true, excluded_from_statistics: false, description: 'Kann alle Dienste übernehmen' },
            { id: crypto.randomUUID(), name: 'Assistenzarzt', priority: 3, is_specialist: false, can_do_foreground_duty: true, can_do_background_duty: false, excluded_from_statistics: false, description: 'Kann Vordergrunddienste übernehmen' },
            { id: crypto.randomUUID(), name: 'Nicht-Radiologe', priority: 4, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: true, description: 'Wird in Statistiken nicht gezählt' },
          ];
          for (const role of defaultRoles) {
            await db.execute(
              'INSERT IGNORE INTO TeamRole (id, name, priority, is_specialist, can_do_foreground_duty, can_do_background_duty, excluded_from_statistics, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [role.id, role.name, role.priority, role.is_specialist, role.can_do_foreground_duty, role.can_do_background_duty, role.excluded_from_statistics, role.description]
            );
          }
          console.log('✅ TeamRole table seeded with defaults');
        }
      }
      console.log(`✅ Table ${table.name} ready`);
    } catch (err) {
      console.error(`❌ Failed to ensure ${table.name}:`, err.message);
    }
  }

  // Add email_verified columns to app_users if they don't exist
  // Note: This can also be triggered manually via Admin Panel > Migrationen
  try {
    await ensureColumns(db, 'app_users', [
      ['email_verified', 'TINYINT(1) DEFAULT 0'],
      ['email_verified_date', 'DATETIME DEFAULT NULL'],
      ['last_seen_at', 'DATETIME DEFAULT NULL'],
    ]);
  } catch (err) {
    // Columns may already exist - that's fine, migration is also available in Admin Panel
  }

  // Ensure EmailVerification table exists
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS EmailVerification (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        type ENUM('email_verify', 'password_sent') NOT NULL DEFAULT 'email_verify',
        status ENUM('pending', 'verified', 'expired') NOT NULL DEFAULT 'pending',
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_date TIMESTAMP NULL,
        expires_date TIMESTAMP NULL,
        INDEX idx_token (token),
        INDEX idx_user_id (user_id)
      )
    `);
  } catch (err) {
    // Table may already exist
  }

  // Ensure CoWorkInvite table exists
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS CoWorkInvite (
        id VARCHAR(36) PRIMARY KEY,
        room_name VARCHAR(128) NOT NULL,
        tenant_slug VARCHAR(64) NOT NULL,
        inviter_user_id VARCHAR(36) NOT NULL,
        invitee_user_id VARCHAR(36) NOT NULL,
        status ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
        responded_date TIMESTAMP NULL,
        expires_date TIMESTAMP NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_invitee_status (invitee_user_id, status),
        INDEX idx_inviter_status (inviter_user_id, status),
        INDEX idx_room_name (room_name),
        INDEX idx_expires_date (expires_date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await db.execute(`ALTER TABLE CoWorkInvite CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (err) {
    // Table may already exist
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server gracefully...');
  await db.end();
  process.exit(0);
});
