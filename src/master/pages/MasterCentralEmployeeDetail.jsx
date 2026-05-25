import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  ArrowLeft, Building2, User, FileText, Clock, CalendarDays,
  TrendingUp, TrendingDown, Minus, Save, Pencil, AlertCircle,
  Briefcase, Hash, Mail, Phone, MapPin,
  Loader2, UserCheck, UserX, Link2, RefreshCw, Trash2,
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
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="stammdaten" className="flex items-center gap-2">
            <User className="w-4 h-4" /> Stammdaten
          </TabsTrigger>
          <TabsTrigger value="vertrag" className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Vertrag
          </TabsTrigger>
          <TabsTrigger value="mandanten" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Mandanten
          </TabsTrigger>
          <TabsTrigger value="zeitkonto" className="flex items-center gap-2">
            <Clock className="w-4 h-4" /> Zeitkonto
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
      </Tabs>
    </div>
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
