/**
 * Deterministic Auto-Fill Engine for the Schedule Board.
 *
 * Priority-based per-day algorithm:
 *
 *   Phase A – Dienste (Services, highest priority):
 *       Fills all service positions FIRST, because:
 *       - Services with auto_off generate "Frei" the next day → affects availability
 *       - Shift wishes (Dienstwünsche) must be respected
 *       Rules:
 *         • Approved "Dienstwunsch" (type='service', status='approved') → priority assignment
 *         • Approved "kein Dienst" (type='no_service', status='approved') → hard NOT (excluded)
 *         • Pending "kein Dienst" (type='no_service', status='pending') → soft NOT (only if others available)
 *         • Qualification + NOT-qualification checks still apply
 *         • Auto-Frei: if service has auto_off, a "Frei" entry is generated only on the direct next day
 *           when that day is neither Saturday, Sunday nor a public holiday
 *
 *   Phase B – Verfügbarkeitsrelevante Arbeitsplätze (affects_availability=true, non-service):
 *       After services are filled and Auto-Frei is applied, we know who is truly available.
 *       Fill rotation workplaces and other availability-relevant positions.
 *       Uses qualification coverage, rotation priority, displacement tracking, round-robin.
 *
 *   Phase C – Nicht-verfügbarkeitsrelevante Arbeitsplätze (affects_availability=false):
 *       Filled last. Doctors assigned in Phase B are STILL available here.
 *       Only absence and service assignments block.
 *
 *   Phase D – Auto-Frei for remaining auto_off positions (non-service):
 *       E.g. if a rotation workplace also has auto_off.
 *
 * Cost Function (v2):
 *   All candidate sorting now uses a unified additive cost function (CostFunction class)
 *   inspired by the ChordMatcher pattern. Lower cost = better candidate.
 *   See costFunction.js for dimension details and tuneable weights.
 */

import { CostFunction } from './costFunction';
import { getAutoFreiDate } from '@/utils/autoFrei';
import { getWorkplaceCategoriesFromSettings, workplaceAllowsMultiple } from '@/utils/workplaceCategoryUtils';
import { isFullDaysOffModel, getPartTimeWorkDaysPerWeek } from './doctorWorkTime';

