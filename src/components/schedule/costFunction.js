/**
 * Unified Cost Function for Schedule Optimization
 *
 * Inspired by the ChordMatcher pattern (GP5-Plugin): all scheduling dimensions
 * are collapsed into a single additive numeric cost. Lower cost = better assignment.
 *
 * Dimensions:
 *   1. qualificationCost   — Pflicht/Sollte/Sollte-nicht/Nicht qualification match
 *   2. rotationMatchCost   — Does the assignment match the doctor's active rotation?
 *   3. fairnessCost        — FTE-adjusted service/assignment distribution
 *   4. impactCost          — How critical is this doctor for other workplaces?
 *   5. wishCost            — Approved/pending service wishes
 *   6. understaffingCost   — Consequence cost: what happens to OTHER workplaces if we assign here?
 *   7. weeklyCost          — Weekly assignment count balance
 *   8. displacementCost    — Bonus for previously displaced rotation doctors
 *   9. discouragedCost     — "Sollte nicht" soft penalty
 *  10. soleOccupantCost    — Penalty for pulling sole occupant from an availability-relevant workplace
 *
 * Usage:
 *   const cf = new CostFunction({ doctors, workplaces, ... });
 *   const cost = cf.assignmentCost(doctorId, workplace, dateStr, context);
 *   // Sort candidates by cost (ascending) — lowest cost = best candidate
 */

// Cost weights — tuneable parameters (analogous to ChordShape cost constants)
const WEIGHTS = {
    // Qualification dimension
    QUAL_EXCLUDED:       Infinity,  // Nicht-Qualifikation → impossible (like muted inner string)
    QUAL_MISSING_MANDATORY: 50,     // Missing Pflicht-Qualifikation
    QUAL_DISCOURAGED:    45,        // Sollte-nicht → very strong soft penalty
    QUAL_MISSING_OPTIONAL: 3,      // Missing Sollte-Qualifikation
    QUAL_HAS_OPTIONAL:   -2,       // Has all Sollte-Qualifikationen → bonus
    QUAL_HAS_ANY_OPTIONAL: -1,     // Has at least one Sollte → small bonus

    // Rotation match (analogous to fretPreferenceCost)
    ROT_MATCH:           -15,      // Doctor is on rotation for this workplace → big bonus
    ROT_DISPLACED_MATCH: -20,      // Displaced doctor returning to rotation target → bigger bonus
    ROT_ELSEWHERE:       8,        // Doctor has rotation elsewhere → penalty for displacing
    ROT_NEUTRAL:         0,        // No rotation → neutral

    // Fairness (analogous to fret span cost)
    FAIRNESS_WEIGHT:     5,        // Multiplier for FTE-adjusted service count deviation
    WEEKLY_WEIGHT:       2,        // Multiplier for weekly assignment count

    // Impact (rotation pool criticality)
    IMPACT_WEIGHT:       3,        // Multiplier for rotation impact score

    // Wishes (analogous to fretPreference bonus/penalty)
    WISH_APPROVED:       -20,      // Approved service wish for this position → strong bonus
    WISH_PENDING:        -10,      // Pending service wish → moderate bonus
    WISH_NO_SERVICE_APPROVED: Infinity, // Approved "kein Dienst" → impossible
    WISH_NO_SERVICE_PENDING: 12,   // Pending "kein Dienst" → soft penalty (assign if nobody else)

    // Understaffing consequence
    UNDERSTAFF_BELOW_MIN: 30,      // Each workplace dropping below min_staff
    UNDERSTAFF_BELOW_OPT: 5,       // Each workplace dropping below optimal_staff
    UNDERSTAFF_CRITICAL:  60,      // Workplace with 0 remaining qualified candidates

    // Context
    DISPLACEMENT_BONUS:  -3,       // Per displacement count → displaced doctors get priority
    SOLE_OCCUPANT:       10,       // Pulling a sole occupant from availability-relevant workplace
    LIMIT_EXCEEDED:      25,       // Doctor would exceed 4-week service limit
    CONSECUTIVE_PENALTY: 20,       // Consecutive service days (when forbidden)
    CONSECUTIVE_BONUS:   -25,      // Consecutive service days (when preferred, e.g. full weekend)
};

export { WEIGHTS };

