import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, db, base44 } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { format, getYear, startOfYear, endOfYear, eachDayOfInterval } from 'date-fns';
import { ChevronLeft, ChevronRight, Eraser, Wand2 } from 'lucide-react';
import { isDoctorAvailable } from '@/components/schedule/staffingUtils';
import { Button } from '@/components/ui/button';
import EmployeeSelect from '@/components/staff/EmployeeSelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Info, Trash2, Plus } from 'lucide-react';
import DoctorYearView from '@/components/vacation/DoctorYearView';
import VacationOverview from '@/components/vacation/VacationOverview';
import AppSettingsDialog from '@/components/settings/AppSettingsDialog';
import ConflictDialog, { categorizeConflict } from '@/components/vacation/ConflictDialog';
import { parseAnnualVacationDays } from '@/components/vacation/vacationBalance';

import { useHolidays } from '@/components/useHolidays';
import { DEFAULT_COLORS } from '@/components/settings/ColorSettingsDialog';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
import { useSectionConfig } from '@/components/settings/SectionConfigDialog';
import { isAlphabeticalDoctorSortingEnabled, sortDoctorsAlphabetically } from '@/utils/doctorSorting';
import { clampRangeToContract, getTrainingContractInfo, isDateWithinContract } from '@/components/training/trainingContractUtils';

