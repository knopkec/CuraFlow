import { describe, expect, it } from 'vitest';
import { createShiftValidator } from '../ShiftValidation';

function createValidator(systemSettings = []) {
  return createShiftValidator({
    doctors: [{ id: 'doctor-1', role: 'Facharzt', fte: 1 }],
    shifts: [
      {
        id: 'shift-1',
        doctor_id: 'doctor-1',
        date: '2026-05-19',
        position: 'Frei',
      },
    ],
    workplaces: [],
    wishes: [],
    systemSettings,
    staffingEntries: [],
    timeslots: [],
    qualificationMap: {},
    getDoctorQualIds: () => [],
    wpQualsByWorkplace: {},
  });
}

describe('ShiftValidator absence overlap setting', () => {
  it('blocks overlapping absence and duty by default', () => {
    const validator = createValidator();

    const result = validator.validate('doctor-1', '2026-05-19', 'Bereitschaftsdienst');

    expect(result.canProceed).toBe(false);
    expect(result.blockers).toContain('Mitarbeiter ist bereits als "Frei" eingetragen (blockiert).');
  });

  it('allows overlapping absence and duty when the setting is enabled', () => {
    const validator = createValidator([
      { key: 'allow_absence_oncall_overlap', value: 'true' },
    ]);

    const result = validator.validate('doctor-1', '2026-05-19', 'Bereitschaftsdienst');

    expect(result.canProceed).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});