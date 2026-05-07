/**
 * Qualification Certificate Routes
 *
 * Speichert/liefert Zertifikate (PDF/JPEG/PNG) für Qualifikationen, die einen
 * Nachweis erfordern (z.B. Strahlenschutz, Notfallmedizin).
 *
 * Speicherort: zentrale Master-DB in Tabelle `QualificationCertificate`.
 * Mandantentrennung: `tenant_key = sha256(host:database)` aus dem
 * X-DB-Token Header (per `tenantDbMiddleware` in req.dbToken bereitgestellt).
 *
 * Berechtigungen:
 *  - Admins (req.user.role === 'admin'): Lese-/Schreibzugriff auf alle Mitarbeiter
 *    des aktuellen Mandanten.
 *  - Sonstige User: ausschließlich Zugriff auf den eigenen `req.user.doctor_id`.
 */

import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { db } from '../index.js';
import { authMiddleware } from './auth.js';
import { parseDbToken } from '../utils/crypto.js';
import { analyzeCertificate, isAnalyzerConfigured } from '../utils/certificateAnalyzer.js';

const router = express.Router();
router.use(authMiddleware);

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ANALYSIS_TOKEN_TTL_MS = 15 * 60 * 1000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has((file.mimetype || '').toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Dateityp nicht erlaubt. Erlaubt: PDF, JPEG, PNG.'));
    }
  },
});

function getTenantKey(req) {
  const token = req.dbToken;
  if (!token) return 'default';
  try {
    const cfg = parseDbToken(token);
    if (!cfg?.host || !cfg?.database) return 'default';
    return crypto
      .createHash('sha256')
      .update(`${cfg.host}:${cfg.database}`)
      .digest('hex');
  } catch {
    return 'default';
  }
}

function ensureCanAccessDoctor(req, doctorId) {
  if (req.user?.role === 'admin') return;
  if (req.user?.doctor_id && req.user.doctor_id === doctorId) return;
  const err = new Error('Kein Zugriff auf diese Zertifikate');
  err.status = 403;
  throw err;
}

