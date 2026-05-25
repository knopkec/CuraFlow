import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../index.js';
import { broadcastUserEvent, buildRealtimeScope, registerRealtimeClient } from '../utils/realtime.js';
import { getEmailProviderInfo, sendEmail } from '../utils/email.js';
import { loadUserGroupContext, listUserGroups } from '../utils/tenantGroups.js';

const router = express.Router();

// JWT Helper Functions
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = '24h';
const JITSI_JWT_APP_ID = process.env.JITSI_JWT_APP_ID;
const JITSI_JWT_APP_SECRET = process.env.JITSI_JWT_APP_SECRET;
const JITSI_JWT_AUDIENCE = process.env.JITSI_JWT_AUDIENCE || 'jitsi';
const JITSI_JWT_SUB = process.env.JITSI_JWT_SUB;
const parsedJitsiJwtExpirySeconds = parseInt(process.env.JITSI_JWT_EXPIRY_SECONDS || '1800', 10);
const JITSI_JWT_EXPIRY_SECONDS = Math.max(Number.isFinite(parsedJitsiJwtExpirySeconds) ? parsedJitsiJwtExpirySeconds : 1800, 1800);
const COWORK_INVITE_EXPIRY_MINUTES = parseInt(process.env.COWORK_INVITE_EXPIRY_MINUTES || '10', 10);
const COWORK_ONLINE_WINDOW_SECONDS = parseInt(process.env.COWORK_ONLINE_WINDOW_SECONDS || '120', 10);

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

function parseTenantSlug(allowedTenants) {
  if (!allowedTenants) return 'default';

  try {
    const parsed = typeof allowedTenants === 'string' ? JSON.parse(allowedTenants) : allowedTenants;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed[0].toString().toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
    }
  } catch (error) {
    // Fallback below for non-JSON values.
  }

  return allowedTenants.toString().toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
}

function parseTenantList(allowedTenants) {
  if (!allowedTenants) return null;

  try {
    const parsed = typeof allowedTenants === 'string' ? JSON.parse(allowedTenants) : allowedTenants;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function usersShareTenantAccess(firstAllowedTenants, secondAllowedTenants) {
  const first = parseTenantList(firstAllowedTenants);
  const second = parseTenantList(secondAllowedTenants);

  if (!first || first.length === 0) return true;
  if (!second || second.length === 0) return true;

  return first.some((tenantId) => second.includes(tenantId));
}

function buildCoworkRoomName(tenantSlug) {
  return `curaflow-support-${tenantSlug}-${crypto.randomUUID().slice(0, 8)}`;
}

function isUserOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  const lastSeen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(lastSeen)) return false;
  return Date.now() - lastSeen <= COWORK_ONLINE_WINDOW_SECONDS * 1000;
}

async function expireStaleCoworkInvites() {
  await db.execute(
    `UPDATE CoWorkInvite
     SET status = 'expired', responded_date = COALESCE(responded_date, UTC_TIMESTAMP())
     WHERE status = 'pending' AND expires_date IS NOT NULL AND expires_date < UTC_TIMESTAMP()`
  );
}

function uuidCompareSql(columnName) {
  return `${columnName} COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR(36) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci`;
}

function createJitsiToken({ roomName, user }) {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign({
    aud: JITSI_JWT_AUDIENCE,
    iss: JITSI_JWT_APP_ID,
    sub: JITSI_JWT_SUB,
    room: roomName,
    nbf: now - 10,
    exp: now + JITSI_JWT_EXPIRY_SECONDS,
    context: {
      user: {
        id: user.id,
        name: user.full_name || user.email || 'CuraFlow Admin',
        email: user.email,
        moderator: user.role === 'admin',
      },
    },
  }, JITSI_JWT_APP_SECRET, { algorithm: 'HS256' });
}

async function getCoworkAudienceUserIds({ allowedTenants, includeUserIds = [] }) {
  const [rows] = await db.execute(
    `SELECT id, allowed_tenants
     FROM app_users
     WHERE is_active = 1 AND role = 'admin'`
  );

  const audience = rows
    .filter((candidate) => usersShareTenantAccess(allowedTenants, candidate.allowed_tenants))
    .map((candidate) => candidate.id);

  for (const userId of includeUserIds) {
    if (userId && !audience.includes(userId)) {
      audience.push(userId);
    }
  }

  return audience;
}

