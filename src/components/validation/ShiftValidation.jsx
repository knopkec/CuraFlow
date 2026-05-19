import { format, addDays, isWeekend, parseISO } from 'date-fns';
import { timeslotsOverlap, createFullDayTimeslot } from '@/utils/timeslotUtils';
import { getAutoFreiDate } from '@/utils/autoFrei';
import { categoryAllowsMultiple, getWorkplaceCategoriesFromSettings, workplaceAllowsMultiple } from '@/utils/workplaceCategoryUtils';

// Hilfsfunktion für Fehlermeldungen
function formatTimeRange(slot) {
    if (!slot) return '';
    const start = slot.start_time?.substring(0, 5) || '00:00';
    const end = slot.end_time?.substring(0, 5) || '23:59';
    return `${start}-${end}`;
}

// Standard Facharzt-Rollen (Fallback wenn nicht aus DB geladen)
export const DEFAULT_SPECIALIST_ROLES = ["Chefarzt", "Oberarzt", "Facharzt"];
export const DEFAULT_ASSISTANT_ROLES = ["Assistenzarzt"];

/**
 * Zentrale Validierungsschicht für alle ShiftEntry-Operationen
 * Wird von ScheduleBoard, ServiceStaffing und Wish-Genehmigung verwendet
 */

export class ShiftValidator {
    constructor({ doctors, shifts, workplaces, wishes, systemSettings, staffingEntries, specialistRoles, timeslots, qualificationMap, getDoctorQualIds, wpQualsByWorkplace }) {
        this.doctors = doctors || [];
        this.shifts = shifts || [];
        this.workplaces = workplaces || [];
        this.wishes = wishes || [];
        this.systemSettings = systemSettings || [];
        this.staffingEntries = staffingEntries || [];
        // Dynamische Facharzt-Rollen aus DB, mit Fallback
        this.specialistRoles = specialistRoles || DEFAULT_SPECIALIST_ROLES;
        this.assistantRoles = DEFAULT_ASSISTANT_ROLES;
        // Timeslots für Überlappungsprüfung
        this.timeslots = timeslots || [];
        // Qualifikationsdaten
        this.qualificationMap = qualificationMap || {};
        this.getDoctorQualIds = getDoctorQualIds || (() => []);
        this.wpQualsByWorkplace = wpQualsByWorkplace || {};
        
        // Custom-Kategorien parsen für Mehrfachbesetzungs-Prüfung
        this._customCategories = getWorkplaceCategoriesFromSettings(this.systemSettings);
        
        // Parse settings
        this.allowAbsenceOncallOverlap = this.systemSettings.find(s => s.key === 'allow_absence_oncall_overlap')?.value === 'true';
        this.absenceBlockingRules = this._parseAbsenceRules();
        this.limits = this._parseLimits();
        this.staffingMinimums = this._parseStaffingMinimums();
    }

    /**
     * Prüft ob eine Kategorie Mehrfachbesetzung erlaubt
     */
    _categoryAllowsMultiple(categoryName) {
        return categoryAllowsMultiple(categoryName, this._customCategories);
    }

    /**
     * Prüft ob ein Arbeitsplatz Mehrfachbesetzung erlaubt.
     * Nutzt workplace.allows_multiple wenn gesetzt, sonst Kategorie-Default.
     */
    _workplaceAllowsMultiple(workplace) {
        return workplaceAllowsMultiple(workplace, this._customCategories);
    }

    _parseAbsenceRules() {
        const setting = this.systemSettings.find(s => s.key === 'absence_blocking_rules');
        return setting ? JSON.parse(setting.value) : {
            "Urlaub": true, "Krank": true, "Frei": true, "Dienstreise": false, "Nicht verfügbar": false
        };
    }

    _parseLimits() {
        const get = (key, def) => parseInt(this.systemSettings.find(s => s.key === key)?.value || def);
        return {
            foreground: get('limit_fore_services', '4'),
            background: get('limit_back_services', '12'),
            weekend: get('limit_weekend_services', '1')
        };
    }

    _parseStaffingMinimums() {
        const get = (key, def) => parseInt(this.systemSettings.find(s => s.key === key)?.value || def);
        return {
            specialists: get('min_present_specialists', '2'),
            assistants: get('min_present_assistants', '3')
        };
    }

