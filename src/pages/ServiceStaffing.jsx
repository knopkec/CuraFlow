import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isWeekend } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Printer, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmployeeSelect from '@/components/staff/EmployeeSelect';
import { useHolidays } from '@/components/useHolidays';
import { useShiftValidation } from '@/components/validation/useShiftValidation';
import { useOverrideValidation } from '@/components/validation/useOverrideValidation';
import OverrideConfirmDialog from '@/components/validation/OverrideConfirmDialog';
import { trackDbChange } from '@/components/utils/dbTracker';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
import { useAllDoctorQualifications, useAllWorkplaceQualifications, useQualifications } from '@/hooks/useQualifications';
import { isWishOnDate } from '@/utils/wishRange';
import { isAlphabeticalDoctorSortingEnabled, sortDoctorsAlphabetically } from '@/utils/doctorSorting';

import WorkplaceConfigDialog from '@/components/settings/WorkplaceConfigDialog';
import { useSectionConfig } from '@/components/settings/SectionConfigDialog';

const STATIC_SERVICE_TYPES = [];

export default function ServiceStaffingPage() {
    const { isReadOnly, user } = useAuth();
    const { getSectionName } = useSectionConfig();
    const { isPublicHoliday } = useHolidays();
    const [currentDate, setCurrentDate] = useState(new Date());
    const queryClient = useQueryClient();
    const servicesCaption = getSectionName('Dienste');
    const servicesPageTitle = servicesCaption === 'Dienste' ? 'Dienstbesetzung' : servicesCaption;
    const alphabeticalDoctorSorting = useMemo(() => isAlphabeticalDoctorSortingEnabled(user), [user]);

    const { data: doctors = [] } = useQuery({
        queryKey: ['doctors'],
        queryFn: () => db.Doctor.list(),
        select: (data) => data.sort((a, b) => (a.order || 0) - (b.order || 0)),
    });

    const fetchRange = useMemo(() => {
        const start = startOfMonth(addMonths(currentDate, -1));
        const end = endOfMonth(addMonths(currentDate, 1));
        return {
            start: format(start, 'yyyy-MM-dd'),
            end: format(end, 'yyyy-MM-dd')
        };
    }, [currentDate]);

    const { data: allShifts = [] } = useQuery({
        queryKey: ['shifts', fetchRange.start, fetchRange.end],
        queryFn: () => db.ShiftEntry.filter({
            date: { $gte: fetchRange.start, $lte: fetchRange.end }
        }, null, 5000),
        keepPreviousData: true,
    });

    const { data: wishes = [] } = useQuery({
        queryKey: ['wishes', fetchRange.start, fetchRange.end],
        queryFn: () => db.WishRequest.filter({
            date: { $gte: fetchRange.start, $lte: fetchRange.end }
        }),
        keepPreviousData: true,
    });

    const { data: demoSettings = [] } = useQuery({
        queryKey: ['demoSettings'],
        queryFn: () => db.DemoSetting.list(),
    });

    const { data: workplaces = [] } = useQuery({
        queryKey: ['workplaces'],
        queryFn: () => db.Workplace.list(null, 1000),
    });

    const { validateWithUI, validate, shouldCreateAutoFrei, findAutoFreiToCleanup } = useShiftValidation(allShifts, { workplaces });

    // Override-Validierung mit Dialog
    const {
        overrideDialog,
        requestOverride,
        confirmOverride,
        cancelOverride,
        setOverrideDialogOpen,
    } = useOverrideValidation({ user, doctors });

    const serviceTypes = useMemo(() => {
        const dynamicServices = workplaces
            .filter(w => w.category === 'Dienste' || (w.category === 'Demonstrationen & Konsile' && w.show_in_service_plan))
            .sort((a, b) => {
                if (a.category !== b.category) {
                    return a.category === 'Dienste' ? -1 : 1;
                }
                return (a.order || 0) - (b.order || 0);
            })
            .map(w => {
                let color = 'bg-slate-100 text-slate-900';
                if (w.category === 'Demonstrationen & Konsile') color = 'bg-purple-50 text-purple-900 border-purple-100';
                else if (w.service_type === 1) color = 'bg-blue-100 text-blue-900';
                else if (w.service_type === 2) color = 'bg-indigo-100 text-indigo-900';
                else if (w.service_type === 3) color = 'bg-amber-100 text-amber-900';
                else if (w.name.includes('Spät')) color = 'bg-amber-100 text-amber-900';

                return {
                    id: w.name,
                    workplace_id: w.id,
                    label: w.name.replace('Dienst ', ''),
                    color,
                    auto_off: w.auto_off,
                    category: w.category,
                    active_days: w.active_days
                };
            });

        return [...dynamicServices, ...STATIC_SERVICE_TYPES];
    }, [workplaces]);

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

    const relevantPositions = serviceTypes.map(t => t.id);

    const { foregroundDutyRoles, backgroundDutyRoles, statisticsExcludedRoles } = useTeamRoles();

    const ALLOWED_ROLES = useMemo(() => {
        const roles = {};
        workplaces.filter(w => w.category === 'Dienste').forEach(w => {
            if (w.service_type === 1) {
                roles[w.name] = foregroundDutyRoles;
            } else {
                roles[w.name] = backgroundDutyRoles;
            }
        });

        workplaces.filter(w => w.category === 'Demonstrationen & Konsile' && w.show_in_service_plan).forEach(w => {
            roles[w.name] = backgroundDutyRoles;
        });
        return roles;
    }, [workplaces, foregroundDutyRoles, backgroundDutyRoles]);

    const { qualificationMap } = useQualifications();
    const { getQualificationIds: getDoctorQualIds } = useAllDoctorQualifications();
    const { byWorkplace: wpQualsByWorkplace } = useAllWorkplaceQualifications();

    const absencesByDate = useMemo(() => {
        const map = {};
        const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
        allShifts.forEach(shift => {
            if (absencePositions.includes(shift.position)) {
                if (!map[shift.date]) map[shift.date] = new Set();
                map[shift.date].add(shift.doctor_id);
            }
        });
        return map;
    }, [allShifts]);

    const sendNotificationsMutation = useMutation({
        mutationFn: async () => {
            const data = await api.sendScheduleNotifications(
                currentDate.getFullYear(),
                currentDate.getMonth()
            );
            return data;
        },
        onSuccess: (data) => {
            const successes = (data.debug || [])
                .filter(line => line.startsWith('Erfolgreich gesendet an') || line.startsWith('Successfully sent to'))
                .map(line => '✅ ' + line.replace(/^(Erfolgreich gesendet an |Successfully sent to )/, ''));
            
            const errors = (data.errors || []).map(e => `❌ ${e.doctor}: ${e.error}`);
            
            let message = "";
            if (successes.length > 0) {
                message += "Erfolgreich versendet:\n" + successes.join('\n') + "\n\n";
            }
            if (errors.length > 0) {
                message += "Fehler:\n" + errors.join('\n');
            }
            
            if (!message) {
                message = `Keine Emails versendet. (Keine ${servicesCaption} im gewählten Zeitraum gefunden?)`;
            }
            
            alert(message);
        },
        onError: (error) => {
            console.error("Failed to send notifications", error);
            const msg = error.response?.data?.error || error.message || "Unbekannter Fehler";
            alert(`Fehler beim Versenden der Emails: ${msg}`);
        }
    });

    const updateShiftMutation = useMutation({
        mutationFn: async ({ id, data }) => {
             const shift = await db.ShiftEntry.update(id, data);

             const fullShift = { ...allShifts.find(s => s.id === id), ...data };

             // Auto-approve matching wishes
             const matchingWish = wishes.find(w => 
                w.doctor_id === fullShift.doctor_id && 
                     isWishOnDate(w, fullShift.date) && 
                w.type === 'service' && 
                w.status === 'pending' &&
                (!w.position || w.position === fullShift.position)
             );

             if (matchingWish) {
                 await db.WishRequest.update(matchingWish.id, { 
                    status: 'approved',
                    user_viewed: false,
                    admin_comment: 'Automatisch genehmigt durch Diensteinteilung'
                });
             }

             return shift;
        },
        onSuccess: () => {
            trackDbChange();
            queryClient.invalidateQueries(['shifts']);
            queryClient.invalidateQueries(['wishes']);
        },
    });

    const createShiftMutation = useMutation({
        mutationFn: async (data) => {
             const shift = await db.ShiftEntry.create(data);

             // Auto-approve matching wishes
             const matchingWish = wishes.find(w => 
                w.doctor_id === data.doctor_id && 
                     isWishOnDate(w, data.date) && 
                w.type === 'service' && 
                w.status === 'pending' &&
                (!w.position || w.position === data.position)
             );

             if (matchingWish) {
                 await db.WishRequest.update(matchingWish.id, { 
                    status: 'approved',
                    user_viewed: false,
                    admin_comment: 'Automatisch genehmigt durch Diensteinteilung'
                });
             }

             return shift;
        },
        onSuccess: () => {
            trackDbChange();
            queryClient.invalidateQueries(['shifts']);
            queryClient.invalidateQueries(['wishes']);
        },
    });

    const deleteShiftMutation = useMutation({
        mutationFn: async (id) => {
             await db.ShiftEntry.delete(id);
        },
        onSuccess: () => {
            trackDbChange();
            queryClient.invalidateQueries(['shifts']);
        },
    });

    const handleAssignment = async (date, position, doctorId) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const existingShift = allShifts.find(s => 
            s.date === dateStr && 
            s.position === position
        );

        // Zentrale Validierung mit Override-Möglichkeit
        if (doctorId !== 'DELETE') {
            const validationResult = validate(doctorId, dateStr, position, {
                excludeShiftId: existingShift?.id
            });

            // Bei Blockern: Override-Dialog anzeigen
            if (validationResult.blockers.length > 0) {
                const doctor = doctors.find(d => d.id === doctorId);
                const { confirmed } = await requestOverride({
                    blockers: validationResult.blockers,
                    warnings: validationResult.warnings,
                    doctorId,
                    doctorName: doctor?.name,
                    date: format(date, 'dd.MM.yyyy', { locale: de }),
                    position,
                    onConfirm: () => executeAssignment(dateStr, position, doctorId, existingShift)
                });
                
                if (!confirmed) return;
                // If confirmed, the onConfirm callback already executed the action
                return;
            }

            // Warnungen anzeigen aber erlauben
            if (validationResult.warnings.length > 0) {
                const msg = validationResult.warnings.join('\n');
                alert(`Hinweis:\n${msg}`);
            }
        }

        // Keine Blocker - direkt ausführen
        executeAssignment(dateStr, position, doctorId, existingShift);
    };

    // Hilfsfunktion für die eigentliche Zuweisung (nach Validierung/Override)
    const executeAssignment = (dateStr, position, doctorId, existingShift) => {        // Helper to remove auto-generated Frei (zentrale Logik)
        const cleanupAutoFrei = (docId) => {
            const autoFreiShift = findAutoFreiToCleanup(docId, dateStr, position);
            if (autoFreiShift) {
                deleteShiftMutation.mutate(autoFreiShift.id);
            }
        };

        const handlePostShiftLogic = () => {
            const autoFreiDateStr = shouldCreateAutoFrei(position, dateStr, isPublicHoliday);

            if (autoFreiDateStr && doctorId !== 'DELETE') {
                 const nextDay = new Date(autoFreiDateStr);

                 // Validierung für Auto-Frei (Mindestbesetzung prüfen)
                 validateWithUI(doctorId, autoFreiDateStr, 'Frei');

                 const existingNextDayShift = allShifts.find(s => s.date === autoFreiDateStr && s.doctor_id === doctorId);
                 
                 if (!existingNextDayShift) {
                     createShiftMutation.mutate({
                         date: autoFreiDateStr,
                         position: 'Frei',
                         doctor_id: doctorId,
                         note: 'Autom. Freizeitausgleich'
                     });
                 } else if (existingNextDayShift.position !== 'Frei') {
                     if (window.confirm(`Für den Folgetag (${format(nextDay, 'dd.MM.')}) existiert bereits ein Eintrag "${existingNextDayShift.position}". Soll dieser durch "Frei" ersetzt werden?`)) {
                         updateShiftMutation.mutate({
                             id: existingNextDayShift.id,
                             data: { position: 'Frei', note: 'Autom. Freizeitausgleich' }
                         });
                     }
                 }
            }
        };

        if (doctorId === 'DELETE') {
            if (existingShift) {
                cleanupAutoFrei(existingShift.doctor_id);
                deleteShiftMutation.mutate(existingShift.id);
            }
        } else if (existingShift) {
            if (existingShift.doctor_id !== doctorId) {
                cleanupAutoFrei(existingShift.doctor_id);
                updateShiftMutation.mutate({
                    id: existingShift.id,
                    data: { doctor_id: doctorId }
                }, { onSuccess: handlePostShiftLogic });
            }
        } else {
            createShiftMutation.mutate({
                date: dateStr,
                position: position,
                doctor_id: doctorId
            }, { onSuccess: handlePostShiftLogic });
        }
    };

    const getAssignedDoctorId = (date, position) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const shift = allShifts.find(s => s.date === dateStr && s.position === position);
        return shift ? shift.doctor_id : undefined;
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="container mx-auto max-w-5xl p-2 sm:p-4 print:p-0 print:max-w-none">
            {/* Header - Hidden on Print */}
            <div className="flex flex-col gap-4 mb-4 sm:mb-6 print:hidden">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{servicesPageTitle}</h1>
                
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
                     <div className="flex items-center justify-center bg-white p-1 rounded-lg shadow-sm border border-slate-200">
                        <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => subMonths(d, 1))}>
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="mx-2 sm:mx-4 font-bold text-base sm:text-lg min-w-[120px] sm:min-w-[140px] text-center">
                            {format(currentDate, 'MMMM yyyy', { locale: de })}
                        </span>
                        <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => addMonths(d, 1))}>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button onClick={handlePrint} variant="outline" className="gap-2 flex-1 sm:flex-none" size="sm">
                            <Printer className="w-4 h-4" />
                            <span className="hidden sm:inline">Drucken</span>
                        </Button>
                        {!isReadOnly && (
                            <>
                                <WorkplaceConfigDialog defaultTab="Dienste" />
                                <Button 
                                    onClick={() => {
                                        if (window.confirm(`Möchten Sie wirklich an alle Mitarbeiter ihre ${servicesCaption} für ${format(currentDate, 'MMMM yyyy', { locale: de })} per Email senden?`)) {
                                            sendNotificationsMutation.mutate();
                                        }
                                    }} 
                                    className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white flex-1 sm:flex-none"
                                    disabled={sendNotificationsMutation.isPending}
                                    size="sm"
                                >
                                    <Send className="w-4 h-4" />
                                    <span className="hidden sm:inline">{sendNotificationsMutation.isPending ? "Sende..." : `${servicesCaption} senden`}</span>
                                    <span className="sm:hidden">{sendNotificationsMutation.isPending ? "..." : "Senden"}</span>
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Print Header */}
            <div className="hidden print:block mb-4">
                <h1 className="text-2xl font-bold text-center">
                    {servicesPageTitle} - {format(currentDate, 'MMMM yyyy', { locale: de })}
                </h1>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto print:border-0 print:shadow-none">
                <table className="w-full text-xs sm:text-sm text-left min-w-[600px]">
                    <thead className="bg-slate-50 border-b border-slate-200 print:bg-slate-100">
                        <tr>
                            <th className="px-4 py-3 font-semibold text-slate-700 w-[120px]">Datum</th>
                            {serviceTypes.map(type => (
                                <th key={type.id} className="px-4 py-3 font-semibold text-slate-700">
                                    {type.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {days.map(day => {
                            const isWeekendDay = isWeekend(day);
                            const isHoliday = isPublicHoliday(day);
                            
                            let rowClass = "";
                            if (isHoliday) {
                                rowClass = "bg-blue-50/80 print:bg-blue-50";
                            } else if (isWeekendDay) {
                                rowClass = "bg-orange-50/60 print:bg-orange-50";
                            }
                            
                            return (
                                <tr key={day.toISOString()} className={rowClass}>
                                    <td className="px-4 py-2 font-medium text-slate-700">
                                        <div className={isHoliday ? "text-red-600" : isWeekendDay ? "text-slate-500" : ""}>
                                            {format(day, 'dd.MM. (EE)', { locale: de })}
                                            {isHoliday && <span className="block text-[10px] leading-none">Feiertag</span>}
                                        </div>
                                    </td>
                                    {serviceTypes.map(type => {
                                        const assignedDoctorId = getAssignedDoctorId(day, type.id);
                                        const assignedDoctor = doctors.find(d => d.id === assignedDoctorId);
                                        
                                        // Filter available doctors (exclude absent ones, but keep currently assigned)
                                        const dateStr = format(day, 'yyyy-MM-dd');
                                        const absentIds = absencesByDate[dateStr] || new Set();
                                        // Qualifikationsanforderungen für diesen Arbeitsplatz/Dienst
                                        const wpQuals = type.workplace_id ? (wpQualsByWorkplace[type.workplace_id] || []) : [];
                                        const mandatoryQualIds = wpQuals.filter(wq => wq.is_mandatory && !wq.is_excluded).map(wq => wq.qualification_id);
                                        const preferredQualIds = wpQuals.filter(wq => !wq.is_mandatory && !wq.is_excluded).map(wq => wq.qualification_id);
                                        const discouragedQualIds = wpQuals.filter(wq => wq.is_mandatory && wq.is_excluded).map(wq => wq.qualification_id);
                                        const excludedQualIds = wpQuals.filter(wq => !wq.is_mandatory && wq.is_excluded).map(wq => wq.qualification_id);
                                        const hasQualRequirements = mandatoryQualIds.length > 0 || preferredQualIds.length > 0 || discouragedQualIds.length > 0 || excludedQualIds.length > 0;

                                        // Base filter: all eligible doctors (without discouraged filter)
                                        const baseDoctors = doctors.filter(doc => {
                                            // Always keep the currently assigned doctor in the list
                                            if (doc.id === assignedDoctorId) return true;
                                            
                                            // Exclude roles that are excluded from statistics (e.g. Nicht-Radiologe)
                                            if (statisticsExcludedRoles.includes(doc.role)) return false;
                                            
                                            // Check absence (allow if currently assigned to this slot)
                                            if (absentIds.has(doc.id)) return false;

                                            // NOT-qualifications: exclude doctors who have any excluded qualification ("Nicht")
                                            if (excludedQualIds.length > 0) {
                                                const docQualIds = getDoctorQualIds(doc.id);
                                                if (excludedQualIds.some(qid => docQualIds.includes(qid))) return false;
                                            }

                                            // If workplace has mandatory qualification requirements, enforce them
                                            if (mandatoryQualIds.length > 0) {
                                                const docQualIds = getDoctorQualIds(doc.id);
                                                const hasMandatory = mandatoryQualIds.every(qid => docQualIds.includes(qid));
                                                if (!hasMandatory) return false;
                                            }

                                            // Legacy role-based restrictions (fallback if no qualification requirements set)
                                            if (!hasQualRequirements) {
                                                const allowedRoles = ALLOWED_ROLES[type.id];
                                                if (allowedRoles && !allowedRoles.includes(doc.role)) return false;
                                            }

                                            return true;
                                        });

                                        // "Sollte nicht": Filter out doctors with discouraged qualifications,
                                        // but keep them as fallback if no other doctors are available
                                        let afterDiscouragedFilter;
                                        if (discouragedQualIds.length > 0) {
                                            const nonDiscouraged = baseDoctors.filter(doc => {
                                                if (doc.id === assignedDoctorId) return true;
                                                const docQualIds = getDoctorQualIds(doc.id);
                                                return !discouragedQualIds.some(qid => docQualIds.includes(qid));
                                            });
                                            // Use non-discouraged list if it has at least one selectable doctor,
                                            // otherwise fall back to full list (with warnings)
                                            const hasNonDiscouragedChoices = nonDiscouraged.some(d => d.id !== assignedDoctorId);
                                            afterDiscouragedFilter = hasNonDiscouragedChoices ? nonDiscouraged : baseDoctors;
                                        } else {
                                            afterDiscouragedFilter = baseDoctors;
                                        }

                                        // "Sollte": Filter to only doctors with preferred qualifications,
                                        // but keep unqualified as fallback if no qualified are available
                                        let availableDoctors;
                                        if (preferredQualIds.length > 0) {
                                            const withPreferred = afterDiscouragedFilter.filter(doc => {
                                                if (doc.id === assignedDoctorId) return true;
                                                const docQualIds = getDoctorQualIds(doc.id);
                                                return preferredQualIds.every(qid => docQualIds.includes(qid));
                                            });
                                            const hasPreferredChoices = withPreferred.some(d => d.id !== assignedDoctorId);
                                            availableDoctors = hasPreferredChoices ? withPreferred : afterDiscouragedFilter;
                                        } else {
                                            availableDoctors = afterDiscouragedFilter;
                                        }

                                        // Sort: preferred ("Sollte") doctors first, discouraged ("Sollte nicht") doctors last
                                        availableDoctors = alphabeticalDoctorSorting
                                            ? sortDoctorsAlphabetically(availableDoctors)
                                            : availableDoctors.sort((a, b) => {
                                                const aQuals = getDoctorQualIds(a.id);
                                                const bQuals = getDoctorQualIds(b.id);

                                                // "Sollte nicht" – doctors WITH discouraged qualifications sort to the bottom
                                                if (discouragedQualIds.length > 0) {
                                                    const aHasDiscouraged = discouragedQualIds.some(qid => aQuals.includes(qid));
                                                    const bHasDiscouraged = discouragedQualIds.some(qid => bQuals.includes(qid));
                                                    if (aHasDiscouraged && !bHasDiscouraged) return 1;
                                                    if (!aHasDiscouraged && bHasDiscouraged) return -1;
                                                }

                                                // "Sollte" – doctors WITH preferred qualifications sort to the top
                                                if (preferredQualIds.length === 0) return 0;
                                                const aHasPreferred = preferredQualIds.every(qid => aQuals.includes(qid));
                                                const bHasPreferred = preferredQualIds.every(qid => bQuals.includes(qid));
                                                if (aHasPreferred && !bHasPreferred) return -1;
                                                if (!aHasPreferred && bHasPreferred) return 1;
                                                return 0;
                                            });

                                        // Check if active (for Demos/Konsile with restricted days)
                                        // Default active_days: Mo-Fr [1,2,3,4,5]
                                        let isActive = true;
                                        const activeDays = (type.active_days && type.active_days.length > 0) ? type.active_days : [1, 2, 3, 4, 5];
                                        
                                        // Feiertage verhalten sich wie Sonntag (Index 0)
                                        // An Feiertagen zählt nur, ob Sonntag aktiv ist
                                        if (isPublicHoliday(day)) {
                                            isActive = activeDays.some(d => Number(d) === 0);
                                        } else {
                                            isActive = activeDays.some(d => Number(d) === day.getDay());
                                        }
                                        // Fallback for legacy/static
                                        if (!isActive && type.id === 'Onko-Konsil') {
                                            const setting = demoSettings.find(s => s.name === 'Onko-Konsil');
                                            if (setting && setting.active_days) {
                                                isActive = setting.active_days.includes(day.getDay());
                                            }
                                        }

                                        if (!isActive) {
                                            return (
                                                <td key={type.id} className="px-4 py-1 bg-slate-50/50">
                                                    <div className="h-8 w-full bg-slate-100/50 rounded flex items-center justify-center">
                                                        <span className="text-slate-300 text-xs"></span>
                                                    </div>
                                                </td>
                                            );
                                        }
                                        
                                        return (
                                            <td key={type.id} className="px-4 py-1">
                                                <div className="print:hidden">
                                                    <EmployeeSelect
                                                        disabled={isReadOnly}
                                                        value={assignedDoctorId || 'unassigned'}
                                                        onValueChange={(val) => handleAssignment(day, type.id, val === 'unassigned' ? 'DELETE' : val)}
                                                        placeholder="-"
                                                        searchPlaceholder="Mitarbeiter suchen..."
                                                        emptyText="Keine passenden Mitarbeiter gefunden."
                                                        triggerClassName={`h-8 w-full ${assignedDoctorId ? 'border-indigo-200 bg-indigo-50/50 text-indigo-900' : 'text-slate-400'}`}
                                                        contentClassName="w-[380px]"
                                                        options={[
                                                            {
                                                                value: 'unassigned',
                                                                label: '-',
                                                                triggerLabel: '-',
                                                                sortLabel: '',
                                                                keywords: ['leer', 'nicht zugewiesen'],
                                                            },
                                                            ...availableDoctors.map((doc) => {
                                                                const dateStr = format(day, 'yyyy-MM-dd');
                                                                const wish = wishes.find((entry) => entry.doctor_id === doc.id && isWishOnDate(entry, dateStr) && entry.status !== 'rejected');
                                                                let itemClassName = '';
                                                                if (wish) {
                                                                    if (wish.type === 'service') itemClassName = 'text-green-600 font-medium bg-green-50';
                                                                    else if (wish.type === 'no_service') itemClassName = 'text-red-600 font-medium bg-red-50';
                                                                }

                                                                const docQualIds = getDoctorQualIds(doc.id);
                                                                const missingPreferred = preferredQualIds.filter((qualificationId) => !docQualIds.includes(qualificationId));
                                                                const hasPreferredWarning = missingPreferred.length > 0 && doc.id !== assignedDoctorId;
                                                                const missingPreferredNames = missingPreferred.map((qualificationId) => qualificationMap[qualificationId]?.name || '?').join(', ');

                                                                const hasDiscouragedQual = discouragedQualIds.some((qualificationId) => docQualIds.includes(qualificationId));
                                                                const hasDiscouragedWarning = hasDiscouragedQual && doc.id !== assignedDoctorId;
                                                                const discouragedNames = discouragedQualIds
                                                                    .filter((qualificationId) => docQualIds.includes(qualificationId))
                                                                    .map((qualificationId) => qualificationMap[qualificationId]?.name || '?')
                                                                    .join(', ');

                                                                const warningText = [
                                                                    wish ? (wish.type === 'service' ? 'Dienstwunsch' : 'Kein-Dienst-Wunsch') : '',
                                                                    hasPreferredWarning ? `Fehlt: ${missingPreferredNames}` : '',
                                                                    hasDiscouragedWarning ? `Warnung: ${discouragedNames}` : '',
                                                                ].filter(Boolean).join(' · ');

                                                                return {
                                                                    value: doc.id,
                                                                    label: doc.name,
                                                                    triggerLabel: doc.name,
                                                                    description: warningText || undefined,
                                                                    searchText: [doc.initials, doc.role, warningText].filter(Boolean).join(' '),
                                                                    sortLabel: doc.name,
                                                                    itemClassName: `${itemClassName} ${(hasPreferredWarning || hasDiscouragedWarning) ? 'text-amber-700' : ''}`.trim(),
                                                                };
                                                            }),
                                                        ]}
                                                    />
                                                </div>
                                                <div className="hidden print:block text-sm">
                                                    {assignedDoctor ? (
                                                        <span className="font-medium text-slate-900">
                                                            {assignedDoctor.name}
                                                            {assignedDoctor.initials && <span className="text-slate-500 ml-1">({assignedDoctor.initials})</span>}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300">-</span>
                                                    )}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            
            {/* Print Footer */}
            <div className="hidden print:block mt-8 text-xs text-slate-400 text-center">
                Erstellt am {format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de })}
            </div>

            {/* Override Confirm Dialog */}
            <OverrideConfirmDialog
                open={overrideDialog.open}
                onOpenChange={setOverrideDialogOpen}
                blockers={overrideDialog.blockers}
                warnings={overrideDialog.warnings}
                context={overrideDialog.context}
                onConfirm={confirmOverride}
                onCancel={cancelOverride}
            />

            <style>{`
                @media print {
                    @page {
                        margin: 1.5cm;
                    }
                    body {
                        print-color-adjust: exact;
                        -webkit-print-color-adjust: exact;
                    }
                    /* Hide sidebar and header elements handled by global layout if they persist */
                    nav, aside, header {
                        display: none !important;
                    }
                    /* Ensure main content takes full width */
                    main {
                        margin: 0 !important;
                        padding: 0 !important;
                        width: 100% !important;
                    }
                    /* Ensure selects are hidden and text shown (handled by utility classes but reinforcing) */
                }
            `}</style>
        </div>
    );
}