async function broadcastCoworkUpdate({ type, actor = null, allowedTenants = null, includeUserIds = [], invite = null }) {
  const userIds = await getCoworkAudienceUserIds({ allowedTenants, includeUserIds });

  broadcastUserEvent({
    eventName: 'cowork-update',
    userIds,
    payload: {
      type,
      changedAt: new Date().toISOString(),
      actor: actor ? {
        id: actor.id || null,
        email: actor.email || null,
      } : null,
      invite: invite ? {
        id: invite.id || null,
        roomName: invite.roomName || null,
        status: invite.status || null,
      } : null,
    },
  });
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
  const jsonFields = ['allowed_tenants', 'allowed_groups', 'group_admin_groups', 'collapsed_sections', 'schedule_hidden_rows', 'wish_hidden_doctors'];
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
    
    // Update last login and presence for CoWork online detection.
    await db.execute(
      'UPDATE app_users SET last_login = NOW(), last_seen_at = NOW() WHERE id = ?',
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
      'grid_font_size', 'wish_show_occupied', 'wish_show_absences', 'wish_hidden_doctors', 'wish_default_position'
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
      'full_name', 'role', 'doctor_id', 'is_active', 'allowed_tenants', 'allowed_groups', 'group_admin_groups',
      'theme', 'section_config', 'collapsed_sections',
      'schedule_hidden_rows', 'schedule_show_sidebar', 'highlight_my_name',
      'grid_font_size', 'wish_show_occupied', 'wish_show_absences', 'wish_hidden_doctors', 'wish_default_position'
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

// ============ GET MY ALLOWED GROUPS ============
// Returns the cross-tenant pool groups the user is allowed to see.
router.get('/my-groups', authMiddleware, async (req, res, next) => {
  try {
    const ctx = await loadUserGroupContext(db, req.user.sub);
    if (!ctx) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    const groups = await listUserGroups(db, ctx);
    res.json({
      hasFullAccess: ctx.isMasterAdmin,
      groups: groups.map((g) => ({
        ...g,
        is_active: Boolean(g.is_active),
        // canWrite signals whether the user may modify pool data for this group
        canWrite: ctx.isMasterAdmin
          || (Array.isArray(ctx.adminGroups) && ctx.adminGroups.includes(Number(g.id))),
      })),
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
  try {
    await db.execute(
      'UPDATE app_users SET last_seen_at = NOW() WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );

    const [rows] = await db.execute(
      'SELECT id, email, role, allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );

    if (rows[0]?.role === 'admin') {
      await broadcastCoworkUpdate({
        type: 'presence-updated',
        actor: rows[0],
        allowedTenants: rows[0].allowed_tenants,
        includeUserIds: [rows[0].id],
      });
    }

    res.json({ success: true, lastSeenAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

router.get('/jitsi-token', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    if (!JITSI_JWT_APP_ID || !JITSI_JWT_APP_SECRET || !JITSI_JWT_SUB) {
      return res.status(503).json({
        error: 'Jitsi JWT ist nicht vollständig konfiguriert. Bitte JITSI_JWT_APP_ID, JITSI_JWT_APP_SECRET und JITSI_JWT_SUB setzen.'
      });
    }

    const [rows] = await db.execute(
      'SELECT id, email, full_name, role, allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = rows[0];
    const tenantSlug = parseTenantSlug(user.allowed_tenants);
    const roomName = `curaflow-support-${tenantSlug}`;
    const token = createJitsiToken({ roomName, user });
    const expiresAt = Math.floor(Date.now() / 1000) + JITSI_JWT_EXPIRY_SECONDS;

    res.json({
      token,
      roomName,
      tenantSlug,
      expiresAt,
    });
  } catch (error) {
    next(error);
  }
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

router.get('/cowork/contacts', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const [adminRows] = await db.execute(
      'SELECT id, email, full_name, role, allowed_tenants, last_seen_at FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );

    if (adminRows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const adminUser = adminRows[0];
    const [rows] = await db.execute(
      `SELECT id, email, full_name, role, allowed_tenants, last_seen_at
       FROM app_users
       WHERE is_active = 1 AND id <> ?
       ORDER BY full_name ASC, email ASC`,
      [req.user.sub]
    );

    const contacts = rows
      .filter((candidate) => candidate.role === 'admin')
      .filter((candidate) => usersShareTenantAccess(adminUser.allowed_tenants, candidate.allowed_tenants))
      .map((candidate) => ({
        id: candidate.id,
        email: candidate.email,
        full_name: candidate.full_name,
        role: candidate.role,
        last_seen_at: candidate.last_seen_at,
        is_online: isUserOnline(candidate.last_seen_at),
      }));

    res.json(contacts);
  } catch (error) {
    next(error);
  }
});

router.get('/cowork/invites', authMiddleware, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    await expireStaleCoworkInvites();

    const [incomingRows] = await db.execute(
      `SELECT ci.*, inviter.full_name AS inviter_name, inviter.email AS inviter_email
       FROM CoWorkInvite ci
       INNER JOIN app_users inviter ON inviter.id COLLATE utf8mb4_unicode_ci = ci.inviter_user_id COLLATE utf8mb4_unicode_ci
       WHERE ${uuidCompareSql('ci.invitee_user_id')}
         AND ci.status IN ('pending', 'accepted')
         AND (ci.expires_date IS NULL OR ci.expires_date >= UTC_TIMESTAMP())
       ORDER BY ci.created_date DESC
       LIMIT 10`,
      [req.user.sub]
    );

    const [outgoingRows] = await db.execute(
      `SELECT ci.*, invitee.full_name AS invitee_name, invitee.email AS invitee_email, invitee.last_seen_at AS invitee_last_seen_at
       FROM CoWorkInvite ci
       INNER JOIN app_users invitee ON invitee.id COLLATE utf8mb4_unicode_ci = ci.invitee_user_id COLLATE utf8mb4_unicode_ci
       WHERE ${uuidCompareSql('ci.inviter_user_id')}
         AND ci.status IN ('pending', 'accepted')
         AND (ci.expires_date IS NULL OR ci.expires_date >= UTC_TIMESTAMP())
       ORDER BY ci.created_date DESC
       LIMIT 10`,
      [req.user.sub]
    );

    res.json({
      incoming: incomingRows.map((invite) => ({
        id: invite.id,
        room_name: invite.room_name,
        tenant_slug: invite.tenant_slug,
        status: invite.status,
        created_date: invite.created_date,
        responded_date: invite.responded_date,
        expires_date: invite.expires_date,
        inviter_name: invite.inviter_name,
        inviter_email: invite.inviter_email,
      })),
      outgoing: outgoingRows.map((invite) => ({
        id: invite.id,
        room_name: invite.room_name,
        tenant_slug: invite.tenant_slug,
        status: invite.status,
        created_date: invite.created_date,
        responded_date: invite.responded_date,
        expires_date: invite.expires_date,
        invitee_name: invite.invitee_name,
        invitee_email: invite.invitee_email,
        invitee_last_seen_at: invite.invitee_last_seen_at,
        invitee_is_online: isUserOnline(invite.invitee_last_seen_at),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cowork/invites', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    if (!JITSI_JWT_APP_ID || !JITSI_JWT_APP_SECRET || !JITSI_JWT_SUB) {
      return res.status(503).json({
        error: 'Jitsi JWT ist nicht vollständig konfiguriert. Bitte JITSI_JWT_APP_ID, JITSI_JWT_APP_SECRET und JITSI_JWT_SUB setzen.'
      });
    }

    const { inviteeUserId } = req.body || {};
    if (!inviteeUserId) {
      return res.status(400).json({ error: 'inviteeUserId ist erforderlich' });
    }

    if (inviteeUserId === req.user.sub) {
      return res.status(400).json({ error: 'Sie koennen sich nicht selbst einladen' });
    }

    const [userRows] = await db.execute(
      `SELECT id, email, full_name, role, allowed_tenants
       FROM app_users
       WHERE id IN (?, ?) AND is_active = 1`,
      [req.user.sub, inviteeUserId]
    );

    const inviter = userRows.find((row) => row.id === req.user.sub);
    const invitee = userRows.find((row) => row.id === inviteeUserId);

    if (!inviter || !invitee) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    if (invitee.role !== 'admin') {
      return res.status(400).json({ error: 'CoWork-Einladungen koennen aktuell nur an Admins gesendet werden' });
    }

    if (!usersShareTenantAccess(inviter.allowed_tenants, invitee.allowed_tenants)) {
      return res.status(403).json({ error: 'Der Benutzer liegt ausserhalb Ihres Mandantenkontexts' });
    }

    await expireStaleCoworkInvites();

    await db.execute(
      `UPDATE CoWorkInvite
       SET status = 'cancelled', responded_date = UTC_TIMESTAMP()
       WHERE ${uuidCompareSql('inviter_user_id')}
         AND ${uuidCompareSql('invitee_user_id')}
         AND status = 'pending'
         AND (expires_date IS NULL OR expires_date >= UTC_TIMESTAMP())`,
      [req.user.sub, inviteeUserId]
    );

    const tenantSlug = parseTenantSlug(inviter.allowed_tenants || invitee.allowed_tenants);
    const roomName = buildCoworkRoomName(tenantSlug);
    const inviteId = crypto.randomUUID();

    await db.execute(
      `INSERT INTO CoWorkInvite (
        id, room_name, tenant_slug, inviter_user_id, invitee_user_id, status, expires_date
      ) VALUES (?, ?, ?, ?, ?, 'pending', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
      [inviteId, roomName, tenantSlug, req.user.sub, inviteeUserId, COWORK_INVITE_EXPIRY_MINUTES]
    );

    const token = createJitsiToken({ roomName, user: inviter });
    const expiresAt = Math.floor(Date.now() / 1000) + JITSI_JWT_EXPIRY_SECONDS;

    await broadcastCoworkUpdate({
      type: 'invite-created',
      actor: inviter,
      allowedTenants: inviter.allowed_tenants,
      includeUserIds: [inviter.id, invitee.id],
      invite: {
        id: inviteId,
        roomName,
        status: 'pending',
      },
    });

    res.status(201).json({
      invite: {
        id: inviteId,
        room_name: roomName,
        tenant_slug: tenantSlug,
        status: 'pending',
        expires_date: new Date(Date.now() + COWORK_INVITE_EXPIRY_MINUTES * 60 * 1000),
        invitee_name: invitee.full_name,
        invitee_email: invitee.email,
      },
      session: {
        inviteId,
        roomName,
        tenantSlug,
        token,
        expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cowork/invites/:inviteId/decline', authMiddleware, async (req, res, next) => {
  try {
    const { inviteId } = req.params;

    const [rows] = await db.execute(
      `SELECT ci.id, ci.inviter_user_id, ci.invitee_user_id, ci.status, ci.expires_date, ci.room_name
       FROM CoWorkInvite ci
       WHERE ${uuidCompareSql('ci.id')}`,
      [inviteId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Einladung nicht gefunden' });
    }

    const invite = rows[0];
    if (invite.invitee_user_id !== req.user.sub) {
      return res.status(403).json({ error: 'Nur der eingeladene Benutzer kann ablehnen' });
    }

    if (invite.status === 'expired') {
      return res.status(410).json({ error: 'Die Einladung ist bereits abgelaufen' });
    }

    await db.execute(
      `UPDATE CoWorkInvite
       SET status = 'declined', responded_date = UTC_TIMESTAMP()
       WHERE ${uuidCompareSql('id')}
         AND status = 'pending'
         AND (expires_date IS NULL OR expires_date >= UTC_TIMESTAMP())`,
      [inviteId]
    );

    const [userRows] = await db.execute(
      `SELECT id, email, allowed_tenants
       FROM app_users
       WHERE id = ? AND is_active = 1`,
      [req.user.sub]
    );

    if (userRows.length > 0) {
      await broadcastCoworkUpdate({
        type: 'invite-declined',
        actor: userRows[0],
        allowedTenants: userRows[0].allowed_tenants,
        includeUserIds: [invite.inviter_user_id, invite.invitee_user_id],
        invite: {
          id: inviteId,
          roomName: invite.room_name,
          status: 'declined',
        },
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/cowork/invites/:inviteId/cancel', authMiddleware, async (req, res, next) => {
  try {
    const { inviteId } = req.params;

    const [rows] = await db.execute(
      `SELECT ci.id, ci.inviter_user_id, ci.invitee_user_id, ci.status, ci.room_name,
              inviter.allowed_tenants AS inviter_allowed_tenants
       FROM CoWorkInvite ci
       INNER JOIN app_users inviter ON inviter.id COLLATE utf8mb4_unicode_ci = ci.inviter_user_id COLLATE utf8mb4_unicode_ci
       WHERE ${uuidCompareSql('ci.id')}`,
      [inviteId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Einladung nicht gefunden' });
    }

    const invite = rows[0];
    const isParticipant = invite.inviter_user_id === req.user.sub || invite.invitee_user_id === req.user.sub;
    if (!isParticipant) {
      return res.status(403).json({ error: 'Nur Teilnehmer dieser CoWork-Einladung koennen sie beenden' });
    }

    await db.execute(
      `UPDATE CoWorkInvite
       SET status = 'cancelled', responded_date = UTC_TIMESTAMP()
       WHERE ${uuidCompareSql('id')} AND status IN ('pending', 'accepted')`,
      [inviteId]
    );

    await broadcastCoworkUpdate({
      type: 'invite-cancelled',
      actor: { id: req.user.sub, email: req.user.email || null },
      allowedTenants: invite.inviter_allowed_tenants,
      includeUserIds: [invite.inviter_user_id, invite.invitee_user_id],
      invite: {
        id: inviteId,
        roomName: invite.room_name,
        status: 'cancelled',
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/cowork/session/:inviteId', authMiddleware, async (req, res, next) => {
  try {
    if (!JITSI_JWT_APP_ID || !JITSI_JWT_APP_SECRET || !JITSI_JWT_SUB) {
      return res.status(503).json({
        error: 'Jitsi JWT ist nicht vollständig konfiguriert. Bitte JITSI_JWT_APP_ID, JITSI_JWT_APP_SECRET und JITSI_JWT_SUB setzen.'
      });
    }

    await expireStaleCoworkInvites();

    const { inviteId } = req.params;
    const [inviteRows] = await db.execute(
      `SELECT ci.*, inviter.full_name AS inviter_name, inviter.email AS inviter_email,
              invitee.full_name AS invitee_name, invitee.email AS invitee_email
       FROM CoWorkInvite ci
       INNER JOIN app_users inviter ON inviter.id COLLATE utf8mb4_unicode_ci = ci.inviter_user_id COLLATE utf8mb4_unicode_ci
       INNER JOIN app_users invitee ON invitee.id COLLATE utf8mb4_unicode_ci = ci.invitee_user_id COLLATE utf8mb4_unicode_ci
       WHERE ${uuidCompareSql('ci.id')}`,
      [inviteId]
    );

    if (inviteRows.length === 0) {
      return res.status(404).json({ error: 'Einladung nicht gefunden' });
    }

    const invite = inviteRows[0];
    const isInviter = invite.inviter_user_id === req.user.sub;
    const isInvitee = invite.invitee_user_id === req.user.sub;

    if (!isInviter && !isInvitee) {
      return res.status(403).json({ error: 'Kein Zugriff auf diese Einladung' });
    }

    if (['declined', 'cancelled', 'expired'].includes(invite.status)) {
      return res.status(410).json({ error: 'Diese Einladung ist nicht mehr gueltig' });
    }

    if (invite.expires_date && new Date(invite.expires_date).getTime() < Date.now()) {
      await db.execute(
        `UPDATE CoWorkInvite SET status = 'expired', responded_date = UTC_TIMESTAMP() WHERE ${uuidCompareSql('id')}`,
        [inviteId]
      );
      return res.status(410).json({ error: 'Diese Einladung ist abgelaufen' });
    }

    const [userRows] = await db.execute(
      'SELECT id, email, full_name, role, allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    let inviteStatus = invite.status;
    if (isInvitee && invite.status === 'pending') {
      inviteStatus = 'accepted';
      await db.execute(
        `UPDATE CoWorkInvite
         SET status = 'accepted', responded_date = UTC_TIMESTAMP()
         WHERE ${uuidCompareSql('id')}`,
        [inviteId]
      );
    }

    await db.execute(
      'UPDATE app_users SET last_seen_at = NOW() WHERE id = ?',
      [req.user.sub]
    );

    await broadcastCoworkUpdate({
      type: inviteStatus === 'accepted' ? 'invite-accepted' : 'session-opened',
      actor: userRows[0],
      allowedTenants: userRows[0].allowed_tenants,
      includeUserIds: [invite.inviter_user_id, invite.invitee_user_id],
      invite: {
        id: inviteId,
        roomName: invite.room_name,
        status: inviteStatus,
      },
    });

    const token = createJitsiToken({ roomName: invite.room_name, user: userRows[0] });
    const expiresAt = Math.floor(Date.now() / 1000) + JITSI_JWT_EXPIRY_SECONDS;

    res.json({
      inviteId,
      roomName: invite.room_name,
      tenantSlug: invite.tenant_slug,
      token,
      expiresAt,
      inviteStatus,
      inviterName: invite.inviter_name,
      inviterEmail: invite.inviter_email,
      inviteeName: invite.invitee_name,
      inviteeEmail: invite.invitee_email,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
