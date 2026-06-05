// Pure helpers for the row-scoped qualification filter in the scheduler.
//
// Row semantics (mirrors WorkplaceQualificationEditor state cycle):
//   - Pflicht          (is_mandatory=true,  is_excluded=false) -> REQUIRED (AND over all)
//   - Sollte           (is_mandatory=false, is_excluded=false) -> OPTIONAL (OR over all)
//   - Sollte nicht     (is_mandatory=true,  is_excluded=true)  -> DISCOURAGED (visual hint only, NOT a filter)
//   - Nicht           (is_mandatory=false, is_excluded=true)  -> EXCLUDED (AND-NOT)
//
// Matching rule (strict, evaluated in order, short-circuit):
//   1. EXCLUDED (Nicht): doctor must hold NONE of them.
//   2. REQUIRED (Pflicht): doctor must hold ALL of them.
//   3. OPTIONAL (Sollte): doctor must hold at least one of them.
//      (When only Nicht is configured, all other doctors remain visible
//      because no positive intent is inferred.)
//
// DISCOURAGED (Sollte-nicht) is NOT applied as a filter. Instead, the UI
// surfaces a red ring on the doctor chip in the sidebar and Anwesend
// areas to nudge the planner away from those candidates. OPTIONAL
// (Sollte) candidates receive a green ring to suggest they are
// preferred when multiple options are available.

/**
 * Build the qualification sets for a workplace from the four getter functions
 * provided by useAllWorkplaceQualifications.
 *
 * @param {object} args
 * @param {string|null|undefined} args.workplaceId
 * @param {Function} args.getRequired    Pflicht       (is_mandatory=true,  is_excluded=false)
 * @param {Function} args.getOptional    Sollte        (is_mandatory=false, is_excluded=false)
 * @param {Function} args.getDiscouraged Sollte nicht  (is_mandatory=true,  is_excluded=true)
 * @param {Function} args.getExcluded    Nicht         (is_mandatory=false, is_excluded=true)
 * @returns {{
 *   requiredIds: string[],
 *   optionalIds: string[],
 *   discouragedIds: string[],
 *   excludeIds: string[],
 * }}
 */
export function buildRowQualSets({ workplaceId, getRequired, getOptional, getDiscouraged, getExcluded }) {
    if (!workplaceId) {
        return { requiredIds: [], optionalIds: [], discouragedIds: [], excludeIds: [] };
    }

    const requiredIds = [...new Set(getRequired?.(workplaceId) || [])];
    const optionalIds = [...new Set(getOptional?.(workplaceId) || [])];
    const discouragedIds = [...new Set(getDiscouraged?.(workplaceId) || [])];
    const excludeIds = [...new Set(getExcluded?.(workplaceId) || [])];

    return { requiredIds, optionalIds, discouragedIds, excludeIds };
}

/**
 * Test whether a doctor passes the active row filter.
 *
 * Rule (strict, evaluated in order, short-circuit):
 *   1. filter null/empty -> true
 *   2. EXCLUDED (Nicht): doctor must hold NONE of them.
 *   3. REQUIRED (Pflicht): doctor must hold ALL of them.
 *   4. OPTIONAL (Sollte): doctor must hold at least one of them.
 *      (skipped when no positive intent was configured)
 *
 * Sollte-nicht is intentionally NOT a filter criterion here — see the
 * `getDoctorRowQualHint` helper for the visual hint.
 *
 * @param {object|null|undefined} filter  { requiredIds, optionalIds, discouragedIds, excludeIds }
 * @param {string[]} doctorQualIds
 * @returns {boolean}
 */
export function matchesRowQualFilter(filter, doctorQualIds) {
    if (!filter) return true;

    const ids = doctorQualIds || [];
    const required = filter.requiredIds || [];
    const optional = filter.optionalIds || [];
    const exclude = filter.excludeIds || [];

    if (
        required.length === 0
        && optional.length === 0
        && exclude.length === 0
    ) {
        return true;
    }

    if (exclude.length > 0 && exclude.some((qid) => ids.includes(qid))) {
        return false;
    }

    if (required.length > 0 && !required.every((qid) => ids.includes(qid))) {
        return false;
    }

    if (optional.length > 0 && !optional.some((qid) => ids.includes(qid))) {
        return false;
    }

    return true;
}

/**
 * Visual hint for a single doctor given the row filter. Sollte-nicht is
 * surfaced here as a red ring; Sollte as a green ring. The ring is
 * orthogonal to the strict filter — a doctor can still pass the filter
 * while being discouraged, in which case the planner gets a visual
 * warning that this candidate is suboptimal.
 *
 * Returns one of:
 *   - 'preferred'   doctor holds at least one Sollte qualification
 *   - 'discouraged' doctor holds at least one Sollte-nicht qualification
 *                    (takes precedence when both apply, to flag the warning)
 *   - null          no row filter active, or no matching hint
 */
export function getDoctorRowQualHint(filter, doctorQualIds) {
    if (!filter) return null;
    const ids = doctorQualIds || [];
    const optional = filter.optionalIds || [];
    const discouraged = filter.discouragedIds || [];

    if (optional.length === 0 && discouraged.length === 0) return null;

    const isDiscouraged = discouraged.length > 0 && discouraged.some((qid) => ids.includes(qid));
    if (isDiscouraged) return 'discouraged';

    const isPreferred = optional.length > 0 && optional.some((qid) => ids.includes(qid));
    if (isPreferred) return 'preferred';

    return null;
}

/**
 * Tailwind class fragment for the chip ring. Returns null when no hint is
 * active so the caller can keep the chip clean.
 */
export function getDoctorRowQualRingClass(hint) {
    if (hint === 'preferred') {
        return 'ring-2 ring-emerald-500';
    }
    if (hint === 'discouraged') {
        return 'ring-2 ring-rose-500';
    }
    return null;
}

/**
 * Compute the unique key for a row given its name and optional timeslot id.
 * Used to detect "click the same row again -> deactivate".
 */
export function rowKey(rowName, rowTimeslotId) {
    return rowTimeslotId ? `${rowName}__${rowTimeslotId}` : rowName;
}
