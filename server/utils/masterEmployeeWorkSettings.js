export function resolveEmployeeTargetWeeklyHours(employee) {
  const explicitWeeklyHours = Number(employee?.target_hours_per_week);
  if (Number.isFinite(explicitWeeklyHours) && explicitWeeklyHours > 0) {
    return explicitWeeklyHours;
  }

  const modelWeeklyHours = Number(employee?.model_hours_per_week);
  if (Number.isFinite(modelWeeklyHours) && modelWeeklyHours > 0) {
    return modelWeeklyHours;
  }

  return null;
}

export async function syncEmployeeWorkSettingsToTenantDoctors({
  employee,
  assignments = [],
  tokens = [],
  withTenantDb,
  actor = null,
  buildRealtimeScope,
  broadcastPlanUpdate,
}) {
  const linkedAssignments = assignments.filter(
    (assignment) => assignment?.tenant_id && assignment?.tenant_doctor_id
  );
  const resolvedWeeklyHours = resolveEmployeeTargetWeeklyHours(employee);

  if (!employee?.id || linkedAssignments.length === 0) {
    return {
      syncedAssignments: [],
      skippedAssignments: [],
      failedAssignments: [],
    };
  }

  const tokenById = new Map(tokens.map((token) => [String(token.id), token]));
  const doctorColumnCache = new Map();
  const syncedAssignments = [];
  const skippedAssignments = [];
  const failedAssignments = [];

  for (const assignment of linkedAssignments) {
    const token = tokenById.get(String(assignment.tenant_id));
    if (!token) {
      skippedAssignments.push({
        tenant_id: assignment.tenant_id,
        tenant_doctor_id: assignment.tenant_doctor_id,
        reason: 'tenant_not_found',
      });
      continue;
    }

    try {
      await withTenantDb(token, async (pool) => {
        let doctorColumns = doctorColumnCache.get(String(token.id));

        if (!doctorColumns) {
          const [columnRows] = await pool.execute(
            `SELECT COLUMN_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_NAME = 'Doctor'
               AND TABLE_SCHEMA = DATABASE()
               AND COLUMN_NAME IN ('target_weekly_hours', 'work_time_model_id', 'vacation_days')`
          );

          doctorColumns = new Set(columnRows.map((row) => row.COLUMN_NAME));
          doctorColumnCache.set(String(token.id), doctorColumns);
        }

        const updates = [];
        const params = [];

        if (doctorColumns.has('target_weekly_hours')) {
          updates.push('target_weekly_hours = ?');
          params.push(resolvedWeeklyHours);
        }

        if (doctorColumns.has('work_time_model_id')) {
          updates.push('work_time_model_id = ?');
          params.push(employee.work_time_model_id || null);
        }

        if (doctorColumns.has('vacation_days') && employee.vacation_days_annual != null) {
          updates.push('vacation_days = ?');
          params.push(employee.vacation_days_annual);
        }

        if (updates.length === 0) {
          skippedAssignments.push({
            tenant_id: assignment.tenant_id,
            tenant_doctor_id: assignment.tenant_doctor_id,
            reason: 'missing_columns',
          });
          return;
        }

        params.push(assignment.tenant_doctor_id);
        await pool.execute(`UPDATE Doctor SET ${updates.join(', ')} WHERE id = ?`, params);

        syncedAssignments.push({
          tenant_id: assignment.tenant_id,
          tenant_doctor_id: assignment.tenant_doctor_id,
          updated_fields: updates.map((update) => update.split(' = ')[0]),
        });

        if (buildRealtimeScope && broadcastPlanUpdate) {
          broadcastPlanUpdate({
            scope: buildRealtimeScope(token.token),
            entity: 'Doctor',
            action: 'update',
            recordId: assignment.tenant_doctor_id,
            actor,
          });
        }
      });
    } catch (error) {
      failedAssignments.push({
        tenant_id: assignment.tenant_id,
        tenant_doctor_id: assignment.tenant_doctor_id,
        error: error.message,
      });
    }
  }

  return {
    syncedAssignments,
    skippedAssignments,
    failedAssignments,
  };
}