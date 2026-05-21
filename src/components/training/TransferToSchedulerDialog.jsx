import { useState, useMemo } from 'react';
import { format, eachDayOfInterval, startOfWeek, endOfWeek, isBefore, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarDays, Info, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { isDoctorAvailable } from '@/components/schedule/staffingUtils';

export default function TransferToSchedulerDialog({ 
    open, 
    onOpenChange, 
    rotations = [], 
    doctors = [], 
    allShifts = [], 
    staffingPlanEntries = [],
    workplaces = [],
    isPublicHoliday,
    onTransfer,
    isPending = false
}) {
    const [transferMode, setTransferMode] = useState('day'); // 'day' | 'week' | 'from_date'
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [overwriteExisting, setOverwriteExisting] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [calendarOpen, setCalendarOpen] = useState(false);

    const today = startOfDay(new Date());

    // Ensure selected date is never before today
    const effectiveDate = useMemo(() => {
        const d = startOfDay(selectedDate);
        return isBefore(d, today) ? today : d;
    }, [selectedDate, today]);

    // Calculate the date range based on the transfer mode
    const dateRange = useMemo(() => {
        let start, end;
        
        switch (transferMode) {
            case 'day':
                start = effectiveDate;
                end = effectiveDate;
                break;
            case 'week':
                start = startOfWeek(effectiveDate, { weekStartsOn: 1 }); // Monday
                end = endOfWeek(effectiveDate, { weekStartsOn: 1 }); // Sunday
                // Ensure start is not before today
                if (isBefore(start, today)) start = today;
                break;
            case 'from_date':
                start = effectiveDate;
                // End of year or last rotation end, whichever is earlier
                const maxEnd = new Date(effectiveDate.getFullYear(), 11, 31);
                end = maxEnd;
                break;
            default:
                start = effectiveDate;
                end = effectiveDate;
        }
        
        return { start, end };
    }, [transferMode, effectiveDate, today]);

    // Calculate all entries that would be created
    const transferPreview = useMemo(() => {
        const { start, end } = dateRange;
        const entries = [];
        const skipped = [];
        
        const startStr = format(start, 'yyyy-MM-dd');
        const endStr = format(end, 'yyyy-MM-dd');
        
        // Build shift lookup for quick conflict detection
        const shiftLookup = new Map();
        allShifts.forEach(s => {
            const key = `${s.date}_${s.doctor_id}`;
            if (!shiftLookup.has(key)) shiftLookup.set(key, []);
            shiftLookup.get(key).push(s);
        });
        
        // Get rotation workplaces for matching
        const rotationWorkplaces = workplaces.filter(w => w.category === 'Rotationen').map(w => w.name);
        
        rotations.forEach(rot => {
            // Check if rotation overlaps with our date range
            if (rot.end_date < startStr || rot.start_date > endStr) return;
            
            const doctor = doctors.find(d => d.id === rot.doctor_id);
            if (!doctor) return;
            
            // The rotation modality must match a workplace in "Rotationen" category
            if (!rotationWorkplaces.includes(rot.modality)) {
                return; // Skip - modality doesn't match any rotation workplace
            }
            
            // Calculate effective overlap period
            const rotStart = rot.start_date > startStr ? new Date(rot.start_date) : start;
            const rotEnd = rot.end_date < endStr ? new Date(rot.end_date) : end;
            
            const days = eachDayOfInterval({ start: rotStart, end: rotEnd });
            
            days.forEach(day => {
                const dateStr = format(day, 'yyyy-MM-dd');
                
                // Skip past dates
                if (isBefore(day, today)) {
                    return;
                }
                
                // Check active_days of the workplace for this rotation
                // Feiertage verhalten sich wie Sonntag (Index 0)
                const wp = workplaces.find(w => w.name === rot.modality && w.category === 'Rotationen');
                const activeDays = (wp?.active_days?.length > 0) ? wp.active_days : [1, 2, 3, 4, 5];
                const isHoliday = isPublicHoliday && isPublicHoliday(day);
                const isActiveDay = isHoliday
                    ? activeDays.some(d => Number(d) === 0)
                    : activeDays.some(d => Number(d) === day.getDay());
                if (!isActiveDay) {
                    return;
                }
                
                // Check availability (FTE, contract end, KO/EZ/MS)
                const available = isDoctorAvailable(doctor, day, staffingPlanEntries);
                if (!available) {
                    skipped.push({
                        date: dateStr,
                        doctor_id: rot.doctor_id,
                        doctorName: doctor.name,
                        modality: rot.modality,
                        reason: 'Nicht verfügbar (Stellenplan)'
                    });
                    return;
                }
                
                // Check for existing shifts/absences on that day
                const existingShifts = shiftLookup.get(`${dateStr}_${rot.doctor_id}`) || [];
                const absenceTypes = ["Urlaub", "Krank", "Frei", "Dienstreise", "Nicht verfügbar"];
                const hasAbsence = existingShifts.some(s => absenceTypes.includes(s.position));
                
                if (hasAbsence) {
                    const absenceShift = existingShifts.find(s => absenceTypes.includes(s.position));
                    skipped.push({
                        date: dateStr,
                        doctor_id: rot.doctor_id,
                        doctorName: doctor.name,
                        modality: rot.modality,
                        reason: `Abwesend (${absenceShift.position})`
                    });
                    return;
                }
                
                // Existing non-absence entries can optionally be replaced.
                const existingAssignableEntries = existingShifts.filter(s => !absenceTypes.includes(s.position));
                const hasExistingRotation = existingAssignableEntries.some(s => s.position === rot.modality);

                if (hasExistingRotation && !overwriteExisting) {
                    skipped.push({
                        date: dateStr,
                        doctor_id: rot.doctor_id,
                        doctorName: doctor.name,
                        modality: rot.modality,
                        reason: 'Bereits eingetragen'
                    });
                    return;
                }

                if (existingAssignableEntries.length > 0 && !overwriteExisting) {
                    skipped.push({
                        date: dateStr,
                        doctor_id: rot.doctor_id,
                        doctorName: doctor.name,
                        modality: rot.modality,
                        reason: `Bereits belegt (${existingAssignableEntries[0].position})`,
                        existingShiftIds: existingAssignableEntries.map(s => s.id)
                    });
                    return;
                }
                
                entries.push({
                    date: dateStr,
                    doctor_id: rot.doctor_id,
                    doctorName: doctor.name,
                    position: rot.modality,
                    modality: rot.modality,
                    overwrite: existingAssignableEntries.length > 0,
                    existingShiftIds: existingAssignableEntries.map(s => s.id),
                    existingPosition: existingAssignableEntries.length > 0 ? existingAssignableEntries[0].position : null
                });
            });
        });
        
        // Sort by date, then doctor name
        entries.sort((a, b) => a.date.localeCompare(b.date) || a.doctorName.localeCompare(b.doctorName));
        skipped.sort((a, b) => a.date.localeCompare(b.date) || a.doctorName.localeCompare(b.doctorName));
        
        return { entries, skipped };
    }, [dateRange, rotations, doctors, allShifts, staffingPlanEntries, workplaces, overwriteExisting, today, isPublicHoliday]);

    const handleTransfer = () => {
        if (transferPreview.entries.length === 0) return;
        
        onTransfer({
            entries: transferPreview.entries,
            overwriteExisting
        });
    };

    const handleDateSelect = (date) => {
        if (date) {
            setSelectedDate(date);
            setCalendarOpen(false);
        }
    };

    const handleOpenChange = (open) => {
        if (!open) {
            setShowPreview(false);
        }
        onOpenChange(open);
    };

    // Summary by doctor
    const doctorSummary = useMemo(() => {
        const summary = {};
        transferPreview.entries.forEach(e => {
            if (!summary[e.doctorName]) {
                summary[e.doctorName] = { count: 0, modalities: new Set() };
            }
            summary[e.doctorName].count++;
            summary[e.doctorName].modalities.add(e.modality);
        });
        return summary;
    }, [transferPreview.entries]);

    const skippedReasonSummary = useMemo(() => {
        const summary = new Map();
        transferPreview.skipped.forEach(item => {
            summary.set(item.reason, (summary.get(item.reason) || 0) + 1);
        });

        return Array.from(summary.entries())
            .sort((a, b) => b[1] - a[1]);
    }, [transferPreview.skipped]);

    const modeLabels = {
        day: 'Einen Tag',
        week: 'Eine Woche',
        from_date: 'Alles ab Datum'
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="training-transfer-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarDays className="w-5 h-5 text-emerald-600" />
                        Ausbildung in Wochenplan übertragen
                    </DialogTitle>
                    <DialogDescription>
                        Übertragen Sie die geplanten Ausbildungsrotationen als Schichteinträge in den Wochenplan.
                    </DialogDescription>
                </DialogHeader>

                {!showPreview ? (
                    <div className="space-y-6 py-4">
                        {/* Transfer Mode */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium text-slate-700">Übertragungsmodus</Label>
                            <RadioGroup value={transferMode} onValueChange={setTransferMode} className="space-y-2">
                                <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-slate-50 transition-colors">
                                    <RadioGroupItem data-testid="training-transfer-mode-day" value="day" id="mode-day" />
                                    <Label htmlFor="mode-day" className="flex-1 cursor-pointer">
                                        <div className="font-medium">Einen Tag</div>
                                        <div className="text-sm text-slate-500">Nur den ausgewählten Tag übertragen</div>
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-slate-50 transition-colors">
                                    <RadioGroupItem data-testid="training-transfer-mode-week" value="week" id="mode-week" />
                                    <Label htmlFor="mode-week" className="flex-1 cursor-pointer">
                                        <div className="font-medium">Eine Woche</div>
                                        <div className="text-sm text-slate-500">Die gesamte Woche des ausgewählten Datums</div>
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-slate-50 transition-colors">
                                    <RadioGroupItem data-testid="training-transfer-mode-from-date" value="from_date" id="mode-from" />
                                    <Label htmlFor="mode-from" className="flex-1 cursor-pointer">
                                        <div className="font-medium">Alles ab Datum</div>
                                        <div className="text-sm text-slate-500">Alle Rotationen ab dem ausgewählten Datum bis Jahresende</div>
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>

                        {/* Date Picker */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium text-slate-700">Datum auswählen</Label>
                            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                                <PopoverTrigger asChild>
                                    <Button data-testid="training-transfer-date-trigger" variant="outline" className="w-full justify-start text-left font-normal">
                                        <CalendarDays className="mr-2 h-4 w-4" />
                                        {format(effectiveDate, 'EEEE, dd. MMMM yyyy', { locale: de })}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 z-50" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={effectiveDate}
                                        onSelect={handleDateSelect}
                                        disabled={(date) => isBefore(startOfDay(date), today)}
                                        locale={de}
                                    />
                                </PopoverContent>
                            </Popover>
                            
                            {transferMode === 'week' && (
                                <p className="text-sm text-slate-500">
                                    Woche: {format(dateRange.start, 'dd.MM.yyyy')} – {format(dateRange.end, 'dd.MM.yyyy')}
                                </p>
                            )}
                            {transferMode === 'from_date' && (
                                <p className="text-sm text-slate-500">
                                    Zeitraum: {format(dateRange.start, 'dd.MM.yyyy')} – {format(dateRange.end, 'dd.MM.yyyy')}
                                </p>
                            )}
                        </div>

                        {/* Overwrite Checkbox */}
                        <div className="flex items-start space-x-3 p-4 rounded-lg border bg-amber-50 border-amber-200">
                            <Checkbox 
                                id="overwrite" 
                                data-testid="training-transfer-overwrite"
                                checked={overwriteExisting} 
                                onCheckedChange={setOverwriteExisting}
                                className="mt-0.5"
                            />
                            <div>
                                <Label htmlFor="overwrite" className="font-medium text-amber-900 cursor-pointer">
                                    Bestehende Eintragungen überschreiben
                                </Label>
                                <p className="text-sm text-amber-700 mt-1">
                                    Wenn aktiviert, werden bestehende Dienst- und Rotationseinträge durch die Ausbildungsrotation ersetzt. 
                                    Abwesenheiten (Urlaub, Krank, etc.) werden niemals überschrieben.
                                </p>
                            </div>
                        </div>

                        {/* Info Box */}
                        <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
                            <div className="flex gap-2">
                                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                                <div>
                                    <p className="font-medium">Hinweise:</p>
                                    <ul className="mt-1 space-y-1 list-disc list-inside">
                                        <li>Rückdatierte Eintragungen sind nicht möglich (frühestens ab heute)</li>
                                        <li>Nur anwesende Mitarbeiter werden eingetragen (Stellenplan-Prüfung)</li>
                                        <li>Abwesende Mitarbeiter (Urlaub, Krank, etc.) werden automatisch übersprungen</li>
                                        <li>Wochenenden werden nicht eingetragen</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Preview Mode */
                    <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
                        {/* Summary */}
                        <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-lg">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-emerald-600">{transferPreview.entries.length}</div>
                                <div className="text-sm text-slate-600">Einträge erstellen</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-amber-600">{transferPreview.entries.filter(e => e.overwrite).length}</div>
                                <div className="text-sm text-slate-600">Überschreibungen</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-slate-500">{transferPreview.skipped.length}</div>
                                <div className="text-sm text-slate-600">Übersprungen</div>
                            </div>
                        </div>

                        {transferPreview.entries.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center text-slate-500 py-8">
                                <div className="text-center">
                                    <Info className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                                    <p className="text-lg font-medium">Keine Einträge zum Übertragen</p>
                                    <p className="text-sm mt-2">
                                        {transferPreview.skipped.length > 0 
                                            ? `${transferPreview.skipped.length} Einträge wurden übersprungen.`
                                            : 'Im gewählten Zeitraum gibt es keine passenden Ausbildungsrotationen.'
                                        }
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="h-[350px] overflow-y-auto border rounded-lg">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-white z-10">
                                        <TableRow>
                                            <TableHead className="w-[80px]">Status</TableHead>
                                            <TableHead>Mitarbeiter</TableHead>
                                            <TableHead>Datum</TableHead>
                                            <TableHead>Rotation</TableHead>
                                            <TableHead>Bisherige Belegung</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {transferPreview.entries.map((entry, idx) => (
                                            <TableRow key={idx} className={entry.overwrite ? "bg-amber-50" : "bg-emerald-50"}>
                                                <TableCell>
                                                    {entry.overwrite ? (
                                                        <span className="flex items-center gap-1 text-amber-600 text-xs">
                                                            <ArrowRight className="w-3 h-3" />
                                                            Ersetzen
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1 text-emerald-600 text-xs">
                                                            <CheckCircle2 className="w-3 h-3" />
                                                            Neu
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="font-medium">{entry.doctorName}</TableCell>
                                                <TableCell>{format(new Date(entry.date), 'EE, dd.MM.yyyy', { locale: de })}</TableCell>
                                                <TableCell>
                                                    <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-medium">
                                                        {entry.modality}
                                                    </span>
                                                </TableCell>
                                                <TableCell>
                                                    {entry.existingPosition ? (
                                                        <span className="text-amber-700 text-xs">{entry.existingPosition}</span>
                                                    ) : (
                                                        <span className="text-slate-400 text-xs">—</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}

                        {/* Skipped entries (collapsible) */}
                        {transferPreview.skipped.length > 0 && (
                            <div className="space-y-3">
                                <div className="border rounded-lg bg-slate-50 p-3">
                                    <h4 className="text-sm font-medium text-slate-700 mb-2">Häufigste Gründe für übersprungene Einträge</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {skippedReasonSummary.map(([reason, count]) => (
                                            <span key={reason} className="px-2 py-1 rounded border bg-white text-xs text-slate-600">
                                                {count}x {reason}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <details className="border rounded-lg">
                                <summary className="p-3 cursor-pointer hover:bg-slate-50 flex items-center gap-2 text-sm font-medium text-slate-600">
                                    <XCircle className="w-4 h-4 text-slate-400" />
                                    {transferPreview.skipped.length} übersprungene Einträge anzeigen
                                </summary>
                                <div className="max-h-[200px] overflow-y-auto border-t">
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-white z-10">
                                            <TableRow>
                                                <TableHead>Mitarbeiter</TableHead>
                                                <TableHead>Datum</TableHead>
                                                <TableHead>Rotation</TableHead>
                                                <TableHead>Grund</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {transferPreview.skipped.map((item, idx) => (
                                                <TableRow key={idx} className="bg-slate-50">
                                                    <TableCell className="text-xs">{item.doctorName}</TableCell>
                                                    <TableCell className="text-xs">{format(new Date(item.date), 'EE, dd.MM.', { locale: de })}</TableCell>
                                                    <TableCell className="text-xs">{item.modality}</TableCell>
                                                    <TableCell className="text-xs text-slate-500">{item.reason}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                                </details>
                            </div>
                        )}

                        {/* Doctor Summary */}
                        {Object.keys(doctorSummary).length > 0 && (
                            <div className="p-3 bg-emerald-50 rounded-lg">
                                <h4 className="font-medium mb-2 text-emerald-800 text-sm">Zusammenfassung pro Mitarbeiter:</h4>
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(doctorSummary)
                                        .sort((a, b) => b[1].count - a[1].count)
                                        .map(([name, data]) => (
                                            <span key={name} className="px-2 py-1 bg-white rounded text-xs border border-emerald-200">
                                                {name}: <strong>{data.count}</strong> Tage ({[...data.modalities].join(', ')})
                                            </span>
                                        ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="border-t pt-4">
                    {showPreview && (
                        <Button data-testid="training-transfer-back" variant="ghost" onClick={() => setShowPreview(false)} className="mr-auto">
                            ← Zurück
                        </Button>
                    )}
                    
                    <Button data-testid="training-transfer-cancel" variant="outline" onClick={() => handleOpenChange(false)}>
                        Abbrechen
                    </Button>
                    
                    {!showPreview ? (
                        <Button 
                            data-testid="training-transfer-preview"
                            onClick={() => setShowPreview(true)}
                            className="bg-emerald-600 hover:bg-emerald-700"
                        >
                            Vorschau anzeigen ({transferPreview.entries.length} Einträge)
                        </Button>
                    ) : (
                        transferPreview.entries.length > 0 && (
                            <Button 
                                data-testid="training-transfer-confirm"
                                onClick={handleTransfer}
                                className="bg-emerald-600 hover:bg-emerald-700"
                                disabled={isPending}
                            >
                                {isPending 
                                    ? "Wird übertragen..." 
                                    : `${transferPreview.entries.length} Einträge übertragen`
                                }
                            </Button>
                        )
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