    _getDoctorFte(doctorId, date) {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        
        const entry = this.staffingEntries.find(e => 
            e.doctor_id === doctorId && e.year === year && e.month === month
        );

        if (entry) {
            const val = String(entry.value).replace(',', '.');
            const num = parseFloat(val);
            if (isNaN(num)) return 0;
            return num;
        }

        const doctor = this.doctors.find(d => d.id === doctorId);
        return doctor?.fte ?? 1.0;
    }

    /**
     * Hauptvalidierungsmethode
     * @returns {{ canProceed: boolean, blockers: string[], warnings: string[] }}
     */
    validate(doctorId, dateStr, position, options = {}) {
        const { 
            excludeShiftId = null,  // Bei Updates: eigene Shift-ID ausschließen
            silent = false,         // Keine UI-Interaktion
            skipLimits = false,     // Limits überspringen (für Massenoperationen)
            timeslotId = null,      // Ziel-Timeslot-ID (neu für Timeslot-Feature)
        } = options;

        const result = {
            canProceed: true,
            blockers: [],
            warnings: []
        };

        const date = new Date(dateStr);
        const doctor = this.doctors.find(d => d.id === doctorId);
        if (!doctor) {
            result.blockers.push('Person nicht gefunden');
            result.canProceed = false;
            return result;
        }

        // 1. Abwesenheits-Konflikte prüfen
        const absenceResult = this._checkAbsenceConflicts(doctorId, dateStr, position, excludeShiftId);
        if (absenceResult.blocker) {
            result.blockers.push(absenceResult.blocker);
            result.canProceed = false;
        }
        if (absenceResult.warning) {
            result.warnings.push(absenceResult.warning);
        }

        // 2. Dienst/Rotation-Konflikte prüfen
        const conflictResult = this._checkServiceRotationConflicts(doctorId, dateStr, position, excludeShiftId);
        if (conflictResult.blocker) {
            result.blockers.push(conflictResult.blocker);
            result.canProceed = false;
        }

        // 3. Aufeinanderfolgende Tage prüfen
        const consecutiveResult = this._checkConsecutiveDays(doctorId, dateStr, position, excludeShiftId);
        if (consecutiveResult.blocker) {
            result.blockers.push(consecutiveResult.blocker);
            result.canProceed = false;
        }

        // 4. Dienstlimits prüfen (nur Warnung, kein Blocker)
        if (!skipLimits) {
            const limitResult = this._checkServiceLimits(doctorId, dateStr, position, excludeShiftId);
            if (limitResult.warning) {
                result.warnings.push(limitResult.warning);
            }
        }

        // 5. Mindestbesetzung prüfen (nur für Abwesenheiten)
        const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];
        if (absencePositions.includes(position)) {
            const staffingResult = this._checkStaffingMinimums(doctorId, dateStr, excludeShiftId);
            if (staffingResult.warning) {
                result.warnings.push(staffingResult.warning);
            }
        }

        // 6. Qualifikationsanforderungen prüfen
        const qualResult = this._checkQualificationRequirements(doctorId, position, dateStr, excludeShiftId);
        if (qualResult.blocker) {
            result.blockers.push(qualResult.blocker);
            result.canProceed = false;
        }
        if (qualResult.warning) {
            result.warnings.push(qualResult.warning);
        }

        // 7. Timeslot-Überlappung prüfen (nur wenn Timeslots aktiviert)
        if (timeslotId || this._workplaceHasTimeslots(position)) {
            const overlapResult = this._checkTimeslotOverlaps(
                doctorId, dateStr, position, timeslotId, excludeShiftId
            );
            if (overlapResult.blocker) {
                result.blockers.push(overlapResult.blocker);
                result.canProceed = false;
            }
            if (overlapResult.warning) {
                result.warnings.push(overlapResult.warning);
            }
        }

