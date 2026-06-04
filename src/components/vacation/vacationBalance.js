/**
 * Vacation balance calculator (pure, side-effect free).
 *
 * Mirrors the aggregation logic used by the master backend in
 * `server/routes/master.js` (aggregateVacationAcrossTenants) so that
 * tenant-frontend and master-frontend never disagree on what counts as
 * "vacation taken" vs "vacation planned".
 *
 * Rules (kept in sync with the master implementation):
 *  - Only entries with position === 'Urlaub' count.
 *  - Weekends (Sat/Sun) do not consume vacation.
 *  - Public holidays do not consume vacation.
 *  - A date on or before `today` is "taken", a date after is "planned".
 *  - The candidate date (the shift the user is currently planning) is
 *    optionally added on top so the UI can show the live over/undershoot
 *    while the user is dragging a range.
 *
 * @typedef {Object} VacationBalance
 * @property {number} total         Annual vacation entitlement (days).
 * @property {number} taken         Vacation days already consumed (past).
 * @property {number} planned       Vacation days scheduled in the future.
 * @property {number} remaining     total - taken - planned (may be negative).
 * @property {boolean} overshoot    true iff remaining < 0.
 *
 * @param {Object} options
 * @param {Array<{date: string, position: string}>} options.shifts
 *        All shifts for the employee (any positions; only 'Urlaub' counts).
 * @param {number|string} options.year
 *        The year to consider (e.g. 2026).
 * @param {number|null|undefined} options.annualVacationDays
 *        Annual entitlement, e.g. from `doctor.vacation_days`. Falsy/null
 *        values fall back to 30 to match the master backend default.
 * @param {Set<string>|Array<string>} [options.publicHolidayDates]
 *        Set or array of `yyyy-MM-dd` strings. Anything not provided is
 *        treated as "no public holiday information available".
 * @param {Date|string} [options.today]
 *        Override for "now" (useful for tests). Defaults to `new Date()`.
 * @param {string} [options.candidateDate]
 *        Optional `yyyy-MM-dd` for a date the user is currently planning.
 *        When provided it is counted as a planned vacation day regardless
 *        of whether it is in the past — it represents "the action in
 *        progress" so the UI can flag overshoot before save.
 * @returns {VacationBalance}
 */
export function computeVacationBalance({
  shifts = [],
  year,
  annualVacationDays,
  publicHolidayDates,
  today,
  candidateDate,
} = {}) {
  const total = parseAnnualVacationDays(annualVacationDays);

  const holidaySet = publicHolidayDates instanceof Set
    ? publicHolidayDates
    : new Set(Array.isArray(publicHolidayDates) ? publicHolidayDates : []);

  const todayDate = today instanceof Date ? today : new Date(today || Date.now());
  const todayStr = formatYmd(todayDate);

  let taken = 0;
  let planned = 0;

  for (const shift of shifts) {
    if (!shift || shift.position !== 'Urlaub') continue;
    const dateStr = extractYmd(shift.date);
    if (!dateStr) continue;
    if (Number(dateStr.slice(0, 4)) !== Number(year)) continue;
    if (!isCountableVacationDay(dateStr, holidaySet)) continue;

    if (dateStr <= todayStr) taken += 1;
    else planned += 1;
  }

  // Add the in-progress candidate date (does not need to be in the shifts
  // list yet — e.g. the user is dragging out a range).
  if (candidateDate) {
    const dateStr = extractYmd(candidateDate);
    if (
      dateStr
      && Number(dateStr.slice(0, 4)) === Number(year)
      && isCountableVacationDay(dateStr, holidaySet)
    ) {
      // In-progress dates count as "planned" for the overshoot warning —
      // the user is committing to them, regardless of past/future.
      planned += 1;
    }
  }

  const remaining = total - taken - planned;
  return {
    total,
    taken,
    planned,
    remaining,
    overshoot: remaining < 0,
  };
}

/**
 * Extracts `yyyy-MM-dd` from a `Date` or from a string already in that
 * format. Returns null when the input is unusable.
 */
function extractYmd(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatYmd(value);
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return formatYmd(parsed);
  }
  return null;
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses the annual vacation entitlement. Distinguishes "no value
 * provided" (null/undefined/empty string/non-numeric → fallback 30) from
 * "explicitly zero" (legitimate, e.g. for a Praktikant).
 *
 * Exported so the multi-doctor `VacationOverview` can show the entitlement
 * next to the planned+taken count without re-implementing the fallback.
 */
export function parseAnnualVacationDays(value) {
  if (value === null || value === undefined || value === '') return 30;
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return n;
}

/**
 * Returns true iff the given `yyyy-MM-dd` date is a workday that
 * consumes vacation (Mon–Fri, not on the public-holiday set).
 */
function isCountableVacationDay(dateStr, holidaySet) {
  // Re-parse the noon time to avoid TZ shifts.
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  if (holidaySet.has(dateStr)) return false;
  return true;
}
