import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../index.js';
import { buildRealtimeScope, registerRealtimeClient } from '../utils/realtime.js';
import { getEmailProviderInfo, sendEmail } from '../utils/email.js';

const router = express.Router();

// JWT Helper Functions
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = '24h';

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function resolveAuthPayload(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return verifyToken(authHeader.substring(7));
  }

  if (typeof req.query?.access_token === 'string' && req.query.access_token) {
    return verifyToken(req.query.access_token);
  }

  return null;
}

function streamAuthMiddleware(req, res, next) {
  const payload = resolveAuthPayload(req);
  if (!payload) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }

  req.user = payload;
  next();
}

// Middleware to verify authentication
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }
  
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
  
  req.user = payload;
  next();
}

// Middleware to verify admin role
export function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
  }
  next();
}

// Sanitize user object (remove sensitive data)
function sanitizeUser(user) {
  if (!user) return null;
  
  const { password_hash, ...safe } = user;
  
  // Parse JSON fields
  const jsonFields = ['allowed_tenants', 'collapsed_sections', 'schedule_hidden_rows', 'wish_hidden_doctors'];
  for (const field of jsonFields) {
    if (safe[field] && typeof safe[field] === 'string') {
      try {
        safe[field] = JSON.parse(safe[field]);
      } catch (e) {}
    }
  }
  
  // Convert boolean fields
  const boolFields = ['schedule_show_sidebar', 'schedule_show_time_account', 'schedule_initials_only', 'schedule_sort_doctors_alphabetically', 'highlight_my_name', 'wish_show_occupied', 'wish_show_absences', 'is_active', 'must_change_password', 'email_verified'];
  for (const field of boolFields) {
    if (safe[field] !== undefined) {
      safe[field] = !!safe[field];
    }
  }
  
  return safe;
}

function generateTemporaryPassword() {
  return `CF-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}!`;
}

async function sendTemporaryPasswordEmail({ email, fullName, tempPassword }) {
  const providerInfo = getEmailProviderInfo();
  if (!providerInfo.configured) {
    const error = new Error('E-Mail nicht konfiguriert. Bitte BREVO_API_KEY oder SMTP_HOST + SMTP_USER + SMTP_PASS setzen.');
    error.statusCode = 503;
    throw error;
  }

  const displayName = fullName?.trim() || email;
  const appUrl = (process.env.APP_URL || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const loginHint = appUrl
    ? `<p>Login: <a href="${appUrl}">${appUrl}</a></p>`
    : '<p>Bitte melden Sie sich in CuraFlow mit dem neuen Passwort an.</p>';

  await sendEmail({
    to: email,
    subject: 'CuraFlow: Neues temporäres Passwort',
    text: [
      `Hallo ${displayName},`,
      '',
      'für Ihr CuraFlow-Konto wurde ein neues temporäres Passwort erstellt.',
      `Temporäres Passwort: ${tempPassword}`,
      '',
      'Bitte melden Sie sich damit an und ändern Sie Ihr Passwort direkt anschließend.',
      appUrl ? `Login: ${appUrl}` : '',
    ].filter(Boolean).join('\n'),
    html: `
      <p>Hallo ${displayName},</p>
      <p>für Ihr CuraFlow-Konto wurde ein neues temporäres Passwort erstellt.</p>
      <p><strong>Temporäres Passwort:</strong> ${tempPassword}</p>
      <p>Bitte melden Sie sich damit an und ändern Sie Ihr Passwort direkt anschließend.</p>
      ${loginHint}
    `,
  });
}

// ============ LOGIN ============
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email und Passwort erforderlich' });
    }
    
    const [rows] = await db.execute(
      'SELECT * FROM app_users WHERE email = ? AND is_active = 1',
      [email.toLowerCase().trim()]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }
    
    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }
    
    // Update last login
    await db.execute(
      'UPDATE app_users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );
    
    // Create JWT
    const token = createToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      doctor_id: user.doctor_id
    });
    
    res.json({
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    next(error);
  }
});