        return result;
    }

    /**
     * Prüft Qualifikationsanforderungen eines Arbeitsplatzes gegen Mitarbeiter-Qualifikationen
     * Pflicht-Qualifikationen → Blocker (override-fähig)
     * Sollte-Qualifikationen → Bevorzugung (nur für Priorisierung)
     * Sollte-nicht-Qualifikationen → Warnung (override-fähig)
     * Nicht-Qualifikationen → harter Blocker
     * 
     * Ausbildungsmodus: Bei Mehrfachbesetzung werden die Checks ausgesetzt,
     * wenn bereits mind. 1 qualifizierter Mitarbeiter eingeteilt ist.
     */
    _checkQualificationRequirements(doctorId, position, dateStr, excludeShiftId) {
        const workplace = this.workplaces.find(w => w.name === position);
        if (!workplace) return {};

        const wpQuals = this.wpQualsByWorkplace[workplace.id] || [];
        if (wpQuals.length === 0) return {};

        const docQualIds = this.getDoctorQualIds(doctorId);

        // Nicht-Qualifikationen: Mitarbeiter darf KEINE der ausgeschlossenen Qualifikationen haben
        // Dies ist ein harter Blocker (kein Override möglich)
        const excludedQuals = wpQuals.filter(wq => !wq.is_mandatory && wq.is_excluded);
        if (excludedQuals.length > 0) {
            const violatedExclusions = excludedQuals.filter(wq => docQualIds.includes(wq.qualification_id));
            if (violatedExclusions.length > 0) {
                const names = violatedExclusions
                    .map(wq => this.qualificationMap[wq.qualification_id]?.name || '?')
                    .join(', ');
                return { blocker: `Ausgeschlossen: Mitarbeiter hat Ausschlusskriterium „${names}" – darf hier nicht eingeteilt werden.` };
            }
        }

        // Sollte-nicht-Qualifikationen: Mitarbeiter hat eine Qualifikation, die hier unerwünscht ist
        const discouragedQuals = wpQuals.filter(wq => wq.is_mandatory && wq.is_excluded);
        const violatedDiscouraged = discouragedQuals.filter(wq => docQualIds.includes(wq.qualification_id));

        const mandatoryQuals = wpQuals.filter(wq => wq.is_mandatory && !wq.is_excluded);
        const preferredQuals = wpQuals.filter(wq => !wq.is_mandatory && !wq.is_excluded);

        // Mehrfachbesetzung / Ausbildungsmodus:
        // Nur bei Arbeitsplätzen die Mehrfachbesetzung erlauben (nicht bei Single-Slot,
        // da dort der neue Eintrag den bestehenden ersetzt)
        const allowsMultiple = this._workplaceAllowsMultiple(workplace);
        if (dateStr && allowsMultiple) {
            const otherAssignments = this.shifts.filter(s =>
                s.position === position &&
                s.date === dateStr &&
                s.doctor_id !== doctorId &&
                s.id !== excludeShiftId
            );

            if (otherAssignments.length > 0) {
                // Prüfe ob mindestens ein bereits eingeteilter Kollege alle Pflicht-Qualifikationen hat
                const allRequiredQualIds = [...mandatoryQuals.map(wq => wq.qualification_id), ...preferredQuals.map(wq => wq.qualification_id)];
                const hasQualifiedColleague = otherAssignments.some(s => {
                    const colleagueQuals = this.getDoctorQualIds(s.doctor_id);
                    return allRequiredQualIds.every(qid => colleagueQuals.includes(qid));
                });

                if (hasQualifiedColleague) {
                    return {};
                }
            }
        }

        // Pflicht-Qualifikationen prüfen
        const missingMandatory = mandatoryQuals.filter(wq => !docQualIds.includes(wq.qualification_id));
        if (missingMandatory.length > 0) {
            const names = missingMandatory
                .map(wq => this.qualificationMap[wq.qualification_id]?.name || '?')
                .join(', ');
            return { blocker: `Fehlende Pflicht-Qualifikation: ${names}` };
        }

        // Sollte-nicht-Qualifikationen: Warnung wenn Mitarbeiter unerwünschte Qualifikation hat
        if (violatedDiscouraged.length > 0) {
            const names = violatedDiscouraged
                .map(wq => this.qualificationMap[wq.qualification_id]?.name || '?')
                .join(', ');
            return { warning: `Sollte nicht: Mitarbeiter hat Qualifikation „${names}" – nur zuweisen wenn kein anderer verfügbar.` };
        }

        // Sollte-Qualifikationen: Warnung wenn Arzt die bevorzugte Qualifikation NICHT hat
        // (Fallback: nur zuweisen wenn kein qualifizierter Arzt verfügbar)
        if (preferredQuals.length > 0) {
            const missingPreferred = preferredQuals.filter(wq => !docQualIds.includes(wq.qualification_id));
            if (missingPreferred.length > 0) {
                const names = missingPreferred
                    .map(wq => this.qualificationMap[wq.qualification_id]?.name || '?')
                    .join(', ');
                return { warning: `Fehlende Sollte-Qualifikation: ${names} – nur zuweisen wenn kein qualifizierter Arzt verfügbar.` };
            }
        }

        return {};
    }

    /**
     * Prüft ob ein Arbeitsplatz Timeslots aktiviert hat
     */
    _workplaceHasTimeslots(position) {
        const workplace = this.workplaces.find(w => w.name === position);
        return workplace?.timeslots_enabled === true;
    }

    /**
     * Prüft ob ein Mitarbeiter in überlappenden Zeitfenstern eingeteilt ist
     */
    _checkTimeslotOverlaps(doctorId, dateStr, newPosition, newTimeslotId, excludeShiftId) {
        // Alle ShiftEntries des Mitarbeiters am Tag laden
        const doctorShifts = this.shifts.filter(s => 
            s.doctor_id === doctorId && 
            s.date === dateStr &&
            s.id !== excludeShiftId
        );

        if (doctorShifts.length === 0) {
            return {}; // Keine anderen Schichten an diesem Tag
        }

        // Neues Timeslot laden
        const newTimeslot = newTimeslotId 
            ? this.timeslots.find(t => t.id === newTimeslotId)
            : null;

        // Wenn kein Timeslot angegeben und Position hat keine Timeslots, ist es ganztägig
        const newWorkplace = this.workplaces.find(w => w.name === newPosition);
        const newEffectiveSlot = newTimeslot || 
            (newWorkplace?.timeslots_enabled ? null : createFullDayTimeslot());

        if (!newEffectiveSlot) {
            // Timeslot-Position ohne konkreten Timeslot - das ist ein Problem
            return { warning: 'Bitte wählen Sie ein Zeitfenster aus.' };
        }

        // Toleranz ermitteln
        const tolerance = newTimeslot?.overlap_tolerance_minutes || 
            newWorkplace?.default_overlap_tolerance_minutes || 0;

        // Prüfe gegen alle anderen Schichten des Mitarbeiters
        for (const existingShift of doctorShifts) {
            const existingTimeslot = existingShift.timeslot_id
                ? this.timeslots.find(t => t.id === existingShift.timeslot_id)
                : null;

            const existingWorkplace = this.workplaces.find(w => w.name === existingShift.position);
            const existingEffectiveSlot = existingTimeslot || 
                (existingWorkplace?.timeslots_enabled ? null : createFullDayTimeslot());

            if (!existingEffectiveSlot) {
                continue; // Existierender Eintrag hat keinen gültigen Slot
            }

            // Überlappung prüfen
            if (timeslotsOverlap(newEffectiveSlot, existingEffectiveSlot, tolerance)) {
                const existingLabel = existingTimeslot?.label || existingShift.position;
                const newLabel = newTimeslot?.label || newPosition;
                return { 
                    blocker: `Zeitkonflikt: "${existingLabel}" überlappt mit "${newLabel}" um ${formatTimeRange(existingEffectiveSlot)}.`
                };
            }
        }

        return {};
    }

    _checkAbsenceConflicts(doctorId, dateStr, newPosition, excludeShiftId) {
        // On-call shifts are not explicitly identifiable in the current model,
        // so this setting bypasses absence blocking globally when enabled.
        if (this.allowAbsenceOncallOverlap) {
            return {};
        }

        const doctorShifts = this.shifts.filter(s => 
            s.doctor_id === doctorId && 
            s.date === dateStr &&
            s.id !== excludeShiftId
        );

        for (const shift of doctorShifts) {
            const isBlocking = this.absenceBlockingRules[shift.position];
            
            if (typeof isBlocking === 'boolean') {
                if (isBlocking) {
                    return { blocker: `Mitarbeiter ist bereits als "${shift.position}" eingetragen (blockiert).` };
                } else {
                    return { warning: `Konflikt: Mitarbeiter ist "${shift.position}".` };
                }
            }
        }

        return {};
    }

    _checkServiceRotationConflicts(doctorId, dateStr, newPosition, excludeShiftId) {
        const doctorShifts = this.shifts.filter(s => 
            s.doctor_id === doctorId && 
            s.date === dateStr &&
            s.id !== excludeShiftId
        );

        // Check if new position is a non-availability-affecting workplace
        const newWorkplace = this.workplaces.find(w => w.name === newPosition);
        
        // If the NEW position doesn't affect availability, only check for absences (handled elsewhere)
        // Skip rotation/service conflict checks
        if (newWorkplace?.affects_availability === false) {
            return {};
        }

        const rotationPositions = this.workplaces.filter(w => w.category === 'Rotationen').map(w => w.name);
        const exclusiveServices = this.workplaces
            .filter(w => w.category === 'Dienste' && w.allows_rotation_concurrently === false)
            .map(w => w.name);

        const isNewRotation = rotationPositions.includes(newPosition);
        const newServiceWorkplace = this.workplaces.find(w => w.name === newPosition && w.category === 'Dienste');
        const isNewService = !!newServiceWorkplace;

        // Neue Rotation + existierender exklusiver Dienst
        if (isNewRotation) {
            const conflict = doctorShifts.find(s => exclusiveServices.includes(s.position));
            if (conflict) {
                return { blocker: `Konflikt: "${conflict.position}" blockiert Rotation.` };
            }
        }

        // Neuer exklusiver Dienst + existierende Rotation
        if (isNewService && newServiceWorkplace.allows_rotation_concurrently === false) {
            // Check if existing shift is a non-availability-affecting position
            // If so, it doesn't block the new service
            const conflict = doctorShifts.find(s => {
                if (!rotationPositions.includes(s.position)) return false;
                const existingWorkplace = this.workplaces.find(w => w.name === s.position);
                // Non-availability-affecting positions don't block
                if (existingWorkplace?.affects_availability === false) return false;
                return true;
            });
            if (conflict) {
                return { blocker: `Konflikt: Rotation "${conflict.position}" ist nicht mit diesem Dienst kombinierbar.` };
            }
        }

        return {};
    }

    _checkConsecutiveDays(doctorId, dateStr, newPosition, excludeShiftId) {
        // Check if this position allows consecutive days (from workplace config)
        const workplace = this.workplaces.find(w => w.name === newPosition);
        
        // Only apply consecutive days check for "Dienste" category
        // Rotations, Demos, and other categories should not have this restriction
        if (!workplace || workplace.category !== 'Dienste') {
            return {};
        }
        
        // Determine consecutive mode: 'forbidden' | 'allowed' | 'preferred'
        // Backward compat: old boolean false → 'forbidden', true/undefined → 'allowed'
        const mode = workplace.consecutive_days_mode
            || (workplace.allows_consecutive_days === false ? 'forbidden' : 'allowed');
        
        // Only block if mode is 'forbidden'
        if (mode !== 'forbidden') {
            return {};
        }

        const currentDate = new Date(dateStr);
        const prevDateStr = format(addDays(currentDate, -1), 'yyyy-MM-dd');
        const nextDateStr = format(addDays(currentDate, 1), 'yyyy-MM-dd');

        const hasConsecutive = this.shifts.some(s => 
            s.doctor_id === doctorId && 
            s.position === newPosition && 
            s.id !== excludeShiftId &&
            (s.date === prevDateStr || s.date === nextDateStr)
        );

        if (hasConsecutive) {
            return { blocker: `"${newPosition}" ist nicht an aufeinanderfolgenden Tagen erlaubt.` };
        }

        return {};
    }

    _checkServiceLimits(doctorId, dateStr, newPosition, excludeShiftId) {
        const workplace = this.workplaces.find(w => w.name === newPosition);
        if (!workplace || workplace.category !== 'Dienste') return {};

        // Get all service workplaces to identify foreground/background by service_type
        const serviceWorkplaces = this.workplaces.filter(w => w.category === 'Dienste');
        const sortedServices = [...serviceWorkplaces].sort((a, b) => (a.order || 0) - (b.order || 0));
        
        // Build sets of position names by service_type
        const foregroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 1).map(w => w.name));
        const backgroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 2).map(w => w.name));
        
        // Legacy fallback: if no service_type set, use old convention
        if (foregroundPositions.size === 0 && backgroundPositions.size === 0 && sortedServices.length > 0) {
            foregroundPositions.add(sortedServices[0].name);
            sortedServices.slice(1).forEach(w => backgroundPositions.add(w.name));
        }

        const date = new Date(dateStr);
        const isFG = foregroundPositions.has(newPosition);
        const isBG = backgroundPositions.has(newPosition);
        const isWknd = isWeekend(date) && isFG;

        let countFG = 0, countBG = 0, countWknd = 0;
        const monthStr = format(date, 'yyyy-MM');

        this.shifts.forEach(s => {
            if (s.doctor_id !== doctorId) return;
            if (!s.date.startsWith(monthStr)) return;
            if (s.id === excludeShiftId) return;

            if (foregroundPositions.has(s.position)) {
                countFG++;
                const sDate = parseISO(s.date);
                if (isWeekend(sDate)) countWknd++;
            }
            if (backgroundPositions.has(s.position)) countBG++;
        });

        if (isFG) countFG++;
        if (isBG) countBG++;
        if (isWknd) countWknd++;

        const fte = this._getDoctorFte(doctorId, date);
        const adjFG = Math.round(this.limits.foreground * fte);
        const adjBG = Math.round(this.limits.background * fte);

        const warnings = [];
        if (isFG && countFG > adjFG) warnings.push(`${countFG}. Bereitschaftsdienst (Limit: ${adjFG})`);
        if (isBG && countBG > adjBG) warnings.push(`${countBG}. Rufbereitschaftsdienst (Limit: ${adjBG})`);
        if (isWknd && countWknd > this.limits.weekend) warnings.push(`${countWknd}. Wochenenddienst (Limit: ${this.limits.weekend})`);

        if (warnings.length > 0) {
            return { warning: `Dienstlimit überschritten: ${warnings.join(', ')}` };
        }

        return {};
    }

    _checkStaffingMinimums(doctorId, dateStr, excludeShiftId) {
        const doctor = this.doctors.find(d => d.id === doctorId);
        if (!doctor) return {};

        const ABSENCE_POSITIONS = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

        // Zähle aktuelle Abwesenheiten (ohne diese neue)
        const absentOnDate = this.shifts.filter(s => 
            s.date === dateStr && 
            ABSENCE_POSITIONS.includes(s.position) &&
            s.id !== excludeShiftId
        ).map(s => s.doctor_id);

        // Füge den neuen Abwesenden hinzu
        const allAbsent = new Set([...absentOnDate, doctorId]);

        // Zähle verfügbare Ärzte (mit dynamischen Rollen)
        const totalSpecialists = this.doctors.filter(d => this.specialistRoles.includes(d.role)).length;
        const totalAssistants = this.doctors.filter(d => this.assistantRoles.includes(d.role)).length;

        const absentSpecialists = this.doctors.filter(d => 
            this.specialistRoles.includes(d.role) && allAbsent.has(d.id)
        ).length;
        const absentAssistants = this.doctors.filter(d => 
            this.assistantRoles.includes(d.role) && allAbsent.has(d.id)
        ).length;

        const presentSpecialists = totalSpecialists - absentSpecialists;
        const presentAssistants = totalAssistants - absentAssistants;

        const warnings = [];
        if (presentSpecialists < this.staffingMinimums.specialists) {
            warnings.push(`Nur ${presentSpecialists} Fachärzte anwesend (Min: ${this.staffingMinimums.specialists})`);
        }
        if (presentAssistants < this.staffingMinimums.assistants) {
            warnings.push(`Nur ${presentAssistants} Assistenzärzte anwesend (Min: ${this.staffingMinimums.assistants})`);
        }

        if (warnings.length > 0) {
            return { warning: `Mindestbesetzung unterschritten: ${warnings.join(', ')}` };
        }

        return {};
    }

    /**
     * Prüft ob Auto-Frei am direkten Folgetag erstellt werden soll.
     * Samstage, Sonntage und Feiertage lösen kein verschobenes Auto-Frei aus.
     * @returns {string|null} - Datum für Auto-Frei oder null
     */
    shouldCreateAutoFrei(position, dateStr, isPublicHoliday) {
        const workplace = this.workplaces.find(w => w.name === position);
        if (!workplace?.auto_off) return null;

        return getAutoFreiDate(dateStr, isPublicHoliday);
    }

    /**
     * Findet Auto-Frei-Einträge die gelöscht werden sollten wenn ein Dienst entfernt wird
     * @returns {object|null} - Der zu löschende Shift oder null
     */
    findAutoFreiToCleanup(doctorId, dateStr, position) {
        const workplace = this.workplaces.find(w => w.name === position);
        if (!workplace?.auto_off) return null;

        const nextDay = addDays(parseISO(dateStr), 1);
        const nextDayStr = format(nextDay, 'yyyy-MM-dd');

        const autoFreiShift = this.shifts.find(s => 
            s.date === nextDayStr && 
            s.doctor_id === doctorId && 
            s.position === 'Frei' &&
            (s.note?.includes('Autom.') || s.note?.includes('Freizeitausgleich'))
        );

        return autoFreiShift || null;
    }

    /**
     * Prüft ob eine Position Auto-Off auslöst
     */
    isAutoOffPosition(position) {
        const workplace = this.workplaces.find(w => w.name === position);
        return !!workplace?.auto_off;
    }
}

/**
 * Hook-artige Factory-Funktion für einfache Integration
 */
export function createShiftValidator(data) {
    return new ShiftValidator(data);
}