/**
 * CostFunction — encapsulates all cost calculations for schedule optimization.
 *
 * Constructed once per planning run with all shared context.
 * Then call assignmentCost() for each candidate-workplace pair.
 */
export class CostFunction {
    constructor({
        doctors,
        workplaces,
        existingShifts,
        suggestions,
        trainingRotations,
        getDoctorQualIds,
        getWpRequiredQualIds,
        getWpOptionalQualIds,
        getWpExcludedQualIds,
        getWpDiscouragedQualIds,
        wishes,
        serviceHistory,
        weeklyCount,
        foregroundPosition,
        backgroundPosition,
        foregroundPositions,
        backgroundPositions,
        getServiceType,
        limitFG,
        limitBG,
        limitWeekend,
        isPublicHoliday,
        autoFreiByDate,
        isPartTimeOffDay,
        systemSettings,
    }) {
        this.doctors = doctors;
        this.workplaces = workplaces;
        this.existingShifts = existingShifts;
        this.suggestions = suggestions;
        this.trainingRotations = trainingRotations || [];
        this.getDoctorQualIds = getDoctorQualIds;
        this.getWpRequiredQualIds = getWpRequiredQualIds;
        this.getWpOptionalQualIds = getWpOptionalQualIds;
        this.getWpExcludedQualIds = getWpExcludedQualIds;
        this.getWpDiscouragedQualIds = getWpDiscouragedQualIds;
        this.wishes = wishes || [];
        this.serviceHistory = serviceHistory || {};
        this.weeklyCount = weeklyCount || {};
        this.foregroundPosition = foregroundPosition;
        this.backgroundPosition = backgroundPosition;
        this.foregroundPositions = foregroundPositions || new Set(foregroundPosition ? [foregroundPosition] : []);
        this.backgroundPositions = backgroundPositions || new Set(backgroundPosition ? [backgroundPosition] : []);
        // Use provided getServiceType or build a fallback from position sets
        this.getServiceType = getServiceType || ((name) => {
            if (this.foregroundPositions.has(name)) return 'fg';
            if (this.backgroundPositions.has(name)) return 'bg';
            return 'other';
        });
        this.limitFG = limitFG;
        this.limitBG = limitBG;
        this.limitWeekend = limitWeekend;
        this.isPublicHoliday = isPublicHoliday;
        this.autoFreiByDate = autoFreiByDate || {};
        this.isPartTimeOffDay = isPartTimeOffDay || (() => false);
        this.systemSettings = systemSettings;

        // Pre-compute lookup maps
        this._wpByName = {};
        this._wpById = {};
        for (const wp of workplaces) {
            this._wpByName[wp.name] = wp;
            this._wpById[wp.id] = wp;
        }

        this._doctorById = {};
        for (const d of doctors) {
            this._doctorById[d.id] = d;
        }
    }

    // ================================================================
    //  Core: compute total cost for assigning doctor to workplace/date
    // ================================================================

