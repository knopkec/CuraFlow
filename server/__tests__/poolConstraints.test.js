import { describe, expect, it } from 'vitest';
import { validateProposedShift } from '../utils/poolConstraints.js';

function wp(constraints) {
  return { constraints_json: JSON.stringify(constraints) };
}

describe('validateProposedShift', () => {
  it('returns no violations when no constraints are configured', () => {
    const result = validateProposedShift({
      workplace: { constraints_json: null },
      proposed: { date: '2026-01-15', employee_id: 'e1' },
      existingForWorkplace: [],
    });
    expect(result).toEqual([]);
  });

  it('flags max_per_person_month when the cap is already reached', () => {
    const result = validateProposedShift({
      workplace: wp({ max_per_person_month: 2 }),
      proposed: { date: '2026-01-20', employee_id: 'e1' },
      existingForWorkplace: [
        { id: '1', date: '2026-01-05', employee_id: 'e1' },
        { id: '2', date: '2026-01-12', employee_id: 'e1' },
        // other employees should not count
        { id: '3', date: '2026-01-15', employee_id: 'e2' },
      ],
    });
    expect(result.map((v) => v.rule)).toContain('max_per_person_month');
  });

  it('does not flag max_per_person_month when shifts are in a different month', () => {
    const result = validateProposedShift({
      workplace: wp({ max_per_person_month: 2 }),
      proposed: { date: '2026-02-01', employee_id: 'e1' },
      existingForWorkplace: [
        { id: '1', date: '2026-01-05', employee_id: 'e1' },
        { id: '2', date: '2026-01-12', employee_id: 'e1' },
      ],
    });
    expect(result).toEqual([]);
  });

  it('flags rest_after.next_day_off when the person already works the day after', () => {
    const result = validateProposedShift({
      workplace: wp({ rest_after: { next_day_off: true } }),
      proposed: { date: '2026-01-10', employee_id: 'e1' },
      existingForWorkplace: [
        { id: '1', date: '2026-01-11', employee_id: 'e1' },
      ],
    });
    expect(result.map((v) => v.rule)).toContain('rest_after');
  });

  it('does not flag rest_after for a different employee on the next day', () => {
    const result = validateProposedShift({
      workplace: wp({ rest_after: { next_day_off: true } }),
      proposed: { date: '2026-01-10', employee_id: 'e1' },
      existingForWorkplace: [
        { id: '1', date: '2026-01-11', employee_id: 'e2' },
      ],
    });
    expect(result).toEqual([]);
  });

  it('returns a pairing violation when no partner of the required role exists on the same day', () => {
    const result = validateProposedShift({
      workplace: wp({
        pairing: [{ left: 'new', right: 'experienced', scope: 'same_day' }],
      }),
      proposed: { date: '2026-01-10', employee_id: 'e1', employee_role: 'new' },
      existingForWorkplace: [],
    });
    expect(result.map((v) => v.rule)).toContain('pairing');
  });

  it('passes pairing when a partner of the required role is present', () => {
    const result = validateProposedShift({
      workplace: wp({
        pairing: [{ left: 'new', right: 'experienced', scope: 'same_day' }],
      }),
      proposed: { date: '2026-01-10', employee_id: 'e1', employee_role: 'new' },
      existingForWorkplace: [
        { id: '1', date: '2026-01-10', employee_id: 'e2', employee_role: 'experienced' },
      ],
    });
    expect(result.filter((v) => v.rule === 'pairing')).toEqual([]);
  });

  it('ignores pairing rules whose left role does not match the proposed role', () => {
    const result = validateProposedShift({
      workplace: wp({
        pairing: [{ left: 'new', right: 'experienced', scope: 'same_day' }],
      }),
      proposed: { date: '2026-01-10', employee_id: 'e1', employee_role: 'experienced' },
      existingForWorkplace: [],
    });
    expect(result).toEqual([]);
  });
});
