import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, Calendar, Trash2, Info } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Defines which positions can optionally co-exist
// Dienstreise is compatible with all service positions (category-based)
// Legacy fallback: hardcoded position names (only used if workplace data not available)
const OPTIONAL_COEXIST_LEGACY = {
    "Dienstreise": ["Dienst Vordergrund", "Dienst Hintergrund", "Spätdienst"],
};

// Categorizes conflict types
// Pass workplaces array optionally for dynamic lookup
export const categorizeConflict = (newPosition, existingPosition, workplaces = []) => {
    // Dynamic: Dienstreise can co-exist with any service (category='Dienste')
    if (newPosition === 'Dienstreise' && workplaces.length > 0) {
        const existingWp = workplaces.find(w => w.name === existingPosition);
        if (existingWp?.category === 'Dienste') {
            return 'optional';
        }
    }

    // Legacy fallback: Check hardcoded co-existence
    if (workplaces.length === 0) {
        const optionalWith = OPTIONAL_COEXIST_LEGACY[newPosition] || [];
        if (optionalWith.includes(existingPosition)) {
            return 'optional'; // Can keep both or delete
        }
    }
    
    // Absences always conflict with each other
    const absences = ["Urlaub", "Frei", "Krank", "Dienstreise", "Nicht verfügbar"];
    if (absences.includes(newPosition) && absences.includes(existingPosition)) {
        return 'overwrite'; // Must overwrite
    }
    
    // Absence conflicts with service/rotation
    if (absences.includes(newPosition) && !absences.includes(existingPosition)) {
        return 'delete_service'; // Will delete service
    }
    
    return 'overwrite';
};

export default function ConflictDialog({ 
    open, 
    onOpenChange, 
    conflicts, // Array of { date, existingShift, newPosition, conflictType }
    doctorName,
    onConfirm, // Called with { proceed: boolean, keepOptional: boolean, selectedConflicts: [] }
    onCancel
}) {
    const [keepOptionalServices, setKeepOptionalServices] = useState(true);
    
    const optionalConflicts = conflicts.filter(c => c.conflictType === 'optional');
    const deleteConflicts = conflicts.filter(c => c.conflictType === 'delete_service');
    const overwriteConflicts = conflicts.filter(c => c.conflictType === 'overwrite');
    
    const totalToDelete = deleteConflicts.length + (keepOptionalServices ? 0 : optionalConflicts.length);
    const totalToOverwrite = overwriteConflicts.length;
    
    const handleConfirm = () => {
        onConfirm({ 
            proceed: true, 
            keepOptionalServices,
            // Return which conflicts should result in deletion
            deleteIds: [
                ...deleteConflicts.map(c => c.existingShift.id),
                ...(keepOptionalServices ? [] : optionalConflicts.map(c => c.existingShift.id))
            ],
            overwriteIds: overwriteConflicts.map(c => c.existingShift.id)
        });
        onOpenChange(false);
    };
    
    const handleCancel = () => {
        onCancel?.();
        onOpenChange(false);
    };
    
    // Group conflicts by type for display
    const groupByPosition = (arr) => {
        const groups = {};
        arr.forEach(c => {
            const pos = c.existingShift.position;
            if (!groups[pos]) groups[pos] = [];
            groups[pos].push(c);
        });
        return groups;
    };
    
    const formatDateRange = (dates) => {
        if (dates.length === 0) return '';
        if (dates.length === 1) return format(new Date(dates[0].date), 'dd.MM.yyyy', { locale: de });
        if (dates.length <= 3) return dates.map(d => format(new Date(d.date), 'dd.MM.', { locale: de })).join(', ');
        return `${dates.length} Tage (${format(new Date(dates[0].date), 'dd.MM.', { locale: de })} - ${format(new Date(dates[dates.length-1].date), 'dd.MM.yyyy', { locale: de })})`;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg" data-testid="vacation-conflict-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-amber-600">
                        <AlertTriangle className="w-5 h-5" />
                        Konflikte gefunden
                    </DialogTitle>
                    <DialogDescription>
                        Für <strong>{doctorName}</strong> gibt es bestehende Einträge, die von dieser Änderung betroffen sind.
                    </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 my-4 max-h-80 overflow-y-auto">
                    {/* Dienste die gelöscht werden */}
                    {deleteConflicts.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
                                <Trash2 className="w-4 h-4" />
                                Folgende Einträge werden gelöscht:
                            </div>
                            <ul className="text-sm text-red-600 space-y-1">
                                {Object.entries(groupByPosition(deleteConflicts)).map(([pos, items]) => (
                                    <li key={pos} className="flex justify-between">
                                        <span>{pos}</span>
                                        <span className="text-red-500">{formatDateRange(items)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    
                    {/* Abwesenheiten die überschrieben werden */}
                    {overwriteConflicts.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 text-amber-700 font-medium mb-2">
                                <Calendar className="w-4 h-4" />
                                Folgende Abwesenheiten werden überschrieben:
                            </div>
                            <ul className="text-sm text-amber-600 space-y-1">
                                {Object.entries(groupByPosition(overwriteConflicts)).map(([pos, items]) => (
                                    <li key={pos} className="flex justify-between">
                                        <span>{pos}</span>
                                        <span className="text-amber-500">{formatDateRange(items)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    
                    {/* Optionale Konflikte - User kann entscheiden */}
                    {optionalConflicts.length > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 text-blue-700 font-medium mb-2">
                                <Info className="w-4 h-4" />
                                Optionale Konflikte (Dienste):
                            </div>
                            <ul className="text-sm text-blue-600 space-y-1 mb-3">
                                {Object.entries(groupByPosition(optionalConflicts)).map(([pos, items]) => (
                                    <li key={pos} className="flex justify-between">
                                        <span>{pos}</span>
                                        <span className="text-blue-500">{formatDateRange(items)}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="flex items-center space-x-2 pt-2 border-t border-blue-200">
                                <Checkbox 
                                    id="keep-services" 
                                    data-testid="vacation-conflict-keep-services"
                                    checked={keepOptionalServices}
                                    onCheckedChange={setKeepOptionalServices}
                                />
                                <label 
                                    htmlFor="keep-services" 
                                    className="text-sm font-medium text-blue-800 cursor-pointer"
                                >
                                    Dienste beibehalten (Dienstreise + Dienst gleichzeitig)
                                </label>
                            </div>
                        </div>
                    )}
                </div>
                
                <div className="bg-slate-100 rounded-lg p-3 text-sm">
                    <strong>Zusammenfassung:</strong>
                    <ul className="mt-1 text-slate-600">
                        {totalToDelete > 0 && <li>• {totalToDelete} Eintrag/Einträge werden gelöscht</li>}
                        {totalToOverwrite > 0 && <li>• {totalToOverwrite} Abwesenheit(en) werden überschrieben</li>}
                        {optionalConflicts.length > 0 && keepOptionalServices && (
                            <li>• {optionalConflicts.length} Dienst(e) bleiben erhalten</li>
                        )}
                    </ul>
                </div>
                
                <DialogFooter className="gap-2">
                    <Button data-testid="vacation-conflict-cancel" variant="outline" onClick={handleCancel}>
                        Abbrechen
                    </Button>
                    <Button 
                        data-testid="vacation-conflict-confirm"
                        onClick={handleConfirm}
                        className="bg-amber-600 hover:bg-amber-700"
                    >
                        Fortfahren
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
