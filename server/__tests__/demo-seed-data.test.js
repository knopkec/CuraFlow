import { describe, expect, it } from 'vitest';
import { buildDemoSeedData, DEMO_PREFIX } from '../scripts/demo-seed-data.js';

describe('buildDemoSeedData', () => {
  it('creates rolling data around the provided reference date', () => {
    const seedData = buildDemoSeedData(new Date('2026-04-15T12:00:00Z'));

    expect(seedData.metadata.previousMonth).toBe('2026-03');
    expect(seedData.metadata.currentMonth).toBe('2026-04');
    expect(seedData.metadata.nextMonth).toBe('2026-05');
    expect(seedData.metadata.currentWeekDates).toContain('2026-04-13');
    expect(seedData.metadata.currentWeekDates).toContain('2026-04-19');
    expect(seedData.shiftEntries.some(([id]) => id.startsWith(DEMO_PREFIX))).toBe(true);
    expect(seedData.wishRequests.map(([, , targetMonth]) => targetMonth)).toEqual(
      expect.arrayContaining(['2026-03', '2026-04', '2026-05'])
    );
    expect(seedData.trainingRotations).toHaveLength(3);
    expect(seedData.staffingPlanEntries).toEqual(
      expect.arrayContaining([
        [expect.stringContaining('staffing-anna-2026-04'), 'demo-doctor-anna', 2026, 4, '1.0'],
      ])
    );
  });
});
