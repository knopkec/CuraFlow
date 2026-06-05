// Pure helpers for the row-scoped qualification filter in the scheduler.
//
// Row semantics (mirrors WorkplaceQualificationEditor state cycle):
//   - Pflicht          (is_mandatory=true,  is_excluded=false)  -> REQUIRED (AND over all)
//   - Sollte           (is_mandatory=false, is_excluded=false)  -> OPTIONAL (OR over all)
//   - Sollte nicht     (is_mandatory=true,  is_excluded=true)   -> DISCOURAGED (soft exclude)
//   - Nicht           (is_mandatory=false, is_excluded=true)   -> EXCLUDED (hard AND-NOT)
//
// Matching rule (in order, short-circuit):
//   1. EXCLUDED: if any Nicht is configured, doctor must hold NONE of them.
//   2. REQUIRED: if any Pflicht is configured, doctor must hold ALL of them.
//   3. OPTIONAL: if any Sollte is configured, doctor must hold at least one.
//   4. DISCOURAGED: if any Sollte-nicht is configured, doctor should hold NONE
//      of them — UNLESS no doctor would otherwise pass the required/optional
//      rule. In that degraded fallback we relax the discouraged set to avoid
//      returning zero candidates when staffing is required.
//
// Activation: clicking the hover filter icon on a row whose workplace has
// configured qualifications builds a { requiredIds, optionalIds,
// discouragedIds, excludeIds } quadruple and stores it as the single active
// row filter. Clicking the same row again clears it. Activating on another
// row replaces it.

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
 * Test whether a single doctor passes the strict (preferred) part of the row
 * filter: EXCLUDED, REQUIRED, OPTIONAL. Does NOT yet apply the soft
 * DISCOURAGED rule.
 *
 * @param {object} filter
 * @param {string[]} doctorQualIds
 * @returns {boolean}
 */
function passesPreferredRule(filter, doctorQualIds) {
    const ids = doctorQualIds || [];
    const required = filter.requiredIds || [];
    const optional = filter.optionalIds || [];
    const exclude = filter.excludeIds || [];

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
 * Test whether a doctor holds none of the DISCOURAGED (Sollte-nicht) qualifications.
 */
function isCleanOfDiscouraged(filter, doctorQualIds) {
    const discouraged = filter.discouragedIds || [];
    if (discouraged.length === 0) return true;
    const ids = doctorQualIds || [];
    return !discouraged.some((qid) => ids.includes(qid));
}

/**
 * Test whether a doctor passes the active row filter.
 *
 * Rule (evaluated in order, short-circuit):
 *   1. filter null/empty -> true
 *   2. EXCLUDED (Nicht): doctor must hold NONE of them.
 *   3. REQUIRED (Pflicht): doctor must hold ALL of them.
 *   4. OPTIONAL (Sollte): doctor must hold at least one of them.
 *      (When only Nicht or only Sollte-nicht are configured, all other
 *      doctors remain visible because no positive intent is inferred.)
 *   5. DISCOURAGED (Sollte-nicht): doctor should hold NONE of them. If no
 *      doctor in the doctor list would otherwise pass the preferred rule,
 *      we relax the discouraged constraint so staffing is always possible.
 *
 * @param {object|null|undefined} filter  { requiredIds, optionalIds, discouragedIds, excludeIds }
 * @param {string[]} doctorQualIds
 * @param {Array<{qualification_ids?: string[]}>} [allDoctors] optional: all doctors
 *        in the tenant. Required only when a discouraged set is configured and
 *        we need to detect the empty-result fallback.
 * @returns {boolean}
 */
export function matchesRowQualFilter(filter, doctorQualIds, allDoctors = null) {
    if (!filter) return true;

    const required = filter.requiredIds || [];
    const optional = filter.optionalIds || [];
    const discouraged = filter.discouragedIds || [];
    const exclude = filter.excludeIds || [];

    if (
        required.length === 0
        && optional.length === 0
        && discouraged.length === 0
        && exclude.length === 0
    ) {
        return true;
    }

    if (!passesPreferredRule(filter, doctorQualIds)) {
        return false;
    }

    if (discouraged.length === 0) {
        return true;
    }

    if (isCleanOfDiscouraged(filter, doctorQualIds)) {
        return true;
    }

    // Doctor is discouraged. Check if any other doctor would pass BOTH the
    // preferred rule AND the discouraged check. If so, this doctor must be
    // rejected (we have a clean preferred candidate). Otherwise we relax
    // discouraged to avoid an empty staffing list.
    if (Array.isArray(allDoctors) && allDoctors.length > 0) {
        const anyCleanPreferredCandidateExists = allDoctors.some((doc) => {
            const docIds = doc.qualification_ids || [];
            return passesPreferredRule(filter, docIds) && isCleanOfDiscouraged(filter, docIds);
        });
        if (!anyCleanPreferredCandidateExists) {
            return true;
        }
    }

    return false;
}

/**
 * Compute the unique key for a row given its name and optional timeslot id.
 * Used to detect "click the same row again -> deactivate".
 */
export function rowKey(rowName, rowTimeslotId) {
    return rowTimeslotId ? `${rowName}__${rowTimeslotId}` : rowName;
}