    /**
     * Compute the total cost of assigning a doctor to a workplace on a date.
     *
     * @param {string} doctorId
     * @param {object} workplace - workplace object (with id, name, category, etc.)
     * @param {string} dateStr - "YYYY-MM-DD"
     * @param {object} context - per-call context:
     *   {
     *     usedToday: Set,           // doctors already assigned (availability-blocked)
     *     posCount: Object,         // position -> count of assignments today
     *     displacementCount: Object, // doctorId -> displacement count
     *     rotationImpactScore: Object, // doctorId -> impact score
     *     serviceAssignedToday: Set, // doctors already on a service today
     *     soleOccupantDoctors: Set,  // doctors who are sole occupant at an avail-relevant wp
     *     phase: string,             // 'A' | 'B' | 'C' — which phase we're in
     *   }
     * @returns {number} totalCost (lower = better, Infinity = impossible)
     */
    assignmentCost(doctorId, workplace, dateStr, context = {}) {
        let totalCost = 0;

        // 0. Part-time off-day (full_days_off model) → hard block
        if (this.isPartTimeOffDay(doctorId, dateStr)) {
            return Infinity;
        }

        // 1. Qualification cost
        const qCost = this._qualificationCost(doctorId, workplace);
        if (qCost === Infinity) return Infinity;
        totalCost += qCost;

        // 2. Rotation match cost
        totalCost += this._rotationMatchCost(doctorId, workplace, dateStr, context);

        // 3. Fairness cost (service distribution)
        if (context.phase === 'A') {
            totalCost += this._fairnessCost(doctorId, workplace.name);
        }

        // 4. Impact cost (rotation criticality)
        if (context.phase === 'A' && context.rotationImpactScore) {
            const impact = context.rotationImpactScore[doctorId] || 0;
            // Only penalize for services that actually block rotation availability
            if (!workplace.allows_rotation_concurrently) {
                totalCost += impact * WEIGHTS.IMPACT_WEIGHT;
            }
        }

        // 5. Wish cost
        if (context.phase === 'A') {
            const wCost = this._wishCost(doctorId, dateStr, workplace.name);
            if (wCost === Infinity) return Infinity;
            totalCost += wCost;
        }

        // 6. Understaffing consequence cost
        if (context.phase === 'A' || context.phase === 'B') {
            totalCost += this._understaffingCost(doctorId, workplace, dateStr, context);
        }

        // 7. Weekly count cost
        const weekly = this.weeklyCount[doctorId] || 0;
        totalCost += weekly * WEIGHTS.WEEKLY_WEIGHT;

        // 8. Displacement bonus
        if (context.displacementCount) {
            const displaced = context.displacementCount[doctorId] || 0;
            totalCost += displaced * WEIGHTS.DISPLACEMENT_BONUS;
        }

        // 9. Sole occupant cost (Phase C)
        if (context.phase === 'C' && context.soleOccupantDoctors?.has(doctorId)) {
            totalCost += WEIGHTS.SOLE_OCCUPANT;
        }

        // 10. Service limit cost
        if (context.phase === 'A') {
            const lCost = this._limitCost(doctorId, workplace.name, dateStr);
            if (lCost === Infinity) return Infinity;
            totalCost += lCost;
        }

        // 11. Consecutive days cost (forbidden → penalty, preferred → bonus)
        if (context.phase === 'A') {
            totalCost += this._consecutiveCost(doctorId, workplace, dateStr, context);
        }

        return totalCost;
    }

    // ================================================================
    //  Dimension: Qualification
    // ================================================================

    _qualificationCost(doctorId, workplace) {
        const docQuals = this.getDoctorQualIds(doctorId) || [];

        // Excluded ("Nicht"): hard blocker
        const excl = this.getWpExcludedQualIds?.(workplace.id) || [];
        if (excl.length > 0 && excl.some(q => docQuals.includes(q))) {
            return WEIGHTS.QUAL_EXCLUDED;
        }

        // Discouraged ("Sollte nicht"): soft penalty
        const disc = this.getWpDiscouragedQualIds?.(workplace.id) || [];
        let cost = 0;
        if (disc.length > 0 && disc.some(q => docQuals.includes(q))) {
            cost += WEIGHTS.QUAL_DISCOURAGED;
        }

        // Missing mandatory ("Pflicht"): strong penalty
        const req = this.getWpRequiredQualIds?.(workplace.id) || [];
        if (req.length > 0 && !req.every(q => docQuals.includes(q))) {
            cost += WEIGHTS.QUAL_MISSING_MANDATORY;
        }

        // Optional ("Sollte"): bonus/penalty
        const opt = this.getWpOptionalQualIds?.(workplace.id) || [];
        if (opt.length > 0) {
            if (opt.every(q => docQuals.includes(q))) {
                cost += WEIGHTS.QUAL_HAS_OPTIONAL;
            } else if (opt.some(q => docQuals.includes(q))) {
                cost += WEIGHTS.QUAL_HAS_ANY_OPTIONAL;
            } else {
                cost += WEIGHTS.QUAL_MISSING_OPTIONAL;
            }
        }

        return cost;
    }

    // ================================================================
    //  Dimension: Rotation Match (analogous to fretPreferenceCost)
    // ================================================================

    _rotationMatchCost(doctorId, workplace, dateStr, context) {
        const rotTargets = this._getActiveRotationTargets(doctorId, dateStr);
        if (rotTargets.length === 0) return WEIGHTS.ROT_NEUTRAL;

        const hasRotHere = rotTargets.includes(workplace.name);
        const hasRotElsewhere = !hasRotHere && rotTargets.length > 0;

        if (hasRotHere) {
            const displaced = context.displacementCount?.[doctorId] || 0;
            return displaced > 0 ? WEIGHTS.ROT_DISPLACED_MATCH : WEIGHTS.ROT_MATCH;
        }

        if (hasRotElsewhere) {
            return WEIGHTS.ROT_ELSEWHERE;
        }

        return WEIGHTS.ROT_NEUTRAL;
    }

