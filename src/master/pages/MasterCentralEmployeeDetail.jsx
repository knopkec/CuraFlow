import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import {
  ArrowLeft, Building2, User, FileText, Clock, CalendarDays, Sun,
  TrendingUp, TrendingDown, Minus, Save, Pencil, AlertCircle,
  Briefcase, Hash, Mail, Phone, MapPin,
  Loader2, UserCheck, UserX, Link2, RefreshCw, Trash2,
  Download, Eye, Award, CalendarCheck, CalendarX2, Heart, UserPlus,
} from 'lucide-react';

export default function MasterCentralEmployeeDetail() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({});

  // Zentrale Mitarbeiterdaten laden
  const { data: employee, isLoading } = useQuery({
    queryKey: ['master-central-employee', employeeId],
    queryFn: () => api.request(`/api/master/employees/${employeeId}`),
  });

  // Arbeitszeitmodelle laden
  const { data: models = [] } = useQuery({
    queryKey: ['master-work-time-models'],
    queryFn: async () => {
      const res = await api.request('/api/master/work-time-models');
      return res.models || [];
    },
  });

  // Form initialisieren wenn Employee geladen
  useEffect(() => {
    if (employee) {
      setForm({
        last_name: employee.last_name || '',
        first_name: employee.first_name || '',
        former_name: employee.former_name || '',
        payroll_id: employee.payroll_id || '',
        date_of_birth: employee.date_of_birth || '',
        email: employee.email || '',
        phone: employee.phone || '',
        address: employee.address || '',
        contract_type: employee.contract_type || '',
        contract_start: employee.contract_start || '',
        contract_end: employee.contract_end || '',
        probation_end: employee.probation_end || '',
        target_hours_per_week: employee.target_hours_per_week ?? '',
        vacation_days_annual: employee.vacation_days_annual ?? '',
        work_time_model_id: employee.work_time_model_id || '',
        is_active: employee.is_active ?? true,
        exit_date: employee.exit_date || '',
        exit_reason: employee.exit_reason || '',
        notes: employee.notes || '',
      });
    }
  }, [employee]);

  // Speichern
  const saveMutation = useMutation({
    mutationFn: (data) => api.request(`/api/master/employees/${employeeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-central-employee', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['master-central-employees'] });
      setEditMode(false);
      toast({ title: 'Gespeichert', description: 'Mitarbeiterdaten wurden aktualisiert.' });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Speichern fehlgeschlagen.', variant: 'destructive' });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(form);
  };

  const syncTimeAccountsMutation = useMutation({
    mutationFn: () => api.request(`/api/master/employees/${employeeId}/sync-time-accounts`, {
      method: 'POST',
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['master-central-employee', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['master-central-employees'] });
      toast({
        title: 'Zeitkonto aktualisiert',
        description: result?.synced === false
          ? 'Für diesen Mitarbeiter gibt es keine verknüpften Tenant-Zuordnungen.'
          : 'Die Zeitkontodaten wurden neu berechnet.',
      });
    },
    onError: (err) => {
      toast({
        title: 'Fehler',
        description: err.message || 'Zeitkonto konnte nicht neu berechnet werden.',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.request(`/api/master/employees/${employeeId}`, {
      method: 'DELETE',
    }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['master-central-employees'] });
      await queryClient.removeQueries({ queryKey: ['master-central-employee', employeeId] });
      toast({
        title: 'Gelöscht',
        description: result?.message || 'Mitarbeiter wurde permanent gelöscht.',
      });
      navigate('/mitarbeiter');
    },
    onError: (err) => {
      toast({
        title: 'Fehler',
        description: err.message || 'Mitarbeiter konnte nicht gelöscht werden.',
        variant: 'destructive',
      });
    },
  });

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleDelete = () => {
    if (employee?.is_active) {
      toast({
        title: 'Löschen nicht möglich',
        description: 'Bitte den Mitarbeiter zuerst deaktivieren und speichern.',
        variant: 'destructive',
      });
      return;
    }

    if (!window.confirm(`"${displayName}" endgültig löschen?\n\nDies entfernt den Eintrag aus der zentralen Verwaltung und löst alle Mandanten-Verknüpfungen.`)) {
      return;
    }

    deleteMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-3" />
        Mitarbeiterdaten werden geladen…
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="text-center py-24">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Mitarbeiter nicht gefunden</h2>
        <p className="text-sm text-slate-500 mt-1">Die angeforderten Daten konnten nicht geladen werden.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/mitarbeiter')}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Zurück zur Übersicht
        </Button>
      </div>
    );
  }

  const displayName = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Unbekannt';
  const currentModel = models.find((m) => m.id === (form.work_time_model_id || employee.work_time_model_id));
  const hasLinkedAssignments = (employee.assignments || []).some((assignment) => assignment.tenant_id && assignment.tenant_doctor_id);

  return (
    <div className="space-y-6">
      {/* Navigation zurück */}
      <Button variant="ghost" size="sm" onClick={() => navigate('/mitarbeiter')}>
        <ArrowLeft className="w-4 h-4 mr-2" /> Mitarbeiterübersicht
      </Button>

      {/* Kopfzeile */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-indigo-100 flex items-center justify-center">
            <User className="w-7 h-7 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{displayName}</h1>
            <div className="flex items-center gap-2 mt-1">
              {employee.former_name && (
                <span className="text-xs text-slate-400">geb. {employee.former_name}</span>
              )}
              <Badge variant={employee.is_active ? 'default' : 'secondary'} className="text-xs">
                {employee.is_active ? 'Aktiv' : 'Inaktiv'}
              </Badge>
              {employee.contract_type && (
                <Badge variant="secondary" className="text-xs capitalize">
                  <Briefcase className="w-3 h-3 mr-1" />
                  {employee.contract_type}
                </Badge>
              )}
              {currentModel && (
                <Badge variant="outline" className="text-xs">
                  <Clock className="w-3 h-3 mr-1" />
                  {currentModel.name}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={employee.is_active ? 'outline' : 'destructive'}
            size="sm"
            disabled={deleteMutation.isPending || employee.is_active}
            title={employee.is_active ? 'Zum Löschen zuerst deaktivieren und speichern.' : 'Mitarbeiter endgültig löschen'}
            onClick={handleDelete}
          >
            {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Löschen
          </Button>
          {editMode ? (
            <>
              <Button variant="outline" size="sm" onClick={() => { setEditMode(false); setForm({...form}); }}>
                Abbrechen
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Speichern
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>
              <Pencil className="w-4 h-4 mr-2" /> Bearbeiten
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="stammdaten" className="w-full">
        <TabsList className="grid w-full grid-cols-7 lg:w-auto lg:inline-grid">
          <TabsTrigger value="stammdaten" className="flex items-center gap-2">
            <User className="w-4 h-4" /> Stammdaten
          </TabsTrigger>
          <TabsTrigger value="vertrag" className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Vertrag
          </TabsTrigger>
          <TabsTrigger value="urlaub" className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4" /> Urlaub
          </TabsTrigger>
          <TabsTrigger value="mandanten" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Mandanten
          </TabsTrigger>
          <TabsTrigger value="zeitkonto" className="flex items-center gap-2">
            <Clock className="w-4 h-4" /> Zeitkonto
          </TabsTrigger>
          <TabsTrigger value="zertifikate" className="flex items-center gap-2">
            <Award className="w-4 h-4" /> Zertifikate
          </TabsTrigger>
          <TabsTrigger value="beziehungen" className="flex items-center gap-2">
            <Heart className="w-4 h-4" /> Beziehungen
          </TabsTrigger>
        </TabsList>

        {/* Tab: Stammdaten */}
        <TabsContent value="stammdaten" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Persönliche Daten</CardTitle>
              <CardDescription>Grundlegende Informationen zum Mitarbeiter</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FieldRow label="Nachname *" icon={User} value={form.last_name} editMode={editMode}
                  onChange={(v) => updateField('last_name', v)} />
                <FieldRow label="Vorname" icon={User} value={form.first_name} editMode={editMode}
                  onChange={(v) => updateField('first_name', v)} />
                <FieldRow label="Geburtsname" icon={User} value={form.former_name} editMode={editMode}
                  onChange={(v) => updateField('former_name', v)} />
              </div>
              <Separator />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldRow label="Personalnummer" icon={Hash} value={form.payroll_id} editMode={editMode}
                  onChange={(v) => updateField('payroll_id', v)} />
                <FieldRow label="Geburtsdatum" icon={CalendarDays} value={form.date_of_birth} editMode={editMode}
                  type="date" onChange={(v) => updateField('date_of_birth', v)} />
              </div>
              <Separator />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldRow label="E-Mail" icon={Mail} value={form.email} editMode={editMode}
                  type="email" onChange={(v) => updateField('email', v)} />
                <FieldRow label="Telefon" icon={Phone} value={form.phone} editMode={editMode}
                  onChange={(v) => updateField('phone', v)} />
              </div>
              <div>
                <FieldRow label="Adresse" icon={MapPin} value={form.address} editMode={editMode}
                  onChange={(v) => updateField('address', v)} />
              </div>
              {editMode && (
                <>
                  <Separator />
                  <div className="flex items-center gap-3">
                    <Switch checked={form.is_active} onCheckedChange={(v) => updateField('is_active', v)} />
                    <Label>Mitarbeiter aktiv</Label>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Vertrag */}
        <TabsContent value="vertrag" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Vertragsdaten</CardTitle>
              <CardDescription>Arbeitsvertrag, Arbeitszeitmodell und Urlaubsanspruch</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Vertragsart</Label>
                  {editMode ? (
                    <Select value={form.contract_type} onValueChange={(v) => updateField('contract_type', v)}>
                      <SelectTrigger><SelectValue placeholder="Wählen…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unbefristet">Unbefristet</SelectItem>
                        <SelectItem value="befristet">Befristet</SelectItem>
                        <SelectItem value="teilzeit">Teilzeit</SelectItem>
                        <SelectItem value="minijob">Minijob</SelectItem>
                        <SelectItem value="werkstudent">Werkstudent</SelectItem>
                        <SelectItem value="praktikum">Praktikum</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm capitalize">{form.contract_type || '–'}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Arbeitszeitmodell</Label>
                  {editMode ? (
                    <Select value={form.work_time_model_id || '__none__'} onValueChange={(v) => updateField('work_time_model_id', v === '__none__' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="Modell wählen…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Kein Modell</SelectItem>
                        {models.map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>
                            {m.name} ({m.hours_per_week}h/W)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm">{currentModel ? `${currentModel.name} (${currentModel.hours_per_week}h/W)` : '–'}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FieldRow label="Vertragsbeginn" icon={CalendarDays} value={form.contract_start}
                  editMode={editMode} type="date" onChange={(v) => updateField('contract_start', v)} />
                <FieldRow label="Vertragsende" icon={CalendarDays} value={form.contract_end}
                  editMode={editMode} type="date" onChange={(v) => updateField('contract_end', v)} />
                <FieldRow label="Probezeit bis" icon={CalendarDays} value={form.probation_end}
                  editMode={editMode} type="date" onChange={(v) => updateField('probation_end', v)} />
              </div>
              <Separator />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldRow label="Wochenstunden (Soll)" icon={Clock}
                  value={form.target_hours_per_week} editMode={editMode} type="number"
                  onChange={(v) => updateField('target_hours_per_week', v)} />
                <FieldRow label="Urlaubstage / Jahr" icon={CalendarDays}
                  value={form.vacation_days_annual} editMode={editMode} type="number"
                  onChange={(v) => updateField('vacation_days_annual', v)} />
              </div>
              {(form.exit_date || editMode) && (
                <>
                  <Separator />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldRow label="Austrittsdatum" icon={CalendarDays} value={form.exit_date}
                      editMode={editMode} type="date" onChange={(v) => updateField('exit_date', v)} />
                    <FieldRow label="Austrittsgrund" icon={FileText} value={form.exit_reason}
                      editMode={editMode} onChange={(v) => updateField('exit_reason', v)} />
                  </div>
                </>
              )}
              {editMode && (
                <>
                  <Separator />
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Notizen</Label>
                    <Textarea value={form.notes} onChange={(e) => updateField('notes', e.target.value)}
                      placeholder="Interne Notizen…" rows={3} />
                  </div>
                </>
              )}
              {!editMode && form.notes && (
                <>
                  <Separator />
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Notizen</Label>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{form.notes}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Urlaub & Fehlzeiten */}
        <TabsContent value="urlaub" className="mt-6 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MiniCard
              icon={Sun}
              label="Jahresanspruch"
              value={employee.vacation_days_total ?? '–'}
              suffix="Tage"
            />
            <MiniCard
              icon={CalendarCheck}
              label="Genommen"
              value={employee.vacation_days_taken ?? '–'}
              suffix="Tage"
              color="blue"
            />
            <MiniCard
              icon={CalendarDays}
              label="Geplant"
              value={employee.vacation_days_planned ?? '–'}
              suffix="Tage"
              color="amber"
            />
            <MiniCard
              icon={CalendarDays}
              label="Resturlaub"
              value={employee.remaining_vacation ?? '–'}
              suffix="Tage"
              color={
                typeof employee.remaining_vacation === 'number' && employee.remaining_vacation < 5
                  ? 'red'
                  : 'emerald'
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarX2 className="w-5 h-5" />
                Fehlzeiten-Verlauf
              </CardTitle>
              <CardDescription>
                Alle Abwesenheiten dieses Mitarbeiters im aktuellen Jahr (aggregiert über alle verknüpften Mandanten)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(employee.absences?.length ?? 0) === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <CalendarX2 className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">Keine Fehlzeiten eingetragen</p>
                </div>
              ) : (
                <ScrollArea className="h-[350px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Typ</TableHead>
                        <TableHead>Datum</TableHead>
                        <TableHead>Mandant</TableHead>
                        <TableHead>Bemerkung</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(employee.absences ?? []).map((abs, i) => (
                        <TableRow key={`${abs.tenant_id ?? 'x'}__${abs.from}__${abs.type}__${i}`}>
                          <TableCell>
                            <AbsenceTypeBadge type={abs.type} />
                          </TableCell>
                          <TableCell className="text-sm">{abs.from}</TableCell>
                          <TableCell>
                            {abs.tenant_name ? (
                              <Badge variant="outline" className="text-xs">
                                <Building2 className="w-3 h-3 mr-1" />
                                {abs.tenant_name}
                              </Badge>
                            ) : (
                              <span className="text-xs text-slate-400">–</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-slate-500 max-w-[260px] truncate">
                            {abs.note || '–'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Mandanten */}
        <TabsContent value="mandanten" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Mandantenzuordnungen
              </CardTitle>
              <CardDescription>
                In welchen Mandanten (Abteilungen) ist dieser Mitarbeiter eingesetzt
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(employee.assignments || []).length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Link2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">Noch keine Mandantenzuordnung</p>
                  <p className="text-sm mt-1">Verknüpfen Sie diesen Mitarbeiter mit einem Mandanten über die Mitarbeiterliste des Mandanten.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mandant</TableHead>
                      <TableHead>Lokale ID</TableHead>
                      <TableHead>Zugewiesen seit</TableHead>
                      <TableHead>FTE-Anteil</TableHead>
                      <TableHead>Primär</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employee.assignments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            <Building2 className="w-3 h-3 mr-1" />
                            {a.tenant_name || a.tenant_id}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-slate-500 font-mono">
                          {a.tenant_doctor_id || '–'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {a.assigned_since ? new Date(a.assigned_since).toLocaleDateString('de-DE') : '–'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {a.fte_share != null ? `${Math.round(a.fte_share * 100)}%` : '100%'}
                        </TableCell>
                        <TableCell>
                          {a.is_primary ? (
                            <UserCheck className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <UserX className="w-4 h-4 text-slate-300" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Zeitkonto */}
        <TabsContent value="zeitkonto" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Zeitkonto
                  </CardTitle>
                  <CardDescription>Monatliche Soll/Ist-Stunden und Saldo-Übersicht</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncTimeAccountsMutation.mutate()}
                  disabled={!hasLinkedAssignments || syncTimeAccountsMutation.isPending}
                >
                  {syncTimeAccountsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Jetzt neu berechnen
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!hasLinkedAssignments && (
                <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Keine verknüpften Tenant-Mitarbeiter vorhanden. Das Zeitkonto kann erst nach einer Verknüpfung berechnet werden.
                </div>
              )}
              {(employee.timeAccounts || []).length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Clock className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">Noch keine Zeitkonto-Einträge</p>
                  <p className="text-sm mt-1">Sobald Schichten geplant werden, entstehen hier automatisch die Zeitkonto-Einträge.</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Monat</TableHead>
                        <TableHead className="text-right">Soll (h)</TableHead>
                        <TableHead className="text-right">Ist (h)</TableHead>
                        <TableHead className="text-right">Saldo (h)</TableHead>
                        <TableHead className="text-right">Übertrag (h)</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employee.timeAccounts.map((ta) => {
                        const target = (ta.target_minutes / 60).toFixed(1);
                        const actual = (ta.actual_minutes / 60).toFixed(1);
                        const balance = (ta.balance_minutes / 60).toFixed(1);
                        const carry = (ta.carry_over_minutes / 60).toFixed(1);
                        const isPositive = ta.balance_minutes > 0;
                        const isNegative = ta.balance_minutes < 0;
                        return (
                          <TableRow key={ta.id}>
                            <TableCell className="font-medium">
                              {String(ta.month).padStart(2, '0')}/{ta.year}
                            </TableCell>
                            <TableCell className="text-right text-sm">{target}</TableCell>
                            <TableCell className="text-right text-sm">{actual}</TableCell>
                            <TableCell className="text-right text-sm">
                              <span className={`inline-flex items-center gap-1 font-medium ${isPositive ? 'text-emerald-600' : isNegative ? 'text-red-600' : 'text-slate-500'}`}>
                                {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : isNegative ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                                {isPositive ? '+' : ''}{balance}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm text-slate-500">{carry}</TableCell>
                            <TableCell>
                              <Badge variant={ta.status === 'closed' ? 'default' : ta.status === 'provisional' ? 'secondary' : 'outline'} className="text-[10px]">
                                {ta.status === 'closed' ? 'Abgeschlossen' : ta.status === 'provisional' ? 'Vorläufig' : 'Offen'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Zertifikate */}
        <TabsContent value="zertifikate" className="mt-6">
          <CertificatesTab employeeId={employeeId} />
        </TabsContent>

        {/* Tab: Beziehungen */}
        <TabsContent value="beziehungen" className="mt-6">
          <RelationshipsTab employeeId={employeeId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Zertifikate-Tab (read-only, mandantenübergreifend) ── */

function CertificatesTab({ employeeId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['master-central-employee-certificates', employeeId],
    queryFn: async () => {
      const result = await api.request(`/api/master/employees/${employeeId}/certificates`);
      return result?.certificates ?? [];
    },
  });

  const certificates = data ?? [];

  // Single fetch helper: pulls the certificate file with the JWT in the
  // Authorization header (window.open cannot set headers, so a query-string
  // token would be rejected with 401). Returns a Blob or null on error.
  const fetchCertificateBlob = async (cert) => {
    try {
      const baseURL = import.meta.env.VITE_API_URL || '';
      const token = localStorage.getItem('radioplan_jwt_token') || '';
      const response = await fetch(
        `${baseURL}/api/master/employees/${employeeId}/certificates/${cert.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.blob();
    } catch (e) {
      console.error('Zertifikats-Download fehlgeschlagen:', e);
      return null;
    }
  };

  const handleDownload = async (cert) => {
    const blob = await fetchCertificateBlob(cert);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cert.file_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handlePreview = async (cert) => {
    if (!cert.mime_type?.startsWith('image/') && cert.mime_type !== 'application/pdf') return;
    const blob = await fetchCertificateBlob(cert);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    // Object URLs stay alive until the tab closes; revoke later to free memory.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const formatSize = (bytes) => {
    if (!bytes) return '–';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (s) => {
    if (!s) return '–';
    return String(s).substring(0, 10);
  };

  const analysisBadge = (cert) => {
    const status = cert.analysis_status;
    if (!status) return null;
    const map = {
      passed: { label: 'Geprüft ✓', className: 'bg-emerald-100 text-emerald-800' },
      warning: { label: 'Hinweis', className: 'bg-amber-100 text-amber-800' },
      failed: { label: 'Abgelehnt', className: 'bg-red-100 text-red-800' },
      pending: { label: 'Ausstehend', className: 'bg-slate-100 text-slate-600' },
      skipped: { label: 'Übersprungen', className: 'bg-slate-100 text-slate-600' },
      error: { label: 'Fehler', className: 'bg-red-100 text-red-800' },
    };
    const m = map[status] || { label: status, className: 'bg-slate-100 text-slate-600' };
    return <Badge className={`text-xs ${m.className}`}>{m.label}</Badge>;
  };

  const isExpiringSoon = (cert) => {
    if (!cert.expiry_date) return false;
    const exp = new Date(cert.expiry_date);
    const now = new Date();
    const diffDays = Math.floor((exp - now) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 90;
  };

  const isExpired = (cert) => {
    if (!cert.expiry_date) return false;
    return new Date(cert.expiry_date) < new Date();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="w-5 h-5" />
          Hochgeladene Zertifikate
        </CardTitle>
        <CardDescription>
          Qualifikations-Nachweise (PDF/Bilder) aus der zentralen Master-Datenbank, aggregiert über alle verknüpften Mandanten. Ansicht ist schreibgeschützt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Zertifikate werden geladen…
          </div>
        ) : error ? (
          <div className="text-center py-10 text-slate-400">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40 text-red-500" />
            <p className="text-sm text-red-600">Zertifikate konnten nicht geladen werden.</p>
            <p className="text-xs mt-1 text-slate-500">{error.message || 'Unbekannter Fehler'}</p>
          </div>
        ) : certificates.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <Award className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium">Keine Zertifikate hochgeladen</p>
            <p className="text-sm mt-1">Hochgeladene Qualifikations-Nachweise erscheinen hier, sobald welche hinterlegt sind.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datei</TableHead>
                <TableHead>Qualifikation</TableHead>
                <TableHead>Mandant</TableHead>
                <TableHead>Gültig von</TableHead>
                <TableHead>Gültig bis</TableHead>
                <TableHead>Hochgeladen</TableHead>
                <TableHead>Prüfung</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {certificates.map((cert) => (
                <TableRow key={`${cert.tenant_id}__${cert.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate max-w-[200px]" title={cert.file_name}>
                          {cert.file_name}
                        </p>
                        <p className="text-xs text-slate-400">{formatSize(cert.file_size)}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs text-slate-500">{cert.qualification_id}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {cert.tenant_name || cert.tenant_id}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{formatDate(cert.granted_date)}</TableCell>
                  <TableCell className="text-sm">
                    <span className={isExpired(cert) ? 'text-red-600 font-medium' : isExpiringSoon(cert) ? 'text-amber-600 font-medium' : ''}>
                      {formatDate(cert.expiry_date)}
                      {isExpired(cert) && ' (abgelaufen)'}
                      {isExpiringSoon(cert) && ' (läuft bald ab)'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">{formatDate(cert.uploaded_at)}</TableCell>
                  <TableCell>{analysisBadge(cert)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePreview(cert)}
                        disabled={!cert.mime_type?.startsWith('image/') && cert.mime_type !== 'application/pdf'}
                        title={cert.mime_type?.startsWith('image/') || cert.mime_type === 'application/pdf' ? 'Im neuen Tab öffnen' : 'Vorschau nicht verfügbar'}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(cert)}
                        title="Datei herunterladen"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Beziehungen-Tab ── */

function RelationshipsTab({ employeeId }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [relationshipType, setRelationshipType] = useState('lebensgemeinschaft');
  const [shiftConflict, setShiftConflict] = useState(false);

  const { data: relationships = [], isLoading } = useQuery({
    queryKey: ['master-employee-relationships', employeeId],
    queryFn: async () => {
      const res = await api.request(`/api/master/employees/${employeeId}/relationships`);
      return res.relationships || [];
    },
  });

  const { data: allEmployees = [] } = useQuery({
    queryKey: ['master-central-employees-for-relationship', employeeId],
    queryFn: async () => {
      const res = await api.request('/api/master/employees');
      return (res.employees || []).filter(e => e.is_active && e.id !== employeeId);
    },
  });

  const addMutation = useMutation({
    mutationFn: (data) => api.request(`/api/master/employees/${employeeId}/relationships`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-employee-relationships', employeeId] });
      setDialogOpen(false);
      setSelectedEmployeeId('');
      setRelationshipType('lebensgemeinschaft');
      setShiftConflict(false);
      toast({ title: 'Beziehung hinzugefügt', description: 'Die Mitarbeiterbeziehung wurde gespeichert.' });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Beziehung konnte nicht gespeichert werden.', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (relationshipId) => api.request(`/api/master/employees/${employeeId}/relationships/${relationshipId}`, {
      method: 'DELETE',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-employee-relationships', employeeId] });
      toast({ title: 'Beziehung gelöscht', description: 'Die Mitarbeiterbeziehung wurde entfernt.' });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Beziehung konnte nicht gelöscht werden.', variant: 'destructive' });
    },
  });

  const handleAdd = () => {
    if (!selectedEmployeeId) {
      toast({ title: 'Fehler', description: 'Bitte wählen Sie einen Mitarbeiter aus.', variant: 'destructive' });
      return;
    }
    addMutation.mutate({
      related_employee_id: selectedEmployeeId,
      relationship_type: relationshipType,
      shift_conflict: shiftConflict,
    });
  };

  const handleDelete = (rel) => {
    const partnerName = rel.employee_id === employeeId
      ? [rel.related_first_name, rel.related_last_name].filter(Boolean).join(' ')
      : [rel.employee_first_name, rel.employee_last_name].filter(Boolean).join(' ');
    if (!window.confirm(`Beziehung zu "${partnerName}" wirklich löschen?`)) return;
    deleteMutation.mutate(rel.id);
  };

  const getPartnerName = (rel) => {
    if (rel.employee_id === employeeId) {
      return [rel.related_first_name, rel.related_last_name].filter(Boolean).join(' ') || '–';
    }
    return [rel.employee_first_name, rel.employee_last_name].filter(Boolean).join(' ') || '–';
  };

  const getPartnerId = (rel) => {
    return rel.employee_id === employeeId ? rel.related_employee_id : rel.employee_id;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Heart className="w-5 h-5" />
                Mitarbeiterbeziehungen
              </CardTitle>
              <CardDescription>
                Lebensgemeinschaften und andere Beziehungen zwischen Mitarbeitern. Ein Dienstkonflikt verhindert gleichzeitige Dienste.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Beziehung hinzufügen
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Beziehungen werden geladen…
            </div>
          ) : relationships.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <Heart className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Keine Beziehungen erfasst</p>
              <p className="text-sm mt-1">Fügen Sie eine Beziehung hinzu, z.B. eine Lebensgemeinschaft mit einem anderen Mitarbeiter.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Beziehungstyp</TableHead>
                  <TableHead>Dienstkonflikt</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {relationships.map((rel) => (
                  <TableRow key={rel.id}>
                    <TableCell>
                      <button
                        className="text-indigo-600 hover:text-indigo-800 hover:underline text-sm font-medium"
                        onClick={() => window.open(`/mitarbeiter/central/${getPartnerId(rel)}`, '_blank')}
                      >
                        {getPartnerName(rel)}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {rel.relationship_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {rel.shift_conflict ? (
                        <Badge className="text-xs bg-red-100 text-red-800">Ja</Badge>
                      ) : (
                        <Badge className="text-xs bg-slate-100 text-slate-600">Nein</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        disabled={deleteMutation.isPending}
                        onClick={() => handleDelete(rel)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setSelectedEmployeeId(''); setRelationshipType('lebensgemeinschaft'); setShiftConflict(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Beziehung hinzufügen</DialogTitle>
            <DialogDescription>
              Verknüpfen Sie diesen Mitarbeiter mit einem anderen Mitarbeiter, z.B. als Lebensgemeinschaft.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Mitarbeiter</Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Mitarbeiter auswählen…" />
                </SelectTrigger>
                <SelectContent>
                  {allEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {[emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.payroll_id || emp.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {allEmployees.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Keine weiteren aktiven Mitarbeiter vorhanden.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Beziehungstyp</Label>
              <Input
                value={relationshipType}
                onChange={(e) => setRelationshipType(e.target.value)}
                placeholder="z.B. lebensgemeinschaft"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={shiftConflict} onCheckedChange={setShiftConflict} />
              <Label className="text-sm">Dienstkonflikt (kein gleichzeitiger Dienst)</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setDialogOpen(false); setSelectedEmployeeId(''); setRelationshipType('lebensgemeinschaft'); setShiftConflict(false); }}>
              Abbrechen
            </Button>
            <Button onClick={handleAdd} disabled={!selectedEmployeeId || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
              Hinzufügen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Hilfskomponente ── */

function FieldRow({ label, icon: Icon, value, editMode, type = 'text', onChange }) {
  return (
    <div>
      <Label className="text-xs text-slate-500 mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </Label>
      {editMode ? (
        <Input
          type={type}
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          className="h-9"
        />
      ) : (
        <p className="text-sm text-slate-800 py-1.5">
          {type === 'date' && value
            ? new Date(value).toLocaleDateString('de-DE')
            : value || '–'}
        </p>
      )}
    </div>
  );
}

function MiniCard({ icon: Icon, label, value, suffix, color = 'slate' }) {
  const colorMap = {
    slate: 'text-slate-900',
    blue: 'text-blue-700',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
  };
  return (
    <div className="p-4 bg-white rounded-xl border">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-slate-400" />
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className={`text-xl font-bold ${colorMap[color]}`}>
        {value} {suffix && <span className="text-sm font-normal text-slate-400">{suffix}</span>}
      </p>
    </div>
  );
}

function AbsenceTypeBadge({ type }) {
  const map = {
    'Urlaub': 'bg-emerald-100 text-emerald-800',
    'Krank': 'bg-red-100 text-red-800',
    'Frei': 'bg-slate-100 text-slate-800',
    'Dienstreise': 'bg-blue-100 text-blue-800',
    'Nicht verfügbar': 'bg-amber-100 text-amber-800',
    'Fortbildung': 'bg-purple-100 text-purple-800',
    'Kongress': 'bg-violet-100 text-violet-800',
    'Elternzeit': 'bg-pink-100 text-pink-800',
    'Mutterschutz': 'bg-pink-100 text-pink-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[type] || 'bg-slate-100 text-slate-800'}`}>
      {type}
    </span>
  );
}
