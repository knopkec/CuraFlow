import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, X } from 'lucide-react';

/**
 * Required qualifications editor for a shared (cross-tenant) workplace.
 * Qualifications are matched across tenants by their plain name (string).
 * Only employees whose union of qualifications across their tenants of the
 * group covers every required name are eligible for the workplace.
 */
export default function SharedWorkplaceQualificationsDialog({
    open,
    onOpenChange,
    groupId,
    workplace,
}) {
    const queryClient = useQueryClient();
    const [required, setRequired] = useState([]);
    const [draft, setDraft] = useState('');

    const enabled = !!open && !!groupId && !!workplace?.id;

    const currentQuery = useQuery({
        queryKey: ['admin', 'shared-workplace-qualifications', groupId, workplace?.id],
        queryFn: () => api.getWorkplaceQualifications(groupId, workplace.id),
        enabled,
        staleTime: 30_000,
    });

    const availableQuery = useQuery({
        queryKey: ['admin', 'group-qualifications', groupId],
        queryFn: () => api.getGroupQualifications(groupId),
        enabled,
        staleTime: 60_000,
    });

    useEffect(() => {
        if (currentQuery.data?.qualifications) {
            setRequired(
                currentQuery.data.qualifications
                    .filter((q) => !q.is_excluded)
                    .map((q) => q.qualification_name)
            );
        }
    }, [currentQuery.data]);

    const availableSuggestions = useMemo(() => {
        const all = availableQuery.data?.qualifications || [];
        const sel = new Set(required);
        return all.filter((name) => !sel.has(name));
    }, [availableQuery.data, required]);

    const saveMutation = useMutation({
        mutationFn: () =>
            api.replaceWorkplaceQualifications(
                groupId,
                workplace.id,
                required.map((name) => ({ qualification_name: name, is_excluded: false }))
            ),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'shared-workplace-qualifications', groupId, workplace?.id] });
            toast.success('Qualifikationen gespeichert');
            onOpenChange(false);
        },
        onError: (error) => toast.error(error.message || 'Speichern fehlgeschlagen'),
    });

    const addQualification = (name) => {
        const trimmed = String(name || '').trim();
        if (!trimmed) return;
        setRequired((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
        setDraft('');
    };

    const removeQualification = (name) => {
        setRequired((current) => current.filter((entry) => entry !== name));
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Pflicht-Qualifikationen</DialogTitle>
                    <DialogDescription>
                        {workplace?.name
                            ? `Dienst: ${workplace.name}`
                            : 'Wählen Sie die Qualifikationen, die ein Mitarbeiter mindestens besitzen muss, um diesen Dienst zu übernehmen.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {currentQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Lade Qualifikationen …
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-slate-700">
                                    Aktuell erforderlich ({required.length})
                                </div>
                                {required.length === 0 ? (
                                    <div className="rounded-md border border-dashed p-3 text-xs text-slate-500">
                                        Keine Pflicht-Qualifikation gesetzt. Alle Pool-Mitarbeiter sind berechtigt.
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {required.map((name) => (
                                            <Badge key={name} variant="secondary" className="gap-1 pr-1">
                                                {name}
                                                <button
                                                    type="button"
                                                    className="rounded-full p-0.5 hover:bg-slate-300/60"
                                                    onClick={() => removeQualification(name)}
                                                    aria-label={`${name} entfernen`}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium text-slate-700">Hinzufügen</div>
                                <div className="flex gap-2">
                                    <Input
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        placeholder="Qualifikationsname"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                addQualification(draft);
                                            }
                                        }}
                                    />
                                    <Button type="button" variant="outline" onClick={() => addQualification(draft)}>
                                        <Plus className="mr-1 h-3.5 w-3.5" /> Hinzufügen
                                    </Button>
                                </div>
                                {availableQuery.isLoading ? (
                                    <div className="text-xs text-slate-500">Lade Vorschläge …</div>
                                ) : availableSuggestions.length > 0 ? (
                                    <div className="space-y-1">
                                        <div className="text-[11px] uppercase tracking-wide text-slate-400">
                                            Verfügbar in den Mandanten dieses Verbunds
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {availableSuggestions.map((name) => (
                                                <button
                                                    key={name}
                                                    type="button"
                                                    onClick={() => addQualification(name)}
                                                    className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs hover:bg-slate-50"
                                                >
                                                    {name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Abbrechen
                    </Button>
                    <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                        {saveMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                        Speichern
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
