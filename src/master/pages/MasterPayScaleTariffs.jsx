import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  Scale, Plus, Pencil, Trash2, Loader2, Clock, Sun, ChevronDown, ChevronRight, Check,
  Layers, AlertTriangle,
} from 'lucide-react';

const EMPTY_TARIFF = {
  name: '', short_name: '', default_weekly_hours: '', default_vacation_days: '', description: '',
};

export default function MasterPayScaleTariffs() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTariff, setEditingTariff] = useState(null);
  const [form, setForm] = useState(EMPTY_TARIFF);
  const [expandedTariff, setExpandedTariff] = useState(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupForm, setGroupForm] = useState({ name: '', description: '' });
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyTariffId, setApplyTariffId] = useState(null);
  const [applyPreview, setApplyPreview] = useState(null);

  const { data: tariffs = [], isLoading } = useQuery({
    queryKey: ['master-payscale-tariffs'],
    queryFn: async () => {
      const res = await api.request('/api/master/payscale-tariffs');
      return res.tariffs || [];
    },
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['master-payscale-groups', expandedTariff],
    queryFn: async () => {
      if (!expandedTariff) return [];
      const res = await api.request(`/api/master/payscale-tariffs/${expandedTariff}/groups`);
      return res.groups || [];
    },
    enabled: !!expandedTariff,
  });

  // Tariff save mutation
  const saveTariffMutation = useMutation({
    mutationFn: (data) => {
      if (editingTariff) {
        return api.request(`/api/master/payscale-tariffs/${editingTariff.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
      }
      return api.request('/api/master/payscale-tariffs', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-payscale-tariffs'] });
      closeDialog();
      toast({ title: 'Gespeichert', description: editingTariff ? 'Tarifvertrag aktualisiert.' : 'Neuer Tarifvertrag erstellt.' });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Speichern fehlgeschlagen.', variant: 'destructive' });
    },
  });

  // Tariff delete mutation
  const deleteTariffMutation = useMutation({
    mutationFn: (id) => api.request(`/api/master/payscale-tariffs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-payscale-tariffs'] });
      toast({ title: 'Gelöscht', description: 'Tarifvertrag wurde entfernt.' });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Löschen fehlgeschlagen.', variant: 'destructive' });
    },
  });

  // Group save mutation
  const saveGroupMutation = useMutation({
    mutationFn: (data) => {
      if (editingGroup) {
        return api.request(`/api/master/payscale-tariffs/${expandedTariff}/groups/${editingGroup.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
      }
      return api.request(`/api/master/payscale-tariffs/${expandedTariff}/groups`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-payscale-groups', expandedTariff] });
      closeGroupDialog();
      toast({ title: 'Gespeichert', description: editingGroup ? 'Entgeltgruppe aktualisiert.' : 'Neue Entgeltgruppe erstellt.' });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Speichern fehlgeschlagen.', variant: 'destructive' });
    },
  });

  // Group delete mutation
  const deleteGroupMutation = useMutation({
    mutationFn: (groupId) => api.request(`/api/master/payscale-tariffs/${expandedTariff}/groups/${groupId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-payscale-groups', expandedTariff] });
      toast({ title: 'Gelöscht', description: 'Entgeltgruppe wurde entfernt.' });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Löschen fehlgeschlagen.', variant: 'destructive' });
    },
  });

  // Apply defaults mutation
  const applyDefaultsMutation = useMutation({
    mutationFn: (tariffId) => api.request(`/api/master/payscale-tariffs/${tariffId}/apply-defaults`, {
      method: 'POST',
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['master-payscale-tariffs'] });
      setApplyDialogOpen(false);
      setApplyTariffId(null);
      setApplyPreview(null);
      toast({
        title: 'Default-Werte angewandt',
        description: `${result.updated} Mitarbeiter aktualisiert, ${result.skipped} mit individuellen Werten übersprungen.`,
      });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Anwenden fehlgeschlagen.', variant: 'destructive' });
    },
  });

  // --- Tariff dialog handlers ---

  const openCreate = () => {
    setEditingTariff(null);
    setForm(EMPTY_TARIFF);
    setDialogOpen(true);
  };

  const openEdit = (tariff) => {
    setEditingTariff(tariff);
    setForm({
      name: tariff.name || '',
      short_name: tariff.short_name || '',
      default_weekly_hours: tariff.default_weekly_hours ?? '',
      default_vacation_days: tariff.default_vacation_days ?? '',
      description: tariff.description || '',
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingTariff(null);
    setForm(EMPTY_TARIFF);
  };

  const handleSaveTariff = () => {
    if (!form.name.trim() || !form.short_name.trim()) {
      toast({ title: 'Pflichtfeld', description: 'Name und Kurzname sind erforderlich.', variant: 'destructive' });
      return;
    }
    saveTariffMutation.mutate({
      ...form,
      default_weekly_hours: form.default_weekly_hours !== '' ? parseFloat(form.default_weekly_hours) : null,
      default_vacation_days: form.default_vacation_days !== '' ? parseInt(form.default_vacation_days, 10) : null,
    });
  };

  // --- Group dialog handlers ---

  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupForm({ name: '', description: '' });
    setGroupDialogOpen(true);
  };

  const openEditGroup = (group) => {
    setEditingGroup(group);
    setGroupForm({ name: group.name || '', description: group.description || '' });
    setGroupDialogOpen(true);
  };

  const closeGroupDialog = () => {
    setGroupDialogOpen(false);
    setEditingGroup(null);
    setGroupForm({ name: '', description: '' });
  };

  const handleSaveGroup = () => {
    if (!groupForm.name.trim()) {
      toast({ title: 'Pflichtfeld', description: 'Name der Entgeltgruppe ist erforderlich.', variant: 'destructive' });
      return;
    }
    saveGroupMutation.mutate({ ...groupForm });
  };

  // --- Apply defaults handlers ---

  const openApplyDialog = async (tariff) => {
    setApplyTariffId(tariff.id);
    try {
      const res = await api.request(`/api/master/payscale-tariffs/${tariff.id}/apply-defaults`, {
        method: 'POST',
        body: JSON.stringify({ preview: true }),
      });
      // Preview not implemented server-side; show info based on tariff defaults
      setApplyPreview({
        tariffName: tariff.name,
        hours: tariff.default_weekly_hours,
        days: tariff.default_vacation_days,
      });
    } catch {
      setApplyPreview({
        tariffName: tariff.name,
        hours: tariff.default_weekly_hours,
        days: tariff.default_vacation_days,
      });
    }
    setApplyDialogOpen(true);
  };

  const handleApplyDefaults = () => {
    if (applyTariffId) {
      applyDefaultsMutation.mutate(applyTariffId);
    }
  };

  // --- Utilities ---

  const toggleExpand = (tariffId) => {
    setExpandedTariff(expandedTariff === tariffId ? null : tariffId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tarifverträge</h1>
          <p className="text-slate-500 mt-1">
            Verwalten Sie Tarifverträge, Entgeltgruppen und deren Standard-Arbeitszeiten
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4 mr-2" />
          Neuer Tarifvertrag
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="w-5 h-5" />
            Definierte Tarifverträge
          </CardTitle>
          <CardDescription>
            Tarifverträge legen Standard-Wochenstunden und Urlaubsanspruch fest. Änderungen können auf alle
            zugeordneten Mitarbeiter angewandt werden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Wird geladen…
            </div>
          ) : tariffs.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Scale className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Keine Tarifverträge vorhanden</p>
              <p className="text-sm mt-1">Erstellen Sie einen ersten Tarifvertrag.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>Kürzel</TableHead>
                  <TableHead className="text-right">Std./Woche</TableHead>
                  <TableHead className="text-right">Urlaubstage</TableHead>
                  <TableHead className="text-center">Gruppen</TableHead>
                  <TableHead>Aktiv</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tariffs.map((t) => (
                  <>
                    <TableRow key={t.id} className="cursor-pointer hover:bg-slate-50"
                      onClick={() => toggleExpand(t.id)}>
                      <TableCell>
                        <button className="p-1 hover:bg-slate-200 rounded">
                          {expandedTariff === t.id
                            ? <ChevronDown className="w-4 h-4 text-slate-400" />
                            : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">{t.short_name}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {t.default_weekly_hours != null ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {t.default_weekly_hours}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-sm">–</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.default_vacation_days != null ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Sun className="w-3.5 h-3.5 text-slate-400" />
                            {t.default_vacation_days}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-sm">–</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm font-medium">{t.group_count ?? 0}</span>
                      </TableCell>
                      <TableCell>
                        {t.is_active ? (
                          <Badge variant="default" className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                            <Check className="w-3 h-3 mr-0.5" /> Aktiv
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">Inaktiv</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => openEdit(t)}
                            title="Bearbeiten">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {t.default_weekly_hours != null && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600 hover:text-amber-800"
                              onClick={() => openApplyDialog(t)}
                              title="Default-Werte auf Mitarbeiter anwenden">
                              <Layers className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700"
                            onClick={() => {
                              if (window.confirm(`"${t.name}" endgültig löschen?`)) {
                                deleteTariffMutation.mutate(t.id);
                              }
                            }}
                            disabled={deleteTariffMutation.isPending}
                            title="Löschen">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedTariff === t.id && (
                      <TableRow key={`${t.id}-groups`}>
                        <TableCell colSpan={8} className="bg-slate-50 p-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Layers className="w-4 h-4" />
                                Entgeltgruppen ({groups.length})
                              </h4>
                              <Button variant="outline" size="sm" className="h-7 text-xs"
                                onClick={openCreateGroup}>
                                <Plus className="w-3 h-3 mr-1" /> Gruppe
                              </Button>
                            </div>
                            {groups.length === 0 ? (
                              <p className="text-sm text-slate-400 py-2">
                                Keine Entgeltgruppen definiert.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {groups.map((g) => (
                                  <div key={g.id}
                                    className="flex items-center gap-2 bg-white border rounded-md px-3 py-1.5 text-sm group">
                                    <span className="font-medium text-slate-800">{g.name}</span>
                                    {g.description && (
                                      <span className="text-slate-400 text-xs hidden group-hover:inline">
                                        {g.description}
                                      </span>
                                    )}
                                    <button className="text-slate-300 hover:text-indigo-600 ml-1"
                                      onClick={() => openEditGroup(g)}
                                      title="Bearbeiten">
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button className="text-slate-300 hover:text-red-500"
                                      onClick={() => {
                                        if (window.confirm(`Entgeltgruppe "${g.name}" löschen?`)) {
                                          deleteGroupMutation.mutate(g.id);
                                        }
                                      }}
                                      title="Löschen">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Tarif erstellen / bearbeiten Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTariff ? 'Tarifvertrag bearbeiten' : 'Neuen Tarifvertrag'}</DialogTitle>
            <DialogDescription>
              {editingTariff ? 'Aktualisieren Sie die Tarifdaten.' : 'Definieren Sie einen neuen Tarifvertrag.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm">Name *</Label>
                <Input value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="z.B. TV-Ärzte" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">Kurzname *</Label>
                <Input value={form.short_name}
                  onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                  placeholder="z.B. TV-Ärzte" className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm">Standard Wochenstunden</Label>
                <Input type="number" step="0.5" min="0" max="60"
                  value={form.default_weekly_hours}
                  onChange={(e) => setForm({ ...form, default_weekly_hours: e.target.value })}
                  placeholder="z.B. 38,5" className="mt-1" />
                <p className="text-xs text-slate-400 mt-1">Leer lassen bei AT (individuell)</p>
              </div>
              <div>
                <Label className="text-sm">Standard Urlaubstage</Label>
                <Input type="number" step="1" min="0" max="40"
                  value={form.default_vacation_days}
                  onChange={(e) => setForm({ ...form, default_vacation_days: e.target.value })}
                  placeholder="z.B. 30" className="mt-1" />
                <p className="text-xs text-slate-400 mt-1">Leer lassen bei AT (individuell)</p>
              </div>
            </div>
            <div>
              <Label className="text-sm">Beschreibung</Label>
              <Input value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optionale Beschreibung…" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Abbrechen</Button>
            <Button onClick={handleSaveTariff} disabled={saveTariffMutation.isPending}>
              {saveTariffMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editingTariff ? 'Aktualisieren' : 'Erstellen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Entgeltgruppe erstellen / bearbeiten Dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Entgeltgruppe bearbeiten' : 'Neue Entgeltgruppe'}</DialogTitle>
            <DialogDescription>
              {editingGroup ? 'Aktualisieren Sie die Gruppendaten.' : 'Fügen Sie eine neue Entgeltgruppe hinzu.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm">Name *</Label>
              <Input value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                placeholder="z.B. Ä1, E5, P8" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Beschreibung</Label>
              <Input value={groupForm.description}
                onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                placeholder="Optionale Beschreibung…" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeGroupDialog}>Abbrechen</Button>
            <Button onClick={handleSaveGroup} disabled={saveGroupMutation.isPending}>
              {saveGroupMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editingGroup ? 'Aktualisieren' : 'Hinzufügen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Defaults Bestätigungsdialog */}
      <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-amber-500" />
              Default-Werte anwenden
            </DialogTitle>
            <DialogDescription>
              {applyPreview ? (
                <div className="space-y-3 pt-2">
                  <p>
                    Für <strong>{applyPreview.tariffName}</strong> werden folgende Standard-Werte auf alle
                    zugeordneten Mitarbeiter angewandt:
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-amber-600" />
                      <span><strong>Wochenstunden:</strong> {applyPreview.hours ?? '–'}h</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Sun className="w-4 h-4 text-amber-600" />
                      <span><strong>Urlaubstage:</strong> {applyPreview.days ?? '–'} Tage</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600 bg-slate-50 rounded-md p-3">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <span>
                      Nur Mitarbeiter mit den System-Standardwerten (38,5h / 30 Tage) werden aktualisiert.
                      Mitarbeiter mit individuellen Anpassungen bleiben unverändert.
                    </span>
                  </div>
                </div>
              ) : (
                <p>Daten werden geladen…</p>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApplyDialogOpen(false); setApplyTariffId(null); }}>
              Abbrechen
            </Button>
            <Button onClick={handleApplyDefaults}
              disabled={applyDefaultsMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700">
              {applyDefaultsMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Defaults anwenden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}