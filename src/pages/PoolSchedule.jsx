import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Users, AlertCircle } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/components/AuthProvider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Cross-tenant pool schedule (read-only skeleton).
 * Shows the shared workplaces and shift assignments for the user's
 * active tenant group across a 14-day window.
 */
export default function PoolSchedule() {
    const { allowedGroups, activeGroupId, setActiveGroupId, isLoading: authLoading } = useAuth();

    const [windowStart, setWindowStart] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
    });

    // Auto-pick first available group if none selected
    useEffect(() => {
        if (!activeGroupId && allowedGroups?.length === 1) {
            setActiveGroupId(allowedGroups[0].id);
        }
    }, [allowedGroups, activeGroupId, setActiveGroupId]);

    const windowEnd = useMemo(() => {
        const d = new Date(windowStart);
        d.setDate(d.getDate() + 13);
        return d.toISOString().slice(0, 10);
    }, [windowStart]);

    const dateRange = useMemo(() => {
        const out = [];
        const start = new Date(windowStart);
        for (let i = 0; i < 14; i += 1) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            out.push(d.toISOString().slice(0, 10));
        }
        return out;
    }, [windowStart]);

    const workplacesQuery = useQuery({
        queryKey: ['pool', 'workplaces', activeGroupId],
        queryFn: () => api.listSharedWorkplaces(activeGroupId),
        enabled: !!activeGroupId,
    });

    const scheduleQuery = useQuery({
        queryKey: ['pool', 'schedule', activeGroupId, windowStart, windowEnd],
        queryFn: () => api.getGroupSchedule(activeGroupId, { from: windowStart, to: windowEnd }),
        enabled: !!activeGroupId,
    });

    const staffQuery = useQuery({
        queryKey: ['pool', 'staff', activeGroupId],
        queryFn: () => api.getGroupStaff(activeGroupId),
        enabled: !!activeGroupId,
    });

    const employeeNameById = useMemo(() => {
        const list = staffQuery.data?.staff || staffQuery.data || [];
        const map = new Map();
        for (const emp of list) {
            const name = emp.display_name
                || [emp.first_name, emp.last_name].filter(Boolean).join(' ')
                || emp.email
                || `#${emp.id}`;
            map.set(Number(emp.id), name);
        }
        return map;
    }, [staffQuery.data]);

    // Index shifts by workplace_id + date for fast lookup
    const shiftIndex = useMemo(() => {
        const shifts = scheduleQuery.data?.shifts || scheduleQuery.data || [];
        const idx = new Map();
        for (const s of shifts) {
            const key = `${s.shared_workplace_id}|${s.shift_date}`;
            if (!idx.has(key)) idx.set(key, []);
            idx.get(key).push(s);
        }
        return idx;
    }, [scheduleQuery.data]);

    if (authLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
            </div>
        );
    }

    if (!allowedGroups || allowedGroups.length === 0) {
        return (
            <div className="max-w-3xl mx-auto p-6">
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Kein Pool-Zugriff</AlertTitle>
                    <AlertDescription>
                        Sie sind aktuell keinem mandantenübergreifenden Verbund zugeordnet.
                        Wenden Sie sich an Ihre Administration, um Zugriff auf den
                        Cross-Department-Pool zu erhalten.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const workplaces = workplacesQuery.data?.workplaces || workplacesQuery.data || [];
    const isLoadingData = workplacesQuery.isLoading || scheduleQuery.isLoading;

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-indigo-600" />
                        Cross-Department-Dienstplan
                    </CardTitle>
                    <CardDescription>
                        Mandantenübergreifender Pool-Dienstplan
                        ({windowStart} – {windowEnd})
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-slate-700">Verbund:</label>
                            <Select
                                value={activeGroupId ? String(activeGroupId) : ''}
                                onValueChange={(v) => setActiveGroupId(Number(v))}
                            >
                                <SelectTrigger className="w-64">
                                    <SelectValue placeholder="Verbund wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {allowedGroups.map((g) => (
                                        <SelectItem key={g.id} value={String(g.id)}>
                                            {g.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-slate-700">Ab:</label>
                            <input
                                type="date"
                                value={windowStart}
                                onChange={(e) => setWindowStart(e.target.value)}
                                className="px-2 py-1 border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                workplacesQuery.refetch();
                                scheduleQuery.refetch();
                            }}
                        >
                            Aktualisieren
                        </Button>
                    </div>

                    {scheduleQuery.error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Fehler beim Laden</AlertTitle>
                            <AlertDescription>{scheduleQuery.error.message}</AlertDescription>
                        </Alert>
                    )}

                    {isLoadingData ? (
                        <div className="flex items-center justify-center h-48">
                            <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
                        </div>
                    ) : workplaces.length === 0 ? (
                        <div className="text-sm text-slate-500 py-8 text-center">
                            Keine gemeinsamen Arbeitsplätze konfiguriert.
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-slate-200 rounded">
                            <table className="min-w-full text-xs">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-semibold text-slate-700 sticky left-0 bg-slate-50 z-10 border-r">
                                            Arbeitsplatz
                                        </th>
                                        {dateRange.map((d) => (
                                            <th key={d} className="px-2 py-2 text-center font-medium text-slate-700 whitespace-nowrap">
                                                {d.slice(5)}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {workplaces.map((wp) => (
                                        <tr key={wp.id} className="border-t border-slate-100">
                                            <td className="px-3 py-2 font-medium text-slate-800 sticky left-0 bg-white border-r whitespace-nowrap">
                                                {wp.name}
                                            </td>
                                            {dateRange.map((d) => {
                                                const shifts = shiftIndex.get(`${wp.id}|${d}`) || [];
                                                return (
                                                    <td key={d} className="px-1 py-1 align-top text-center">
                                                        {shifts.length === 0 ? (
                                                            <span className="text-slate-300">—</span>
                                                        ) : (
                                                            <div className="flex flex-col gap-1">
                                                                {shifts.map((s) => (
                                                                    <span
                                                                        key={s.id}
                                                                        className="inline-block px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px]"
                                                                        title={`Tenant ${s.billing_tenant_id || '?'}`}
                                                                    >
                                                                        {employeeNameById.get(Number(s.employee_id)) || `#${s.employee_id}`}
                                                                    </span>
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
                </CardContent>
            </Card>
        </div>
    );
}