    _getActiveRotationTargets(doctorId, dateStr) {
        return this.trainingRotations
            .filter(r => r.doctor_id === doctorId && r.start_date <= dateStr && r.end_date >= dateStr)
            .map(r => {
                if (r.modality === 'Röntgen') {
                    const roeWp = this.workplaces.find(w =>
                        w.name === 'DL/konv. Rö' || w.name.includes('Rö')
                    );
                    return roeWp?.name || r.modality;
                }
                return r.modality;
            });
    }

    // ================================================================
    //  Dimension: Fairness (analogous to fret span cost)
    // ================================================================

    _fairnessCost(doctorId, serviceName) {
        const hist = this.serviceHistory[doctorId] || { fg: 0, bg: 0, weekend: 0 };
        const fte = this._doctorById[doctorId]?.fte ?? 1.0;

        let serviceCount;
        const svcType = this.getServiceType(serviceName);
        if (svcType === 'fg') {
            serviceCount = hist.fg;
        } else if (svcType === 'bg') {
            serviceCount = hist.bg;
        } else {
            serviceCount = (hist.fg || 0) + (hist.bg || 0);
        }

        // FTE-adjusted: more services relative to FTE = higher cost
        return (serviceCount / (fte || 1)) * WEIGHTS.FAIRNESS_WEIGHT;
    }

    // ================================================================
    //  Dimension: Wish (analogous to fretPreference bonus)
    // ================================================================

    _wishCost(doctorId, dateStr, positionName) {
        // Hard block: approved "kein Dienst"
        const hasApprovedNoService = this.wishes.some(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'no_service' &&
            w.status === 'approved'
        );
        if (hasApprovedNoService) return WEIGHTS.WISH_NO_SERVICE_APPROVED;

        // Pending "kein Dienst" → soft penalty
        const hasPendingNoService = this.wishes.some(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'no_service' &&
            w.status === 'pending'
        );
        if (hasPendingNoService) return WEIGHTS.WISH_NO_SERVICE_PENDING;

        // Service wish for this position → bonus
        const serviceWish = this.wishes.find(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'service' &&
            (w.status === 'approved' || w.status === 'pending')
        );
        if (serviceWish) {
            if (!serviceWish.position || serviceWish.position === positionName) {
                return serviceWish.status === 'approved'
                    ? WEIGHTS.WISH_APPROVED
                    : WEIGHTS.WISH_PENDING;
            }
        }

        return 0;
    }

    // ================================================================
    //  Dimension: Service Limit
    // ================================================================

    _limitCost(doctorId, serviceName, dateStr) {
        const hist = this.serviceHistory[doctorId] || { fg: 0, bg: 0, weekend: 0 };
        const fte = this._doctorById[doctorId]?.fte ?? 1.0;

        const svcType = this.getServiceType(serviceName);
        const isFG = svcType === 'fg';
        const isBG = svcType === 'bg';
        const d = new Date(dateStr + 'T00:00:00');
        const isWknd = (d.getDay() === 0 || d.getDay() === 6) && isFG;

        if (isFG && (hist.fg + 1) > Math.round(this.limitFG * fte)) return WEIGHTS.LIMIT_EXCEEDED;
        if (isBG && (hist.bg + 1) > Math.round(this.limitBG * fte)) return WEIGHTS.LIMIT_EXCEEDED;
        if (isWknd && (hist.weekend + 1) > this.limitWeekend) return WEIGHTS.LIMIT_EXCEEDED;

        return 0;
    }

    // ================================================================
    //  Dimension: Consecutive Days Cost
    //  Modes: 'forbidden' → penalty, 'allowed' → neutral, 'preferred' → bonus
    //  Backward compat: allows_consecutive_days===false → 'forbidden'
    // ================================================================

