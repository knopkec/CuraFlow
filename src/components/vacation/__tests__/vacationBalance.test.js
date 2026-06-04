import { describe, it, expect } from 'vitest';
import { addDays, isWeekend, format } from 'date-fns';
import { computeVacationBalance, parseAnnualVacationDays } from '../vacationBalance';

/**
 * Build `count` consecutive weekday dates (Mon–Fri) starting from
 * `start`, formatted as `yyyy-MM-dd`. Skips weekends while counting.
 */
function buildWeekdays(start, count) {
  const dates = [];
  let cursor = new Date(start);
  while (dates.length < count) {
    if (!isWeekend(cursor)) {
      dates.push(format(cursor, 'yyyy-MM-dd'));
    }
    cursor = addDays(cursor, 1);
  }
  return dates;
}

const YEAR = 2026;
const TODAY = new Date(`${YEAR}-06-15T12:00:00`);

describe('computeVacationBalance', () => {
  it('returns the annual entitlement as remaining when there are no shifts', () => {
    const result = computeVacationBalance({
      shifts: [],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result).toEqual({
      total: 30,
      taken: 0,
      planned: 0,
      remaining: 30,
      overshoot: false,
    });
  });

  it('counts a past workday Urlaub shift as taken', () => {
    // 2026-06-10 is a Wednesday
    const result = computeVacationBalance({
      shifts: [{ date: `${YEAR}-06-10`, position: 'Urlaub' }],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(1);
    expect(result.planned).toBe(0);
    expect(result.remaining).toBe(29);
  });

  it('counts a future workday Urlaub shift as planned', () => {
    // 2026-06-20 is a Saturday → not counted as planned (weekend).
    // 2026-06-22 is a Monday → counted as planned.
    const result = computeVacationBalance({
      shifts: [
        { date: `${YEAR}-06-22`, position: 'Urlaub' },
        { date: `${YEAR}-06-20`, position: 'Urlaub' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(0);
    expect(result.planned).toBe(1);
    expect(result.remaining).toBe(29);
  });

  it('skips weekends (Sat/Sun) even when marked as Urlaub', () => {
    // 2026-06-13 Saturday, 2026-06-14 Sunday
    const result = computeVacationBalance({
      shifts: [
        { date: `${YEAR}-06-13`, position: 'Urlaub' },
        { date: `${YEAR}-06-14`, position: 'Urlaub' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(0);
    expect(result.planned).toBe(0);
    expect(result.remaining).toBe(30);
  });

  it('skips dates on the public-holiday set', () => {
    // 2026-06-10 is a Wednesday — counted unless on holiday list.
    const holidays = new Set([`${YEAR}-06-10`]);
    const result = computeVacationBalance({
      shifts: [{ date: `${YEAR}-06-10`, position: 'Urlaub' }],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
      publicHolidayDates: holidays,
    });
    expect(result.taken).toBe(0);
    expect(result.remaining).toBe(30);
  });

  it('ignores shifts of positions other than Urlaub', () => {
    const result = computeVacationBalance({
      shifts: [
        { date: `${YEAR}-06-10`, position: 'Krank' },
        { date: `${YEAR}-06-11`, position: 'Frei' },
        { date: `${YEAR}-06-12`, position: 'Dienstreise' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(0);
    expect(result.planned).toBe(0);
    expect(result.remaining).toBe(30);
  });

  it('only counts shifts of the requested year', () => {
    const result = computeVacationBalance({
      shifts: [
        { date: '2025-06-10', position: 'Urlaub' },
        { date: `${YEAR}-06-10`, position: 'Urlaub' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(1);
  });

  it('falls back to 30 days when annualVacationDays is null/undefined/empty string', () => {
    for (const falsy of [null, undefined, '']) {
      const result = computeVacationBalance({
        shifts: [],
        year: YEAR,
        annualVacationDays: falsy,
        today: TODAY,
      });
      expect(result.total).toBe(30);
    }
  });

  it('accepts 0 as a valid (legitimate zero) annual entitlement', () => {
    const result = computeVacationBalance({
      shifts: [],
      year: YEAR,
      annualVacationDays: 0,
      today: TODAY,
    });
    expect(result.total).toBe(0);
  });

  it('flags overshoot when remaining goes below zero', () => {
    // Build exactly 5 past weekdays and 26 future weekdays (Mon–Fri only),
    // starting from known-anchored dates so the test is deterministic.
    const pastDates = buildWeekdays(new Date(`${YEAR}-05-04T12:00:00`), 5);
    const futureDates = buildWeekdays(new Date(`${YEAR}-07-01T12:00:00`), 26);
    const shifts = [...pastDates, ...futureDates].map((d) => ({ date: d, position: 'Urlaub' }));
    const result = computeVacationBalance({
      shifts,
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(5);
    expect(result.planned).toBe(26);
    expect(result.remaining).toBe(-1);
    expect(result.overshoot).toBe(true);
  });

  it('includes the candidateDate in the planned count (UI in-progress)', () => {
    // 2026-06-16 is a Tuesday — future relative to today.
    const result = computeVacationBalance({
      shifts: [],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
      candidateDate: `${YEAR}-06-16`,
    });
    expect(result.planned).toBe(1);
    expect(result.remaining).toBe(29);
  });

  it('skips candidateDate when it falls on a weekend', () => {
    // 2026-06-20 is a Saturday
    const result = computeVacationBalance({
      shifts: [],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
      candidateDate: `${YEAR}-06-20`,
    });
    expect(result.planned).toBe(0);
    expect(result.remaining).toBe(30);
  });

  it('accepts Date objects in shifts[].date', () => {
    const d = new Date(`${YEAR}-06-10T00:00:00`);
    const result = computeVacationBalance({
      shifts: [{ date: d, position: 'Urlaub' }],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(1);
  });

  it('accepts an array for publicHolidayDates (in addition to Set)', () => {
    const result = computeVacationBalance({
      shifts: [{ date: `${YEAR}-06-10`, position: 'Urlaub' }],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
      publicHolidayDates: [`${YEAR}-06-10`],
    });
    expect(result.taken).toBe(0);
  });

  it('ignores malformed shift entries without crashing', () => {
    const result = computeVacationBalance({
      shifts: [
        null,
        undefined,
        {},
        { date: 'not-a-date', position: 'Urlaub' },
        { date: `${YEAR}-06-10`, position: 'Urlaub' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(1);
  });
});

describe('parseAnnualVacationDays', () => {
  it('returns the numeric value for finite numbers', () => {
    expect(parseAnnualVacationDays(30)).toBe(30);
    expect(parseAnnualVacationDays(0)).toBe(0);
    expect(parseAnnualVacationDays('26')).toBe(26);
  });

  it('falls back to 30 for null/undefined/empty string/non-numeric', () => {
    expect(parseAnnualVacationDays(null)).toBe(30);
    expect(parseAnnualVacationDays(undefined)).toBe(30);
    expect(parseAnnualVacationDays('')).toBe(30);
    expect(parseAnnualVacationDays('n/a')).toBe(30);
  });
});
