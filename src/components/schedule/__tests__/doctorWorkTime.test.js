import { describe, expect, it } from 'vitest';

import {
  resolveDoctorTargetDailyHours,
  resolveDoctorTargetWeeklyHours,
} from '@/components/schedule/doctorWorkTime';

describe('doctorWorkTime', () => {
  it('prefers central employee weekly hours over the 38.5h FTE fallback', () => {
    const doctor = { fte: 1, target_weekly_hours: null, central_employee_id: 'employee-1' };
    const centralEmployee = { id: 'employee-1', target_hours_per_week: 40, model_hours_per_week: null };

    expect(resolveDoctorTargetWeeklyHours(doctor, null, centralEmployee)).toBe(40);
    expect(resolveDoctorTargetDailyHours(doctor, null, centralEmployee)).toBe(8);
  });

  it('uses local work time model before falling back to central model hours', () => {
    const doctor = { fte: 1, target_weekly_hours: null, central_employee_id: 'employee-1' };
    const workTimeModel = { hours_per_week: 38.5, hours_per_day: 7.7 };
    const centralEmployee = { id: 'employee-1', target_hours_per_week: null, model_hours_per_week: 40 };

    expect(resolveDoctorTargetWeeklyHours(doctor, workTimeModel, centralEmployee)).toBe(38.5);
    expect(resolveDoctorTargetDailyHours(doctor, workTimeModel, centralEmployee)).toBe(7.7);
  });
});