// ============ REGISTER (Admin only) ============
router.post('/register', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { email, password, full_name, role = 'user', doctor_id } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email und Passwort erforderlich' });
    }
    
    // Check if user exists
    const [existing] = await db.execute(
      'SELECT id FROM app_users WHERE email = ?',
      [email.toLowerCase().trim()]
    );
    
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Benutzer existiert bereits' });
    }
    
    // Hash password
    const password_hash = await bcrypt.hash(password, 12);
    const id = crypto.randomUUID();
    
    await db.execute(
      `INSERT INTO app_users (id, email, password_hash, full_name, role, doctor_id, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, email.toLowerCase().trim(), password_hash, full_name || '', role, doctor_id || null]
    );
    
    const [newUser] = await db.execute('SELECT * FROM app_users WHERE id = ?', [id]);
    
    res.status(201).json({ user: sanitizeUser(newUser[0]) });
  } catch (error) {
    next(error);
  }
});

// ============ ME (Get current user) ============
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    res.json(sanitizeUser(rows[0]));
  } catch (error) {
    next(error);
  }
});

// ============ UPDATE ME ============
router.patch('/me', authMiddleware, async (req, res, next) => {
  try {
    const { data } = req.body;
    
    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Keine Daten zum Aktualisieren' });
    }
    
    // Whitelist allowed fields for self-update
    const allowedFields = [
      'full_name', 'theme', 'section_config', 'collapsed_sections',
      'schedule_hidden_rows', 'schedule_show_sidebar', 'schedule_show_time_account', 'highlight_my_name',
      'grid_font_size', 'wish_show_occupied', 'wish_show_absences', 'wish_hidden_doctors'
    ];
    
    const updates = [];
    const values = [];
    
    for (const [key, value] of Object.entries(data)) {
      if (allowedFields.includes(key)) {
        updates.push(`\`${key}\` = ?`);
        // Serialize arrays/objects
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine gültigen Felder zum Aktualisieren' });
    }
    
    values.push(req.user.sub);
    
    await db.execute(
      `UPDATE app_users SET ${updates.join(', ')}, updated_date = NOW() WHERE id = ?`,
      values
    );
    
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [req.user.sub]);
    
    res.json(sanitizeUser(rows[0]));
  } catch (error) {
    next(error);
  }
});

// ============ CHANGE PASSWORD ============
router.post('/change-password', authMiddleware, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben' });
    }
    
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [req.user.sub]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    const validPassword = await bcrypt.compare(currentPassword, rows[0].password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    }
    
    const newHash = await bcrypt.hash(newPassword, 12);
    await db.execute(
      'UPDATE app_users SET password_hash = ?, must_change_password = 0, updated_date = NOW() WHERE id = ?',
      [newHash, req.user.sub]
    );
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============ FORCE CHANGE PASSWORD ============
router.post('/force-change-password', authMiddleware, async (req, res, next) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: 'Neues Passwort erforderlich' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.execute(
      'UPDATE app_users SET password_hash = ?, must_change_password = 0, updated_date = NOW() WHERE id = ?',
      [newHash, req.user.sub]
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============ LIST USERS (Admin only) ============
router.get('/users', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT * FROM app_users WHERE is_active = 1 ORDER BY created_date DESC');
    res.json(rows.map(sanitizeUser));
  } catch (error) {
    next(error);
  }
});

// ============ UPDATE USER (Admin only) ============
router.patch('/users/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { data } = req.body;
    
    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Keine Daten zum Aktualisieren' });
    }
    
    // Admin can update more fields
    const allowedFields = [
      'full_name', 'role', 'doctor_id', 'is_active', 'allowed_tenants',
      'theme', 'section_config', 'collapsed_sections',
      'schedule_hidden_rows', 'schedule_show_sidebar', 'highlight_my_name',
      'grid_font_size', 'wish_show_occupied', 'wish_show_absences', 'wish_hidden_doctors'
    ];
    
    const updates = [];
    const values = [];
    
    for (const [key, value] of Object.entries(data)) {
      if (allowedFields.includes(key)) {
        updates.push(`\`${key}\` = ?`);
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }
    
    // Handle password reset
    if (data.password) {
      updates.push('password_hash = ?');
      values.push(await bcrypt.hash(data.password, 12));
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine gültigen Felder' });
    }
    
    values.push(userId);
    
    await db.execute(
      `UPDATE app_users SET ${updates.join(', ')}, updated_date = NOW() WHERE id = ?`,
      values
    );
    
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [userId]);
    
    res.json(sanitizeUser(rows[0]));
  } catch (error) {
    next(error);
  }
});

