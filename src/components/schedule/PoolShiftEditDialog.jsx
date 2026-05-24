import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2, Trash2, AlertCircle } from 'lucide-react';
import { api } from '@/api/client';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Edit (or create) a single pool shift entry.
 *
 * Props:
 *   open: boolean
 *   onOpenChange(open)
 *   workplace: { id, name, group_id, canWrite }
 *   date: 'YYYY-MM-DD'
 *   shift: existing shift entry (with id, employee_id, billing_tenant_id) or null
 *   activeTenantId: string  — db_tokens.id of the current x-db-token
 */
export default function PoolShiftEditDialog({
    open,
    onOpenChange,
    workplace,
    date,
    shift,
    activeTenantId,
}) {
    const queryClient = useQueryClient();
    const isEdit = !!shift;
    const groupId = workplace?.group_id;

    const [employeeId, setEmployeeId] = useState('');
    const [billingTenantId, setBillingTenantId] = useState('');
    const [forceOverride, setForceOverride] = useState(false);
    const [violations, setViolations] = useState([]);

    // Reset form when dialog opens or target changes
    useEffect(() => {
        if (!open) return;
        setEmployeeId(shift?.employee_id || '');
        setBillingTenantId(shift?.billing_tenant_id || activeTenantId || '');
        setForceOverride(false);
        setViolations([]);
    }, [open, shift, activeTenantId]);

    const staffQuery = useQuery({
        queryKey: ['pool', 'group-staff', groupId],
        queryFn: () => api.getGroupStaff(groupId),
        enabled: !!open && !!groupId,
        staleTime: 60_000,
    });

    const staff = staffQuery.data?.staff || [];

    // Distinct list of tenant ids the chosen employee is assigned to.
    // We let the admin pick which tenant gets billed for the shift.
    const billingOptions = useMemo(() => {
        const emp = staff.find((s) => s.id === employeeId);
        const ids = emp?.tenant_ids || [];
        if (ids.length === 0 && activeTenantId) return [activeTenantId];
        return ids;
    }, [staff, employeeId, activeTenantId]);

    useEffect(() => {
        // Auto-pick first valid billing option when employee changes
        if (billingOptions.length === 0) return;
        if (!billingOptions.includes(billingTenantId)) {
            setBillingTenantId(billingOptions[0]);
        }
    }, [billingOptions, billingTenantId]);

    const invalidateVisibleShifts = () => {
        queryClient.invalidateQueries({ queryKey: ['pool', 'visible-shifts'] });
    };

    const saveMutation = useMutation({
        mutationFn: async () => {
            const payload = {
                shared_workplace_id: workplace.id,
                date,
                employee_id: employeeId,
                billing_tenant_id: billingTenantId,
            };
            if (isEdit) {
                return api.updateGroupShift(groupId, shift.id, payload, { force: forceOverride });
            }
            return api.createGroupShift(groupId, payload, { force: forceOverride });
        },
        onSuccess: () => {
            invalidateVisibleShifts();
            onOpenChange(false);
        },
        onError: (err) => {
            // The constraints validator returns { error: 'constraint_violation', details: [...] }
            const details = err?.details;
            if (details?.error === 'constraint_violation' && Array.isArray(details.details)) {
                setViolations(details.details);
            } else {
                setViolations([{ rule: 'error', message: err.message || 'Speichern fehlgeschlagen' }]);
            }
        },
    });

    const deleteMutation = useMutation({
        mutationFn: () => api.deleteGroupShift(groupId, shift.id),
        onSuccess: () => {
            invalidateVisibleShifts();
            onOpenChange(false);
        },
    });

    const canSubmit = !!employeeId && !!billingTenantId && !saveMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? 'Pool-Dienst bearbeiten' : 'Pool-Dienst anlegen'}
                    </DialogTitle>
                    <DialogDescription>
                        {workplace?.name} ·{' '}
                        {date ? format(new Date(date), 'EEEE, d. MMMM yyyy', { locale: de }) : ''}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="pool-shift-employee">Mitarbeiter</Label>
                        {staffQuery.isLoading ? (
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Loader2 className="w-4 h-4 animate-spin" /> Lade Pool-Mitarbeiter …
                            </div>
                        ) : staff.length === 0 ? (
                            <div className="text-sm text-slate-500">
                                Keine Pool-Mitarbeiter in dieser Gruppe gefunden.
                            </div>
                        ) : (
                            <Select value={employeeId} onValueChange={setEmployeeId}>
                                <SelectTrigger id="pool-shift-employee">
                                    <SelectValue placeholder="Mitarbeiter wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {staff.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                            {[s.last_name, s.first_name].filter(Boolean).join(', ') || s.id}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {billingOptions.length > 1 && (
                        <div className="space-y-1.5">
                            <Label htmlFor="pool-shift-billing">Abrechnender Mandant</Label>
                            <Select value={billingTenantId} onValueChange={setBillingTenantId}>
                                <SelectTrigger id="pool-shift-billing">
                                    <SelectValue placeholder="Mandant wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {billingOptions.map((tid) => (
                                        <SelectItem key={tid} value={tid}>
                                            {tid === activeTenantId ? `${tid} (aktiv)` : tid}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {violations.length > 0 && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                <div className="font-medium mb-1">Constraint-Verstoß:</div>
                                <ul className="list-disc list-inside text-xs">
                                    {violations.map((v, i) => (
                                        <li key={i}>{v.message}</li>
                                    ))}
                                </ul>
                                <div className="mt-2">
                                    <label className="text-xs flex items-center gap-1.5 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={forceOverride}
                                            onChange={(e) => setForceOverride(e.target.checked)}
                                        />
                                        Trotzdem speichern (Override)
                                    </label>
                                </div>
                            </AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    {isEdit && (
                        <Button
                            type="button"
                            variant="outline"
                            className="text-rose-700 border-rose-200 hover:bg-rose-50 mr-auto"
                            onClick={() => deleteMutation.mutate()}
                            disabled={deleteMutation.isPending}
                        >
                            <Trash2 className="w-4 h-4 mr-1.5" />
                            {deleteMutation.isPending ? 'Lösche …' : 'Löschen'}
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Abbrechen
                    </Button>
                    <Button
                        onClick={() => saveMutation.mutate()}
                        disabled={!canSubmit}
                    >
                        {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                        Speichern
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
