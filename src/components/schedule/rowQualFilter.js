// Pure helpers for the row-scoped qualification filter in the scheduler.
//
// Row semantics (mirrors WorkplaceQualificationEditor state cycle):
//   - Pflicht          (is_mandatory=true,  is_excluded=false)  -> REQUIRED (AND over all)
//   - Sollte           (is_mandatory=false, is_excluded=false)  -> OPTIONAL (OR over all)
//   - Sollte nicht     (is_mandatory=true,  is_excluded=true)   -> OPTIONAL (OR over all)
//   - Nicht           (is_mandatory=false, is_excluded=true)   -> EXCLUDED (AND-NOT)
//
// Matching rule (in order, short-circuit):
//   1. If REQUIRED is non-empty: doctor must hold ALL of them. Otherwise false.
//   2. If EXCLUDED is non-empty: doctor must hold NONE of them. Otherwise false.
//   3. If OPTIONAL is non-empty: doctor must hold at least one of them. Otherwise false.
//      (Without required/optional, a doctor passes even with no qualifications
//      defined beyond the excluded set, since we cannot infer any positive intent.)
//
// Activation: clicking the hover filter icon on a row whose workplace has
// configured qualifications builds a { requiredIds, optionalIds, excludeIds }
// triple and stores it as the single active row filter. Clicking the same row
// again clears it. Activating on another row replaces it.

/**
 * Build the required/optional/exclude sets for a workplace from the four
 * getter functions provided by useAllWorkplaceQualifications.
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
 *   excludeIds: string[],
 * }}
 */
export function buildRowQualSets({ workplaceId, getRequired, getOptional, getDiscouraged, getExcluded }) {
    if (!workplaceId) return { requiredIds: [], optionalIds: [], excludeIds: [] };

    const requiredIds = [...new Set(getRequired?.(workplaceId) || [])];

    const optionalIds = [
        ...new Set([
            ...(getOptional?.(workplaceId) || []),
            ...(getDiscouraged?.(workplaceId) || []),
        ]),
    ];

    const excludeIds = [...new Set(getExcluded?.(workplaceId) || [])];

    return { requiredIds, optionalIds, excludeIds };
}

/**
 * Test whether a doctor passes the active row filter.
 *
 * Rule (evaluated in order, short-circuit):
 *   1. filter null/empty -> true
 *   2. requiredIds non-empty -> doctor must hold ALL of them (AND)
 *   3. excludeIds non-empty -> doctor must hold NONE of them (AND-NOT)
 *   4. optionalIds non-empty -> doctor must hold at least one of them (OR)
 *      (skipped when no positive intent was configured)
 *
 * @param {object|null|undefined} filter  { requiredIds, optionalIds, excludeIds }
 * @param {string[]} doctorQualIds
 * @returns {boolean}
 */
export function matchesRowQualFilter(filter, doctorQualIds) {
    if (!filter) return true;
    const ids = doctorQualIds || [];
    const required = filter.requiredIds || [];
    const optional = filter.optionalIds || [];
    const exclude = filter.excludeIds || [];

    if (required.length === 0 && optional.length === 0 && exclude.length === 0) {
        return true;
    }

    // Pflicht: doctor must hold ALL of them.
    if (required.length > 0 && !required.every((qid) => ids.includes(qid))) {
        return false;
    }

    // Nicht: doctor must hold NONE of them.
    if (exclude.length > 0 && exclude.some((qid) => ids.includes(qid))) {
        return false;
    }

    // Sollte / Sollte-nicht: doctor must hold at least one of them.
    if (optional.length > 0 && !optional.some((qid) => ids.includes(qid))) {
        return false;
    }

    return true;
}

/**
 * Compute the unique key for a row given its name and optional timeslot id.
 * Used to detect "click the same row again -> deactivate".
 */
export function rowKey(rowName, rowTimeslotId) {
    return rowTimeslotId ? `${rowName}__${rowTimeslotId}` : rowName;
}