// ============ DELETE USER (Admin only - soft delete) ============
router.delete('/users/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    await db.execute(
      'UPDATE app_users SET is_active = 0, updated_date = NOW() WHERE id = ?',
      [userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============ RESET USER PASSWORD (Admin only) ============
router.post('/users/:userId/reset-password', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;

    const [rows] = await db.execute(
      'SELECT id, email, full_name, is_active FROM app_users WHERE id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(400).json({ error: 'Passwort kann nur für aktive Benutzer zurückgesetzt werden' });
    }

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await sendTemporaryPasswordEmail({
      email: user.email,
      fullName: user.full_name,
      tempPassword,
    });

    await db.execute(
      'UPDATE app_users SET password_hash = ?, must_change_password = 1, updated_date = NOW() WHERE id = ?',
      [passwordHash, userId]
    );

    res.json({ success: true, message: `Passwort-E-Mail an ${user.email} gesendet` });
  } catch (error) {
    next(error);
  }
});

// ============ GET MY ALLOWED TENANTS ============
// Returns the tenants that the current user is allowed to access
router.get('/my-tenants', authMiddleware, async (req, res, next) => {
  try {
    // Get user's allowed_tenants
    const [userRows] = await db.execute(
      'SELECT allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    const allowedTenants = userRows[0].allowed_tenants;
    let allowedTenantList = null;
    
    // Parse allowed_tenants (could be JSON string, array, or null)
    if (allowedTenants) {
      allowedTenantList = typeof allowedTenants === 'string' 
        ? JSON.parse(allowedTenants) 
        : allowedTenants;
    }
    
    // Get all db_tokens
    const [tokenRows] = await db.execute(`
      SELECT id, name, host, db_name, description, is_active
      FROM db_tokens
      ORDER BY name ASC
    `);
    
    // Filter tokens based on user's allowed_tenants
    let filteredTokens = tokenRows;
    
    // If allowedTenantList is null or empty, user has access to all tenants
    if (allowedTenantList && allowedTenantList.length > 0) {
      filteredTokens = tokenRows.filter(token => allowedTenantList.includes(token.id));
    }
    
    // Convert is_active from MySQL tinyint to proper boolean
    const tokens = filteredTokens.map(row => ({
      ...row,
      is_active: Boolean(row.is_active)
    }));
    
    res.json({
      hasFullAccess: !allowedTenantList || allowedTenantList.length === 0,
      tenants: tokens
    });
  } catch (error) {
    next(error);
  }
});

// Activate a tenant for the current user (checks tenant access)
router.post('/activate-tenant/:tokenId', authMiddleware, async (req, res, next) => {
  try {
    const { tokenId } = req.params;

    // Check user's allowed tenants
    const [userRows] = await db.execute(
      'SELECT allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const allowedTenants = userRows[0].allowed_tenants;
    let allowedTenantList = null;
    if (allowedTenants) {
      allowedTenantList = typeof allowedTenants === 'string'
        ? JSON.parse(allowedTenants)
        : allowedTenants;
    }

    // If user has restricted access, verify this tenant is allowed
    if (allowedTenantList && allowedTenantList.length > 0) {
      if (!allowedTenantList.includes(Number(tokenId)) && !allowedTenantList.includes(String(tokenId))) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Mandanten' });
      }
    }

    // Find the token
    const [existing] = await db.execute('SELECT id, token, name, host, db_name FROM db_tokens WHERE id = ?', [tokenId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }

    // Deactivate all, activate selected
    await db.execute('UPDATE db_tokens SET is_active = FALSE');
    await db.execute('UPDATE db_tokens SET is_active = TRUE WHERE id = ?', [tokenId]);

    console.log(`[Auth] Tenant "${existing[0].name}" activated by ${req.user.email}`);

    res.json({
      success: true,
      token: existing[0].token,
      name: existing[0].name,
      host: existing[0].host,
      db_name: existing[0].db_name
    });
  } catch (error) {
    next(error);
  }
});

// ============ VERIFY TOKEN ============
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.json({ valid: false });
  }
  
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  
  res.json({ valid: !!payload, payload });
});

router.post('/presence', authMiddleware, async (req, res) => {
  res.json({
    success: true,
    receivedAt: new Date().toISOString(),
  });
});

router.get('/events/stream', streamAuthMiddleware, async (req, res) => {
  const dbToken = typeof req.query?.db_token === 'string' ? req.query.db_token : null;
  const scope = buildRealtimeScope(dbToken);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const unregister = registerRealtimeClient({
    scope,
    res,
    userId: req.user?.sub || null,
  });

  req.on('close', unregister);
  req.on('end', unregister);
});

router.get('/cowork/contacts', authMiddleware, async (req, res) => {
  res.json([]);
});

router.get('/cowork/invites', authMiddleware, async (req, res) => {
  res.json({
    incoming: [],
    outgoing: [],
  });
});

export default router;
