import express from 'express';
import crypto from 'crypto';
import { authMiddleware } from './auth.js';
import { writeAuditLog } from './dbProxy.js';
import { broadcastPlanUpdate, buildRealtimeScope, isPlanSyncEntity } from '../utils/realtime.js';
import { db } from '../index.js';
import {
  deleteCentralAbsenceById,
  getShiftEntryWithCentralAbsence,
  isCentralAbsencePosition,
  listShiftEntriesWithCentralAbsences,
  writeShiftEntryToCentralAbsence,
} from '../utils/centralAbsences.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';

const router = express.Router();

// All atomic operations require authentication
router.use(authMiddleware);

// Helper: Convert JS value to MySQL value
const toSqlValue = (val) => {
  if (val === undefined) return null;
  if (typeof val === 'number' && isNaN(val)) return null;
  if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
    return JSON.stringify(val);
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 19).replace('T', ' ');
  }
  return val;
};

// Helper: Parse MySQL row
const fromSqlRow = (row) => {
  if (!row) return null;
  const res = { ...row };
  const boolFields = [
    'receive_email_notifications', 'exclude_from_staffing_plan', 
    'user_viewed', 'auto_off', 'show_in_service_plan', 
    'allows_rotation_concurrently', 'allows_absence_overlap',
    'acknowledged', 'is_active'
  ];
  for (const key in res) {
    if (boolFields.includes(key)) res[key] = !!res[key];
  }
  return res;
};