function normalizeDateInput(value) {
  if (!value) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Accept YYYY-MM-DD only (HTML date input format).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getAnalysisSigningSecret() {
  return process.env.JWT_SECRET || process.env.AUTH_SECRET || 'curaflow-certificate-analysis-dev';
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function createAnalysisApprovalToken(payload) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', getAnalysisSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyAnalysisApprovalToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [encodedPayload, signature] = token.split('.');
  const expected = crypto
    .createHmac('sha256', getAnalysisSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
  if (signature !== expected) {
    return null;
  }
  try {
    return JSON.parse(decodeBase64Url(encodedPayload));
  } catch {
    return null;
  }
}

function buildApprovedAnalysisPayload({ result, buffer, mimeType, qualificationName, qualificationDescription }) {
  const now = Date.now();
  return {
    file_hash: sha256Buffer(buffer),
    mime_type: mimeType,
    qualification_name: qualificationName,
    qualification_description: qualificationDescription || '',
    status: result.status,
    is_certificate: result.is_certificate,
    scope_match: result.scope_match,
    scope_detected: result.scope_detected,
    confidence: result.confidence,
    reasoning: result.reasoning || result.error || null,
    granted_date: result.granted_date,
    expiry_date: result.expiry_date,
    iat: now,
    exp: now + ANALYSIS_TOKEN_TTL_MS,
  };
}

function extractPersistedAnalysisFields(payload) {
  return {
    analysis_status: payload?.status || 'error',
    analysis_is_certificate: payload?.is_certificate === null ? null : (payload?.is_certificate ? 1 : 0),
    analysis_scope_match: payload?.scope_match === null ? null : (payload?.scope_match ? 1 : 0),
    analysis_scope_detected: payload?.scope_detected || null,
    analysis_confidence: typeof payload?.confidence === 'number' ? payload.confidence : null,
    analysis_reasoning: payload?.reasoning || null,
    analysis_detected_granted: normalizeDateInput(payload?.granted_date),
    analysis_detected_expiry: normalizeDateInput(payload?.expiry_date),
  };
}

function isApprovedPayloadValidForUpload({ payload, buffer, mimeType, qualificationName, qualificationDescription }) {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.exp || payload.exp < Date.now()) return false;
  if (payload.file_hash !== sha256Buffer(buffer)) return false;
  if (payload.mime_type !== mimeType) return false;
  if (payload.qualification_name !== qualificationName) return false;
  if ((payload.qualification_description || '') !== (qualificationDescription || '')) return false;
  if (payload.status !== 'passed') return false;
  if (payload.is_certificate !== true) return false;
  if (payload.scope_match !== true) return false;
  return true;
}

/**
 * Führt die LLM-Analyse asynchron im Hintergrund aus und schreibt das
 * Ergebnis in die Tabelle. Fehler werden geloggt, brechen den Upload-Flow
 * aber nicht ab (der Upload selbst war ja bereits erfolgreich).
 */
async function runAnalysisAndPersist({
  certificateId,
  tenantKey,
  buffer,
  mimeType,
  qualificationName,
  qualificationDescription,
  fillDatesIfMissing,
}) {
  console.info('[certificates] Starte Analyse', { certificateId, qualificationName, mimeType, size: buffer?.length });
  try {
    const result = await analyzeCertificate({
      buffer,
      mimeType,
      qualificationName,
      qualificationDescription,
    });

    console.info('[certificates] Analyse abgeschlossen', {
      certificateId,
      status: result.status,
      is_certificate: result.is_certificate,
      scope_match: result.scope_match,
      reasoning: result.reasoning?.slice(0, 200),
      error: result.error,
    });

    const fields = [
      'analysis_status = ?',
      'analysis_is_certificate = ?',
      'analysis_scope_match = ?',
      'analysis_scope_detected = ?',
      'analysis_confidence = ?',
      'analysis_reasoning = ?',
      'analysis_detected_granted = ?',
      'analysis_detected_expiry = ?',
      'analyzed_at = NOW()',
    ];
    const params = [
      result.status,
      result.is_certificate === null ? null : (result.is_certificate ? 1 : 0),
      result.scope_match === null ? null : (result.scope_match ? 1 : 0),
      result.scope_detected,
      result.confidence,
      result.reasoning || result.error,
      result.granted_date,
      result.expiry_date,
    ];

    if (fillDatesIfMissing) {
      if (result.granted_date) {
        fields.push('granted_date = COALESCE(granted_date, ?)');
        params.push(result.granted_date);
      }
      if (result.expiry_date) {
        fields.push('expiry_date = COALESCE(expiry_date, ?)');
        params.push(result.expiry_date);
      }
    }

    params.push(certificateId, tenantKey);

    await db.execute(
      `UPDATE QualificationCertificate
          SET ${fields.join(', ')}
        WHERE id = ? AND tenant_key = ?`,
      params
    );
  } catch (err) {
    console.error('[certificates] LLM-Analyse fehlgeschlagen', err);
    try {
      await db.execute(
        `UPDATE QualificationCertificate
            SET analysis_status = 'error',
                analysis_reasoning = ?,
                analyzed_at = NOW()
          WHERE id = ? AND tenant_key = ?`,
        [err.message?.slice(0, 1000) || 'Unbekannter Fehler', certificateId, tenantKey]
      );
    } catch (innerErr) {
      console.error('[certificates] Konnte Fehler-Status nicht persistieren', innerErr);
    }
  }
}

// ============ POST /api/certificates/check ============
// multipart/form-data: file + qualification_name + qualification_description?
// Führt OCR/LLM synchron aus und liefert erkannte Daten zurück. Nur wenn der
// Scope passt, wird ein signiertes approval_token für den späteren Upload
// ausgegeben.
router.post('/check', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei angegeben' });
    }
    if (!isAnalyzerConfigured()) {
      return res.status(503).json({ error: 'LLM nicht konfiguriert' });
    }

    const { qualification_name, qualification_description } = req.body || {};
    if (!qualification_name) {
      return res.status(400).json({ error: 'qualification_name erforderlich' });
    }

    const result = await analyzeCertificate({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      qualificationName: qualification_name,
      qualificationDescription: qualification_description,
    });

    const approved = result.status === 'passed' && result.is_certificate === true && result.scope_match === true;
    const approvalPayload = approved
      ? buildApprovedAnalysisPayload({
          result,
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          qualificationName: qualification_name,
          qualificationDescription: qualification_description,
        })
      : null;

    res.json({
      ok: true,
      upload_allowed: approved,
      approval_token: approvalPayload ? createAnalysisApprovalToken(approvalPayload) : null,
      analysis: {
        status: result.status,
        is_certificate: result.is_certificate,
        scope_match: result.scope_match,
        scope_detected: result.scope_detected,
        confidence: result.confidence,
        reasoning: result.reasoning || result.error || null,
        detected_granted_date: result.granted_date,
        detected_expiry_date: result.expiry_date,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============ POST /api/certificates/upload ============
// multipart/form-data: file + doctor_id, qualification_id, granted_date?, expiry_date?, notes?, doctor_qualification_id?
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei angegeben' });
    }
    const tenantKey = getTenantKey(req);
    const {
      doctor_id,
      qualification_id,
      doctor_qualification_id,
      granted_date,
      expiry_date,
      notes,
      approval_token,
      qualification_name,
      qualification_description,
    } = req.body || {};

    if (!doctor_id || !qualification_id) {
      return res
        .status(400)
        .json({ error: 'doctor_id und qualification_id sind erforderlich' });
    }

    ensureCanAccessDoctor(req, doctor_id);

    let approvedAnalysis = null;
    if (isAnalyzerConfigured()) {
      if (!qualification_name) {
        return res.status(400).json({ error: 'qualification_name ist für die automatische Prüfung erforderlich' });
      }
      approvedAnalysis = verifyAnalysisApprovalToken(approval_token);
      if (!isApprovedPayloadValidForUpload({
        payload: approvedAnalysis,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        qualificationName: qualification_name,
        qualificationDescription: qualification_description,
      })) {
        return res.status(422).json({
          error: 'Upload verweigert: Dokument muss unmittelbar vor dem Upload erfolgreich geprüft werden und im Scope passen.',
        });
      }
    }

    const approvedFields = extractPersistedAnalysisFields(approvedAnalysis);
    const finalGrantedDate = normalizeDateInput(granted_date) || approvedFields.analysis_detected_granted || null;
    const finalExpiryDate = normalizeDateInput(expiry_date) || approvedFields.analysis_detected_expiry || null;

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO QualificationCertificate
         (id, tenant_key, doctor_id, qualification_id, doctor_qualification_id,
          file_name, mime_type, file_size, file_data,
          granted_date, expiry_date, notes, uploaded_by,
          analysis_status, analysis_is_certificate, analysis_scope_match,
          analysis_scope_detected, analysis_confidence, analysis_reasoning,
          analysis_detected_granted, analysis_detected_expiry, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        tenantKey,
        doctor_id,
        qualification_id,
        doctor_qualification_id || null,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.buffer,
        finalGrantedDate,
        finalExpiryDate,
        notes ? String(notes).slice(0, 500) : null,
        req.user?.sub || null,
        approvedAnalysis ? approvedFields.analysis_status : 'skipped',
        approvedAnalysis ? approvedFields.analysis_is_certificate : null,
        approvedAnalysis ? approvedFields.analysis_scope_match : null,
        approvedAnalysis ? approvedFields.analysis_scope_detected : null,
        approvedAnalysis ? approvedFields.analysis_confidence : null,
        approvedAnalysis ? approvedFields.analysis_reasoning : null,
        approvedAnalysis ? approvedFields.analysis_detected_granted : null,
        approvedAnalysis ? approvedFields.analysis_detected_expiry : null,
      ]
    );

    res.json({
      id,
      doctor_id,
      qualification_id,
      doctor_qualification_id: doctor_qualification_id || null,
      file_name: req.file.originalname,
      mime_type: req.file.mimetype,
      file_size: req.file.size,
      granted_date: finalGrantedDate,
      expiry_date: finalExpiryDate,
      notes: notes || null,
      uploaded_by: req.user?.sub || null,
      uploaded_at: new Date().toISOString(),
      analysis_status: approvedAnalysis ? approvedFields.analysis_status : 'skipped',
      analysis_is_certificate: approvedAnalysis ? approvedAnalysis.is_certificate : null,
      analysis_scope_match: approvedAnalysis ? approvedAnalysis.scope_match : null,
      analysis_scope_detected: approvedAnalysis ? approvedAnalysis.scope_detected : null,
      analysis_confidence: approvedAnalysis ? approvedAnalysis.confidence : null,
      analysis_reasoning: approvedAnalysis ? approvedAnalysis.reasoning : null,
      analysis_detected_granted: approvedAnalysis ? approvedAnalysis.granted_date : null,
      analysis_detected_expiry: approvedAnalysis ? approvedAnalysis.expiry_date : null,
    });
  } catch (err) {
    next(err);
  }
});

