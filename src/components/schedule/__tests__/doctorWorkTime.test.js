import { describe, expect, it } from 'vitest';

import {
  getPartTimeWorkDaysPerWeek,
  isFullDaysOffModel,
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

  describe('full_days_off part-time model', () => {
    it('detects full_days_off model only when part_time_model is set', () => {
      expect(isFullDaysOffModel({ part_time_model: 'full_days_off' })).toBe(true);
      expect(isFullDaysOffModel({ part_time_model: 'reduced_daily' })).toBe(false);
      expect(isFullDaysOffModel({})).toBe(false);
      expect(isFullDaysOffModel(null)).toBe(false);
    });

    it('returns full daily hours (no fte scaling) for full_days_off with central employee', () => {
      const doctor = {
        fte: 0.8,
        part_time_model: 'full_days_off',
        central_employee_id: 'employee-1',
        target_weekly_hours: null,
      };
      const centralEmployee = { id: 'employee-1', target_hours_per_week: 40, model_hours_per_week: null };

      // Full day: 40 / 5 = 8h, not scaled by 0.8
      expect(resolveDoctorTargetDailyHours(doctor, null, centralEmployee)).toBe(8);
    });

    it('returns full daily hours for full_days_off with local weekly hours', () => {
      const doctor = {
        fte: 0.6,
        part_time_model: 'full_days_off',
        central_employee_id: null,
        target_weekly_hours: 30,
      };

      // 30 / 5 = 6h, not scaled by 0.6
      expect(resolveDoctorTargetDailyHours(doctor, null, null)).toBe(6);
    });

    it('keeps reduced_daily as the default part-time model behaviour', () => {
      const doctor = {
        fte: 0.8,
        central_employee_id: 'employee-1',
        target_weekly_hours: null,
      };
      const centralEmployee = { id: 'employee-1', target_hours_per_week: 40, model_hours_per_week: null };

      // reduced_daily → 40 * 0.8 = 32 weekly, 32/5 = 6.4 daily
      expect(resolveDoctorTargetDailyHours(doctor, null, centralEmployee)).toBe(6.4);
    });
  });

  describe('getPartTimeWorkDaysPerWeek', () => {
    it('returns 5 for full-time and missing fte', () => {
      expect(getPartTimeWorkDaysPerWeek({ fte: 1.0 })).toBe(5);
      expect(getPartTimeWorkDaysPerWeek({ fte: 1.2 })).toBe(5);
      expect(getPartTimeWorkDaysPerWeek({})).toBe(5);
      expect(getPartTimeWorkDaysPerWeek(null)).toBe(5);
    });

    it('rounds to the nearest whole day per week', () => {
      expect(getPartTimeWorkDaysPerWeek({ fte: 0.8 })).toBe(4);
      expect(getPartTimeWorkDaysPerWeek({ fte: 0.6 })).toBe(3);
      expect(getPartTimeWorkDaysPerWeek({ fte: 0.4 })).toBe(2);
      expect(getPartTimeWorkDaysPerWeek({ fte: 0.2 })).toBe(1);
      expect(getPartTimeWorkDaysPerWeek({ fte: 0.1 })).toBe(1); // min 1 day
    });
  });
});