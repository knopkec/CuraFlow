import { describe, it, expect } from 'vitest';
import {
  getWishStartDate,
  getWishEndDate,
  hasWishRange,
  isWishOnDate,
  getWishDateLabel,
} from '../wishRange';

describe('getWishStartDate', () => {
  it('returns range_start when present', () => {
    expect(getWishStartDate({ range_start: '2024-03-01', date: '2024-03-10' })).toBe('2024-03-01');
  });

  it('falls back to date when range_start is absent', () => {
    expect(getWishStartDate({ date: '2024-03-10' })).toBe('2024-03-10');
  });

  it('falls back to start_date before date', () => {
    expect(getWishStartDate({ start_date: '2024-03-08', date: '2024-03-10' })).toBe('2024-03-08');
  });

  it('prefers range_start over start_date and date', () => {
    expect(getWishStartDate({
      range_start: '2024-03-01',
      start_date: '2024-03-08',
      date: '2024-03-10',
    })).toBe('2024-03-01');
  });

  it('returns null for empty wish', () => {
    expect(getWishStartDate({})).toBe(null);
    expect(getWishStartDate(null)).toBe(null);
  });
});

describe('getWishEndDate', () => {
  it('returns range_end when present', () => {
    expect(getWishEndDate({ range_end: '2024-03-15', date: '2024-03-10' })).toBe('2024-03-15');
  });

  it('falls back to date when range_end is absent', () => {
    expect(getWishEndDate({ date: '2024-03-10' })).toBe('2024-03-10');
  });

  it('falls back to end_date before date', () => {
    expect(getWishEndDate({ end_date: '2024-03-12', date: '2024-03-10' })).toBe('2024-03-12');
  });

  it('falls back to range_start if date also absent', () => {
    expect(getWishEndDate({ range_start: '2024-03-10' })).toBe('2024-03-10');
  });

  it('falls back to start_date when end_date and date are absent', () => {
    expect(getWishEndDate({ start_date: '2024-03-09' })).toBe('2024-03-09');
  });

  it('prefers range_end over end_date, date, start_date, and range_start', () => {
    expect(getWishEndDate({
      range_end: '2024-03-15',
      end_date: '2024-03-12',
      date: '2024-03-10',
      start_date: '2024-03-08',
      range_start: '2024-03-01',
    })).toBe('2024-03-15');
  });

  it('returns null for empty wish', () => {
    expect(getWishEndDate({})).toBe(null);
  });
});

describe('hasWishRange', () => {
  it('returns true when start and end differ', () => {
    expect(hasWishRange({ range_start: '2024-03-01', range_end: '2024-03-07' })).toBe(true);
  });

  it('returns false when start equals end', () => {
    expect(hasWishRange({ date: '2024-03-01' })).toBe(false);
  });

  it('returns false when dates are missing', () => {
    expect(hasWishRange({})).toBe(false);
    expect(hasWishRange(null)).toBe(false);
  });
});

describe('isWishOnDate', () => {
  const rangeWish = { range_start: '2024-03-01', range_end: '2024-03-07' };
  const singleWish = { date: '2024-03-05' };

  it('returns true for a date within the range (inclusive)', () => {
    expect(isWishOnDate(rangeWish, '2024-03-01')).toBe(true);
    expect(isWishOnDate(rangeWish, '2024-03-04')).toBe(true);
    expect(isWishOnDate(rangeWish, '2024-03-07')).toBe(true);
  });

  it('returns false for a date outside the range', () => {
    expect(isWishOnDate(rangeWish, '2024-02-28')).toBe(false);
    expect(isWishOnDate(rangeWish, '2024-03-08')).toBe(false);
  });

  it('returns true for exact single-day match', () => {
    expect(isWishOnDate(singleWish, '2024-03-05')).toBe(true);
  });

  it('returns false for null wish or null date', () => {
    expect(isWishOnDate(null, '2024-03-05')).toBe(false);
    expect(isWishOnDate(singleWish, null)).toBe(false);
  });

  it('accepts a Date object as dateValue', () => {
    expect(isWishOnDate(singleWish, new Date(2024, 2, 5))).toBe(true);
  });
});

describe('getWishDateLabel', () => {
  it('returns "-" when both dates are missing', () => {
    expect(getWishDateLabel({})).toBe('-');
  });

  it('returns the single date for single-day wish', () => {
    expect(getWishDateLabel({ date: '2024-03-05' })).toBe('2024-03-05');
  });

  it('returns "start bis end" for a range', () => {
    const wish = { range_start: '2024-03-01', range_end: '2024-03-07' };
    expect(getWishDateLabel(wish)).toBe('2024-03-01 bis 2024-03-07');
  });
});