// ============ GET /api/certificates ============
// Query: doctor_id?, qualification_id?
// Liefert Metadaten ohne Dateiinhalt.
router.get('/', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const { doctor_id, qualification_id } = req.query;

    let effectiveDoctorId = doctor_id || null;
    if (req.user?.role !== 'admin') {
      if (!req.user?.doctor_id) return res.json([]);
      effectiveDoctorId = req.user.doctor_id;
    }

    const conditions = ['tenant_key = ?'];
    const params = [tenantKey];
    if (effectiveDoctorId) {
      conditions.push('doctor_id = ?');
      params.push(effectiveDoctorId);
    }
    if (qualification_id) {
      conditions.push('qualification_id = ?');
      params.push(qualification_id);
    }

    const [rows] = await db.execute(
      `SELECT id, doctor_id, qualification_id, doctor_qualification_id,
              file_name, mime_type, file_size,
              granted_date, expiry_date, notes,
              uploaded_by, uploaded_at, updated_at,
              analysis_status, analysis_is_certificate, analysis_scope_match,
              analysis_scope_detected, analysis_confidence, analysis_reasoning,
              analysis_detected_granted, analysis_detected_expiry, analyzed_at
         FROM QualificationCertificate
        WHERE ${conditions.join(' AND ')}
        ORDER BY uploaded_at DESC`,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ============ GET /api/certificates/expiring ============
// Query: days? (default 60, max 365)
router.get('/expiring', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const requested = parseInt(req.query.days, 10);
    const days = Math.min(Math.max(Number.isFinite(requested) ? requested : 60, 1), 365);

    const conditions = [
      'tenant_key = ?',
      'expiry_date IS NOT NULL',
      'expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)',
    ];
    const params = [tenantKey, days];

    if (req.user?.role !== 'admin') {
      if (!req.user?.doctor_id) return res.json([]);
      conditions.push('doctor_id = ?');
      params.push(req.user.doctor_id);
    }

    const [rows] = await db.execute(
      `SELECT id, doctor_id, qualification_id, file_name,
              granted_date, expiry_date, uploaded_at,
              DATEDIFF(expiry_date, CURDATE()) AS days_until_expiry
         FROM QualificationCertificate
        WHERE ${conditions.join(' AND ')}
        ORDER BY expiry_date ASC`,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ============ PATCH /api/certificates/:id ============
// Aktualisiert nur Datum/Notiz, nicht den Dateiinhalt.
router.patch('/:id', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT doctor_id FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }
    ensureCanAccessDoctor(req, rows[0].doctor_id);

    const { granted_date, expiry_date, notes } = req.body || {};
    await db.execute(
      `UPDATE QualificationCertificate
          SET granted_date = ?, expiry_date = ?, notes = ?
        WHERE id = ? AND tenant_key = ?`,
      [
        normalizeDateInput(granted_date),
        normalizeDateInput(expiry_date),
        notes ? String(notes).slice(0, 500) : null,
        id,
        tenantKey,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ============ GET /api/certificates/:id/download ============
router.get('/:id/download', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT doctor_id, file_name, mime_type, file_data
         FROM QualificationCertificate
        WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }
    ensureCanAccessDoctor(req, rows[0].doctor_id);

    const safeName = String(rows[0].file_name || 'zertifikat')
      .replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Type', rows[0].mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(safeName)}"`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(rows[0].file_data);
  } catch (err) {
    next(err);
  }
});

// ============ POST /api/certificates/:id/analyze ============
// Erneute LLM-Analyse für ein bereits hochgeladenes Zertifikat anstoßen.
router.post('/:id/analyze', express.json(), async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const { id } = req.params;
    const { qualification_name, qualification_description } = req.body || {};

    const [rows] = await db.execute(
      `SELECT doctor_id, mime_type, file_data
         FROM QualificationCertificate
        WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }
    ensureCanAccessDoctor(req, rows[0].doctor_id);

    if (!isAnalyzerConfigured()) {
      return res.status(503).json({ error: 'Vision-LLM nicht konfiguriert' });
    }
    if (!qualification_name) {
      return res.status(400).json({ error: 'qualification_name erforderlich' });
    }

    await db.execute(
      `UPDATE QualificationCertificate SET analysis_status = 'pending' WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );

    runAnalysisAndPersist({
      certificateId: id,
      tenantKey,
      buffer: rows[0].file_data,
      mimeType: rows[0].mime_type,
      qualificationName: qualification_name,
      qualificationDescription: qualification_description,
      fillDatesIfMissing: false,
    });

    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// ============ DELETE /api/certificates/:id ============
router.delete('/:id', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT doctor_id FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }
    ensureCanAccessDoctor(req, rows[0].doctor_id);

    await db.execute(
      `DELETE FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Multer-spezifische Fehlerbehandlung
router.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Datei zu groß (max. 5 MB).' });
  }
  if (err.message && /Dateityp nicht erlaubt/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

export default router;
