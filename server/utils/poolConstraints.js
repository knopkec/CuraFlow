/**
 * Constraint validator for shared (pool) shifts.
 *
 * Constraints are stored as JSON on shared_workplace.constraints_json.
 * Supported rules (initial set):
 *
 *   {
 *     "daily_required": 2,                       // min staffing per day
 *     "max_per_person_month": 4,                 // hard cap per person & calendar month
 *     "max_consecutive": 1,                      // max consecutive days for the same person
 *     "rest_after": { "next_day_off": true },    // person is unavailable the day after
 *     "pairing": [
 *       { "left": "Assistenzarzt neu",
 *         "right": "Assistenzarzt erfahren",
 *         "scope": "same_day" }
 *     ]
 *   }
 *
 * The validator is invoked on every manual write and by the auto-planner.
 * It returns an array of { rule, message } violations. An empty array
 * means the proposed assignment is valid.
 */

function parseConstraints(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function monthKey(dateStr) {
  // dateStr is YYYY-MM-DD
  return dateStr.slice(0, 7);
}

function dayDelta(aStr, bStr) {
  const a = new Date(`${aStr}T00:00:00Z`).getTime();
  const b = new Date(`${bStr}T00:00:00Z`).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

/**
 * @typedef {Object} ExistingShift
 * @property {string} id
 * @property {string} date           - YYYY-MM-DD
 * @property {string} employee_id
 * @property {string|null} [employee_role]
 *
 * @param {Object} params
 * @param {Object} params.workplace      - shared_workplace row
 * @param {Object} params.proposed       - { date, employee_id, employee_role }
 * @param {ExistingShift[]} params.existingForWorkplace - all entries for this workplace
 *                                                       in a window large enough to evaluate
 *                                                       month + consecutive constraints
 *                                                       (typically: month of proposed.date
 *                                                       +/- 1 day)
 * @returns {{rule: string, message: string}[]}
 */
export function validateProposedShift({ workplace, proposed, existingForWorkplace }) {
  const violations = [];
  const constraints = parseConstraints(workplace?.constraints_json);
  const { date, employee_id, employee_role } = proposed;

  // 1) max_per_person_month
  if (constraints.max_per_person_month) {
    const mk = monthKey(date);
    const count = existingForWorkplace.filter(
      (s) => s.employee_id === employee_id && monthKey(s.date) === mk
    ).length;
    if (count >= constraints.max_per_person_month) {
      violations.push({
        rule: 'max_per_person_month',
        message: `Limit von ${constraints.max_per_person_month} Diensten pro Monat erreicht`,
      });
    }
  }

  // 2) max_consecutive
  if (constraints.max_consecutive) {
    const personDates = existingForWorkplace
      .filter((s) => s.employee_id === employee_id)
      .map((s) => s.date);
    let consecutive = 1;
    for (const d of personDates) {
      const diff = Math.abs(dayDelta(d, date));
      if (diff >= 1 && diff <= constraints.max_consecutive) {
        consecutive += 1;
      }
    }
    if (consecutive > constraints.max_consecutive) {
      violations.push({
        rule: 'max_consecutive',
        message: `Mehr als ${constraints.max_consecutive} aufeinanderfolgende Dienste`,
      });
    }
  }

  // 3) rest_after.next_day_off — block same person also on day+1
  if (constraints.rest_after?.next_day_off) {
    const sameNextDay = existingForWorkplace.find(
      (s) => s.employee_id === employee_id && dayDelta(s.date, date) === 1
    );
    if (sameNextDay) {
      violations.push({
        rule: 'rest_after',
        message: 'Person ist am Folgetag bereits eingeteilt',
      });
    }
  }

  // 4) pairing rules: only "same_day" supported for now. We validate by
  //    checking whether at least one partner of the required role exists
  //    for the same date. This must be re-evaluated after every change to
  //    the day, hence it is informational on a single-add but blocking
  //    when the workplace has min_staff > 1.
  if (Array.isArray(constraints.pairing)) {
    for (const rule of constraints.pairing) {
      if (rule.scope !== 'same_day') continue;
      if (employee_role !== rule.left) continue;
      const sameDay = existingForWorkplace.filter((s) => s.date === date && s.employee_id !== employee_id);
      const hasPartner = sameDay.some((s) => s.employee_role === rule.right);
      if (!hasPartner) {
        violations.push({
          rule: 'pairing',
          message: `Pairing-Regel: ${rule.left} braucht ${rule.right} am gleichen Tag`,
        });
      }
    }
  }

  return violations;
}

export const __testing = {
  parseConstraints,
  monthKey,
  dayDelta,
};
