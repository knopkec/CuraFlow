import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addDays, startOfWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { Globe2, ChevronLeft, ChevronRight, Loader2, Info, Plus } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import PoolShiftEditDialog from './PoolShiftEditDialog';

/**
 * Cross-tenant pool shifts that affect the active tenant.
 *
 * Lives above the regular ScheduleBoard. One row per shared workplace, 7 day
 * columns. For users whose `canWrite` flag is true on a workplace
 * (cross-tenant admins) a cell click opens `PoolShiftEditDialog` to
 * create/edit/delete the shift; everyone else sees the plan read-only.
 */
export default function PoolShiftsPanel() {
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [editTarget, setEditTarget] = useState(null); // { workplace, date, shift }

    const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
    const fromStr = useMemo(() => format(weekStart, 'yyyy-MM-dd'), [weekStart]);
    const toStr = useMemo(() => format(weekEnd, 'yyyy-MM-dd'), [weekEnd]);

    const weekDays = useMemo(
        () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
        [weekStart]
    );

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['pool', 'visible-shifts', fromStr, toStr],
        queryFn: () => api.getVisiblePoolShifts({ from: fromStr, to: toStr }),
        staleTime: 30_000,
    });

    const shifts = data?.shifts || [];
    const workplaces = data?.workplaces || [];
    const activeTenantId = data?.tenantId || null;

    // Index shifts by workplace_id + date so each cell can be filled in O(1).
    const shiftsByCell = useMemo(() => {
        const map = new Map();
        for (const s of shifts) {
            const key = `${s.shared_workplace_id}|${s.date}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(s);
        }
        return map;
    }, [shifts]);

    // Hide the panel completely if the tenant has no pool access at all.
    if (
        !isLoading &&
        !isError &&
        workplaces.length === 0 &&
        !(data?.groupIds?.length)
    ) {
        return null;
    }

    const prevWeek = () => setWeekStart((d) => addDays(d, -7));
    const nextWeek = () => setWeekStart((d) => addDays(d, 7));
    const thisWeek = () => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

    const handleCellClick = (workplace, dateKey, cellShifts) => {
        if (!workplace.canWrite) return;
        // To keep the UX predictable we only allow editing single-shift cells.
        // Empty cells open the create form; multi-shift cells stay read-only.
        if (cellShifts.length === 0) {
            setEditTarget({ workplace, date: dateKey, shift: null });
        } else if (cellShifts.length === 1) {
            setEditTarget({ workplace, date: dateKey, shift: cellShifts[0] });
        }
    };

    return (
        <div
            className="mx-2 mt-2 mb-3 border border-indigo-200 bg-indigo-50/40 rounded-lg overflow-hidden"
            data-testid="pool-shifts-panel"
        >
            <div className="flex items-center justify-between px-3 py-2 bg-indigo-100/60 border-b border-indigo-200">
                <div className="flex items-center gap-2">
                    <Globe2 className="w-4 h-4 text-indigo-700" />
                    <span className="font-semibold text-sm text-indigo-900">
                        Cross-Department-Pool
                    </span>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Info className="w-3.5 h-3.5 text-indigo-500 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                                Mandantenübergreifende Dienste. Cross-Department-Admins können
                                Zellen anklicken, um Einträge anzulegen oder zu bearbeiten;
                                alle anderen sehen den Plan schreibgeschützt.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={prevWeek}>
                        <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={thisWeek}>
                        Heute
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={nextWeek}>
                        <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-xs text-slate-600 ml-2">
                        {format(weekStart, 'd. MMM', { locale: de })} – {format(weekEnd, 'd. MMM yyyy', { locale: de })}
                    </span>
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-6 text-xs text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> Lade Pool-Dienste …
                </div>
            ) : isError ? (
                <div className="px-3 py-3 text-xs text-rose-700">
                    Fehler beim Laden: {error?.message || 'unbekannt'}
                </div>
            ) : workplaces.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-500">
                    Keine Pool-Arbeitsplätze konfiguriert.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                        <thead className="bg-indigo-50/80">
                            <tr>
                                <th className="px-2 py-1.5 text-left font-medium text-slate-700 sticky left-0 bg-indigo-50/80 border-r border-indigo-200 min-w-[110px]">
                                    Pool-Dienst
                                </th>
                                {weekDays.map((d) => (
                                    <th
                                        key={d.toISOString()}
                                        className="px-1.5 py-1.5 text-center font-medium text-slate-700 whitespace-nowrap min-w-[100px]"
                                    >
                                        <div>{format(d, 'EE', { locale: de })}</div>
                                        <div className="text-[10px] text-slate-500 font-normal">
                                            {format(d, 'd.M.', { locale: de })}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {workplaces.map((wp) => (
                                <tr key={wp.id} className="border-t border-indigo-100">
                                    <td className="px-2 py-1.5 font-medium text-slate-800 sticky left-0 bg-white border-r border-indigo-100 whitespace-nowrap">
                                        {wp.name}
                                        {wp.category && (
                                            <span className="ml-1 text-[10px] text-slate-400">
                                                ({wp.category})
                                            </span>
                                        )}
                                    </td>
                                    {weekDays.map((d) => {
                                        const dateKey = format(d, 'yyyy-MM-dd');
                                        const cellShifts = shiftsByCell.get(`${wp.id}|${dateKey}`) || [];
                                        const interactive = wp.canWrite && cellShifts.length <= 1;
                                        return (
                                            <td
                                                key={dateKey}
                                                className={`px-1 py-1 align-top text-center ${
                                                    interactive ? 'cursor-pointer hover:bg-indigo-100/40' : ''
                                                }`}
                                                onClick={
                                                    interactive
                                                        ? () => handleCellClick(wp, dateKey, cellShifts)
                                                        : undefined
                                                }
                                                data-testid={
                                                    interactive ? 'pool-cell-editable' : 'pool-cell-readonly'
                                                }
                                            >
                                                {cellShifts.length === 0 ? (
                                                    interactive ? (
                                                        <Plus className="w-3 h-3 text-indigo-300 mx-auto" />
                                                    ) : (
                                                        <span className="text-slate-300">—</span>
                                                    )
                                                ) : (
                                                    <div className="flex flex-col gap-0.5">
                                                        {cellShifts.map((s) => (
                                                            <PoolShiftChip key={s.id} shift={s} />
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <PoolShiftEditDialog
                open={!!editTarget}
                onOpenChange={(open) => {
                    if (!open) setEditTarget(null);
                }}
                workplace={editTarget?.workplace}
                date={editTarget?.date}
                shift={editTarget?.shift}
                activeTenantId={activeTenantId}
            />
        </div>
    );
}

function PoolShiftChip({ shift }) {
    // Visual distinction:
    //  - shifts staffed by an employee of THIS tenant get a stronger color
    //    (they actually block the person locally)
    //  - shifts from another tenant are softer
    const isLocal = shift.belongs_to_active_tenant;
    const baseClass = isLocal
        ? 'bg-indigo-100 text-indigo-900 border-indigo-300'
        : 'bg-white text-slate-700 border-slate-300';

    const tooltip = isLocal
        ? 'Mitarbeiter dieses Mandanten — blockt Folgetag-Verfügbarkeit'
        : 'Mitarbeiter eines anderen Mandanten im Verbund';

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={`inline-block px-1.5 py-0.5 rounded border text-[10px] truncate max-w-[110px] ${baseClass}`}
                    >
                        {shift.employee_name}
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                    <div className="font-medium">{shift.workplace_name}</div>
                    <div>{shift.employee_name}</div>
                    <div className="text-slate-500">{tooltip}</div>
                    {shift.canWrite ? (
                        <div className="text-slate-500 mt-1">Klick zum Bearbeiten</div>
                    ) : (
                        <div className="text-slate-400 mt-1">Schreibgeschützt</div>
                    )}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