export default function VacationPage() {
  const { isReadOnly, user } = useAuth();
  const { getSectionName } = useSectionConfig();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const { isSchoolHoliday, isPublicHoliday } = useHolidays(selectedYear);
  const [selectedDoctorId, setSelectedDoctorId] = useState(null);
  const [viewMode, setViewMode] = useState('single'); // 'single' | 'overview'
  const [simulationData, setSimulationData] = useState(null); // { newShifts, shiftsToDelete, shiftsToDeleteIds }
  const [showSimulationDialog, setShowSimulationDialog] = useState(false);
  const absencesCaption = getSectionName('Abwesenheiten');
  const availableCaption = getSectionName('Anwesenheiten');
  
  const queryClient = useQueryClient();

  // Dynamische Rollenprioritäten aus DB laden
  const { rolePriority } = useTeamRoles();

  // Fetch Doctors
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => db.Doctor.list(),
    select: (data) => data.sort((a, b) => {
      const roleDiff = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      return (a.order || 0) - (b.order || 0);
    }),
  });

  const doctorsForSelection = React.useMemo(() => {
      return isAlphabeticalDoctorSortingEnabled(user) ? sortDoctorsAlphabetically(doctors) : doctors;
  }, [doctors, user]);

  const doctorSelectOptions = React.useMemo(() => (
    doctorsForSelection.map((doctor) => ({
      value: doctor.id,
      label: doctor.name,
      triggerLabel: doctor.name,
      description: doctor.role || undefined,
      searchText: [doctor.role, doctor.initials].filter(Boolean).join(' '),
      sortLabel: doctor.name,
    }))
  ), [doctorsForSelection]);

  const { data: masterEmployees = [] } = useQuery({
    queryKey: ['master-central-employees-for-vacation'],
    queryFn: async () => {
      try {
        const result = await api.request('/api/master/employees');
        return result.employees || [];
      } catch {
        return [];
      }
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Select doctor: prefer user's assigned doctor, otherwise first in list
  React.useEffect(() => {
    if (doctorsForSelection.length > 0 && !selectedDoctorId) {
      if (user?.doctor_id && doctorsForSelection.some(d => d.id === user.doctor_id)) {
        setSelectedDoctorId(user.doctor_id);
      } else {
        setSelectedDoctorId(doctorsForSelection[0].id);
      }
    }
  }, [doctorsForSelection, selectedDoctorId, user]);

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId);

  const contractInfoByDoctorId = useMemo(() => {
    const employeesById = new Map(masterEmployees.map((employee) => [employee.id, employee]));
    const infoByDoctorId = {};

    doctorsForSelection.forEach((doctor) => {
      const employee = doctor.central_employee_id ? employeesById.get(doctor.central_employee_id) : null;
      const contractInfo = getTrainingContractInfo(employee?.contract_start, employee?.contract_end);

      if (contractInfo) {
        infoByDoctorId[doctor.id] = contractInfo;
      }
    });

    return infoByDoctorId;
  }, [doctorsForSelection, masterEmployees]);

  // Annual vacation entitlement per doctor. Prefer the linked master
  // Employee's `vacation_days_annual` so the overview reflects changes made
  // in the master frontend (e.g. via PayScaleTariff apply-defaults) without
  // waiting for the Doctor row to be resynced. Falls back to the tenant
  // Doctor.vacation_days only when the doctor is not linked, mirroring the
  // single-view logic in DoctorYearView.
  const entitlementByDoctorId = useMemo(() => {
    const employeesById = new Map(masterEmployees.map((employee) => [employee.id, employee]));
    const map = {};

    doctorsForSelection.forEach((doctor) => {
      const employee = doctor.central_employee_id ? employeesById.get(doctor.central_employee_id) : null;
      const centralValue = employee?.vacation_days_annual;
      const raw = centralValue != null ? centralValue : doctor.vacation_days;
      map[doctor.id] = parseAnnualVacationDays(raw);
    });

    return map;
  }, [doctorsForSelection, masterEmployees]);

  const selectedDoctorContractInfo = selectedDoctor ? contractInfoByDoctorId[selectedDoctor.id] : null;

  const getDoctorContractInfo = (doctorId) => contractInfoByDoctorId[doctorId] || null;

  const isDateEditableForDoctor = (date, doctorId) => {
    const contractInfo = getDoctorContractInfo(doctorId);
    return isDateWithinContract(date, contractInfo?.contractStart, contractInfo?.contractEnd);
  };

  const clampRangeForDoctor = (start, end, doctorId) => {
    const contractInfo = getDoctorContractInfo(doctorId);
    return clampRangeToContract(start, end, contractInfo?.contractStart, contractInfo?.contractEnd);
  };

  // Fetch Shifts for the year (filtering by date range for better performance)
  const { data: allShifts = [] } = useQuery({
    queryKey: ['shifts', selectedYear],
    queryFn: () => db.ShiftEntry.filter({
        date: { $gte: `${selectedYear}-01-01`, $lte: `${selectedYear}-12-31` }
    }, null, 5000),
    staleTime: 30 * 1000,
    keepPreviousData: true,
  });

  const { data: systemSettings = [] } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list(),
  });

  const { data: colorSettings = [] } = useQuery({
      queryKey: ['colorSettings'],
      queryFn: () => db.ColorSetting.list(),
  });

  const { data: staffingPlanEntries = [] } = useQuery({
      queryKey: ['staffingPlanEntries', selectedYear],
      queryFn: () => db.StaffingPlanEntry.filter({ year: selectedYear }),
  });

  const ABSENCE_PRIORITY = {
      "Nicht verfügbar": 100,
      "Krank": 90,
      "Frei": 80,
      "Urlaub": 70,
      "Dienstreise": 60,
      "DELETE": 0
  };

  const getPriority = (position) => ABSENCE_PRIORITY[position] || 0;

  // SIMULATION MODE: Berechnet Änderungen, führt sie aber NICHT aus
  const handleSyncAbsences = () => {
      const newShifts = [];
      const shiftsToDelete = [];
      const shiftsToDeleteIds = [];

      const startOfYearDate = startOfYear(new Date(selectedYear, 0, 1));
      const endOfYearDate = endOfYear(new Date(selectedYear, 0, 1));
      const days = eachDayOfInterval({ start: startOfYearDate, end: endOfYearDate });

      // Pre-calculate existing shift map
      const existingShiftsMap = new Map();
      allShifts.forEach(s => {
          if (getYear(new Date(s.date)) === selectedYear) {
              existingShiftsMap.set(`${s.doctor_id}_${s.date}`, s);
          }
      });

      doctors.forEach(doc => {
           if (doc.exclude_from_staffing_plan) return;

           days.forEach(day => {
               const dateStr = format(day, 'yyyy-MM-dd');
               const available = isDoctorAvailable(doc, day, staffingPlanEntries);
               
               if (!available) {
                   const existing = existingShiftsMap.get(`${doc.id}_${dateStr}`);
                   const newPriority = getPriority("Nicht verfügbar");
                   
                   // Ermittle den Grund für die Nichtverfügbarkeit
                   let reason = "Unbekannt";
                   if (doc.contract_end_date) {
                       const endDate = new Date(doc.contract_end_date);
                       endDate.setHours(0,0,0,0);
                       const checkDate = new Date(day);
                       checkDate.setHours(0,0,0,0);
                       if (checkDate > endDate) {
                           reason = `Vertragsende (${format(endDate, 'dd.MM.yyyy')})`;
                       }
                   }
                   if (reason === "Unbekannt") {
                       const year = day.getFullYear();
                       const month = day.getMonth() + 1;
                       const entry = staffingPlanEntries.find(e => e.doctor_id === doc.id && e.year === year && e.month === month);
                       const val = entry ? String(entry.value).trim() : (doc.fte !== undefined ? String(doc.fte) : "1.0");
                       if (val === "KO") reason = "Status: KO (Krank ohne Entgelt)";
                       else if (val === "EZ") reason = "Status: EZ (Elternzeit)";
                       else if (val === "MS") reason = "Status: MS (Mutterschutz)";
                       else {
                           const num = parseFloat(val.replace(',', '.'));
                           if (!isNaN(num) && num <= 0.0001) reason = `FTE: ${val} (0.0)`;
                       }
                   }
                   
                   if (existing) {
                       // Check priority
                       const existingPriority = getPriority(existing.position);
                       if (newPriority > existingPriority) {
                           // Overwrite
                           shiftsToDeleteIds.push(existing.id);
                           shiftsToDelete.push({
                               ...existing,
                               doctorName: doc.name,
                               reason
                           });
                           newShifts.push({
                               date: dateStr,
                               position: "Nicht verfügbar",
                               doctor_id: doc.id,
                               doctorName: doc.name,
                               note: "Aus Stellenplan",
                               reason,
                               replacesExisting: existing.position
                           });
                       }
                   } else {
                       // Create new
                       newShifts.push({
                           date: dateStr,
                           position: "Nicht verfügbar",
                           doctor_id: doc.id,
                           doctorName: doc.name,
                           note: "Aus Stellenplan",
                           reason,
                           replacesExisting: null
                       });
                   }
               }
           });
      });

      // Zeige Simulationsdialog
      setSimulationData({ newShifts, shiftsToDelete, shiftsToDeleteIds });
      setShowSimulationDialog(true);
  };

  // Führt die tatsächlichen Änderungen aus
  const executeSyncAbsences = () => {
      if (!simulationData || simulationData.newShifts.length === 0) return;
      if (bulkCreateShiftMutation.isPending || bulkDeleteShiftMutation.isPending) return; // Prevent double execution
      
      // Schließe Dialog sofort um Doppelklick zu verhindern
      const dataToProcess = { ...simulationData };
      setShowSimulationDialog(false);
      setSimulationData(null);
      
      // Bereite die Daten für die DB vor (ohne die UI-spezifischen Felder)
      const shiftsToCreate = dataToProcess.newShifts.map(({ doctorName, reason, replacesExisting, ...shift }) => shift);
      
      if (dataToProcess.shiftsToDeleteIds.length > 0) {
          bulkDeleteShiftMutation.mutate(dataToProcess.shiftsToDeleteIds, {
              onSuccess: () => {
                  bulkCreateShiftMutation.mutate(shiftsToCreate);
              }
          });
      } else {
          bulkCreateShiftMutation.mutate(shiftsToCreate);
      }
  };

  // Prepare Props for Overview
  const rawVisibleTypes = systemSettings.find(s => s.key === 'overview_visible_types')?.value;
  const visibleTypes = rawVisibleTypes ? JSON.parse(rawVisibleTypes) : ["Urlaub", "Krank", "Frei", "Dienstreise", "Nicht verfügbar"];

  const minPresentSpecialists = parseInt(systemSettings.find(s => s.key === 'min_present_specialists')?.value || '2');
  const minPresentAssistants = parseInt(systemSettings.find(s => s.key === 'min_present_assistants')?.value || '4');
  const monthsPerRow = parseInt(systemSettings.find(s => s.key === 'vacation_months_per_row')?.value || '3');

  const customColors = React.useMemo(() => {
      const colors = {};
      // Fill absence defaults first
      Object.entries(DEFAULT_COLORS.absences).forEach(([pos, color]) => {
          colors[pos] = { backgroundColor: color.bg, color: color.text };
      });
      // Also include position defaults for backwards compatibility
      Object.entries(DEFAULT_COLORS.positions).forEach(([pos, color]) => {
          if (!colors[pos]) {
              colors[pos] = { backgroundColor: color.bg, color: color.text };
          }
      });
      // Override with DB settings (check 'absence' category first, then 'position' for backwards compat)
      colorSettings.filter(s => s.category === 'absence').forEach(s => {
          colors[s.name] = { backgroundColor: s.bg_color, color: s.text_color };
      });
      colorSettings.filter(s => s.category === 'position').forEach(s => {
          if (!colors[s.name] || !colorSettings.some(cs => cs.name === s.name && cs.category === 'absence')) {
              colors[s.name] = { backgroundColor: s.bg_color, color: s.text_color };
          }
      });
      return colors;
  }, [colorSettings]);

  // Only show absence positions in Vacation module
  const absencePositions = ["Urlaub", "Krank", "Frei", "Dienstreise", "Nicht verfügbar"];
  
  const yearShifts = allShifts.filter(s => 
    s.doctor_id === selectedDoctorId && absencePositions.includes(s.position)
  );

  const overviewShifts = allShifts.filter(s => 
    absencePositions.includes(s.position)
  );

  const createShiftMutation = useMutation({
    mutationFn: async (data) => {
        // Use atomic checkAndCreate
        const response = await base44.functions.invoke('atomicOperations', {
            operation: 'checkAndCreate',
            entity: 'ShiftEntry',
            data: data,
            check: { uniqueKeys: ['date', 'doctor_id'] }
        });
        return response.data;
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['shifts', selectedYear] });
        queryClient.invalidateQueries({ queryKey: ['central-absences'] });
    },
    onError: (err) => {
        toast.error("Konflikt: " + (err.response?.data?.message || err.message));
        queryClient.invalidateQueries({ queryKey: ['shifts', selectedYear] });
        queryClient.invalidateQueries({ queryKey: ['central-absences'] });
    }
  });

  const deleteShiftMutation = useMutation({
    mutationFn: (id) => db.ShiftEntry.delete(id),
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['shifts', selectedYear] });
        queryClient.invalidateQueries({ queryKey: ['central-absences'] });
    },
  });

  const [activeType, setActiveType] = useState('Urlaub');
  const [rangeStart, setRangeStart] = useState(null);
  
  // Conflict Dialog State
  const [conflictDialog, setConflictDialog] = useState({
      open: false,
      conflicts: [],
      doctorName: '',
      pendingAction: null // { type: 'range' | 'single', data: {...} }
  });

  const bulkCreateShiftMutation = useMutation({
    mutationFn: (data) => db.ShiftEntry.bulkCreate(data),
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['shifts', selectedYear] });
        queryClient.invalidateQueries({ queryKey: ['central-absences'] });
    },
  });

  const bulkDeleteShiftMutation = useMutation({
    mutationFn: async (ids) => {
        await Promise.all(ids.map(id => db.ShiftEntry.delete(id)));
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['shifts', selectedYear] });
        queryClient.invalidateQueries({ queryKey: ['central-absences'] });
    },
  });

  // Analyze conflicts for a range selection
  const analyzeConflicts = (days, targetDoctorId, newPosition) => {
      const relevantShifts = allShifts.filter(s => s.doctor_id === targetDoctorId);
      const conflicts = [];
      
      days.forEach(d => {
          const dStr = format(d, 'yyyy-MM-dd');
          const existingShift = relevantShifts.find(s => s.date === dStr);
          
          if (existingShift && existingShift.position !== newPosition) {
              const conflictType = categorizeConflict(newPosition, existingShift.position);
              conflicts.push({
                  date: dStr,
                  existingShift,
                  newPosition,
                  conflictType
              });
          }
      });
      
      return conflicts;
  };

  // Execute the actual range mutation
  const executeRangeAction = (days, targetDoctorId, deleteIds, overwriteIds, keepOptionalServices) => {
      const relevantShifts = allShifts.filter(s => s.doctor_id === targetDoctorId);
      const shiftsToDeleteIds = [...deleteIds, ...overwriteIds];
      const newShifts = [];
      
      days.forEach(d => {
          const dStr = format(d, 'yyyy-MM-dd');
          const existingShift = relevantShifts.find(s => s.date === dStr);
          
          // Skip if same type already exists
          if (existingShift && existingShift.position === activeType) return;
          
          // Skip if keeping optional and this is an optional conflict
          if (existingShift && keepOptionalServices) {
              const conflictType = categorizeConflict(activeType, existingShift.position);
              if (conflictType === 'optional') return; // Keep both - don't create new absence here either
          }
          
          // Only add if not in delete list (means we're overwriting) or no existing shift
          if (!existingShift || shiftsToDeleteIds.includes(existingShift.id)) {
              newShifts.push({
                  date: dStr,
                  position: activeType,
                  doctor_id: targetDoctorId
              });
          }
      });
      
      // Execute mutations
      if (shiftsToDeleteIds.length > 0) {
          bulkDeleteShiftMutation.mutate(shiftsToDeleteIds, {
              onSuccess: () => {
                  if (newShifts.length > 0) bulkCreateShiftMutation.mutate(newShifts);
              }
          });
      } else {
          if (newShifts.length > 0) bulkCreateShiftMutation.mutate(newShifts);
      }
  };

  const handleRangeSelection = (start, end, doctorId = null) => {
      const targetDoctorId = doctorId || selectedDoctorId;
      if (!targetDoctorId || isReadOnly) return;

      const clampedRange = clampRangeForDoctor(start, end, targetDoctorId);
      if (!clampedRange) return;

      const days = eachDayOfInterval({ start: clampedRange.startDate, end: clampedRange.endDate });
      
      // Handle DELETE mode - no conflict check needed
      if (activeType === 'DELETE') {
          const relevantShifts = allShifts.filter(s => s.doctor_id === targetDoctorId);
          const shiftsToDeleteIds = days
              .map(d => relevantShifts.find(s => s.date === format(d, 'yyyy-MM-dd')))
              .filter(Boolean)
              .map(s => s.id);
          
          if (shiftsToDeleteIds.length > 0) {
              bulkDeleteShiftMutation.mutate(shiftsToDeleteIds);
          }
          return;
      }
      
      // Analyze conflicts
      const conflicts = analyzeConflicts(days, targetDoctorId, activeType);
      const doctor = doctors.find(d => d.id === targetDoctorId);
      
      // If there are conflicts, show dialog
      if (conflicts.length > 0) {
          setConflictDialog({
              open: true,
              conflicts,
              doctorName: doctor?.name || 'Unbekannt',
              pendingAction: {
                  type: 'range',
                  data: { days, targetDoctorId }
              }
          });
          return;
      }
      
      // No conflicts - execute directly
      const newShifts = days.map(d => ({
          date: format(d, 'yyyy-MM-dd'),
          position: activeType,
          doctor_id: targetDoctorId
      })).filter(s => {
          // Filter out days that already have this type
          const existing = allShifts.find(x => x.doctor_id === targetDoctorId && x.date === s.date);
          return !existing || existing.position !== activeType;
      });
      
      if (newShifts.length > 0) {
          bulkCreateShiftMutation.mutate(newShifts);
      }
  };
  
  // Handle conflict dialog confirmation
  const handleConflictConfirm = ({ proceed, keepOptionalServices, deleteIds, overwriteIds }) => {
      if (!proceed || !conflictDialog.pendingAction) return;
      
      const { type, data } = conflictDialog.pendingAction;
      
      if (type === 'range') {
          executeRangeAction(data.days, data.targetDoctorId, deleteIds, overwriteIds, keepOptionalServices);
      } else if (type === 'single') {
          // Single click: delete existing + create new
          const idsToDelete = data.existingShifts.map(s => s.id);
          bulkDeleteShiftMutation.mutate(idsToDelete, {
              onSuccess: () => {
                  createShiftMutation.mutate({
                      date: data.dateStr,
                      position: data.activeType,
                      doctor_id: data.targetDoctorId
                  });
              }
          });
      }
      
      setConflictDialog({ open: false, conflicts: [], doctorName: '', pendingAction: null });
  };

  const handleToggleShift = (date, currentStatus, doctorId = null, event) => {
    const targetDoctorId = doctorId || selectedDoctorId;
    if (!targetDoctorId || isReadOnly) return;
    if (!isDateEditableForDoctor(date, targetDoctorId)) return;
    const dateStr = format(date, 'yyyy-MM-dd');

    const relevantShifts = doctorId ? allShifts.filter(s => s.doctor_id === targetDoctorId) : yearShifts;

    // Check for CTRL key range selection (Optional now with drag)
    if (event && (event.ctrlKey || event.metaKey)) {
        if (!rangeStart) {
            setRangeStart(date);
            return; // Wait for second click
        } else {
            // Range selection complete
            handleRangeSelection(rangeStart, date, targetDoctorId);
            setRangeStart(null);
            return;
        }
    }

    // Normal toggle (no CTRL)
    setRangeStart(null); // Clear range if normal click

    if (activeType === 'DELETE') {
        // Check for any shift on this date
        const shift = relevantShifts.find(s => s.date === dateStr);
        if (shift) deleteShiftMutation.mutate(shift.id);
        return;
    }

    // Check real data state - Find ALL shifts for this day to ensure cleanup
    const existingShifts = relevantShifts.filter(s => s.date === dateStr);
    const existingShift = existingShifts[0]; // Primary one for logic

    // 1. Exact match: Toggle OFF
    if (existingShift && existingShift.position === activeType) {
        // Delete ALL shifts on this day if we are toggling off, to be clean
        const idsToDelete = existingShifts.map(s => s.id);
        bulkDeleteShiftMutation.mutate(idsToDelete);
        return;
    }

    // 2. No shift: Create
    if (!existingShift) {
        createShiftMutation.mutate({
            date: dateStr,
            position: activeType,
            doctor_id: targetDoctorId
        });
        return;
    }

    // 3. Different shift: Overwrite if it's an absence type
    const isExistingAbsence = ["Urlaub", "Frei", "Krank", "Dienstreise", "Nicht verfügbar"].includes(existingShift.position);
    
    if (isExistingAbsence) {
         // Overwrite: Update the first one, delete any others (duplicates)
         const [first, ...rest] = existingShifts;
         
         if (rest.length > 0) {
             bulkDeleteShiftMutation.mutate(rest.map(s => s.id));
         }
         
         // Optimistic Update via atomicOperations
         base44.functions.invoke('atomicOperations', {
             operation: 'checkAndUpdate',
             entity: 'ShiftEntry',
             id: first.id,
             data: { position: activeType },
             check: { updated_date: first.updated_date }
         }).then(() => {
             queryClient.invalidateQueries({ queryKey: ['shifts'] });
         }).catch(err => {
             alert("Fehler beim Aktualisieren: " + (err.response?.data?.message || err.message));
             queryClient.invalidateQueries({ queryKey: ['shifts'] });
         });
    } else {
         // Work shift exists - show ConflictDialog
         const conflict = {
             date: dateStr,
             existingShift,
             newPosition: activeType,
             conflictType: categorizeConflict(activeType, existingShift.position)
         };
         const doctor = doctors.find(d => d.id === targetDoctorId);
         setConflictDialog({
             open: true,
             conflicts: [conflict],
             doctorName: doctor?.name || 'Unbekannt',
             pendingAction: {
                 type: 'single',
                 data: { dateStr, activeType, targetDoctorId, existingShifts }
             }
         });
    }
  };

  const absenceTypes = React.useMemo(() => {
      const types = [
          'Urlaub', 'Frei', 'Krank', 'Dienstreise', 'Nicht verfügbar'
      ].map(id => {
          const color = customColors[id] || { backgroundColor: '#64748b', color: '#ffffff' };
          return { id, label: id, bgColor: color.backgroundColor, textColor: color.color };
      });
      types.push({ 
          id: 'DELETE', 
          label: 'Löschen', 
          bgColor: '#f1f5f9',
          textColor: '#0f172a',
          isDelete: true,
      });
      return types;
  }, [customColors]);

  return (
    <div className="container mx-auto max-w-7xl" data-testid="vacation-page">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{absencesCaption}</h1>
          <p className="text-slate-500 mt-1">Übersicht der {absencesCaption} und {availableCaption}</p>
        </div>

        <div className="flex items-center gap-4">
            {!isReadOnly && (
                <>
                    <Button 
                        variant="outline" 
                        onClick={handleSyncAbsences}
                      title={`${absencesCaption} aus Stellenplan übernehmen (KO, EZ, 0.0 FTE, Vertragsende)`}
                    >
                        <Wand2 className="w-4 h-4 mr-2" />
                        Stellenplan-Sync
                    </Button>
                    <AppSettingsDialog />
                </>
            )}
            
            <div className="bg-slate-100 p-1 rounded-lg flex">
                <button 
                    data-testid="vacation-view-single"
                    onClick={() => setViewMode('single')}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${viewMode === 'single' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Einzelansicht
                </button>
                <button 
                    data-testid="vacation-view-overview"
                    onClick={() => setViewMode('overview')}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${viewMode === 'overview' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Jahresübersicht
                </button>
            </div>

            <div className="flex items-center gap-4 bg-white p-2 rounded-lg shadow-sm border border-slate-200">
               <div className="flex items-center">
                 <Button data-testid="vacation-year-prev" variant="ghost" size="icon" onClick={() => setSelectedYear(y => y - 1)}>
                     <ChevronLeft className="w-4 h-4" />
                 </Button>
                 <span className="mx-2 font-bold text-lg w-16 text-center" data-testid="vacation-year-current">{selectedYear}</span>
                 <Button data-testid="vacation-year-next" variant="ghost" size="icon" onClick={() => setSelectedYear(y => y + 1)}>
                     <ChevronRight className="w-4 h-4" />
                 </Button>
               </div>
               
               {viewMode === 'single' && (
               <>
                   <div className="w-px h-8 bg-slate-200 mx-2" />

                      <EmployeeSelect
                     value={selectedDoctorId || ''}
                     onValueChange={setSelectedDoctorId}
                     options={doctorSelectOptions}
                     placeholder="Person auswählen"
                     searchPlaceholder="Person suchen..."
                     triggerClassName="w-[200px]"
                     triggerTestId="vacation-doctor-select-trigger"
                     optionTestIdPrefix="vacation-doctor-option-"
                      />
               </>
               )}
            </div>
        </div>
      </div>
      
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {absenceTypes.map(type => (
               <Button
                   key={type.id}
                   data-testid={`vacation-type-${String(type.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}
                   variant={activeType === type.id ? "default" : "outline"}
                  onClick={() => !isReadOnly && setActiveType(type.id)}
                  className={`gap-2 ${activeType === type.id ? 'border-transparent shadow-sm' : 'hover:bg-slate-50'} ${isReadOnly ? 'cursor-default opacity-100 hover:bg-transparent' : ''}`}
                  style={activeType === type.id ? { backgroundColor: type.bgColor, color: type.textColor, borderColor: 'transparent' } : {}}
                  disabled={isReadOnly && activeType !== type.id}
              >
                  {type.id === 'DELETE' ? <Eraser className="w-4 h-4" /> : <div className="w-3 h-3 rounded-full" style={{ backgroundColor: type.bgColor }} />}
                  {type.label}
              </Button>
          ))}
      </div>

      {viewMode === 'single' ? (
        <>
          {selectedDoctor ? (
             <DoctorYearView 
                doctor={selectedDoctor} 
                year={selectedYear} 
                shifts={yearShifts}
                onToggle={(d, s, e) => handleToggleShift(d, s, selectedDoctorId, e)}
                onRangeSelect={(s, e) => handleRangeSelection(s, e, selectedDoctorId)}
                activeType={activeType}
                rangeStart={rangeStart}
              contractInfo={selectedDoctorContractInfo}
                 customColors={customColors}
                 isSchoolHoliday={isSchoolHoliday}
                 isPublicHoliday={isPublicHoliday}
                 dayTestIdPrefix="vacation-day"
             />
          ) : (
            <div className="text-center py-12 text-slate-500">
                Bitte wählen Sie eine Person aus.
            </div>
          )}
        </>
      ) : (
        <VacationOverview 
            year={selectedYear} 
            doctors={doctors} 
            shifts={overviewShifts} 
          contractInfoByDoctorId={contractInfoByDoctorId}
          entitlementByDoctorId={entitlementByDoctorId}
            isSchoolHoliday={isSchoolHoliday}
            isPublicHoliday={isPublicHoliday}
            visibleTypes={visibleTypes}
            customColors={customColors}
            onToggle={handleToggleShift}
            onRangeSelect={handleRangeSelection}
            activeType={activeType}
            isReadOnly={isReadOnly}
            monthsPerRow={monthsPerRow}
            minPresentSpecialists={minPresentSpecialists}
            minPresentAssistants={minPresentAssistants}
            />
      )}
      
      {/* Conflict Warning Dialog */}
      <ConflictDialog
          open={conflictDialog.open}
          onOpenChange={(open) => setConflictDialog(prev => ({ ...prev, open }))}
          conflicts={conflictDialog.conflicts}
          doctorName={conflictDialog.doctorName}
          onConfirm={handleConflictConfirm}
          onCancel={() => setConflictDialog({ open: false, conflicts: [], doctorName: '', pendingAction: null })}
      />

      {/* Stellenplan-Sync Simulation Dialog */}
      <Dialog open={showSimulationDialog} onOpenChange={setShowSimulationDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Stellenplan-Sync Simulation ({selectedYear})
            </DialogTitle>
            <DialogDescription>
              <span className="flex items-center gap-2 text-amber-600 font-medium">
                <Info className="w-4 h-4" />
                SIMULATIONSMODUS - Es werden KEINE Änderungen vorgenommen!
              </span>
            </DialogDescription>
          </DialogHeader>
          
          {simulationData && (
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
              {/* Zusammenfassung */}
              <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-lg">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{simulationData.newShifts.filter(s => !s.replacesExisting).length}</div>
                  <div className="text-sm text-slate-600">Neue Einträge</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-amber-600">{simulationData.shiftsToDelete.length}</div>
                  <div className="text-sm text-slate-600">Überschreibungen</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{simulationData.newShifts.length}</div>
                  <div className="text-sm text-slate-600">Gesamt-Änderungen</div>
                </div>
              </div>

              {simulationData.newShifts.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-slate-500">
                  <div className="text-center">
                    <Info className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                    <p className="text-lg font-medium">Keine Änderungen erforderlich</p>
                    <p className="text-sm">Alle {absencesCaption} aus dem Stellenplan sind bereits eingetragen.</p>
                  </div>
                </div>
              ) : (
                <div className="h-[400px] overflow-y-auto border rounded-lg">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white z-10">
                      <TableRow>
                        <TableHead className="w-[100px]">Aktion</TableHead>
                        <TableHead>Mitarbeiter</TableHead>
                        <TableHead>Datum</TableHead>
                        <TableHead>Grund</TableHead>
                        <TableHead>Bisheriger Status</TableHead>
                        <TableHead>Neuer Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {simulationData.newShifts.slice(0, 500).map((shift, idx) => (
                        <TableRow key={idx} className={shift.replacesExisting ? "bg-amber-50" : "bg-green-50"}>
                          <TableCell>
                            {shift.replacesExisting ? (
                              <span className="flex items-center gap-1 text-amber-600">
                                <Trash2 className="w-3 h-3" />
                                Überschreiben
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-green-600">
                                <Plus className="w-3 h-3" />
                                Neu
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{shift.doctorName}</TableCell>
                          <TableCell>{format(new Date(shift.date), 'dd.MM.yyyy (EEEEEE)', { locale: undefined })}</TableCell>
                          <TableCell>
                            <span className="text-xs px-2 py-1 bg-slate-100 rounded">
                              {shift.reason}
                            </span>
                          </TableCell>
                          <TableCell>
                            {shift.replacesExisting ? (
                              <span className="text-amber-700">{shift.replacesExisting}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="font-medium text-red-600">Nicht verfügbar</span>
                          </TableCell>
                        </TableRow>
                      ))}
                      {simulationData.newShifts.length > 500 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-slate-500 py-4">
                            ... und {simulationData.newShifts.length - 500} weitere Einträge
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Gruppierte Zusammenfassung nach Mitarbeiter */}
              {simulationData.newShifts.length > 0 && (
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-medium mb-2 text-blue-800">Zusammenfassung pro Mitarbeiter:</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(
                      simulationData.newShifts.reduce((acc, shift) => {
                        acc[shift.doctorName] = (acc[shift.doctorName] || 0) + 1;
                        return acc;
                      }, {})
                    ).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                      <span key={name} className="px-2 py-1 bg-white rounded text-sm border border-blue-200">
                        {name}: <strong>{count}</strong> Tage
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="border-t pt-4">
            <div className="flex items-center gap-2 text-sm text-slate-500 mr-auto">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Bitte prüfen Sie die Änderungen sorgfältig vor der Ausführung
            </div>
            <Button variant="outline" onClick={() => setShowSimulationDialog(false)}>
              Abbrechen
            </Button>
            {simulationData && simulationData.newShifts.length > 0 && (
              <Button 
                onClick={executeSyncAbsences}
                className="bg-green-600 hover:bg-green-700"
                disabled={bulkCreateShiftMutation.isPending || bulkDeleteShiftMutation.isPending}
              >
                {(bulkCreateShiftMutation.isPending || bulkDeleteShiftMutation.isPending) 
                  ? "Wird ausgeführt..." 
                  : `${simulationData.newShifts.length} Änderungen ausführen`
                }
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