const shiftIsoDate = (dateString, days) => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// ===== ATOMIC OPERATIONS ENDPOINT =====
router.post('/', async (req, res, next) => {
  try {
    const { operation, entity, id, data, check } = req.body;
    const dbPool = req.db; // Set by tenantDbMiddleware
    const userEmail = req.user?.email || 'system';
    const realtimeScope = buildRealtimeScope(req.dbToken);
    const actor = {
      id: req.user?.sub || null,
      email: userEmail,
    };
    const tenantId = req.dbToken ? await resolveTenantIdFromToken(db, req.dbToken) : null;

    // Helper: Get single record
    const getRecord = async (tableName, recordId) => {
      const [rows] = await dbPool.execute(
        `SELECT * FROM \`${tableName}\` WHERE id = ?`, 
        [recordId]
      );
      return rows[0] ? fromSqlRow(rows[0]) : null;
    };

    const getShiftAwareRecord = async (tableName, recordId) => {
      if (tableName === 'ShiftEntry' && req.db) {
        return await getShiftEntryWithCentralAbsence({ tenantDb: dbPool, masterDb: db, id: recordId });
      }
      return await getRecord(tableName, recordId);
    };

    // Helper: Filter records
    const filterRecords = async (tableName, filter) => {
      if (tableName === 'ShiftEntry' && req.db) {
        return await listShiftEntriesWithCentralAbsences({
          tenantDb: dbPool,
          masterDb: db,
          filters: filter,
        });
      }

      const clauses = [];
      const params = [];
      for (const [key, val] of Object.entries(filter)) {
        clauses.push(`\`${key}\` = ?`);
        params.push(toSqlValue(val));
      }
      const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      const [rows] = await dbPool.execute(
        `SELECT * FROM \`${tableName}\`${whereClause}`, 
        params
      );
      return rows.map(fromSqlRow);
    };

    // Helper: Create record
    const createRecord = async (tableName, createData) => {
      if (tableName === 'ShiftEntry' && req.db && isCentralAbsencePosition(createData?.position)) {
        const created = await writeShiftEntryToCentralAbsence({
          tenantDb: dbPool,
          masterDb: db,
          tenantId,
          shiftEntry: createData,
          doctorId: createData.doctor_id,
          preserveId: true,
        });
        if (created) {
          return created;
        }
      }

      if (!createData.id) createData.id = crypto.randomUUID();
      createData.created_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      createData.updated_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      createData.created_by = userEmail;

      const keys = Object.keys(createData);
      const values = keys.map(k => toSqlValue(createData[k]));
      const placeholders = keys.map(() => '?').join(',');
      
      await dbPool.execute(
        `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`, 
        values
      );
      return createData;
    };

    // Helper: Update record
    const updateRecord = async (tableName, recordId, updateData) => {
      if (tableName === 'ShiftEntry' && req.db) {
        const current = await getShiftAwareRecord(tableName, recordId);
        const nextPosition = updateData.position || current?.position;
        if (current && isCentralAbsencePosition(nextPosition)) {
          const updated = await writeShiftEntryToCentralAbsence({
            tenantDb: dbPool,
            masterDb: db,
            tenantId,
            shiftEntry: { ...current, ...updateData, id: recordId },
            doctorId: updateData.doctor_id || current.doctor_id,
            preserveId: true,
          });
          if (updated) {
            return updated;
          }
        }
        if (current && isCentralAbsencePosition(current.position) && !isCentralAbsencePosition(nextPosition)) {
          await deleteCentralAbsenceById(db, recordId);
          const replacement = { ...current, ...updateData, id: recordId };
          const keys = Object.keys(replacement);
          const values = keys.map((key) => toSqlValue(replacement[key]));
          const placeholders = keys.map(() => '?').join(',');
          await dbPool.execute(
            `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`,
            values
          );
          return await getShiftAwareRecord(tableName, recordId);
        }
      }

      updateData.updated_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const keys = Object.keys(updateData).filter(k => k !== 'id');
      const sets = keys.map(k => `\`${k}\` = ?`).join(',');
      const values = keys.map(k => toSqlValue(updateData[k]));
      values.push(recordId);
      
      await dbPool.execute(
        `UPDATE \`${tableName}\` SET ${sets} WHERE id = ?`, 
        values
      );
      return await getShiftAwareRecord(tableName, recordId);
    };

    // Helper: Delete record
    const deleteRecord = async (tableName, recordId) => {
      if (tableName === 'ShiftEntry' && req.db) {
        const current = await getRecord(tableName, recordId);
        if (!current) {
          const centralCurrent = await getShiftEntryWithCentralAbsence({ tenantDb: dbPool, masterDb: db, id: recordId });
          if (centralCurrent && isCentralAbsencePosition(centralCurrent.position)) {
            await deleteCentralAbsenceById(db, recordId);
            return { success: true };
          }
        }
      }

      // Fetch record before deletion for audit log
      const [existingRows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [recordId]);
      const deletedRecord = existingRows[0] ? fromSqlRow(existingRows[0]) : null;
      
      await dbPool.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [recordId]);
      
      // Write audit to SystemLog table
      const timestamp = new Date().toISOString();
      await writeAuditLog(dbPool, {
        level: 'audit',
        source: 'Löschung',
        message: `${tableName} gelöscht von ${userEmail} (ID: ${recordId})`,
        details: { table: tableName, record_id: recordId, deleted_data: deletedRecord, timestamp },
        userEmail
      });
      
      return { success: true };
    };

    // ===== OPERATION: checkAndUpdate =====
    // Optimistic locking - check updated_date before updating
    if (operation === 'checkAndUpdate') {
      if (!entity || !id) {
        return res.status(400).json({ error: 'entity und id sind erforderlich' });
      }

      const current = await getShiftAwareRecord(entity, id);
      if (!current) {
        return res.status(404).json({ 
          error: 'NOT_FOUND', 
          message: 'Eintrag nicht gefunden.' 
        });
      }

      // Check for concurrent modification
      if (check && check.updated_date) {
        const dbDate = new Date(current.updated_date).getTime();
        const clientDate = new Date(check.updated_date).getTime();
        
        if (dbDate !== clientDate) {
          return res.status(409).json({
            error: 'CONCURRENCY_ERROR',
            message: 'Daten wurden von einem anderen Benutzer geändert.',
            currentData: current
          });
        }
      }

      const result = await updateRecord(entity, id, data);
      if (isPlanSyncEntity(entity)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity,
          action: 'update',
          recordId: id,
          actor,
        });
      }
      return res.json(result);
    }

    // ===== OPERATION: checkAndCreate =====
    // Check for duplicates before creating
    if (operation === 'checkAndCreate') {
      if (!entity || !data) {
        return res.status(400).json({ error: 'entity und data sind erforderlich' });
      }

      // Check for existing record with same unique keys
      if (check && check.uniqueKeys) {
        const filter = {};
        check.uniqueKeys.forEach(k => {
          if (data[k] !== undefined) filter[k] = data[k];
        });

        if (Object.keys(filter).length > 0) {
          const existing = await filterRecords(entity, filter);
          if (existing.length > 0) {
            return res.status(409).json({
              error: 'DUPLICATE_ERROR',
              message: 'Eintrag existiert bereits.',
              existingEntry: existing[0]
            });
          }
        }
      }

      const result = await createRecord(entity, data);
      if (isPlanSyncEntity(entity)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity,
          action: 'create',
          recordId: result.id,
          actor,
        });
      }
      return res.json(result);
    }

    // ===== OPERATION: upsertStaffing =====
    // Special upsert logic for StaffingPlanEntry
    if (operation === 'upsertStaffing') {
      const { doctor_id, year, month, value, old_value_check } = data || {};

      if (!doctor_id || !year || !month) {
        return res.status(400).json({ error: 'doctor_id, year und month sind erforderlich' });
      }

      const existingList = await filterRecords('StaffingPlanEntry', { doctor_id, year, month });
      const existing = existingList[0];

      if (existing) {
        // Check for concurrent modification
        if (old_value_check !== undefined && existing.value != old_value_check) {
          return res.status(409).json({
            error: 'CONCURRENCY_ERROR',
            message: 'Wert wurde von einem anderen Benutzer geändert.',
            currentValue: existing.value
          });
        }

        // Delete if empty value
        if (value === '' || value === null || value === undefined) {
          await deleteRecord('StaffingPlanEntry', existing.id);
          broadcastPlanUpdate({
            scope: realtimeScope,
            entity: 'StaffingPlanEntry',
            action: 'delete',
            recordId: existing.id,
            actor,
          });
          return res.json({ deleted: true, id: existing.id });
        }

        // Update existing
        const result = await updateRecord('StaffingPlanEntry', existing.id, { value });
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: 'StaffingPlanEntry',
          action: 'update',
          recordId: existing.id,
          actor,
        });
        return res.json(result);
      } else {
        // Skip if empty value
        if (value === '' || value === null || value === undefined) {
          return res.json({ skipped: true });
        }

        // Create new
        const result = await createRecord('StaffingPlanEntry', { doctor_id, year, month, value });
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: 'StaffingPlanEntry',
          action: 'create',
          recordId: result.id,
          actor,
        });
        return res.json(result);
      }
    }

    if (operation === 'replaceTrainingRotationRange') {
      const payload = data || {};
      const doctorId = payload.doctor_id;
      const modality = payload.modality || null;
      const inputStart = payload.start_date;
      const inputEnd = payload.end_date;

      if (!doctorId || !inputStart || !inputEnd) {
        return res.status(400).json({ error: 'doctor_id, start_date und end_date sind erforderlich' });
      }

      const startDate = inputStart <= inputEnd ? inputStart : inputEnd;
      const endDate = inputStart <= inputEnd ? inputEnd : inputStart;
      const leftNeighborDate = shiftIsoDate(startDate, -1);
      const rightNeighborDate = shiftIsoDate(endDate, 1);
      const connection = await dbPool.getConnection();
      let changedCount = 0;

      const insertRotation = async (rotationData) => {
        const rotationId = crypto.randomUUID();
        const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await connection.execute(
          `INSERT INTO \`TrainingRotation\` (\`id\`, \`created_date\`, \`updated_date\`, \`created_by\`, \`doctor_id\`, \`modality\`, \`start_date\`, \`end_date\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rotationId,
            createdAt,
            createdAt,
            userEmail,
            rotationData.doctor_id,
            rotationData.modality,
            rotationData.start_date,
            rotationData.end_date,
          ]
        );
        changedCount += 1;
        return rotationId;
      };

      try {
        await connection.beginTransaction();

        const [overlappingRows] = await connection.execute(
          `SELECT * FROM \`TrainingRotation\` WHERE \`doctor_id\` = ? AND \`start_date\` <= ? AND \`end_date\` >= ? ORDER BY \`start_date\` ASC, \`id\` ASC FOR UPDATE`,
          [doctorId, endDate, startDate]
        );

        for (const row of overlappingRows) {
          if (row.start_date >= startDate && row.end_date <= endDate) {
            await connection.execute('DELETE FROM `TrainingRotation` WHERE `id` = ?', [row.id]);
            changedCount += 1;
            continue;
          }

          if (row.start_date < startDate && row.end_date > endDate) {
            await connection.execute(
              'UPDATE `TrainingRotation` SET `end_date` = ?, `updated_date` = ? WHERE `id` = ?',
              [shiftIsoDate(startDate, -1), new Date().toISOString().slice(0, 19).replace('T', ' '), row.id]
            );
            changedCount += 1;
            await insertRotation({
              doctor_id: row.doctor_id,
              modality: row.modality,
              start_date: rightNeighborDate,
              end_date: row.end_date,
            });
            continue;
          }

          if (row.start_date < startDate) {
            await connection.execute(
              'UPDATE `TrainingRotation` SET `end_date` = ?, `updated_date` = ? WHERE `id` = ?',
              [shiftIsoDate(startDate, -1), new Date().toISOString().slice(0, 19).replace('T', ' '), row.id]
            );
            changedCount += 1;
            continue;
          }

          if (row.end_date > endDate) {
            await connection.execute(
              'UPDATE `TrainingRotation` SET `start_date` = ?, `updated_date` = ? WHERE `id` = ?',
              [rightNeighborDate, new Date().toISOString().slice(0, 19).replace('T', ' '), row.id]
            );
            changedCount += 1;
          }
        }

        if (modality) {
          const [mergeRows] = await connection.execute(
            `SELECT * FROM \`TrainingRotation\` WHERE \`doctor_id\` = ? AND \`modality\` = ? AND \`start_date\` <= ? AND \`end_date\` >= ? ORDER BY \`start_date\` ASC, \`id\` ASC FOR UPDATE`,
            [doctorId, modality, rightNeighborDate, leftNeighborDate]
          );

          let mergedStart = startDate;
          let mergedEnd = endDate;

          for (const row of mergeRows) {
            if (row.start_date < mergedStart) {
              mergedStart = row.start_date;
            }
            if (row.end_date > mergedEnd) {
              mergedEnd = row.end_date;
            }
            await connection.execute('DELETE FROM `TrainingRotation` WHERE `id` = ?', [row.id]);
            changedCount += 1;
          }

          await insertRotation({
            doctor_id: doctorId,
            modality,
            start_date: mergedStart,
            end_date: mergedEnd,
          });
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      if (changedCount > 0) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: 'TrainingRotation',
          action: 'bulkUpdate',
          recordCount: changedCount,
          actor,
        });
      }

      return res.json({
        success: true,
        changedCount,
        doctor_id: doctorId,
        modality,
        start_date: startDate,
        end_date: endDate,
      });
    }

    return res.status(400).json({ error: 'Invalid operation', validOperations: ['checkAndUpdate', 'checkAndCreate', 'upsertStaffing', 'replaceTrainingRotationRange'] });

  } catch (error) {
    console.error('Atomic operation error:', error);
    next(error);
  }
});

export default router;