export function generateSuggestions({
    weekDays,
    doctors,
    workplaces,
    existingShifts,
    allShifts = [],
    trainingRotations,
    isPublicHoliday,
    getDoctorQualIds,
    getWpRequiredQualIds,
    getWpOptionalQualIds,
    getWpExcludedQualIds,
    getWpDiscouragedQualIds,
    categoriesToFill,
    systemSettings,
    wishes = [],
    workplaceTimeslots = [],
    debug = null,
}) {
    // Shuffle doctors to avoid deterministic bias (e.g. same doctors always getting Monday shifts)
    const shuffled = [...doctors];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    doctors = shuffled;

    const suggestions = [];
    const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
    const DEFAULT_ACTIVE_DAYS = [1, 2, 3, 4, 5];

    const debugEnabled = Boolean(debug?.enabled);
    const debugEntries = debug?.entries || [];
    const debugRequestId = debug?.requestId || `det-${Date.now().toString(36)}`;
    const debugMaxEntries = 1200;
    const debugLog = (stage, message, meta = null) => {
        if (!debugEnabled) return;
        debugEntries.push({
            ts: new Date().toISOString(),
            stage,
            message,
            ...(meta ? { meta } : {}),
        });
        if (debugEntries.length > debugMaxEntries) debugEntries.shift();
    };
    const doctorNameById = Object.fromEntries(doctors.map(d => [d.id, d.name]));

    debugLog('init', 'Deterministic AutoFill started', {
        requestId: debugRequestId,
        days: weekDays.length,
        doctors: doctors.length,
        workplaces: workplaces.length,
        categoriesToFill,
        existingShifts: existingShifts.length,
    });

    // ========================================================
    //  Helper functions
    // ========================================================

    const getActiveDays = (wp) =>
        wp.active_days?.length > 0 ? wp.active_days : DEFAULT_ACTIVE_DAYS;

    const isActiveOnDate = (wp, date) => {
        const ad = getActiveDays(wp);
        // Feiertag = wie Sonntag: An Feiertagen zählt nur, ob Sonntag (0) aktiv ist
        if (isPublicHoliday(date)) return ad.some(d => Number(d) === 0);
        return ad.some(d => Number(d) === date.getDay());
    };

    /** Does this doctor hold ALL mandatory qualifications for a workplace? */
    const isQualified = (doctorId, wpId) => {
        const req = getWpRequiredQualIds(wpId);
        if (!req?.length) return true;
        const doc = getDoctorQualIds(doctorId);
        if (!doc) return false;
        return req.every(q => doc.includes(q));
    };

    /** Is the doctor EXCLUDED from this workplace via a NOT-qualification? */
    const isExcluded = (doctorId, wpId) => {
        const excl = getWpExcludedQualIds?.(wpId);
        if (!excl?.length) return false;
        const doc = getDoctorQualIds(doctorId);
        if (!doc?.length) return false;
        return excl.some(q => doc.includes(q));
    };

    /** Does this workplace have any mandatory qualification requirement? */
    const hasQualReq = (wp) => {
        const rq = getWpRequiredQualIds(wp.id);
        return rq?.length > 0;
    };

    /** Does the doctor have ALL optional qualifications for this workplace? */
    const hasOptionalQuals = (doctorId, wpId) => {
        const opt = getWpOptionalQualIds?.(wpId);
        if (!opt?.length) return true; // no optional quals = considered "has them"
        const doc = getDoctorQualIds(doctorId);
        if (!doc?.length) return false;
        return opt.every(q => doc.includes(q));
    };

    /** Does the doctor have ANY optional qualification for this workplace? */
    const hasAnyOptionalQual = (doctorId, wpId) => {
        const opt = getWpOptionalQualIds?.(wpId);
        if (!opt?.length) return true;
        const doc = getDoctorQualIds(doctorId);
        if (!doc?.length) return false;
        return opt.some(q => doc.includes(q));
    };

    /** Does this workplace have any optional qualification? */
    const hasOptionalQualReq = (wp) => {
        const oq = getWpOptionalQualIds?.(wp.id);
        return oq?.length > 0;
    };

    /** Is the doctor DISCOURAGED from this workplace via a 'Sollte nicht'-qualification? */
    const isDiscouraged = (doctorId, wpId) => {
        const disc = getWpDiscouragedQualIds?.(wpId);
        if (!disc?.length) return false;
        const doc = getDoctorQualIds(doctorId);
        if (!doc?.length) return false;
        return disc.some(q => doc.includes(q));
    };

    const customCategories = getWorkplaceCategoriesFromSettings(systemSettings);
    const allowsMultiple = (wp) => workplaceAllowsMultiple(wp, customCategories);

    /** optimal_staff: target headcount */
    const getOptimal = (wp) => {
        if (!allowsMultiple(wp)) return 1;
        return Math.max(wp.optimal_staff ?? 1, wp.min_staff ?? 1);
    };

    const getMinStaff = (wp) => {
        if (!allowsMultiple(wp)) return 1;
        return wp.min_staff ?? 1;
    };

    // ========================================================
    //  Timeslot helpers
    // ========================================================

    /** Get timeslots for a workplace (sorted by order) */
    const getTimeslots = (wp) => {
        if (!wp.timeslots_enabled) return [];
        return workplaceTimeslots
            .filter(t => t.workplace_id === wp.id)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    };

    /** Build a composite key for position counting: position + optional timeslot_id */
    const slotKey = (posName, timeslotId) => timeslotId ? `${posName}::${timeslotId}` : posName;

    /** Count existing shifts for a position+timeslot combo on a date */
    const countShiftsForSlot = (dateStr, posName, timeslotId, existingArr, suggestionsArr) => {
        let count = 0;
        for (const s of existingArr) {
            if (s.date !== dateStr || s.position !== posName) continue;
            if (timeslotId) {
                if (s.timeslot_id === timeslotId) count++;
            } else {
                if (!s.timeslot_id) count++;
            }
        }
        for (const s of suggestionsArr) {
            if (s.date !== dateStr || s.position !== posName) continue;
            if (timeslotId) {
                if (s.timeslot_id === timeslotId) count++;
            } else {
                if (!s.timeslot_id) count++;
            }
        }
        return count;
    };

    /**
     * Expand workplaces into "fill slots" — each workplace becomes one or more slots.
     * A slot has: { wp, timeslotId, timeslotLabel }
     * For workplaces with N timeslots, N slots are created, each with the same
     * optimal/min staff and qualification requirements as the parent workplace.
     */
    const expandToSlots = (wps) => {
        const slots = [];
        for (const wp of wps) {
            const ts = getTimeslots(wp);
            if (ts.length > 1) {
                // Multiple timeslots: each timeslot is an independent slot
                for (const t of ts) {
                    slots.push({ wp, timeslotId: t.id, timeslotLabel: t.label });
                }
            } else {
                // No timeslots or exactly 1 timeslot: treat as single slot
                // If single timeslot, include its ID for proper tracking
                const singleTsId = ts.length === 1 ? ts[0].id : null;
                slots.push({ wp, timeslotId: singleTsId, timeslotLabel: ts[0]?.label || null });
            }
        }
        return slots;
    };

    // ---- Weekly tracking for fair distribution ----
    const weeklyCount = {};
    for (const s of existingShifts) {
        if (!absencePositions.includes(s.position) && s.position !== 'Verfügbar') {
            weeklyCount[s.doctor_id] = (weeklyCount[s.doctor_id] || 0) + 1;
        }
    }
    const getWeekly = (id) => weeklyCount[id] || 0;
    const incWeekly = (id) => { weeklyCount[id] = (weeklyCount[id] || 0) + 1; };

    // ========================================================
    //  4-week service limits & fair VG/HG distribution
    // ========================================================

    // Read limit settings
    const getSetting = (key, def) => {
        const s = systemSettings?.find(x => x.key === key);
        return parseInt(s?.value || def);
    };
    const getSettingBool = (key, def = false) => {
        const s = systemSettings?.find(x => x.key === key);
        if (!s) return def;
        return s.value === 'true' || s.value === '1';
    };
    const limitFG = getSetting('limit_fore_services', '4');
    const limitBG = getSetting('limit_back_services', '12');
    const limitWeekend = getSetting('limit_weekend_services', '1');

    // Identify foreground/background service positions by service_type field
    // service_type: 1=Bereitschaftsdienst (Vordergrund), 2=Rufbereitschaftsdienst (Hintergrund), 3=Schichtdienst, 4=Andere
    const serviceWorkplaces = workplaces.filter(w => w.category === 'Dienste');
    const sortedServices = [...serviceWorkplaces].sort((a, b) => (a.order || 0) - (b.order || 0));
    
    // Build sets of position names by service_type
    const foregroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 1).map(w => w.name));
    const backgroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 2).map(w => w.name));
    
    // Legacy fallback: if no service_type is set, use old convention (first = FG, rest = BG)
    if (foregroundPositions.size === 0 && backgroundPositions.size === 0 && sortedServices.length > 0) {
        foregroundPositions.add(sortedServices[0].name);
        sortedServices.slice(1).forEach(w => backgroundPositions.add(w.name));
    }
    
    // Helper to get service type of a position
    const getServiceType = (positionName) => {
        if (foregroundPositions.has(positionName)) return 'fg';
        if (backgroundPositions.has(positionName)) return 'bg';
        return 'other';
    };
    
    // For backward compatibility, keep single position names (first of each set)
    const foregroundPosition = [...foregroundPositions][0] || null;
    const backgroundPosition = [...backgroundPositions][0] || null;

    // Compute 4-week window: 3 weeks before the first planning day through the last planning day
    const firstPlanDate = weekDays[0];
    const fourWeekStart = new Date(firstPlanDate);
    fourWeekStart.setDate(fourWeekStart.getDate() - 21); // 3 weeks back
    const fourWeekStartStr = formatDate(fourWeekStart);
    const lastPlanStr = formatDate(weekDays[weekDays.length - 1]);

    // Use allShifts (broader range) for historical counting, fallback to existingShifts
    const historyShifts = allShifts.length > 0 ? allShifts : existingShifts;

    // Count each doctor's services in the 4-week window (existing only, pre-suggestions)
    const serviceHistory = {}; // doctorId -> { fg: n, bg: n, weekend: n }
    const getServiceHist = (docId) => {
        if (!serviceHistory[docId]) serviceHistory[docId] = { fg: 0, bg: 0, weekend: 0 };
        return serviceHistory[docId];
    };

    for (const s of historyShifts) {
        if (s.date < fourWeekStartStr || s.date > lastPlanStr) continue;
        if (s.isPreview) continue;
        const h = getServiceHist(s.doctor_id);
        const svcType = getServiceType(s.position);
        if (svcType === 'fg') {
            h.fg++;
            const sDay = new Date(s.date + 'T00:00:00').getDay();
            if (sDay === 0 || sDay === 6) h.weekend++;
        }
        if (svcType === 'bg') h.bg++;
    }

    /** Get doctor FTE (from doctor.fte field) */
    const getDoctorFte = (docId) => {
        const doc = doctors.find(d => d.id === docId);
        return doc?.fte ?? 1.0;
    };

    /** Would assigning this service to this doctor exceed the 4-week limit? */
    const wouldExceedLimit = (docId, serviceName, dateStr) => {
        const h = getServiceHist(docId);
        const fte = getDoctorFte(docId);
        const svcType = getServiceType(serviceName);
        const isFG = svcType === 'fg';
        const isBG = svcType === 'bg';
        const d = new Date(dateStr + 'T00:00:00');
        const isWknd = (d.getDay() === 0 || d.getDay() === 6) && isFG;

        if (isFG && (h.fg + 1) > Math.round(limitFG * fte)) return true;
        if (isBG && (h.bg + 1) > Math.round(limitBG * fte)) return true;
        if (isWknd && (h.weekend + 1) > limitWeekend) return true;
        return false;
    };

    /** Track a new service assignment in the 4-week history */
    const recordServiceAssignment = (docId, serviceName, dateStr) => {
        const h = getServiceHist(docId);
        const svcType = getServiceType(serviceName);
        if (svcType === 'fg') {
            h.fg++;
            const d = new Date(dateStr + 'T00:00:00').getDay();
            if (d === 0 || d === 6) h.weekend++;
        }
        if (svcType === 'bg') h.bg++;
    };

    /**
     * Fair distribution score: lower = should get the next service.
     * Considers total services in 4-week window relative to FTE.
     * Separate scoring for FG and BG to balance both independently.
     */
    const getFairnessScore = (docId, serviceName) => {
        const h = getServiceHist(docId);
        const fte = getDoctorFte(docId) || 1;
        const svcType = getServiceType(serviceName);
        if (svcType === 'fg') return h.fg / fte;
        if (svcType === 'bg') return h.bg / fte;
        return (h.fg + h.bg) / fte;
    };

    // ---- Rotation mapping ----
    const getActiveRotationTargets = (doctorId, dateStr) => {
        return trainingRotations
            .filter(r => r.doctor_id === doctorId && r.start_date <= dateStr && r.end_date >= dateStr)
            .map(r => {
                if (r.modality === 'Röntgen') {
                    const roeWp = workplaces.find(w => w.name === 'DL/konv. Rö' || w.name.includes('Rö'));
                    return roeWp?.name || r.modality;
                }
                return r.modality;
            });
    };

    // ---- Displacement tracking ----
    const displacementCount = {};
    const getDisplaced = (id) => displacementCount[id] || 0;
    const addDisplacement = (id) => { displacementCount[id] = (displacementCount[id] || 0) + 1; };

    // ---- Auto-Frei tracking across days ----
    // Doctors who get Auto-Frei on a specific date are blocked that day.
    const autoFreiByDate = {};
    const autoFreiSuggestions = [];

    // ---- Part-time off-day tracking (full_days_off model) ----
    // Für Mitarbeiter im Modell "volle Tage mit freien Tagen" werden
    // (5 - round(FTE*5)) Wochentage als freie Tage blockiert. Die Verteilung
    // erfolgt flexibel: pro Kalenderwoche werden die Tage mit den wenigsten
    // bereits geblockten Slots (Absenzen, Auto-Frei, explizite Wünsche) gewählt,
    // um Konflikte mit bestehenden Einträgen zu minimieren.
    const partTimeOffDays = new Set(); // Set<`${weekKey}::${doctorId}::${dateStr}`>

    const ptIsoWeekKey = (date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 4 - (d.getDay() || 7));
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    };

    const ptFormatDate = (date) => {
        const d = new Date(date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const buildPartTimeOffDays = () => {
        // Gruppierung pro ISO-Woche
        const weekDaysMap = new Map();
        for (const day of weekDays) {
            const key = ptIsoWeekKey(day);
            if (!weekDaysMap.has(key)) weekDaysMap.set(key, []);
            weekDaysMap.get(key).push(day);
        }

        for (const doctor of doctors) {
            if (!isFullDaysOffModel(doctor)) continue;
            const offDaysCount = 5 - getPartTimeWorkDaysPerWeek(doctor);
            if (offDaysCount <= 0) continue;

            for (const [weekKey, days] of weekDaysMap.entries()) {
                if (days.length <= offDaysCount) continue; // weniger Tage als nötig → überspringen

                // Konflikt-Score pro Tag: bestehende Absenzen, Auto-Frei. Wir wählen
                // die Tage mit dem niedrigsten Score, damit fixe Abwesenheiten
                // Vorrang haben und Sonntage/Feiertage bevorzugt werden.
                const dayScores = days.map((day) => {
                    const dateStr = ptFormatDate(day);
                    let score = 0;
                    for (const s of existingShifts) {
                        if (s.date === dateStr && s.doctor_id === doctor.id
                            && absencePositions.includes(s.position)) {
                            score += 100; // bereits abwesend → kein Off-Day nötig
                        }
                    }
                    if (autoFreiByDate[dateStr]?.has(doctor.id)) score += 50;
                    if (day.getDay() === 0) score -= 5;
                    if (day.getDay() === 6) score -= 2;
                    if (isPublicHoliday(day)) score -= 5;
                    return { day, dateStr, score };
                });

                dayScores.sort((a, b) => a.score - b.score);
                const chosen = dayScores.slice(0, offDaysCount);
                for (const { dateStr } of chosen) {
                    partTimeOffDays.add(`${weekKey}::${doctor.id}::${dateStr}`);
                }
            }
        }
    };
    buildPartTimeOffDays();

    const isPartTimeOffDay = (doctorId, dateStr) => {
        const day = new Date(dateStr + 'T00:00:00');
        const key = `${ptIsoWeekKey(day)}::${doctorId}::${dateStr}`;
        return partTimeOffDays.has(key);
    };

    // ========================================================
    //  Cost Function instance (shared across all phases)
    // ========================================================
    const costFn = new CostFunction({
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
    });

    /** Generate an Auto-Frei for a doctor on the direct next day after dateStr when eligible. */
    const generateAutoFrei = (doctorId, dateStr) => {
        const nextStr = getAutoFreiDate(dateStr, isPublicHoliday);
        if (!nextStr) return;

        // Check if something already exists that day for this doctor
        const hasExisting =
            existingShifts.some(x => x.date === nextStr && x.doctor_id === doctorId) ||
            suggestions.some(x => x.date === nextStr && x.doctor_id === doctorId) ||
            autoFreiSuggestions.some(x => x.date === nextStr && x.doctor_id === doctorId);

        if (!hasExisting) {
            autoFreiSuggestions.push({
                date: nextStr,
                position: 'Frei',
                doctor_id: doctorId,
                note: 'Autom. Freizeitausgleich',
                isPreview: true,
            });
            // Track this doctor as blocked on the Auto-Frei day
            if (!autoFreiByDate[nextStr]) autoFreiByDate[nextStr] = new Set();
            autoFreiByDate[nextStr].add(doctorId);
        }
    };

    // ========================================================
    //  Wish helpers
    // ========================================================

    /** Get service wish for a doctor on a date (approved OR pending) */
    const getServiceWish = (doctorId, dateStr) => {
        return wishes.find(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'service' &&
            (w.status === 'approved' || w.status === 'pending')
        );
    };

    /** Is this doctor hard-blocked from ALL services on this date? (approved "kein Dienst") */
    const hasApprovedNoService = (doctorId, dateStr) => {
        return wishes.some(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'no_service' &&
            w.status === 'approved'
        );
    };

    /** Does this doctor have a pending (unapproved) "kein Dienst" wish? (soft NOT) */
    const hasPendingNoService = (doctorId, dateStr) => {
        return wishes.some(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'no_service' &&
            w.status === 'pending'
        );
    };

    /** Does this doctor have a specific service wish for a named position on this date? */
    const hasSpecificServiceWish = (doctorId, dateStr, positionName) => {
        return wishes.some(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'service' &&
            (w.status === 'approved' || w.status === 'pending') &&
            w.position === positionName
        );
    };

    // ========================================================
    //  Classify workplaces
    // ========================================================
    const isServiceWp = (wp) => wp.category === 'Dienste';
    const isRotationWp = (wp) => wp.category === 'Rotationen';
    const isAffectsAvailability = (wp) => wp.affects_availability !== false;
    const isRotationTraineeForWp = (doctorId, wpName, dateStr) => {
        const targets = getActiveRotationTargets(doctorId, dateStr);
        return targets.includes(wpName);
    };

    /** Does this doctor have any active rotation on this date? */
    const hasActiveRotation = (doctorId, dateStr) => {
        return getActiveRotationTargets(doctorId, dateStr).length > 0;
    };

    // Strict rotation mode: when enabled, doctors with active rotations are excluded from
    // services and non-rotation positions. Default false (= soft penalty only, traditional behavior).
    // Needed for departments like Anesthesia (KAI) where rotation trainees must stay on their rotation.
    const strictRotationMode = getSettingBool('rotation_restricts_other_assignments', false);

    /** Get consecutive days mode for a workplace: 'forbidden' | 'allowed' | 'preferred' */
    const getConsecutiveMode = (wp) => {
        if (wp.consecutive_days_mode) return wp.consecutive_days_mode;
        // Backward compat: old boolean field
        if (wp.allows_consecutive_days === false) return 'forbidden';
        return 'allowed';
    };

    /** Check if assigning this doctor to this service on this date would violate consecutive-forbidden */
    const wouldViolateConsecutive = (docId, svcName, dateStr) => {
        const wp = workplaces.find(w => w.name === svcName);
        if (!wp || getConsecutiveMode(wp) !== 'forbidden') return false;

        const d = new Date(dateStr + 'T00:00:00');
        const prev = new Date(d); prev.setDate(prev.getDate() - 1);
        const next = new Date(d); next.setDate(next.getDate() + 1);
        const prevStr = formatDate(prev);
        const nextStr = formatDate(next);

        return existingShifts.some(s =>
            s.doctor_id === docId && s.position === svcName &&
            (s.date === prevStr || s.date === nextStr)
        ) || suggestions.some(s =>
            s.doctor_id === docId && s.position === svcName &&
            (s.date === prevStr || s.date === nextStr)
        );
    };

    // ========================================================
    //  Process each day
    // ========================================================
    for (const day of weekDays) {
        const dateStr = formatDate(day);
        const dayStartSuggestions = suggestions.length;
        const dayStartAutoFrei = autoFreiSuggestions.length;

        debugLog('day:start', 'Start day planning', {
            date: dateStr,
            weekday: day.getDay(),
        });

        // --- Base blocked set (absences + existing availability-relevant assignments) ---
        const baseBlocked = new Set();
        const posCount = {};      // position-level count (for backward-compat)
        const slotCount = {};     // slot-level count: slotKey(pos, tsId) -> count

        // Include doctors blocked by auto-frei from a previous day's service
        if (autoFreiByDate[dateStr]) {
            for (const docId of autoFreiByDate[dateStr]) {
                baseBlocked.add(docId);
            }
        }

        // Part-time off-day (full_days_off model) → block this doctor
        for (const d of doctors) {
            if (isPartTimeOffDay(d.id, dateStr)) {
                baseBlocked.add(d.id);
            }
        }

        for (const s of existingShifts) {
            if (s.date !== dateStr) continue;
            posCount[s.position] = (posCount[s.position] || 0) + 1;
            // Also count per slot (position + timeslot_id)
            const sk = slotKey(s.position, s.timeslot_id);
            slotCount[sk] = (slotCount[sk] || 0) + 1;

            if (absencePositions.includes(s.position)) { baseBlocked.add(s.doctor_id); continue; }
            if (s.position === 'Verfügbar') continue;

            const wp = workplaces.find(w => w.name === s.position);
            if (wp?.affects_availability === false) continue;
            if (wp?.allows_rotation_concurrently) continue;
            // Demos/Konsile only block if they are marked as availability-relevant
            if (wp?.category === 'Demonstrationen & Konsile' && wp?.affects_availability !== true) continue;
            baseBlocked.add(s.doctor_id);
        }

        // Track who is used today (starts as copy of baseBlocked)
        const usedToday = new Set(baseBlocked);

        // All workplaces active today in the categories we're filling
        const allTodayWps = workplaces
            .filter(wp => categoriesToFill.includes(wp.category) && isActiveOnDate(wp, day));

        // Track doctors assigned to a service today (even if rotation-OK)
        const serviceAssignedToday = new Set();
        for (const s of existingShifts) {
            if (s.date !== dateStr) continue;
            const wp = workplaces.find(w => w.name === s.position);
            if (wp?.category === 'Dienste') serviceAssignedToday.add(s.doctor_id);
        }

        // Record a suggestion and update tracking
        const assign = (docId, wpName, timeslotId = null) => {
            const suggestion = { date: dateStr, position: wpName, doctor_id: docId, isPreview: true };
            if (timeslotId) suggestion.timeslot_id = timeslotId;
            suggestions.push(suggestion);
            // Only block the doctor if the workplace actually reduces availability
            const wp = workplaces.find(w => w.name === wpName);
            if (wp?.category === 'Dienste') serviceAssignedToday.add(docId);
            if (!wp?.allows_rotation_concurrently) {
                usedToday.add(docId);
            }
            posCount[wpName] = (posCount[wpName] || 0) + 1;
            const sk = slotKey(wpName, timeslotId);
            slotCount[sk] = (slotCount[sk] || 0) + 1;
            incWeekly(docId);
        };

        /** Does this position already have ≥1 qualified person today? */
        const hasQualCoverage = (wp) => {
            for (const s of existingShifts) {
                if (s.date === dateStr && s.position === wp.name && isQualified(s.doctor_id, wp.id)) return true;
            }
            for (const s of suggestions) {
                if (s.date === dateStr && s.position === wp.name && isQualified(s.doctor_id, wp.id)) return true;
            }
            return false;
        };

        // ============================================================
        //  Pre-Phase A: Rotation qualification impact analysis
        //  Compute how critical each available doctor is for rotation
        //  workplaces that require mandatory qualifications.
        //  This prevents sending ALL qualified Fachärzte into services
        //  when they are the only ones who can fill rotation positions.
        //
        //  ALSO: For services with auto_off, consider the direct next day's
        //  impact when that day actually receives Auto-Frei. If a doctor gets Auto-Frei tomorrow, they can't
        //  fill rotation positions there either.
        // ============================================================
        const rotationImpactScore = {}; // doctorId -> number (higher = more critical for rotations)
        {
            /** Compute impact scores for a given day/date, considering who is blocked */
            const computeImpactForDay = (targetDay, blockedSet, multiplier) => {
                const critWps = workplaces.filter(wp =>
                    !isServiceWp(wp) &&
                    isAffectsAvailability(wp) &&
                    isActiveOnDate(wp, targetDay) &&
                    hasQualReq(wp) &&
                    getMinStaff(wp) > 0
                );

                for (const wp of critWps) {
                    const qualifiedPool = doctors.filter(d =>
                        !blockedSet.has(d.id) &&
                        !isExcluded(d.id, wp.id) &&
                        isQualified(d.id, wp.id)
                    );
                    const poolSize = qualifiedPool.length;
                    if (poolSize === 0) continue;
                    for (const doc of qualifiedPool) {
                        if (!rotationImpactScore[doc.id]) rotationImpactScore[doc.id] = 0;
                        if (poolSize <= 1) rotationImpactScore[doc.id] += 10 * multiplier;
                        else if (poolSize <= 2) rotationImpactScore[doc.id] += 5 * multiplier;
                        else if (poolSize <= 3) rotationImpactScore[doc.id] += 2 * multiplier;
                        else rotationImpactScore[doc.id] += 1 * multiplier;
                    }
                }
            };

            // Impact for TODAY (weight 1x)
            computeImpactForDay(day, baseBlocked, 1);

            // Impact for the DIRECT NEXT DAY (weight 1x) — relevant for auto_off services
            // only if that day is eligible for Auto-Frei.
            const hasAutoOffService = allTodayWps.some(wp => isServiceWp(wp) && wp.auto_off);
            if (hasAutoOffService) {
                const nextDateStr = getAutoFreiDate(dateStr, isPublicHoliday);
                if (nextDateStr) {
                    const nextDay = new Date(nextDateStr + 'T00:00:00');

                    // Build blocked set for next day: absences + existing assignments + auto-frei
                    const nextDayBlocked = new Set();
                    if (autoFreiByDate[nextDateStr]) {
                        for (const docId of autoFreiByDate[nextDateStr]) nextDayBlocked.add(docId);
                    }
                    for (const s of existingShifts) {
                        if (s.date !== nextDateStr) continue;
                        if (absencePositions.includes(s.position)) { nextDayBlocked.add(s.doctor_id); continue; }
                        if (s.position === 'Verfügbar') continue;
                        const xwp = workplaces.find(w => w.name === s.position);
                        if (xwp?.affects_availability === false) continue;
                        if (xwp?.allows_rotation_concurrently) continue;
                        // Demos/Konsile only block if they are marked as availability-relevant
                        if (xwp?.category === 'Demonstrationen & Konsile' && xwp?.affects_availability !== true) continue;
                        nextDayBlocked.add(s.doctor_id);
                    }
                    for (const d of doctors) {
                        if (isPartTimeOffDay(d.id, nextDateStr)) nextDayBlocked.add(d.id);
                    }

                    computeImpactForDay(nextDay, nextDayBlocked, 1);
                }
            }
        }

        const getRotationImpact = (docId) => rotationImpactScore[docId] || 0;

        // ============================================================
        //  PHASE A: DIENSTE (Services) — highest priority
        // ============================================================
        if (categoriesToFill.includes('Dienste')) {
            const serviceWps = allTodayWps.filter(wp => isServiceWp(wp));
            // Expand services into timeslot-aware slots
            const serviceSlots = expandToSlots(serviceWps);

            for (const slot of serviceSlots) {
                const svc = slot.wp;
                const tsId = slot.timeslotId;
                const sk = slotKey(svc.name, tsId);
                const currentCount = slotCount[sk] || 0;
                const targetCount = getOptimal(svc);
                const slotsNeeded = targetCount - currentCount;
                if (slotsNeeded <= 0) continue;

                // Build candidate pool for this service
                // Exclude doctors who would exceed their 4-week limit
                // Also exclude doctors already assigned to a service today
                // In strict rotation mode: exclude doctors with active rotations
                // EXCEPTION: Allow dual-service if doctor has a specific wish for THIS service
                // (e.g. wishes for both Spätdienst and Hintergrunddienst on the same day)
                const allCandidates = doctors.filter(d => {
                    const hasWishForThis = hasSpecificServiceWish(d.id, dateStr, svc.name);
                    return (
                        (!usedToday.has(d.id) || hasWishForThis) &&
                        (!serviceAssignedToday.has(d.id) || hasWishForThis) &&
                        (!strictRotationMode || !hasActiveRotation(d.id, dateStr) || hasWishForThis) &&
                        !isExcluded(d.id, svc.id) &&
                        !hasApprovedNoService(d.id, dateStr) &&
                        isQualified(d.id, svc.id) &&
                        !wouldExceedLimit(d.id, svc.name, dateStr) &&
                        !wouldViolateConsecutive(d.id, svc.name, dateStr)
                    );
                });

                // Separate candidates into priority tiers
                // → NOW: Use unified cost function instead of manual tier separation
                const costContext = {
                    usedToday,
                    posCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    phase: 'A',
                };

                // Sort ALL candidates by cost (ascending = best first)
                // The cost function handles wishes, fairness, impact, limits, etc.
                allCandidates.sort((a, b) => {
                    const costA = costFn.assignmentCost(a.id, svc, dateStr, costContext);
                    const costB = costFn.assignmentCost(b.id, svc, dateStr, costContext);
                    return costA - costB;
                });

                const ranked = allCandidates.filter(d => {
                    const cost = costFn.assignmentCost(d.id, svc, dateStr, costContext);
                    return cost < Infinity;
                });

                // If no candidates within limits, fall back to all qualified (limit exceeded = last resort)
                if (ranked.length === 0) {
                    debugLog('phase:A:fallback', 'No in-limit ranked candidates, using fallback pool', {
                        date: dateStr,
                        service: svc.name,
                        timeslotId: tsId,
                    });
                    const fallbackContext = { ...costContext };
                    const fallback = doctors.filter(d => {
                        const hasWishForThis = hasSpecificServiceWish(d.id, dateStr, svc.name);
                        return (
                            (!usedToday.has(d.id) || hasWishForThis) &&
                            (!serviceAssignedToday.has(d.id) || hasWishForThis) &&
                            (!strictRotationMode || !hasActiveRotation(d.id, dateStr) || hasWishForThis) &&
                            !isExcluded(d.id, svc.id) &&
                            !hasApprovedNoService(d.id, dateStr) &&
                            isQualified(d.id, svc.id) &&
                            !wouldViolateConsecutive(d.id, svc.name, dateStr)
                        );
                    }).sort((a, b) => {
                        const costA = costFn.assignmentCost(a.id, svc, dateStr, fallbackContext);
                        const costB = costFn.assignmentCost(b.id, svc, dateStr, fallbackContext);
                        // Filter out Infinity costs but allow LIMIT_EXCEEDED costs
                        return costA - costB;
                    });
                    ranked.push(...fallback);
                }

                if (ranked.length < slotsNeeded) {
                    debugLog('phase:A:underfill', 'Not enough candidates to fill service slot target', {
                        date: dateStr,
                        service: svc.name,
                        timeslotId: tsId,
                        slotsNeeded,
                        rankedCandidates: ranked.length,
                    });
                }

                for (let i = 0; i < slotsNeeded && i < ranked.length; i++) {
                    const chosen = ranked[i];
                    const chosenCost = costFn.assignmentCost(chosen.id, svc, dateStr, costContext);
                    assign(chosen.id, svc.name, tsId);
                    recordServiceAssignment(chosen.id, svc.name, dateStr);
                    debugLog('phase:A:assign', 'Assigned service slot', {
                        date: dateStr,
                        service: svc.name,
                        timeslotId: tsId,
                        doctorId: chosen.id,
                        doctorName: doctorNameById[chosen.id] || chosen.id,
                        cost: Number.isFinite(chosenCost) ? chosenCost : null,
                    });

                    // Auto-Frei: if service has auto_off, block doctor on the direct next eligible day
                    if (svc.auto_off) {
                        generateAutoFrei(chosen.id, dateStr);
                    }
                }
            }
        }

        // After Phase A: doctors assigned to services + auto-frei are now in usedToday.
        // Save the service-blocked set for Phase C.
        const serviceBlocked = new Set(usedToday);

        // ============================================================
        //  PHASE B: Verfügbarkeitsrelevante Arbeitsplätze (non-service)
        // ============================================================
        const availWps = allTodayWps.filter(wp =>
            !isServiceWp(wp) && isAffectsAvailability(wp)
        );

        if (availWps.length > 0) {
            const phaseBStartIdx = suggestions.length; // Track start for swap optimization
            // Expand into timeslot-aware slots
            const availSlots = expandToSlots(availWps);

            // --- B.1: Qualification coverage ---
            // For timeslot workplaces: each timeslot needs coverage independently
            const qualSlots = availSlots
                .filter(slot => hasQualReq(slot.wp) && getMinStaff(slot.wp) > 0)
                .sort((a, b) => {
                    const aPool = doctors.filter(d => !usedToday.has(d.id) && !isExcluded(d.id, a.wp.id) && isQualified(d.id, a.wp.id)).length;
                    const bPool = doctors.filter(d => !usedToday.has(d.id) && !isExcluded(d.id, b.wp.id) && isQualified(d.id, b.wp.id)).length;
                    return aPool - bPool;
                });

            for (const slot of qualSlots) {
                const wp = slot.wp;
                const tsId = slot.timeslotId;
                
                // Check coverage for this specific slot
                const hasSlotCoverage = () => {
                    for (const s of existingShifts) {
                        if (s.date === dateStr && s.position === wp.name && isQualified(s.doctor_id, wp.id)) {
                            if (tsId) { if (s.timeslot_id === tsId) return true; }
                            else { if (!s.timeslot_id) return true; }
                        }
                    }
                    for (const s of suggestions) {
                        if (s.date === dateStr && s.position === wp.name && isQualified(s.doctor_id, wp.id)) {
                            if (tsId) { if (s.timeslot_id === tsId) return true; }
                            else { if (!s.timeslot_id) return true; }
                        }
                    }
                    return false;
                };
                
                if (hasSlotCoverage()) continue;

                const sortB1 = (a, b) => {
                    const aRotElsewhere = getActiveRotationTargets(a.id, dateStr)
                        .some(t => t !== wp.name) ? 1 : 0;
                    const bRotElsewhere = getActiveRotationTargets(b.id, dateStr)
                        .some(t => t !== wp.name) ? 1 : 0;
                    if (aRotElsewhere !== bRotElsewhere) return aRotElsewhere - bRotElsewhere;
                    return getWeekly(a.id) - getWeekly(b.id);
                };

                // Progressive filtering
                let eligible = doctors
                    .filter(d => !usedToday.has(d.id) && !isExcluded(d.id, wp.id) && isQualified(d.id, wp.id));

                // Strict rotation mode: prefer non-rotating doctors for non-rotation workplaces
                if (strictRotationMode && !isRotationWp(wp)) {
                    const nonRotating = eligible.filter(d => !hasActiveRotation(d.id, dateStr));
                    if (nonRotating.length > 0) eligible = nonRotating;
                }

                {
                    const nonDiscouraged = eligible.filter(d => !isDiscouraged(d.id, wp.id));
                    if (nonDiscouraged.length > 0) eligible = nonDiscouraged;
                }

                if (hasOptionalQualReq(wp)) {
                    const withPreferred = eligible.filter(d => hasOptionalQuals(d.id, wp.id));
                    if (withPreferred.length > 0) eligible = withPreferred;
                }

                const candidates = eligible.sort(sortB1);

                if (candidates.length > 0) {
                    assign(candidates[0].id, wp.name, tsId);
                    debugLog('phase:B:coverage', 'Assigned qualification coverage slot', {
                        date: dateStr,
                        workplace: wp.name,
                        timeslotId: tsId,
                        doctorId: candidates[0].id,
                        doctorName: doctorNameById[candidates[0].id] || candidates[0].id,
                    });
                }
            }

            // --- B.2: Fill to optimal_staff (round-robin) ---
            // Priority: 1) Slots below min_staff first (critical)
            //           2) Then slots below optimal but above min_staff
            //           3) min_staff=0 slots are filled last
            let changed = true;
            while (changed) {
                changed = false;

                const underFilled = availSlots
                    .filter(slot => {
                        const sk = slotKey(slot.wp.name, slot.timeslotId);
                        return (slotCount[sk] || 0) < getOptimal(slot.wp);
                    })
                    .sort((a, b) => {
                        const aSk = slotKey(a.wp.name, a.timeslotId);
                        const bSk = slotKey(b.wp.name, b.timeslotId);
                        const aCur = slotCount[aSk] || 0;
                        const bCur = slotCount[bSk] || 0;
                        const aMin = getMinStaff(a.wp);
                        const bMin = getMinStaff(b.wp);
                        const aOpt = getOptimal(a.wp);
                        const bOpt = getOptimal(b.wp);

                        // Tier 0: below min_staff (critical shortage)
                        // Tier 1: at/above min_staff but below optimal (min_staff > 0)
                        // Tier 2: min_staff=0, still below optimal (nice to fill, lowest priority)
                        const aTier = aCur < aMin ? 0 : (aMin > 0 ? 1 : 2);
                        const bTier = bCur < bMin ? 0 : (bMin > 0 ? 1 : 2);
                        if (aTier !== bTier) return aTier - bTier;

                        // Within same tier, prefer larger absolute deficit first
                        const aDef = aOpt - aCur;
                        const bDef = bOpt - bCur;
                        if (aDef !== bDef) return bDef - aDef;

                        // Then sort by fill ratio (least filled first)
                        const aR = aCur / aOpt;
                        const bR = bCur / bOpt;
                        if (Math.abs(aR - bR) > 0.001) return aR - bR;

                        // Prefer slots with higher optimal (more staff needed = more important)
                        if (aOpt !== bOpt) return bOpt - aOpt;

                        const aQ = hasQualReq(a.wp) ? 0 : 1;
                        const bQ = hasQualReq(b.wp) ? 0 : 1;
                        if (aQ !== bQ) return aQ - bQ;
                        return (a.wp.order || 0) - (b.wp.order || 0);
                    });

                if (underFilled.length === 0) break;

                const unassigned = doctors.filter(d => !usedToday.has(d.id));
                if (unassigned.length === 0) break;

                const targetSlot = underFilled[0];
                const targetWp = targetSlot.wp;
                const targetTsId = targetSlot.timeslotId;
                const targetSk = slotKey(targetWp.name, targetTsId);
                const targetCurrentCount = slotCount[targetSk] || 0;

                // Cost-based candidate sorting (replaces tier-based scoreCandidate/sortCandidates)
                const costContextB = {
                    usedToday,
                    posCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    phase: 'B',
                };

                // Progressive filtering: "Sollte nicht" + "Sollte" with fallback
                let eligible = unassigned.filter(doc => !isExcluded(doc.id, targetWp.id));

                // Rotation restriction (configurable per tenant):
                if (isRotationWp(targetWp)) {
                    // For rotation workplaces: restrict 2nd+ slot to active trainees
                    if (targetCurrentCount >= 1) {
                        const traineeOnly = eligible.filter(doc =>
                            isRotationTraineeForWp(doc.id, targetWp.name, dateStr)
                        );
                        if (traineeOnly.length > 0) {
                            eligible = traineeOnly;
                        }
                    }
                } else if (strictRotationMode) {
                    // Strict mode: exclude doctors who have an active rotation elsewhere
                    const nonRotating = eligible.filter(doc => !hasActiveRotation(doc.id, dateStr));
                    if (nonRotating.length > 0) {
                        eligible = nonRotating;
                    }
                }

                // "Sollte nicht": filter out discouraged doctors (fallback if none remain)
                {
                    const nonDiscouraged = eligible.filter(doc => !isDiscouraged(doc.id, targetWp.id));
                    if (nonDiscouraged.length > 0) eligible = nonDiscouraged;
                }

                // "Sollte": filter to doctors with preferred quals (fallback if none remain)
                if (hasOptionalQualReq(targetWp)) {
                    const withPreferred = eligible.filter(doc => hasOptionalQuals(doc.id, targetWp.id));
                    if (withPreferred.length > 0) eligible = withPreferred;
                }

                // Sort by cost function (ascending = best first)
                eligible.sort((a, b) => {
                    const costA = costFn.assignmentCost(a.id, targetWp, dateStr, costContextB);
                    const costB = costFn.assignmentCost(b.id, targetWp, dateStr, costContextB);
                    return costA - costB;
                });

                if (eligible.length > 0 && costFn.assignmentCost(eligible[0].id, targetWp, dateStr, costContextB) < Infinity) {
                    const chosen = eligible[0];
                    assign(chosen.id, targetWp.name, targetTsId);
                    debugLog('phase:B:fill', 'Assigned availability-relevant slot', {
                        date: dateStr,
                        workplace: targetWp.name,
                        timeslotId: targetTsId,
                        doctorId: chosen.id,
                        doctorName: doctorNameById[chosen.id] || chosen.id,
                    });

                    const rotTargets = getActiveRotationTargets(chosen.id, dateStr);
                    if (rotTargets.length > 0 && !rotTargets.includes(targetWp.name)) {
                        addDisplacement(chosen.id);
                    }
                    changed = true;
                } else if (isRotationWp(targetWp) && targetCurrentCount >= 1) {
                    debugLog('phase:B:rotation-skip', 'Skipped second occupancy for rotation workplace (no eligible trainee after filters)', {
                        date: dateStr,
                        workplace: targetWp.name,
                        timeslotId: targetTsId,
                        currentCount: targetCurrentCount,
                    });
                }
            }

            // --- B.3: Over-fill remaining doctors into allows_multiple ---
            let overChanged = true;
            while (overChanged) {
                overChanged = false;

                const remaining = doctors.filter(d => !usedToday.has(d.id));
                if (remaining.length === 0) break;

                // Build slot-level options for overfill
                const overSlots = expandToSlots(availWps.filter(wp => allowsMultiple(wp)));
                const options = overSlots
                    .map(slot => {
                        const sk = slotKey(slot.wp.name, slot.timeslotId);
                        const current = slotCount[sk] || 0;
                        const optimal = Math.max(getOptimal(slot.wp), 1);
                        return {
                            ...slot,
                            fillRatio: current / optimal,
                            deficit: optimal - current,
                        };
                    })
                    .filter(o => {
                        // Never overfill rotation workplaces beyond optimal
                        if (isRotationWp(o.wp) && o.deficit <= 0) return false;
                        return true;
                    })
                    .sort((a, b) => {
                        if (a.deficit !== b.deficit) return b.deficit - a.deficit;
                        if (Math.abs(a.fillRatio - b.fillRatio) > 0.001) return a.fillRatio - b.fillRatio;
                        return (a.wp.order || 0) - (b.wp.order || 0);
                    });

                if (options.length === 0) break;

                // Cost-based: pick doctor with lowest cost for best available workplace
                const costContextB3 = {
                    usedToday,
                    posCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    phase: 'B',
                };

                // For each remaining doctor, find their best workplace by cost
                let bestAssignment = null;
                let bestCost = Infinity;

                const hasAnyDeficitOption = options.some(o => o.deficit > 0);

                for (const doc of remaining) {
                    // Progressive filtering: "Sollte nicht" + "Sollte" with fallback
                    let eligibleWps = options.filter(o => !isExcluded(doc.id, o.wp.id));

                    // Strict rotation mode: doctors with active rotations should only go to their rotation wp
                    if (strictRotationMode && hasActiveRotation(doc.id, dateStr)) {
                        const rotOnly = eligibleWps.filter(o => isRotationTraineeForWp(doc.id, o.wp.name, dateStr));
                        if (rotOnly.length > 0) {
                            eligibleWps = rotOnly;
                        } else {
                            eligibleWps = []; // no suitable rotation wp available → skip this doctor
                        }
                    }

                    // Deficit-first: while any deficit exists, only consider deficit slots
                    if (hasAnyDeficitOption) {
                        const deficitOnly = eligibleWps.filter(o => o.deficit > 0);
                        if (deficitOnly.length > 0) eligibleWps = deficitOnly;
                    }

                    // On rotation workplaces, prefer designated trainees for 2nd+ occupancy,
                    // but allow fallback to others if no trainee available.
                    {
                        const traineePreferred = eligibleWps.filter(o => {
                            const sk = slotKey(o.wp.name, o.timeslotId);
                            const cur = slotCount[sk] || 0;
                            if (!isRotationWp(o.wp) || cur < 1) return true;
                            return isRotationTraineeForWp(doc.id, o.wp.name, dateStr);
                        });
                        if (traineePreferred.length > 0) eligibleWps = traineePreferred;
                    }

                    // "Sollte nicht": filter out workplaces where doctor is discouraged (fallback)
                    {
                        const nonDiscouraged = eligibleWps.filter(o => !isDiscouraged(doc.id, o.wp.id));
                        if (nonDiscouraged.length > 0) eligibleWps = nonDiscouraged;
                    }

                    // "Sollte": prefer workplaces where doctor has preferred quals (fallback)
                    {
                        const withPreferred = eligibleWps.filter(o =>
                            !hasOptionalQualReq(o.wp) || hasOptionalQuals(doc.id, o.wp.id)
                        );
                        if (withPreferred.length > 0) eligibleWps = withPreferred;
                    }

                    for (const o of eligibleWps) {
                        const cost = costFn.assignmentCost(doc.id, o.wp, dateStr, costContextB3);
                        // Add fill ratio as a tiebreaker to spread assignments
                        const adjustedCost = cost + o.fillRatio * 2 - o.deficit * 4;
                        if (adjustedCost < bestCost) {
                            bestCost = adjustedCost;
                            bestAssignment = { doc, wp: o.wp, timeslotId: o.timeslotId };
                        }
                    }
                }

                if (bestAssignment && bestCost < Infinity) {
                    assign(bestAssignment.doc.id, bestAssignment.wp.name, bestAssignment.timeslotId);
                    debugLog('phase:B:overfill', 'Overfill assignment applied', {
                        date: dateStr,
                        workplace: bestAssignment.wp.name,
                        timeslotId: bestAssignment.timeslotId,
                        doctorId: bestAssignment.doc.id,
                        doctorName: doctorNameById[bestAssignment.doc.id] || bestAssignment.doc.id,
                        adjustedCost: bestCost,
                    });
                    const rotTargets = getActiveRotationTargets(bestAssignment.doc.id, dateStr);
                    if (rotTargets.length > 0 && !rotTargets.includes(bestAssignment.wp.name)) {
                        addDisplacement(bestAssignment.doc.id);
                    }
                    overChanged = true;
                }
            }

            // ============================================================
            //  Phase B: Swap Optimization (2-opt local search)
            //  After greedy assignment, try pairwise doctor swaps to
            //  reduce total cost. This catches cases where the greedy
            //  per-slot approach creates avoidable "sollte-nicht" assignments
            //  that could be resolved by shuffling doctors between workplaces.
            //  Example: BAR→CT (sollte-nicht) + Roch→Mamma
            //         → Roch→CT + BAR→Mamma (no penalties)
            // ============================================================
            {
                const phaseBSuggestions = [];
                for (let idx = phaseBStartIdx; idx < suggestions.length; idx++) {
                    const s = suggestions[idx];
                    if (s.date !== dateStr) continue;
                    if (s.position === 'Frei') continue;
                    const wp = workplaces.find(w => w.name === s.position);
                    if (!wp || isServiceWp(wp)) continue;
                    if (!isAffectsAvailability(wp)) continue;
                    phaseBSuggestions.push(s);
                }

                if (phaseBSuggestions.length >= 2) {
                    const swapContext = {
                        usedToday,
                        posCount,
                        displacementCount,
                        rotationImpactScore,
                        serviceAssignedToday,
                        phase: 'B',
                    };

                    let swapImproved = true;
                    let swapRounds = 0;
                    const maxSwapRounds = 20;

                    while (swapImproved && swapRounds < maxSwapRounds) {
                        swapImproved = false;
                        swapRounds++;

                        for (let i = 0; i < phaseBSuggestions.length && !swapImproved; i++) {
                            for (let j = i + 1; j < phaseBSuggestions.length && !swapImproved; j++) {
                                const s1 = phaseBSuggestions[i];
                                const s2 = phaseBSuggestions[j];
                                if (s1.position === s2.position) continue;
                                if (s1.doctor_id === s2.doctor_id) continue;

                                const wp1 = workplaces.find(w => w.name === s1.position);
                                const wp2 = workplaces.find(w => w.name === s2.position);
                                if (!wp1 || !wp2) continue;

                                // Validity: exclusion
                                if (isExcluded(s2.doctor_id, wp1.id)) continue;
                                if (isExcluded(s1.doctor_id, wp2.id)) continue;

                                // Validity: mandatory qualification
                                if (hasQualReq(wp1) && !isQualified(s2.doctor_id, wp1.id)) continue;
                                if (hasQualReq(wp2) && !isQualified(s1.doctor_id, wp2.id)) continue;

                                // Cost comparison
                                const currentCost =
                                    costFn.assignmentCost(s1.doctor_id, wp1, dateStr, swapContext) +
                                    costFn.assignmentCost(s2.doctor_id, wp2, dateStr, swapContext);
                                const swappedCost =
                                    costFn.assignmentCost(s2.doctor_id, wp1, dateStr, swapContext) +
                                    costFn.assignmentCost(s1.doctor_id, wp2, dateStr, swapContext);

                                if (swappedCost < currentCost - 0.5) {
                                    debugLog('phase:B:swap', `Swap reduces cost by ${(currentCost - swappedCost).toFixed(1)}`, {
                                        before: `${doctorNameById[s1.doctor_id]}\u2192${s1.position}, ${doctorNameById[s2.doctor_id]}\u2192${s2.position}`,
                                        after: `${doctorNameById[s2.doctor_id]}\u2192${s1.position}, ${doctorNameById[s1.doctor_id]}\u2192${s2.position}`,
                                        costBefore: Math.round(currentCost * 10) / 10,
                                        costAfter: Math.round(swappedCost * 10) / 10,
                                    });

                                    // Apply swap (exchange doctor_ids, keep positions)
                                    const tmp = s1.doctor_id;
                                    s1.doctor_id = s2.doctor_id;
                                    s2.doctor_id = tmp;
                                    swapImproved = true;
                                }
                            }
                        }
                    }

                    if (swapRounds > 1) {
                        debugLog('phase:B:swap-summary', `Swap optimization completed in ${swapRounds} rounds`, {
                            date: dateStr,
                            totalSwaps: swapRounds - 1,
                        });
                    }
                }
            }
        }

        // ============================================================
        //  Sole-occupant detection: doctors who are the only person at
        //  an availability-relevant workplace should be deprioritized
        //  for Demo assignments (only assigned if no one else available)
        // ============================================================
        const soleOccupantDoctors = new Set();
        {
            const wpStaffing = {}; // wpName -> Set of doctorIds
            for (const s of existingShifts) {
                if (s.date !== dateStr) continue;
                if (absencePositions.includes(s.position) || s.position === 'Verfügbar') continue;
                const wp = workplaces.find(w => w.name === s.position);
                if (!wp || wp.category === 'Dienste') continue;
                // Include availability-relevant Demos in sole-occupant detection
                if (wp.category === 'Demonstrationen & Konsile' && wp.affects_availability !== true) continue;
                if (wp.affects_availability === false) continue;
                if (!wpStaffing[wp.name]) wpStaffing[wp.name] = new Set();
                wpStaffing[wp.name].add(s.doctor_id);
            }
            for (const s of suggestions) {
                if (s.date !== dateStr) continue;
                if (s.position === 'Frei') continue;
                const wp = workplaces.find(w => w.name === s.position);
                if (!wp || wp.category === 'Dienste') continue;
                if (wp.category === 'Demonstrationen & Konsile' && wp.affects_availability !== true) continue;
                if (wp.affects_availability === false) continue;
                if (!wpStaffing[wp.name]) wpStaffing[wp.name] = new Set();
                wpStaffing[wp.name].add(s.doctor_id);
            }
            for (const [, docIds] of Object.entries(wpStaffing)) {
                if (docIds.size === 1) {
                    for (const docId of docIds) soleOccupantDoctors.add(docId);
                }
            }
        }

        // ============================================================
        //  PHASE C: Nicht-verfügbarkeitsrelevante Arbeitsplätze
        //  (affects_availability=false) — Ärzte aus Phase B bleiben verfügbar
        // ============================================================
        const nonAvailWps = allTodayWps.filter(wp =>
            !isServiceWp(wp) && !isAffectsAvailability(wp)
        );

        if (nonAvailWps.length > 0) {
            const phaseCStartIdx = suggestions.length; // Track start for swap optimization
            // For Phase C, only service-blocked and absence-blocked doctors are excluded.
            // Doctors assigned in Phase B (availability-relevant workplaces) ARE available.
            // KEY RULE: For workplaces with Pflichtqualifikation (mandatory qualifications),
            // a qualified doctor may be assigned to MULTIPLE such workplaces.
            // An unqualified doctor must NEVER be assigned alone to a Pflicht-workplace.
            const phaseC_blocked = new Set(serviceBlocked);

            const phaseCSlotCount = { ...slotCount };

            // Track which doctor is assigned to which Phase C slots (to prevent same-slot duplicates)
            const phaseCAssignments = {}; // doctor_id -> Set<slotKey>

            const isAlreadyAssignedToSlot = (docId, wpName, tsId) => {
                const sk = slotKey(wpName, tsId);
                if (phaseCAssignments[docId]?.has(sk)) return true;
                return existingShifts.some(s => {
                    if (s.date !== dateStr || s.position !== wpName || s.doctor_id !== docId) return false;
                    if (tsId) return s.timeslot_id === tsId;
                    return !s.timeslot_id;
                }) || suggestions.some(s => {
                    if (s.date !== dateStr || s.position !== wpName || s.doctor_id !== docId) return false;
                    if (tsId) return s.timeslot_id === tsId;
                    return !s.timeslot_id;
                });
            };

            const assignC = (docId, wpName, wpHasQualReq, tsId = null) => {
                const suggestion = { date: dateStr, position: wpName, doctor_id: docId, isPreview: true };
                if (tsId) suggestion.timeslot_id = tsId;
                suggestions.push(suggestion);
                const sk = slotKey(wpName, tsId);
                phaseCSlotCount[sk] = (phaseCSlotCount[sk] || 0) + 1;
                incWeekly(docId);
                if (!phaseCAssignments[docId]) phaseCAssignments[docId] = new Set();
                phaseCAssignments[docId].add(sk);
                // Only block for non-Pflicht workplaces; qualified doctors on Pflicht workplaces stay available
                if (!wpHasQualReq) {
                    phaseC_blocked.add(docId);
                }
            };

            // Expand non-availability workplaces into timeslot-aware slots
            const nonAvailSlots = expandToSlots(nonAvailWps);

            // C.1: Qualification coverage — assign qualified doctors first (prefer unblocked ones)
            const qualSlotsC = nonAvailSlots
                .filter(slot => hasQualReq(slot.wp) && getMinStaff(slot.wp) > 0)
                .sort((a, b) => {
                    // Sort by smallest available qualified pool first (most constrained first)
                    const aPool = doctors.filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, a.wp.id) && isQualified(d.id, a.wp.id)).length;
                    const bPool = doctors.filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, b.wp.id) && isQualified(d.id, b.wp.id)).length;
                    return aPool - bPool;
                });

            for (const slot of qualSlotsC) {
                const wp = slot.wp;
                const tsId = slot.timeslotId;
                
                // Check coverage for this specific slot
                const hasCov = [...existingShifts, ...suggestions].some(s => {
                    if (s.date !== dateStr || s.position !== wp.name || !isQualified(s.doctor_id, wp.id)) return false;
                    if (tsId) return s.timeslot_id === tsId;
                    return !s.timeslot_id;
                });
                if (hasCov) continue;

                const costContextC1 = {
                    usedToday: phaseC_blocked,
                    posCount: phaseCSlotCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    soleOccupantDoctors,
                    phase: 'C',
                };

                // Cost-based sorting for C.1 with progressive fallback stages
                // Stage 1: unblocked, not discouraged, qualified
                let candidates = doctors
                    .filter(d => !phaseC_blocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                 !isDiscouraged(d.id, wp.id) &&
                                 isQualified(d.id, wp.id) && !isAlreadyAssignedToSlot(d.id, wp.name, tsId));
                if (hasOptionalQualReq(wp) && candidates.length > 0) {
                    const withPref = candidates.filter(d => hasOptionalQuals(d.id, wp.id));
                    if (withPref.length > 0) candidates = withPref;
                }

                if (candidates.length === 0) {
                    // Fallback: include discouraged doctors
                    candidates = doctors
                        .filter(d => !phaseC_blocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                     isQualified(d.id, wp.id) && !isAlreadyAssignedToSlot(d.id, wp.name, tsId));
                    if (hasOptionalQualReq(wp) && candidates.length > 0) {
                        const withPref = candidates.filter(d => hasOptionalQuals(d.id, wp.id));
                        if (withPref.length > 0) candidates = withPref;
                    }
                }

                // If none free, allow already-assigned-in-Phase-C qualified doctors (Mehrfachbesetzung!)
                if (candidates.length === 0) {
                    candidates = doctors
                        .filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                     !isDiscouraged(d.id, wp.id) &&
                                     isQualified(d.id, wp.id) && !isAlreadyAssignedToSlot(d.id, wp.name, tsId));
                    if (hasOptionalQualReq(wp) && candidates.length > 0) {
                        const withPref = candidates.filter(d => hasOptionalQuals(d.id, wp.id));
                        if (withPref.length > 0) candidates = withPref;
                    }
                }
                if (candidates.length === 0) {
                    // Fallback: include discouraged doctors in Mehrfachbesetzung
                    candidates = doctors
                        .filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                     isQualified(d.id, wp.id) && !isAlreadyAssignedToSlot(d.id, wp.name, tsId));
                    if (hasOptionalQualReq(wp) && candidates.length > 0) {
                        const withPref = candidates.filter(d => hasOptionalQuals(d.id, wp.id));
                        if (withPref.length > 0) candidates = withPref;
                    }
                }

                // Sort by cost function
                candidates.sort((a, b) => {
                    const costA = costFn.assignmentCost(a.id, wp, dateStr, costContextC1);
                    const costB = costFn.assignmentCost(b.id, wp, dateStr, costContextC1);
                    return costA - costB;
                });

                if (candidates.length > 0) {
                    assignC(candidates[0].id, wp.name, true, tsId);
                    debugLog('phase:C:coverage', 'Assigned non-availability Pflicht coverage slot', {
                        date: dateStr,
                        workplace: wp.name,
                        timeslotId: tsId,
                        doctorId: candidates[0].id,
                        doctorName: doctorNameById[candidates[0].id] || candidates[0].id,
                    });
                }
            }

            // C.2: Fill to optimal_staff (slot-level)
            let changedC = true;
            while (changedC) {
                changedC = false;

                const underFilledC = nonAvailSlots
                    .filter(slot => {
                        const sk = slotKey(slot.wp.name, slot.timeslotId);
                        return (phaseCSlotCount[sk] || 0) < getOptimal(slot.wp);
                    })
                    .sort((a, b) => {
                        const aCur = phaseCSlotCount[slotKey(a.wp.name, a.timeslotId)] || 0;
                        const bCur = phaseCSlotCount[slotKey(b.wp.name, b.timeslotId)] || 0;
                        const aDef = getOptimal(a.wp) - aCur;
                        const bDef = getOptimal(b.wp) - bCur;
                        if (aDef !== bDef) return bDef - aDef;
                        const aR = (phaseCSlotCount[slotKey(a.wp.name, a.timeslotId)] || 0) / getOptimal(a.wp);
                        const bR = (phaseCSlotCount[slotKey(b.wp.name, b.timeslotId)] || 0) / getOptimal(b.wp);
                        if (Math.abs(aR - bR) > 0.001) return aR - bR;
                        return (a.wp.order || 0) - (b.wp.order || 0);
                    });

                if (underFilledC.length === 0) break;

                const targetSlotC = underFilledC[0];
                const targetWpC = targetSlotC.wp;
                const targetTsIdC = targetSlotC.timeslotId;
                const targetHasQualReq = hasQualReq(targetWpC);
                const targetSkC = slotKey(targetWpC.name, targetTsIdC);
                const targetCurrentCountC = phaseCSlotCount[targetSkC] || 0;

                const costContextC2 = {
                    usedToday: phaseC_blocked,
                    posCount: phaseCSlotCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    soleOccupantDoctors,
                    phase: 'C',
                };

                if (targetHasQualReq) {
                    // Pflicht-workplace: ONLY qualified doctors allowed, and they can be reused
                    let eligiblePflicht = doctors
                        .filter(d => !serviceBlocked.has(d.id) && !phaseC_blocked.has(d.id) &&
                                     !isExcluded(d.id, targetWpC.id) && isQualified(d.id, targetWpC.id) &&
                                     !isAlreadyAssignedToSlot(d.id, targetWpC.name, targetTsIdC));

                    if (isRotationWp(targetWpC) && targetCurrentCountC >= 1) {
                        eligiblePflicht = eligiblePflicht.filter(d =>
                            isRotationTraineeForWp(d.id, targetWpC.name, dateStr)
                        );
                    }
                    {
                        const nonDisc = eligiblePflicht.filter(d => !isDiscouraged(d.id, targetWpC.id));
                        if (nonDisc.length > 0) eligiblePflicht = nonDisc;
                    }
                    if (hasOptionalQualReq(targetWpC)) {
                        const withPref = eligiblePflicht.filter(d => hasOptionalQuals(d.id, targetWpC.id));
                        if (withPref.length > 0) eligiblePflicht = withPref;
                    }

                    eligiblePflicht.sort((a, b) => {
                        const costA = costFn.assignmentCost(a.id, targetWpC, dateStr, costContextC2);
                        const costB = costFn.assignmentCost(b.id, targetWpC, dateStr, costContextC2);
                        return costA - costB;
                    });

                    // If none free, allow already-assigned qualified (Mehrfachbesetzung)
                    if (eligiblePflicht.length === 0) {
                        let eligibleMehr = doctors
                            .filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, targetWpC.id) &&
                                         isQualified(d.id, targetWpC.id) &&
                                         !isAlreadyAssignedToSlot(d.id, targetWpC.name, targetTsIdC));

                        if (isRotationWp(targetWpC) && targetCurrentCountC >= 1) {
                            eligibleMehr = eligibleMehr.filter(d =>
                                isRotationTraineeForWp(d.id, targetWpC.name, dateStr)
                            );
                        }
                        {
                            const nonDisc = eligibleMehr.filter(d => !isDiscouraged(d.id, targetWpC.id));
                            if (nonDisc.length > 0) eligibleMehr = nonDisc;
                        }
                        if (hasOptionalQualReq(targetWpC)) {
                            const withPref = eligibleMehr.filter(d => hasOptionalQuals(d.id, targetWpC.id));
                            if (withPref.length > 0) eligibleMehr = withPref;
                        }
                        eligibleMehr.sort((a, b) => {
                            const costA = costFn.assignmentCost(a.id, targetWpC, dateStr, costContextC2);
                            const costB = costFn.assignmentCost(b.id, targetWpC, dateStr, costContextC2);
                            return costA - costB;
                        });
                        eligiblePflicht = eligibleMehr;
                    }

                    if (eligiblePflicht.length > 0) {
                        assignC(eligiblePflicht[0].id, targetWpC.name, true, targetTsIdC);
                        debugLog('phase:C:pflicht-fill', 'Assigned Pflicht workplace slot', {
                            date: dateStr,
                            workplace: targetWpC.name,
                            timeslotId: targetTsIdC,
                            doctorId: eligiblePflicht[0].id,
                            doctorName: doctorNameById[eligiblePflicht[0].id] || eligiblePflicht[0].id,
                        });
                        changedC = true;
                    } else if (isRotationWp(targetWpC) && targetCurrentCountC >= 1) {
                        debugLog('phase:C:rotation-skip', 'Skipped second Pflicht occupancy for rotation workplace (no eligible trainee)', {
                            date: dateStr,
                            workplace: targetWpC.name,
                            timeslotId: targetTsIdC,
                            currentCount: targetCurrentCountC,
                        });
                    }
                } else {
                    // Non-Pflicht workplace: any unblocked doctor
                    const availableC = doctors.filter(d => !phaseC_blocked.has(d.id));
                    if (availableC.length === 0) break;

                    let eligibleC = availableC.filter(doc => !isExcluded(doc.id, targetWpC.id) &&
                                                             !isAlreadyAssignedToSlot(doc.id, targetWpC.name, targetTsIdC));

                    if (isRotationWp(targetWpC) && targetCurrentCountC >= 1) {
                        eligibleC = eligibleC.filter(doc =>
                            isRotationTraineeForWp(doc.id, targetWpC.name, dateStr)
                        );
                    }

                    {
                        const nonDiscouraged = eligibleC.filter(doc => !isDiscouraged(doc.id, targetWpC.id));
                        if (nonDiscouraged.length > 0) eligibleC = nonDiscouraged;
                    }

                    if (hasOptionalQualReq(targetWpC)) {
                        const withPreferred = eligibleC.filter(doc => hasOptionalQuals(doc.id, targetWpC.id));
                        if (withPreferred.length > 0) eligibleC = withPreferred;
                    }

                    eligibleC.sort((a, b) => {
                        const costA = costFn.assignmentCost(a.id, targetWpC, dateStr, costContextC2);
                        const costB = costFn.assignmentCost(b.id, targetWpC, dateStr, costContextC2);
                        return costA - costB;
                    });

                    if (eligibleC.length > 0 && costFn.assignmentCost(eligibleC[0].id, targetWpC, dateStr, costContextC2) < Infinity) {
                        assignC(eligibleC[0].id, targetWpC.name, false, targetTsIdC);
                        debugLog('phase:C:fill', 'Assigned non-availability slot', {
                            date: dateStr,
                            workplace: targetWpC.name,
                            timeslotId: targetTsIdC,
                            doctorId: eligibleC[0].id,
                            doctorName: doctorNameById[eligibleC[0].id] || eligibleC[0].id,
                        });
                        changedC = true;
                    } else if (isRotationWp(targetWpC) && targetCurrentCountC >= 1) {
                        debugLog('phase:C:rotation-skip', 'Skipped second occupancy for rotation workplace (no eligible trainee after filters)', {
                            date: dateStr,
                            workplace: targetWpC.name,
                            timeslotId: targetTsIdC,
                            currentCount: targetCurrentCountC,
                        });
                    }
                }
            }

            // C.3: Over-fill remaining into non-Pflicht workplaces (slot-level)
            let overChangedC = true;
            while (overChangedC) {
                overChangedC = false;

                const remainingC = doctors.filter(d => !phaseC_blocked.has(d.id));
                if (remainingC.length === 0) break;

                // Over-fill remaining doctors by highest deficit first.
                const optionsC = nonAvailSlots
                    .filter(slot => allowsMultiple(slot.wp))
                    .map(slot => ({
                        wp: slot.wp,
                        timeslotId: slot.timeslotId,
                        fillRatio: (phaseCSlotCount[slotKey(slot.wp.name, slot.timeslotId)] || 0) / Math.max(getOptimal(slot.wp), 1),
                        deficit: Math.max(getOptimal(slot.wp), 1) - (phaseCSlotCount[slotKey(slot.wp.name, slot.timeslotId)] || 0),
                    }))
                    .filter(o => {
                        if (isRotationWp(o.wp) && o.deficit <= 0) return false;
                        return true;
                    })
                    .sort((a, b) => {
                        if (a.deficit !== b.deficit) return b.deficit - a.deficit;
                        if (Math.abs(a.fillRatio - b.fillRatio) > 0.001) return a.fillRatio - b.fillRatio;
                        return (a.wp.order || 0) - (b.wp.order || 0);
                    });

                if (optionsC.length === 0) break;

                const costContextC3 = {
                    usedToday: phaseC_blocked,
                    posCount: phaseCSlotCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    soleOccupantDoctors,
                    phase: 'C',
                };

                // Find best (doctor, workplace, timeslot) triple by cost
                let bestAssignmentC = null;
                let bestCostC = Infinity;

                const hasAnyDeficitOptionC = optionsC.some(o => o.deficit > 0);

                for (const docC of remainingC) {
                    let eligibleC3 = optionsC.filter(o => {
                        if (isExcluded(docC.id, o.wp.id)) return false;
                        if (isAlreadyAssignedToSlot(docC.id, o.wp.name, o.timeslotId)) return false;
                        if (hasQualReq(o.wp) && !isQualified(docC.id, o.wp.id)) return false;
                        return true;
                    });

                    if (hasAnyDeficitOptionC) {
                        const deficitOnly = eligibleC3.filter(o => o.deficit > 0);
                        if (deficitOnly.length > 0) eligibleC3 = deficitOnly;
                    }

                    {
                        const traineePreferred = eligibleC3.filter(o => {
                            const cur = phaseCSlotCount[slotKey(o.wp.name, o.timeslotId)] || 0;
                            if (!isRotationWp(o.wp) || cur < 1) return true;
                            return isRotationTraineeForWp(docC.id, o.wp.name, dateStr);
                        });
                        if (traineePreferred.length > 0) eligibleC3 = traineePreferred;
                    }
                    {
                        const nonDisc = eligibleC3.filter(o => !isDiscouraged(docC.id, o.wp.id));
                        if (nonDisc.length > 0) eligibleC3 = nonDisc;
                    }
                    {
                        const withPref = eligibleC3.filter(o =>
                            !hasOptionalQualReq(o.wp) || hasOptionalQuals(docC.id, o.wp.id)
                        );
                        if (withPref.length > 0) eligibleC3 = withPref;
                    }

                    for (const o of eligibleC3) {
                        const cost = costFn.assignmentCost(docC.id, o.wp, dateStr, costContextC3);
                        const adjustedCost = cost + o.fillRatio * 2 - o.deficit * 4;
                        if (adjustedCost < bestCostC) {
                            bestCostC = adjustedCost;
                            bestAssignmentC = { doc: docC, wp: o.wp, timeslotId: o.timeslotId };
                        }
                    }
                }

                if (bestAssignmentC && bestCostC < Infinity) {
                    assignC(bestAssignmentC.doc.id, bestAssignmentC.wp.name, false, bestAssignmentC.timeslotId);
                    debugLog('phase:C:overfill', 'Overfill assignment in non-availability workplace', {
                        date: dateStr,
                        workplace: bestAssignmentC.wp.name,
                        timeslotId: bestAssignmentC.timeslotId,
                        doctorId: bestAssignmentC.doc.id,
                        doctorName: doctorNameById[bestAssignmentC.doc.id] || bestAssignmentC.doc.id,
                        adjustedCost: bestCostC,
                    });
                    overChangedC = true;
                }
            }

            // ============================================================
            //  Phase C: Swap Optimization (2-opt local search)
            //  Same approach as Phase B: try pairwise swaps to reduce
            //  total cost for non-availability-relevant workplaces.
            // ============================================================
            {
                const phaseCSuggestions = [];
                for (let idx = phaseCStartIdx; idx < suggestions.length; idx++) {
                    const s = suggestions[idx];
                    if (s.date !== dateStr) continue;
                    if (s.position === 'Frei') continue;
                    const wp = workplaces.find(w => w.name === s.position);
                    if (!wp || isServiceWp(wp)) continue;
                    phaseCSuggestions.push(s);
                }

                if (phaseCSuggestions.length >= 2) {
                    const swapContextC = {
                        usedToday: phaseC_blocked,
                        posCount: phaseCSlotCount,
                        displacementCount,
                        rotationImpactScore,
                        serviceAssignedToday,
                        soleOccupantDoctors,
                        phase: 'C',
                    };

                    let swapImprovedC = true;
                    let swapRoundsC = 0;
                    const maxSwapRoundsC = 20;

                    while (swapImprovedC && swapRoundsC < maxSwapRoundsC) {
                        swapImprovedC = false;
                        swapRoundsC++;

                        for (let i = 0; i < phaseCSuggestions.length && !swapImprovedC; i++) {
                            for (let j = i + 1; j < phaseCSuggestions.length && !swapImprovedC; j++) {
                                const s1 = phaseCSuggestions[i];
                                const s2 = phaseCSuggestions[j];
                                if (s1.position === s2.position) continue;
                                if (s1.doctor_id === s2.doctor_id) continue;

                                const wp1 = workplaces.find(w => w.name === s1.position);
                                const wp2 = workplaces.find(w => w.name === s2.position);
                                if (!wp1 || !wp2) continue;

                                // Validity: exclusion
                                if (isExcluded(s2.doctor_id, wp1.id)) continue;
                                if (isExcluded(s1.doctor_id, wp2.id)) continue;

                                // Validity: mandatory qualification
                                if (hasQualReq(wp1) && !isQualified(s2.doctor_id, wp1.id)) continue;
                                if (hasQualReq(wp2) && !isQualified(s1.doctor_id, wp2.id)) continue;

                                // Cost comparison
                                const currentCostC =
                                    costFn.assignmentCost(s1.doctor_id, wp1, dateStr, swapContextC) +
                                    costFn.assignmentCost(s2.doctor_id, wp2, dateStr, swapContextC);
                                const swappedCostC =
                                    costFn.assignmentCost(s2.doctor_id, wp1, dateStr, swapContextC) +
                                    costFn.assignmentCost(s1.doctor_id, wp2, dateStr, swapContextC);

                                if (swappedCostC < currentCostC - 0.5) {
                                    debugLog('phase:C:swap', `Swap reduces cost by ${(currentCostC - swappedCostC).toFixed(1)}`, {
                                        before: `${doctorNameById[s1.doctor_id]}\u2192${s1.position}, ${doctorNameById[s2.doctor_id]}\u2192${s2.position}`,
                                        after: `${doctorNameById[s2.doctor_id]}\u2192${s1.position}, ${doctorNameById[s1.doctor_id]}\u2192${s2.position}`,
                                        costBefore: Math.round(currentCostC * 10) / 10,
                                        costAfter: Math.round(swappedCostC * 10) / 10,
                                    });

                                    const tmp = s1.doctor_id;
                                    s1.doctor_id = s2.doctor_id;
                                    s2.doctor_id = tmp;
                                    swapImprovedC = true;
                                }
                            }
                        }
                    }

                    if (swapRoundsC > 1) {
                        debugLog('phase:C:swap-summary', `Swap optimization completed in ${swapRoundsC} rounds`, {
                            date: dateStr,
                            totalSwaps: swapRoundsC - 1,
                        });
                    }
                }
            }
        }

        debugLog('day:summary', 'Finished day planning', {
            date: dateStr,
            assignedToday: suggestions.length - dayStartSuggestions,
            autoFreiAddedToday: autoFreiSuggestions.length - dayStartAutoFrei,
            blockedDoctorsAtEndOfDay: usedToday.size,
        });
    }

    // ============================================================
    //  PHASE D: Auto-Frei for non-service auto_off positions
    //  (Service auto-frei was already handled in Phase A)
    // ============================================================
    for (const s of suggestions) {
        if (s.position === 'Frei') continue;
        const wp = workplaces.find(w => w.name === s.position);
        if (!wp?.auto_off) continue;
        if (wp.category === 'Dienste') continue; // Already handled in Phase A

        const alreadyGenerated = autoFreiSuggestions.some(
            af => af.doctor_id === s.doctor_id && af.date > s.date
        );
        if (!alreadyGenerated) {
            generateAutoFrei(s.doctor_id, s.date);
            debugLog('phase:D:autoFrei', 'Generated non-service auto-frei', {
                sourceDate: s.date,
                sourcePosition: s.position,
                doctorId: s.doctor_id,
                doctorName: doctorNameById[s.doctor_id] || s.doctor_id,
            });
        }
    }

    const finalResult = [...suggestions, ...autoFreiSuggestions];
    debugLog('result', 'Deterministic AutoFill finished', {
        suggestions: suggestions.length,
        autoFrei: autoFreiSuggestions.length,
        total: finalResult.length,
        debugEntries: debugEntries.length,
        requestId: debugRequestId,
    });

    if (debugEnabled) {
        finalResult.__debug = {
            requestId: debugRequestId,
            entries: debugEntries,
        };
    }

    return finalResult;
}

/** Simple date formatter */
function formatDate(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}