    _consecutiveCost(doctorId, workplace, dateStr, context) {
        if (workplace.category !== 'Dienste') return 0;

        // Determine consecutive mode
        const mode = workplace.consecutive_days_mode
            || (workplace.allows_consecutive_days === false ? 'forbidden' : 'allowed');

        if (mode === 'allowed') return 0;

        // Check if this doctor already has the same service on adjacent days
        const d = new Date(dateStr + 'T00:00:00');
        const prev = new Date(d); prev.setDate(prev.getDate() - 1);
        const next = new Date(d); next.setDate(next.getDate() + 1);
        // Use local date formatting to avoid timezone issues (toISOString() converts to UTC)
        const pad = n => String(n).padStart(2, '0');
        const fmt = dt => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
        const prevStr = fmt(prev);
        const nextStr = fmt(next);

        const hasAdjacent = this.existingShifts.some(s =>
            s.doctor_id === doctorId &&
            s.position === workplace.name &&
            (s.date === prevStr || s.date === nextStr)
        ) || (this.suggestions || []).some(s =>
            s.doctor_id === doctorId &&
            s.position === workplace.name &&
            (s.date === prevStr || s.date === nextStr)
        );

        if (mode === 'forbidden' && hasAdjacent) {
            return WEIGHTS.CONSECUTIVE_PENALTY;
        }

        if (mode === 'preferred') {
            // Bonus if adjacent assignment exists, small penalty if not
            return hasAdjacent ? WEIGHTS.CONSECUTIVE_BONUS : 0;
        }

        return 0;
    }

    // ================================================================
    //  Dimension: Understaffing Consequence Cost
    //  (The key innovation: simulate removing this doctor from the
    //   available pool and measure impact on other workplaces)
    // ================================================================

    _understaffingCost(doctorId, targetWorkplace, dateStr, context) {
        const { usedToday, posCount } = context;
        if (!usedToday || !posCount) return 0;

        // Only compute for assignments that actually block availability
        if (targetWorkplace.affects_availability === false && targetWorkplace.category !== 'Dienste') {
            return 0;
        }

        // If the target workplace allows rotation concurrently, assigning a doctor
        // here does NOT remove them from the available pool (see assign() in autoFillEngine).
        // Therefore there is no understaffing consequence — the doctor remains available.
        if (targetWorkplace.allows_rotation_concurrently) {
            return 0;
        }

        let cost = 0;

        // Simulate: if we assign this doctor, they're no longer available.
        // For each OTHER availability-relevant workplace that needs staff:
        const otherWps = this.workplaces.filter(wp =>
            wp.id !== targetWorkplace.id &&
            wp.category !== 'Dienste' &&
            wp.affects_availability !== false
        );

        for (const wp of otherWps) {
            const currentStaff = posCount[wp.name] || 0;
            const optStaff = Math.max(wp.optimal_staff ?? 1, wp.min_staff ?? 1);
            const minStaff = wp.min_staff ?? 1;

            if (currentStaff >= optStaff) continue; // Already fully staffed

            // Count how many qualified, available doctors remain for this wp
            // (excluding the doctor we're considering assigning elsewhere)
            const qualifiedAvailable = this.doctors.filter(d => {
                if (d.id === doctorId) return false; // Simulated removal
                if (usedToday.has(d.id)) return false;

                // Check excluded
                const excl = this.getWpExcludedQualIds?.(wp.id) || [];
                const docQuals = this.getDoctorQualIds(d.id) || [];
                if (excl.length > 0 && excl.some(q => docQuals.includes(q))) return false;

                // Check mandatory qualification
                const req = this.getWpRequiredQualIds?.(wp.id) || [];
                if (req.length > 0 && !req.every(q => docQuals.includes(q))) return false;

                return true;
            }).length;

            const remainingAfterAssignment = qualifiedAvailable;
            const slotsNeeded = optStaff - currentStaff;

            if (remainingAfterAssignment === 0 && slotsNeeded > 0) {
                // Critical: NO qualified candidates left for a workplace that needs staff
                cost += WEIGHTS.UNDERSTAFF_CRITICAL;
            } else if (remainingAfterAssignment < slotsNeeded) {
                // Will drop below minimum
                if (currentStaff + remainingAfterAssignment < minStaff) {
                    cost += WEIGHTS.UNDERSTAFF_BELOW_MIN;
                } else {
                    cost += WEIGHTS.UNDERSTAFF_BELOW_OPT;
                }
            }
        }

        return cost;
    }

    // ================================================================
    //  Plan-level scoring (for variant comparison in aiAutoFillEngine)
    //  Replaces the old scorePlan() function
    // ================================================================

