import { describe, expect, it } from 'vitest';

import {
  resolveDoctorTargetDailyHours,
  resolveDoctorTargetWeeklyHours,
} from '@/components/schedule/doctorWorkTime';

describe('doctorWorkTime', () => {
  it('scales central employee weekly hours by doctor fte', () => {
    const doctor = { fte: 0.5, target_weekly_hours: null, central_employee_id: 'employee-1' };
    const centralEmployee = { id: 'employee-1', target_hours_per_week: 40, model_hours_per_week: null };

    expect(resolveDoctorTargetWeeklyHours(doctor, null, centralEmployee)).toBe(20);
    expect(resolveDoctorTargetDailyHours(doctor, null, centralEmployee)).toBe(4);
  });

  it('scales model hours by doctor fte before falling back to default full time hours', () => {
    const doctor = { fte: 0.5, target_weekly_hours: null, central_employee_id: 'employee-1' };
    const workTimeModel = { hours_per_week: 40, hours_per_day: 8 };
    const centralEmployee = { id: 'employee-1', target_hours_per_week: null, model_hours_per_week: 40 };

    expect(resolveDoctorTargetWeeklyHours(doctor, workTimeModel, centralEmployee)).toBe(20);
    expect(resolveDoctorTargetDailyHours(doctor, workTimeModel, centralEmployee)).toBe(4);
  });

  it('keeps explicit local weekly hours absolute for non-central doctors', () => {
    const doctor = { fte: 0.5, target_weekly_hours: 22, central_employee_id: null };

    expect(resolveDoctorTargetWeeklyHours(doctor, null, null)).toBe(22);
    expect(resolveDoctorTargetDailyHours(doctor, null, null)).toBe(4.4);
  });

  it('scales mirrored linked weekly hours when central data is not loaded yet', () => {
    const doctor = { fte: 0.5, target_weekly_hours: 40, central_employee_id: 'employee-1' };

    expect(resolveDoctorTargetWeeklyHours(doctor, null, null)).toBe(20);
    expect(resolveDoctorTargetDailyHours(doctor, null, null)).toBe(4);
  });
});