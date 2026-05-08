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
import { getEmailProviderInfo, sendEmail } from '../utils/email.js';
import {
  computeQualificationEvidenceSummary,
  normalizeEvidenceRole,
  normalizeRequirementMode,
} from '../utils/qualificationEvidence.js';

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

function normalizeEvidenceRoleInput(value, qualification = null) {
  return normalizeEvidenceRole(value, normalizeRequirementMode(qualification?.certificate_requirement_mode));
}

async function getQualificationConfig(req, qualificationId) {
  if (!req.db || !qualificationId) return null;
  const [rows] = await req.db.execute(
    `SELECT id, name, description, requires_certificate,
            certificate_requirement_mode, certificate_validity_months,
            certificate_refresh_validity_months, certificate_base_label,
            certificate_refresh_label
       FROM Qualification
      WHERE id = ?
      LIMIT 1`,
    [qualificationId]
  );
  return rows[0] || null;
}

async function listQualificationCertificates({ tenantKey, doctorId, qualificationId }) {
  const [rows] = await db.execute(
    `SELECT id, evidence_role, granted_date, expiry_date, uploaded_at
       FROM QualificationCertificate
      WHERE tenant_key = ? AND doctor_id = ? AND qualification_id = ?
      ORDER BY uploaded_at ASC`,
    [tenantKey, doctorId, qualificationId]
  );
  return rows;
}