    /**
     * Score an entire plan (list of suggestions) across all dimensions.
     * Used to rank the 8 deterministic variants.
     *
     * @param {Array} planSuggestions - array of { date, position, doctor_id }
     * @param {string[]} weekDayStrs - all dates in the planning period
     * @returns {number} totalScore (higher = better, inverted from assignment cost)
     */
    scorePlan(planSuggestions, weekDayStrs) {
        const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
        let score = 0;

        // --- 1. Fairness: std deviation of FTE-adjusted assignments ---
        const counts = {};
        for (const d of this.doctors) counts[d.id] = 0;
        for (const s of planSuggestions) {
            if (!absencePositions.includes(s.position) && s.position !== 'Verfügbar') {
                counts[s.doctor_id] = (counts[s.doctor_id] || 0) + 1;
            }
        }
        const fteAdjusted = this.doctors.map(d => (counts[d.id] || 0) / (d.fte || 1));
        const mean = fteAdjusted.reduce((a, b) => a + b, 0) / (fteAdjusted.length || 1);
        const variance = fteAdjusted.reduce((a, v) => a + (v - mean) ** 2, 0) / (fteAdjusted.length || 1);
        score -= Math.sqrt(variance) * 10;

        // --- 2. Rotation fulfillment: bonus for each rotation target met ---
        for (const rot of this.trainingRotations) {
            for (const dateStr of weekDayStrs) {
                if (rot.start_date <= dateStr && rot.end_date >= dateStr) {
                    const assigned = planSuggestions.find(s =>
                        s.date === dateStr && s.doctor_id === rot.doctor_id && s.position === rot.modality
                    );
                    if (assigned) score += 2;
                }
            }
        }

        // --- 3. Coverage: small bonus per filled slot ---
        score += planSuggestions.filter(s =>
            !absencePositions.includes(s.position) && s.position !== 'Verfügbar'
        ).length * 0.1;

        // --- 4. Qualification quality (per-assignment cost) ---
        for (const s of planSuggestions) {
            if (absencePositions.includes(s.position) || s.position === 'Verfügbar') continue;
            const wp = this._wpByName[s.position];
            if (!wp) continue;

            const qCost = this._qualificationCost(s.doctor_id, wp);
            if (qCost === Infinity) {
                score -= 25; // Hard exclusion violation
            } else {
                // Invert: positive cost → negative score impact
                score -= qCost;
            }
        }

        // --- 5. Understaffing penalty per day ---
        for (const dateStr of weekDayStrs) {
            const daySuggestions = planSuggestions.filter(s => s.date === dateStr);

            for (const wp of this.workplaces) {
                if (wp.category === 'Dienste') continue;
                if (wp.affects_availability === false) continue;

                const optStaff = Math.max(wp.optimal_staff ?? 1, wp.min_staff ?? 1);
                const minStaff = wp.min_staff ?? 1;
                const assigned = daySuggestions.filter(s => s.position === wp.name).length;
                const existing = this.existingShifts.filter(s =>
                    s.date === dateStr && s.position === wp.name
                ).length;
                const total = assigned + existing;

                if (total < minStaff) {
                    score -= (minStaff - total) * 8; // Below minimum: heavy penalty
                } else if (total < optStaff) {
                    score -= (optStaff - total) * 2; // Below optimal: moderate penalty
                }
            }
        }

        // --- 6. Service fairness across doctors ---
        const serviceCounts = {};
        for (const d of this.doctors) serviceCounts[d.id] = 0;
        for (const s of planSuggestions) {
            const wp = this._wpByName[s.position];
            if (wp?.category === 'Dienste') {
                serviceCounts[s.doctor_id] = (serviceCounts[s.doctor_id] || 0) + 1;
            }
        }
        const svcFteAdj = this.doctors.map(d => (serviceCounts[d.id] || 0) / (d.fte || 1));
        const svcMean = svcFteAdj.reduce((a, b) => a + b, 0) / (svcFteAdj.length || 1);
        const svcVar = svcFteAdj.reduce((a, v) => a + (v - svcMean) ** 2, 0) / (svcFteAdj.length || 1);
        score -= Math.sqrt(svcVar) * 15; // Service fairness weighted more heavily

        return Math.round(score * 100) / 100;
    }
}
