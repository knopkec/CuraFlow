import express from 'express';
import crypto from 'crypto';
import ical from 'ical-generator';
import { db } from '../index.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import { sendEmail, getTransporter, getEmailProviderInfo } from '../utils/email.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';
import { resolveEmployeeTargetWeeklyHours } from '../utils/masterEmployeeWorkSettings.js';

const router = express.Router();
router.use(authMiddleware);

function requireAdminRole(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    return false;
  }
  return true;
}

// ===== GET STAFF LIST =====
router.get('/', async (req, res, next) => {
  try {
    const dbPool = req.db || db;
    const [rows] = await dbPool.execute('SELECT * FROM Doctor ORDER BY name');
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/central-employees', async (req, res, next) => {
  try {
    const tenantId = await resolveTenantIdFromToken(db, req.dbToken);
    if (!tenantId) {
      return res.status(400).json({ error: 'Aktiver Mandant konnte nicht aufgelöst werden' });
    }

    const [rows] = await db.execute(
      `SELECT e.id, e.first_name, e.last_name, e.target_hours_per_week, e.work_time_model_id,
              wtm.name AS work_time_model_name,
              wtm.hours_per_week AS model_hours_per_week,
              eta.tenant_doctor_id
         FROM Employee e
         LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
         LEFT JOIN EmployeeTenantAssignment eta
           ON eta.employee_id COLLATE utf8mb4_general_ci = e.id COLLATE utf8mb4_general_ci
          AND eta.tenant_id = ?
        WHERE e.is_active = 1
        ORDER BY e.last_name ASC, e.first_name ASC`,
      [tenantId]
    );

    res.json({
      employees: rows.map((row) => ({
        ...row,
        target_hours_per_week: resolveEmployeeTargetWeeklyHours(row),
        is_linked_to_current_tenant: !!row.tenant_doctor_id,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/central-link', async (req, res, next) => {
  try {
    if (!requireAdminRole(req, res)) {
      return;
    }

    const tenantId = await resolveTenantIdFromToken(db, req.dbToken);
    if (!tenantId) {
      return res.status(400).json({ error: 'Aktiver Mandant konnte nicht aufgelöst werden' });
    }

    const dbPool = req.db || db;
    const { employee_id, doctor_id } = req.body || {};

    if (!employee_id || !doctor_id) {
      return res.status(400).json({ error: 'employee_id und doctor_id sind erforderlich' });
    }

    const [employeeRows] = await db.execute(
      `SELECT e.id, e.target_hours_per_week, e.work_time_model_id, wtm.hours_per_week AS model_hours_per_week
         FROM Employee e
         LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
        WHERE e.id = ? AND e.is_active = 1`,
      [employee_id]
    );
    if (employeeRows.length === 0) {
      return res.status(404).json({ error: 'Zentraler Mitarbeiter nicht gefunden' });
    }

    const employee = employeeRows[0];
    const resolvedWeeklyHours = resolveEmployeeTargetWeeklyHours(employee);

    const [doctorRows] = await dbPool.execute('SELECT id FROM Doctor WHERE id = ? LIMIT 1', [doctor_id]);
    if (doctorRows.length === 0) {
      return res.status(404).json({ error: 'Teammitglied nicht gefunden' });
    }

    await dbPool.execute(
      'UPDATE Doctor SET central_employee_id = ?, target_weekly_hours = ?, work_time_model_id = ? WHERE id = ?',
      [employee_id, resolvedWeeklyHours, employee.work_time_model_id || null, doctor_id]
    );

    await db.execute(
      'DELETE FROM EmployeeTenantAssignment WHERE tenant_id = ? AND tenant_doctor_id = ? AND employee_id != ?',
      [tenantId, doctor_id, employee_id]
    );

    const [existingAssign] = await db.execute(
      'SELECT id FROM EmployeeTenantAssignment WHERE employee_id = ? AND tenant_id = ? LIMIT 1',
      [employee_id, tenantId]
    );
    if (existingAssign.length > 0) {
      await db.execute(
        'UPDATE EmployeeTenantAssignment SET tenant_doctor_id = ? WHERE id = ?',
        [doctor_id, existingAssign[0].id]
      );
    } else {
      await db.execute(
        `INSERT INTO EmployeeTenantAssignment (id, employee_id, tenant_id, tenant_doctor_id, fte_share, is_primary, assigned_since)
         VALUES (?, ?, ?, ?, 1.00, FALSE, CURDATE())`,
        [crypto.randomUUID(), employee_id, tenantId, doctor_id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/central-unlink', async (req, res, next) => {
  try {
    if (!requireAdminRole(req, res)) {
      return;
    }

    const tenantId = await resolveTenantIdFromToken(db, req.dbToken);
    if (!tenantId) {
      return res.status(400).json({ error: 'Aktiver Mandant konnte nicht aufgelöst werden' });
    }

    const dbPool = req.db || db;
    const { doctor_id } = req.body || {};

    if (!doctor_id) {
      return res.status(400).json({ error: 'doctor_id ist erforderlich' });
    }

    await dbPool.execute(
      'UPDATE Doctor SET central_employee_id = NULL WHERE id = ?',
      [doctor_id]
    );

    await db.execute(
      'DELETE FROM EmployeeTenantAssignment WHERE tenant_id = ? AND tenant_doctor_id = ?',
      [tenantId, doctor_id]
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ===== NOTIFY STAFF =====
router.post('/notify', async (req, res, next) => {
  try {
    const { staffIds, message, type } = req.body;
    
    if (!staffIds || !message) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    console.log(`Sending ${type} notification to ${staffIds.length} staff members`);
    res.json({ success: true, notified: staffIds.length });
  } catch (error) {
    next(error);
  }
});

// ===== SEND GENERIC EMAIL (replaces base44.integrations.Core.SendEmail) =====
router.post('/send-email', async (req, res, next) => {
  try {
    const { to, subject, body: textBody, html } = req.body;

    if (!to || !subject) {
      return res.status(400).json({ error: 'Empfänger (to) und Betreff (subject) erforderlich' });
    }

    // Check email configuration (Brevo or SMTP)
    if (!getEmailProviderInfo().configured) {
      return res.status(503).json({ 
        error: 'E-Mail nicht konfiguriert. Bitte BREVO_API_KEY oder SMTP_HOST + SMTP_USER + SMTP_PASS setzen.' 
      });
    }

    await sendEmail({
      to,
      subject,
      text: textBody,
      html,
    });

    res.json({ success: true, message: `E-Mail an ${to} gesendet` });
  } catch (error) {
    console.error('[send-email] Fehler:', error.message);
    next(error);
  }
});

// ===== SEND TEST EMAIL =====
router.post('/send-test-email', async (req, res, next) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: 'Empfänger (to) erforderlich' });
    }

    const providerInfo = getEmailProviderInfo();
    if (!providerInfo.configured) {
      return res.status(503).json({ 
        error: 'E-Mail nicht konfiguriert. Bitte BREVO_API_KEY oder SMTP_HOST + SMTP_USER + SMTP_PASS setzen.' 
      });
    }

    await sendEmail({
      to,
      subject: 'CuraFlow Testmail',
      text: 'Dies ist eine Testnachricht von CuraFlow. Wenn Sie diese E-Mail erhalten, funktioniert der E-Mail-Versand korrekt.',
      html: '<h2>CuraFlow Testmail</h2><p>Dies ist eine Testnachricht von CuraFlow.</p><p>Wenn Sie diese E-Mail erhalten, funktioniert der E-Mail-Versand korrekt.</p><hr><p style="color:#888;font-size:12px">Provider: ' + providerInfo.provider + ' | Absender: ' + providerInfo.from + '</p>',
    });

    res.json({ success: true, message: `Testmail an ${to} gesendet`, provider: providerInfo.provider });
  } catch (error) {
    console.error('[send-test-email] Fehler:', error.message);
    next(error);
  }
});

// ===== SEND SCHEDULE NOTIFICATIONS (replaces sendShiftEmails function) =====
router.post('/schedule-notifications', async (req, res, next) => {
  try {
    const { year, month } = req.body;
    const dbPool = req.db || db;

    // Check email configuration (Brevo or SMTP)
    if (!getEmailProviderInfo().configured) {
      return res.status(503).json({ 
        error: 'E-Mail nicht konfiguriert. Bitte BREVO_API_KEY oder SMTP_HOST + SMTP_USER + SMTP_PASS setzen.' 
      });
    }

    // 1. Fetch doctors with email
    // Dienstplan-Kalender-Emails gehen an die Kalender-E-Mail-Adresse (google_email)
    const [doctors] = await dbPool.execute("SELECT * FROM Doctor WHERE google_email IS NOT NULL AND google_email != ''");
    if (doctors.length === 0) {
      return res.json({ success: true, count: 0, message: 'Keine Ärzte mit E-Mail gefunden', errors: [], debug: [] });
    }

    // 2. Fetch workplaces (service category)
    const [workplaces] = await dbPool.execute("SELECT * FROM Workplace");
    const serviceNames = workplaces
      .filter(w => w.category === 'Dienste')
      .map(w => w.name);
    if (serviceNames.length === 0) {
      serviceNames.push('Dienst Vordergrund', 'Dienst Hintergrund', 'Spätdienst');
    }

    // 3. Determine date range
    let startDate, endDate;
    if (month !== undefined && year !== undefined) {
      startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      endDate = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;
    } else {
      const today = new Date();
      startDate = today.toISOString().slice(0, 10);
      endDate = null;
    }

    // 4. Fetch shifts
    let shifts;
    if (endDate) {
      const [rows] = await dbPool.execute(
        'SELECT * FROM ShiftEntry WHERE date >= ? AND date <= ? ORDER BY date',
        [startDate, endDate]
      );
      shifts = rows;
    } else {
      const [rows] = await dbPool.execute(
        'SELECT * FROM ShiftEntry WHERE date >= ? ORDER BY date',
        [startDate]
      );
      shifts = rows;
    }

    // 5. Group shifts by doctor
    const shiftsByDoctor = {};
    shifts.forEach(shift => {
      if (!shiftsByDoctor[shift.doctor_id]) {
        shiftsByDoctor[shift.doctor_id] = [];
      }
      shiftsByDoctor[shift.doctor_id].push(shift);
    });

    let sentCount = 0;
    const errors = [];
    const debugLog = [];

    debugLog.push(`Found ${doctors.length} doctors with email.`);
    debugLog.push(`Found ${shifts.length} shifts in range.`);

    const formatter = new Intl.DateTimeFormat('de-DE', {
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const generateICS = (docShifts) => {
      const calendar = ical({
        name: 'CuraFlow Dienstplan',
        prodId: {
          company: 'CuraFlow',
          product: 'Dienstplan',
          language: 'DE'
        },
        method: 'PUBLISH'
      });

      for (const shift of docShifts) {
        const date = new Date(shift.date);
        if (isNaN(date.getTime())) {
          continue;
        }

        const nextDay = new Date(date);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);

        calendar.createEvent({
          id: `${shift.id}@curaflow`,
          start: date,
          end: nextDay,
          allDay: true,
          summary: shift.position,
          description: `Eingeteilter Dienst: ${shift.position}`
        });
      }

      return `${calendar.toString()}\r\n`;
    };

    // 6. Send emails per doctor
    for (const doctor of doctors) {
      try {
        const docShifts = shiftsByDoctor[doctor.id];
        if (!docShifts || docShifts.length === 0) {
          debugLog.push(`${doctor.name}: Keine Schichten gefunden.`);
          continue;
        }

        // Only service shifts
        const relevantShifts = docShifts.filter(s => serviceNames.includes(s.position));
        if (relevantShifts.length === 0) {
          debugLog.push(`${doctor.name}: Keine relevanten Dienste.`);
          continue;
        }

        relevantShifts.sort((a, b) => new Date(a.date) - new Date(b.date));

        const dateList = relevantShifts.map(s => {
          const date = new Date(s.date);
          if (isNaN(date.getTime())) return `- ${s.date} (Ungültiges Datum): ${s.position}`;
          return `- ${formatter.format(date)}: ${s.position}`;
        }).join('\n');

        // Generate ICS as attachment
        const icsContent = generateICS(relevantShifts);

        const subject = `[CuraFlow] Dein aktueller Dienstplan`;
        let text = `Hallo ${doctor.name},\n\n`;
        text += `Hier ist eine Übersicht deiner kommenden Dienste:\n\n${dateList}`;
        text += `\n\nIm Anhang findest du eine Kalender-Datei (.ics) zum Importieren.`;
        text += `\n\nViele Grüße,\nDein CuraFlow-System`;

        const email = doctor.google_email.trim();
        debugLog.push(`Sende E-Mail an ${doctor.name} (${email})...`);

        await sendEmail({
          to: email,
          subject,
          text,
          attachments: [{
            filename: `dienstplan_${doctor.initials || doctor.name.replace(/\s+/g, '_')}.ics`,
            content: icsContent,
            contentType: 'text/calendar'
          }]
        });

        sentCount++;
        debugLog.push(`Erfolgreich gesendet an ${doctor.name} (${email})`);
      } catch (e) {
        console.error(`[schedule-notifications] Fehler bei ${doctor.name}:`, e.message);
        errors.push({ doctor: doctor.name, error: e.message });
        debugLog.push(`Fehler bei ${doctor.name}: ${e.message}`);
      }
    }

    // 7. Log result
    try {
      const id = crypto.randomUUID();
      await dbPool.execute(
        'INSERT INTO SystemLog (id, level, source, message, details, created_date) VALUES (?, ?, ?, ?, ?, NOW())',
        [id, errors.length > 0 ? 'warning' : 'success', 'EmailNotification',
         `E-Mail-Versand abgeschlossen. Gesendet: ${sentCount}, Fehler: ${errors.length}`,
         JSON.stringify({ errors, debug: debugLog })]
      ).catch(() => {}); // SystemLog table might not exist
    } catch (e) { /* ignore */ }

    res.json({ success: true, count: sentCount, errors, debug: debugLog });
  } catch (error) {
    console.error('[schedule-notifications] Fehler:', error.message);
    next(error);
  }
});

// ===== SEND SHIFT NOTIFICATION (single shift change notification) =====
router.post('/shift-notification', async (req, res, next) => {
  try {
    const { doctor_id, date, position, type: notifType, message } = req.body;
    const dbPool = req.db || db;

    if (!doctor_id) {
      return res.status(400).json({ error: 'doctor_id erforderlich' });
    }

    // Check email configuration (Brevo or SMTP)
    if (!getEmailProviderInfo().configured) {
      return res.status(503).json({ error: 'E-Mail nicht konfiguriert' });
    }

    // Benachrichtigungen gehen an die Benachrichtigungs-E-Mail-Adresse (email)
    const [doctors] = await dbPool.execute('SELECT * FROM Doctor WHERE id = ?', [doctor_id]);
    if (doctors.length === 0) {
      return res.status(404).json({ error: 'Arzt nicht gefunden' });
    }

    const doctor = doctors[0];
    if (!doctor.email) {
      return res.json({ success: false, message: 'Keine Benachrichtigungs-E-Mail-Adresse hinterlegt' });
    }

    const formatter = new Intl.DateTimeFormat('de-DE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const dateFormatted = date ? formatter.format(new Date(date)) : '';
    const subject = `[CuraFlow] ${notifType === 'new' ? 'Neuer Dienst' : 'Dienständerung'}${date ? ` am ${dateFormatted}` : ''}`;

    let text = `Hallo ${doctor.name},\n\n`;
    if (message) {
      text += message;
    } else {
      text += notifType === 'new'
        ? `Dir wurde ein neuer Dienst zugewiesen: ${position || ''} am ${dateFormatted}.`
        : `Es gab eine Änderung an deinem Dienstplan für den ${dateFormatted}.`;
    }
    text += `\n\nViele Grüße,\nDein CuraFlow-System`;

    await sendEmail({
      to: doctor.email.trim(),
      subject,
      text,
    });

    res.json({ success: true, message: `Benachrichtigung an ${doctor.name} gesendet` });
  } catch (error) {
    console.error('[shift-notification] Fehler:', error.message);
    next(error);
  }
});

// ===== SMTP STATUS CHECK =====
router.get('/email-status', async (req, res) => {
  const configured = !!getTransporter();
  res.json({ 
    smtp_configured: configured,
    smtp_host: process.env.SMTP_HOST || null,
    smtp_user: process.env.SMTP_USER ? '***' : null, 
  });
});

// ===== WISH REMINDER ACK STATUS (Admin) =====
// Returns per-doctor acknowledgment status for a given target month
router.get('/wish-reminder-status', async (req, res, next) => {
  try {
    const { month } = req.query; // e.g. "2025-03"
    const dbPool = req.db || db;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Parameter month im Format YYYY-MM erforderlich' });
    }

    // 1. Get all doctors
    const [doctors] = await dbPool.execute(
      "SELECT id, name, initials, email FROM Doctor ORDER BY name"
    );

    // 2. Get ack records for this target month
    const [acks] = await dbPool.execute(
      "SELECT doctor_id, status, acknowledged_date FROM WishReminderAck WHERE target_month = ?",
      [month]
    );
    const ackMap = {};
    for (const a of acks) {
      ackMap[a.doctor_id] = { status: a.status, acknowledged_date: a.acknowledged_date };
    }

    // 3. Get wish requests for this target month (to see who has actual wishes)
    const monthStart = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

    const [wishes] = await dbPool.execute(
      "SELECT DISTINCT doctor_id FROM WishRequest WHERE date >= ? AND date <= ?",
      [monthStart, monthEnd]
    );
    const hasWishes = new Set(wishes.map(w => w.doctor_id));

    // 4. Build response
    const result = doctors.map(doc => {
      const ack = ackMap[doc.id];
      let reminderStatus;
      
      if (hasWishes.has(doc.id)) {
        reminderStatus = 'has_wishes'; // Has submitted wishes → no ack needed
      } else if (ack?.status === 'acknowledged') {
        reminderStatus = 'acknowledged'; // Clicked "no wishes"
      } else if (ack?.status === 'sent') {
        reminderStatus = 'sent'; // Reminder sent but no response yet
      } else {
        reminderStatus = 'no_reminder'; // No reminder sent (e.g. no email, or not yet due)
      }

      return {
        doctor_id: doc.id,
        name: doc.name,
        initials: doc.initials,
        has_email: !!doc.email,
        reminder_status: reminderStatus,
        acknowledged_date: ack?.acknowledged_date || null,
      };
    });

    // 5. Summary stats
    const stats = {
      total: doctors.length,
      has_wishes: result.filter(r => r.reminder_status === 'has_wishes').length,
      acknowledged: result.filter(r => r.reminder_status === 'acknowledged').length,
      sent: result.filter(r => r.reminder_status === 'sent').length,
      no_reminder: result.filter(r => r.reminder_status === 'no_reminder').length,
    };

    res.json({ month, doctors: result, stats });
  } catch (error) {
    console.error('[wish-reminder-status] Error:', error.message);
    next(error);
  }
});

// ===== WORK TIME MODELS (from master DB) =====
router.get('/work-time-models', async (req, res, next) => {
  try {
    const [models] = await db.execute('SELECT id, name, hours_per_week, hours_per_day FROM WorkTimeModel ORDER BY hours_per_week DESC');
    res.json({ models });
  } catch (error) {
    console.error('[work-time-models] Error:', error.message);
    res.json({ models: [] });
  }
});

export default router;