async function recomputeDoctorQualificationStatus({
  tenantDb,
  tenantKey,
  doctorId,
  qualificationId,
  doctorQualificationId = null,
  qualificationConfig = null,
}) {
  if (!tenantDb || !doctorId || !qualificationId) return null;

  const qualification = qualificationConfig || await getQualificationConfig({ db: tenantDb }, qualificationId);
  if (!qualification || qualification.requires_certificate !== 1 && qualification.requires_certificate !== true) {
    return null;
  }

  let targetDoctorQualificationId = doctorQualificationId || null;
  if (!targetDoctorQualificationId) {
    const [dqRows] = await tenantDb.execute(
      `SELECT id FROM DoctorQualification WHERE doctor_id = ? AND qualification_id = ? LIMIT 1`,
      [doctorId, qualificationId]
    );
    targetDoctorQualificationId = dqRows[0]?.id || null;
  }
  if (!targetDoctorQualificationId) return null;

  const certificates = await listQualificationCertificates({ tenantKey, doctorId, qualificationId });
  const summary = computeQualificationEvidenceSummary({
    qualification,
    certificates,
  });

  await tenantDb.execute(
    `UPDATE DoctorQualification
        SET granted_date = ?,
            expiry_date = ?,
            certificate_status = ?,
            certificate_valid_from = ?,
            certificate_valid_until = ?,
            certificate_status_reason = ?,
            updated_date = CURRENT_TIMESTAMP(3)
      WHERE id = ?`,
    [
      summary.valid_from,
      summary.valid_until,
      summary.status,
      summary.valid_from,
      summary.valid_until,
      summary.reason?.slice(0, 500) || null,
      targetDoctorQualificationId,
    ]
  );

  return summary;
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

function buildAppBaseUrl(req) {
  const configuredBase = (process.env.APP_URL || process.env.PUBLIC_APP_URL || '').trim();
  if (configuredBase) {
    return configuredBase.replace(/\/$/, '');
  }

  return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
}

function buildCertificateReminderLink(req, qualificationIds = []) {
  const url = new URL('/certificate-upload', buildAppBaseUrl(req));
  if (qualificationIds.length === 1) {
    url.searchParams.set('qualification_id', qualificationIds[0]);
  }
  if (req.dbToken) {
    url.searchParams.set('db_token', req.dbToken);
  }
  return url.toString();
}

function formatReminderStatusLabel({ hasCertificates, summary, validUntil }) {
  if (!hasCertificates) return 'kein Zertifikat hinterlegt';
  if (summary?.status === 'expired') {
    return validUntil ? `Nachweis abgelaufen seit ${validUntil}` : 'Nachweis abgelaufen';
  }
  if (summary?.status === 'incomplete') return 'Nachweise unvollstaendig';
  return 'Nachweis ungueltig';
}

function toIsoDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function diffIsoDaysFromToday(value) {
  const iso = toIsoDateOnly(value);
  if (!iso) return null;
  const today = new Date().toISOString().slice(0, 10);
  const targetMs = Date.parse(`${iso}T00:00:00.000Z`);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  return Math.round((targetMs - todayMs) / 86400000);
}

async function getReminderRecipientsForDoctor(doctorId) {
  const [rows] = await db.execute(
    `SELECT id, email, full_name, doctor_id
       FROM app_users
      WHERE is_active = 1
        AND doctor_id = ?
        AND email IS NOT NULL
        AND email != ''
      ORDER BY created_date ASC`,
    [doctorId]
  );
  return rows;
}

async function computeReminderQualificationEntry({ req, tenantKey, doctorId, qualificationId }) {
  const qualification = await getQualificationConfig(req, qualificationId);
  if (!qualification || (qualification.requires_certificate !== 1 && qualification.requires_certificate !== true)) {
    return null;
  }

  const [dqRows] = await req.db.execute(
    `SELECT id, certificate_status, certificate_valid_until, expiry_date
       FROM DoctorQualification
      WHERE doctor_id = ? AND qualification_id = ?
      LIMIT 1`,
    [doctorId, qualificationId]
  );
  const doctorQualification = dqRows[0] || null;
  if (!doctorQualification) {
    return null;
  }

  const certificates = await listQualificationCertificates({
    tenantKey,
    doctorId,
    qualificationId,
  });
  const summary = computeQualificationEvidenceSummary({
    qualification,
    certificates,
  });
  const hasCertificates = certificates.length > 0;
  const isPending = !hasCertificates || summary.status !== 'valid';

  if (!isPending) {
    return null;
  }

  const validUntil = summary.valid_until || doctorQualification.certificate_valid_until || doctorQualification.expiry_date || null;

  return {
    id: qualification.id,
    name: qualification.name,
    status: summary.status,
    reason: formatReminderStatusLabel({ hasCertificates, summary, validUntil }),
  };
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
      evidence_role,
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

  const qualificationConfig = await getQualificationConfig(req, qualification_id);
  const requirementMode = normalizeRequirementMode(qualificationConfig?.certificate_requirement_mode);
  const normalizedEvidenceRole = normalizeEvidenceRoleInput(evidence_role, qualificationConfig);

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

    if (requirementMode === 'base_refresh' && normalizedEvidenceRole === 'refresh') {
      const existingCertificates = await listQualificationCertificates({
        tenantKey,
        doctorId: doctor_id,
        qualificationId: qualification_id,
      });
      const hasBaseCertificate = existingCertificates.some((certificate) => ['base', 'recertification', 'single'].includes(normalizeEvidenceRoleInput(certificate.evidence_role, qualificationConfig)));
      if (!hasBaseCertificate) {
        return res.status(422).json({
          error: `${qualificationConfig?.certificate_base_label || 'Grundnachweis'} muss vor einer Verlängerung hochgeladen werden.`,
        });
      }
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO QualificationCertificate
         (id, tenant_key, doctor_id, qualification_id, doctor_qualification_id,
          evidence_role,
          file_name, mime_type, file_size, file_data,
          granted_date, expiry_date, notes, uploaded_by,
          analysis_status, analysis_is_certificate, analysis_scope_match,
          analysis_scope_detected, analysis_confidence, analysis_reasoning,
          analysis_detected_granted, analysis_detected_expiry, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        tenantKey,
        doctor_id,
        qualification_id,
        doctor_qualification_id || null,
        normalizedEvidenceRole,
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

    const summary = await recomputeDoctorQualificationStatus({
      tenantDb: req.db,
      tenantKey,
      doctorId: doctor_id,
      qualificationId: qualification_id,
      doctorQualificationId: doctor_qualification_id || null,
      qualificationConfig,
    });

    res.json({
      id,
      doctor_id,
      qualification_id,
      doctor_qualification_id: doctor_qualification_id || null,
      evidence_role: normalizedEvidenceRole,
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
      qualification_summary: summary,
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
              evidence_role,
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

    const conditions = ['tenant_key = ?'];
    const params = [tenantKey];

    if (req.user?.role !== 'admin') {
      if (!req.user?.doctor_id) return res.json([]);
      conditions.push('doctor_id = ?');
      params.push(req.user.doctor_id);
    }

    const [certificates] = await db.execute(
      `SELECT id, doctor_id, qualification_id, doctor_qualification_id,
              evidence_role, file_name, granted_date, expiry_date, uploaded_at
         FROM QualificationCertificate
        WHERE ${conditions.join(' AND ')}
        ORDER BY doctor_id ASC, qualification_id ASC, uploaded_at ASC`,
      params
    );

    if (!certificates.length) {
      return res.json([]);
    }

    const qualificationIds = Array.from(new Set(certificates.map((certificate) => certificate.qualification_id).filter(Boolean)));
    if (!qualificationIds.length) {
      return res.json([]);
    }

    const placeholders = qualificationIds.map(() => '?').join(', ');
    const [qualificationRows] = await req.db.execute(
      `SELECT id, name, description, requires_certificate,
              certificate_requirement_mode, certificate_validity_months,
              certificate_refresh_validity_months, certificate_base_label,
              certificate_refresh_label
         FROM Qualification
        WHERE id IN (${placeholders})`,
      qualificationIds
    );
    const qualificationById = new Map(qualificationRows.map((qualification) => [qualification.id, qualification]));
    const certificateById = new Map(certificates.map((certificate) => [certificate.id, certificate]));

    const grouped = new Map();
    for (const certificate of certificates) {
      const key = `${certificate.doctor_id}::${certificate.qualification_id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(certificate);
    }

    const rows = [];
    for (const groupCertificates of grouped.values()) {
      const firstCertificate = groupCertificates[0];
      const qualification = qualificationById.get(firstCertificate.qualification_id);
      if (!qualification || (qualification.requires_certificate !== 1 && qualification.requires_certificate !== true)) {
        continue;
      }

      const summary = computeQualificationEvidenceSummary({
        qualification,
        certificates: groupCertificates,
      });
      const validUntil = toIsoDateOnly(summary.valid_until);
      const daysUntilExpiry = diffIsoDaysFromToday(validUntil);
      if (!Number.isFinite(daysUntilExpiry) || daysUntilExpiry > days) {
        continue;
      }

      const activeIds = Array.isArray(summary.active_certificate_ids) ? summary.active_certificate_ids : [];
      const representativeCertificate = certificateById.get(activeIds[activeIds.length - 1]) || groupCertificates[groupCertificates.length - 1];
      rows.push({
        id: representativeCertificate.id,
        doctor_id: firstCertificate.doctor_id,
        qualification_id: firstCertificate.qualification_id,
        doctor_qualification_id: representativeCertificate.doctor_qualification_id || null,
        evidence_role: representativeCertificate.evidence_role,
        file_name: representativeCertificate.file_name,
        granted_date: representativeCertificate.granted_date,
        expiry_date: validUntil,
        uploaded_at: representativeCertificate.uploaded_at,
        days_until_expiry: daysUntilExpiry,
        certificate_status: summary.status,
        certificate_status_reason: summary.reason,
      });
    }

    rows.sort((left, right) => {
      if (left.days_until_expiry !== right.days_until_expiry) {
        return left.days_until_expiry - right.days_until_expiry;
      }
      return String(left.qualification_id).localeCompare(String(right.qualification_id));
    });

    return res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ============ POST /api/certificates/reminders/send ============
// Body: { recipients: [{ doctor_id, qualification_ids: [] }] }
router.post('/reminders/send', express.json(), async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren duerfen Erinnerungen senden' });
    }

    if (!getEmailProviderInfo().configured) {
      return res.status(503).json({
        error: 'E-Mail nicht konfiguriert. Bitte BREVO_API_KEY oder SMTP_HOST + SMTP_USER + SMTP_PASS setzen.',
      });
    }

    const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'Mindestens ein Empfaenger ist erforderlich' });
    }

    const tenantKey = getTenantKey(req);
    const results = [];
    let sentCount = 0;

    for (const recipient of recipients) {
      const doctorId = recipient?.doctor_id;
      const requestedQualificationIds = Array.isArray(recipient?.qualification_ids)
        ? Array.from(new Set(recipient.qualification_ids.filter(Boolean)))
        : [];

      if (!doctorId || requestedQualificationIds.length === 0) {
        results.push({ doctor_id: doctorId || null, status: 'skipped', reason: 'Fehlende Pflichtdaten' });
        continue;
      }

      const [doctorRows] = await req.db.execute(
        `SELECT id, name, central_employee_id
           FROM Doctor
          WHERE id = ?
          LIMIT 1`,
        [doctorId]
      );
      const doctor = doctorRows[0] || null;
      if (!doctor) {
        results.push({ doctor_id: doctorId, status: 'skipped', reason: 'Mitarbeiter nicht gefunden' });
        continue;
      }

      if (!doctor.central_employee_id) {
        results.push({ doctor_id: doctorId, doctor_name: doctor.name, status: 'skipped', reason: 'Keine Verknuepfung zur zentralen Datenbank' });
        continue;
      }

      const linkedUsers = await getReminderRecipientsForDoctor(doctorId);
      if (linkedUsers.length === 0) {
        results.push({ doctor_id: doctorId, doctor_name: doctor.name, status: 'skipped', reason: 'Kein aktiver Benutzer mit regularem Login verknuepft' });
        continue;
      }

      const pendingQualifications = [];
      for (const qualificationId of requestedQualificationIds) {
        const entry = await computeReminderQualificationEntry({
          req,
          tenantKey,
          doctorId,
          qualificationId,
        });
        if (entry) {
          pendingQualifications.push(entry);
        }
      }

      if (pendingQualifications.length === 0) {
        results.push({ doctor_id: doctorId, doctor_name: doctor.name, status: 'skipped', reason: 'Keine offenen oder ungueltigen Nachweise mehr' });
        continue;
      }

      const reminderLink = buildCertificateReminderLink(req, pendingQualifications.map((item) => item.id));
      const qualificationLines = pendingQualifications
        .map((item) => `<li><strong>${item.name}</strong>: ${item.reason}</li>`)
        .join('');
      const plainQualificationLines = pendingQualifications
        .map((item) => `- ${item.name}: ${item.reason}`)
        .join('\n');

      for (const linkedUser of linkedUsers) {
        await sendEmail({
          to: linkedUser.email,
          subject: 'CuraFlow: Zertifikatsnachweise hochladen',
          text: [
            `Hallo ${linkedUser.full_name || doctor.name},`,
            '',
            'fuer folgende Qualifikationen fehlt ein gueltiger Nachweis oder er ist ungueltig:',
            plainQualificationLines,
            '',
            `Bitte melden Sie sich ueber diesen Link an und laden Sie die Nachweise hoch: ${reminderLink}`,
            '',
            'Der Link fuehrt in Ihren persoenlichen Upload-Bereich in CuraFlow.',
          ].join('\n'),
          html: `
            <p>Hallo ${linkedUser.full_name || doctor.name},</p>
            <p>fuer folgende Qualifikationen fehlt ein gueltiger Nachweis oder er ist ungueltig:</p>
            <ul>${qualificationLines}</ul>
            <p>
              <a href="${reminderLink}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;">
                Nachweise in CuraFlow hochladen
              </a>
            </p>
            <p>Der Link fuehrt in Ihren persoenlichen Upload-Bereich in CuraFlow.</p>
          `,
        });
        sentCount += 1;
      }

      results.push({
        doctor_id: doctorId,
        doctor_name: doctor.name,
        status: 'sent',
        sent_to: linkedUsers.map((user) => user.email),
        qualification_ids: pendingQualifications.map((item) => item.id),
      });
    }

    res.json({
      success: true,
      sent_count: sentCount,
      results,
    });
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
      `SELECT doctor_id, qualification_id, doctor_qualification_id FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }
    ensureCanAccessDoctor(req, rows[0].doctor_id);

    const qualificationConfig = await getQualificationConfig(req, rows[0].qualification_id);
    const { granted_date, expiry_date, notes, evidence_role } = req.body || {};
    await db.execute(
      `UPDATE QualificationCertificate
          SET granted_date = ?, expiry_date = ?, notes = ?, evidence_role = ?
        WHERE id = ? AND tenant_key = ?`,
      [
        normalizeDateInput(granted_date),
        normalizeDateInput(expiry_date),
        notes ? String(notes).slice(0, 500) : null,
        normalizeEvidenceRoleInput(evidence_role, qualificationConfig),
        id,
        tenantKey,
      ]
    );
    const summary = await recomputeDoctorQualificationStatus({
      tenantDb: req.db,
      tenantKey,
      doctorId: rows[0].doctor_id,
      qualificationId: rows[0].qualification_id,
      doctorQualificationId: rows[0].doctor_qualification_id || null,
      qualificationConfig,
    });
    res.json({ ok: true, qualification_summary: summary });
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
      `SELECT doctor_id, qualification_id, doctor_qualification_id FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }
    ensureCanAccessDoctor(req, rows[0].doctor_id);

    const qualificationConfig = await getQualificationConfig(req, rows[0].qualification_id);

    await db.execute(
      `DELETE FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    const summary = await recomputeDoctorQualificationStatus({
      tenantDb: req.db,
      tenantKey,
      doctorId: rows[0].doctor_id,
      qualificationId: rows[0].qualification_id,
      doctorQualificationId: rows[0].doctor_qualification_id || null,
      qualificationConfig,
    });
    res.json({ ok: true, qualification_summary: summary });
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
