import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import {
  ArrowLeft, Building2, User, FileText, Clock, CalendarDays,
  TrendingUp, TrendingDown, Minus, Save, Pencil, AlertCircle,
  Briefcase, BadgeCheck, Hash, Mail, Phone, MapPin, Shield,
  CalendarCheck, CalendarX2, Sun, Loader2, Info,
  Download, Eye, Award,
} from 'lucide-react';

export default function MasterEmployeeDetail() {
  const { tenantId, employeeId } = useParams();
  const navigate = useNavigate();
  const [editMode, setEditMode] = useState(false);

  // Mitarbeiterdaten laden
  const { data: employee, isLoading } = useQuery({
    queryKey: ['master-employee', tenantId, employeeId],
    queryFn: async () => {
      try {
        return await api.request(`/api/master/staff/${tenantId}/${employeeId}`);
      } catch {
        return null;
      }
    },
  });

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
            <h1 className="text-2xl font-bold text-slate-900">
              {employee.name || 'Unbekannt'}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-xs">
                <Building2 className="w-3 h-3 mr-1" />
                {employee.tenantName || tenantId}
              </Badge>
              <Badge variant={employee.is_active ? 'default' : 'secondary'} className="text-xs">
                {employee.is_active ? 'Aktiv' : 'Inaktiv'}
              </Badge>
              {employee.role && (
                <Badge variant="secondary" className="text-xs">
                  <Shield className="w-3 h-3 mr-1" />
                  {employee.role}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={editMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => setEditMode(!editMode)}
          >
            <Pencil className="w-4 h-4 mr-2" />
            {editMode ? 'Bearbeitung aktiv' : 'Bearbeiten'}
          </Button>
          {editMode && (
            <Button size="sm">
              <Save className="w-4 h-4 mr-2" />
              Speichern
            </Button>
          )}
        </div>
      </div>

      {/* Master-DB Hinweis */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-sm text-indigo-700">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          Die Master-Datenbank ist führend. Änderungen hier werden an den Mandanten <strong>{employee.tenantName || tenantId}</strong> durchgereicht.
        </span>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="stammdaten" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="stammdaten" className="text-xs sm:text-sm">
            <User className="w-4 h-4 mr-1.5 hidden sm:inline" />
            Stammdaten
          </TabsTrigger>
          <TabsTrigger value="vertrag" className="text-xs sm:text-sm">
            <FileText className="w-4 h-4 mr-1.5 hidden sm:inline" />
            Vertrag
          </TabsTrigger>
          <TabsTrigger value="urlaub" className="text-xs sm:text-sm">
            <CalendarDays className="w-4 h-4 mr-1.5 hidden sm:inline" />
            Urlaub & Fehlzeiten
          </TabsTrigger>
          <TabsTrigger value="zeitkonto" className="text-xs sm:text-sm">
            <Clock className="w-4 h-4 mr-1.5 hidden sm:inline" />
            Zeitkonto
          </TabsTrigger>
          <TabsTrigger value="zertifikate" className="text-xs sm:text-sm">
            <Award className="w-4 h-4 mr-1.5 hidden sm:inline" />
            Zertifikate
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Stammdaten ── */}
        <TabsContent value="stammdaten" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Persönliche Daten */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="w-4 h-4" /> Persönliche Daten
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FieldRow label="Name" icon={User} value={employee.name} editable={editMode} />
                <FieldRow label="E-Mail" icon={Mail} value={employee.email} editable={editMode} type="email" />
                <FieldRow label="Telefon" icon={Phone} value={employee.phone} editable={editMode} type="tel" />
                <FieldRow label="Personalnummer" icon={Hash} value={employee.payroll_id} editable={editMode} />
                <FieldRow label="Adresse" icon={MapPin} value={employee.address} editable={editMode} />
              </CardContent>
            </Card>

            {/* Qualifikationen & Zuordnung */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BadgeCheck className="w-4 h-4" /> Qualifikationen & Zuordnung
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FieldRow label="Funktion / Rolle" icon={Briefcase} value={employee.role} editable={editMode} />
                <FieldRow label="Qualifikationen" icon={BadgeCheck} value={employee.qualifications} editable={editMode} />
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" /> Mandant
                  </Label>
                  <Badge variant="outline">{employee.tenantName || tenantId}</Badge>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Status</Label>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={employee.is_active ?? true}
                      disabled={!editMode}
                    />
                    <span className="text-sm">{employee.is_active ? 'Aktiv' : 'Inaktiv'}</span>
                  </div>
                </div>
                <FieldRow label="Notizen" icon={FileText} value={employee.notes} editable={editMode} multiline />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Tab 2: Vertrag & Arbeitsmodell ── */}
        <TabsContent value="vertrag" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Vertragsdaten */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Vertragsdaten
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FieldRow label="Vertragsbeginn" icon={CalendarCheck} value={employee.contract_start} editable={editMode} type="date" />
                <FieldRow label="Vertragsende" icon={CalendarX2} value={employee.contract_end} editable={editMode} type="date" placeholder="Unbefristet" />
                <FieldRow label="Probezeit bis" icon={CalendarDays} value={employee.probation_end} editable={editMode} type="date" />
                <FieldRow label="Personalnummer (Loga)" icon={Hash} value={employee.payroll_id} editable={editMode} />
              </CardContent>
            </Card>

            {/* Arbeitsmodell */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Arbeitsmodell
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FieldRow label="Wochen-Soll (Stunden)" icon={Clock} value={employee.target_hours_per_week} editable={editMode} type="number" placeholder="z.B. 38,5" />
                <FieldRow label="VK-Anteil (%)" icon={TrendingUp} value={employee.vk_share} editable={editMode} type="number" placeholder="z.B. 100" />
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Arbeitszeitgewichtung</Label>
                  {editMode ? (
                    <Select defaultValue={employee.work_time_percentage?.toString() || '100'}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="100">100% – Vollschicht</SelectItem>
                        <SelectItem value="70">70% – Rufbereitschaft</SelectItem>
                        <SelectItem value="50">50% – Bereitschaftsdienst</SelectItem>
                        <SelectItem value="0">0% – Nicht anrechenbar</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-slate-900">
                      {employee.work_time_percentage != null
                        ? `${employee.work_time_percentage}%`
                        : '100% (Standard)'}
                    </p>
                  )}
                </div>
                <Separator />
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Sonderstatus</Label>
                  <div className="flex flex-wrap gap-2">
                    {['Elternzeit', 'Mutterschutz', 'KO (Krank ohne Ende)'].map((status) => (
                      <Badge
                        key={status}
                        variant={employee.special_status === status ? 'default' : 'outline'}
                        className="text-xs cursor-pointer"
                      >
                        {status}
                      </Badge>
                    ))}
                    {!employee.special_status && (
                      <span className="text-sm text-slate-400">Kein Sonderstatus</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Tab 3: Urlaub & Fehlzeiten ── */}
        <TabsContent value="urlaub" className="mt-6 space-y-6">
          {/* Urlaubskonto */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MiniCard icon={Sun} label="Jahresanspruch" value={employee.vacation_days_total ?? '–'} suffix="Tage" />
            <MiniCard icon={CalendarCheck} label="Genommen" value={employee.vacation_days_taken ?? '–'} suffix="Tage" color="blue" />
            <MiniCard icon={CalendarDays} label="Geplant" value={employee.vacation_days_planned ?? '–'} suffix="Tage" color="amber" />
            <MiniCard
              icon={CalendarDays}
              label="Resturlaub"
              value={employee.remaining_vacation ?? '–'}
              suffix="Tage"
              color={employee.remaining_vacation < 5 ? 'red' : 'emerald'}
            />
          </div>

          {/* Fehlzeiten-Verlauf */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarX2 className="w-4 h-4" /> Fehlzeiten-Verlauf
              </CardTitle>
              <CardDescription>
                Alle Abwesenheiten dieses Mitarbeiters im aktuellen Jahr
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
                        <TableHead>Von</TableHead>
                        <TableHead>Bis</TableHead>
                        <TableHead>Tage</TableHead>
                        <TableHead>Bemerkung</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(employee.absences ?? []).map((abs, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <AbsenceTypeBadge type={abs.type} />
                          </TableCell>
                          <TableCell className="text-sm">{abs.from}</TableCell>
                          <TableCell className="text-sm">{abs.to}</TableCell>
                          <TableCell className="text-sm font-medium">{abs.days}</TableCell>
                          <TableCell className="text-sm text-slate-500 max-w-[200px] truncate">
                            {abs.note || '–'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
              {editMode && (
                <div className="mt-4">
                  <Button variant="outline" size="sm">
                    <CalendarDays className="w-4 h-4 mr-2" /> Fehlzeit eintragen
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 4: Zeitkonto ── */}
        <TabsContent value="zeitkonto" className="mt-6 space-y-6">
          {/* Salden-Übersicht */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MiniCard icon={Clock} label="Wochen-Soll" value={employee.target_hours_per_week ?? '–'} suffix="h" />
            <MiniCard icon={Clock} label="Ist aktueller Monat" value={employee.current_month_actual ?? '–'} suffix="h" color="blue" />
            <MiniCard
              icon={employee.overtime_balance > 0 ? TrendingUp : employee.overtime_balance < 0 ? TrendingDown : Minus}
              label="Überstunden-Saldo"
              value={employee.overtime_balance != null ? `${employee.overtime_balance > 0 ? '+' : ''}${employee.overtime_balance}` : '–'}
              suffix="h"
              color={employee.overtime_balance > 0 ? 'emerald' : employee.overtime_balance < 0 ? 'red' : 'slate'}
            />
            <MiniCard icon={CalendarCheck} label="Monatsabschluss" value={employee.month_closed ? 'Abgeschlossen' : 'Offen'} color={employee.month_closed ? 'emerald' : 'amber'} />
          </div>

          {/* Monatliche Zeitkonto-Tabelle */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4" /> Monatsverlauf
              </CardTitle>
              <CardDescription>
                Soll/Ist-Vergleich und kumulierter Saldo pro Monat
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(employee.time_accounts?.length ?? 0) === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">Noch keine Zeitkontodaten vorhanden</p>
                  <p className="text-xs mt-1">Daten werden aus dem Mandanten übernommen, sobald Monatsabschlüsse vorliegen.</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Monat</TableHead>
                        <TableHead className="text-right">Soll (h)</TableHead>
                        <TableHead className="text-right">Ist (h)</TableHead>
                        <TableHead className="text-right">Delta</TableHead>
                        <TableHead className="text-right">Vortrag</TableHead>
                        <TableHead className="text-right">Saldo kumuliert</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(employee.time_accounts ?? []).map((ta, i) => {
                        const delta = ta.actual - ta.target;
                        return (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{ta.month}</TableCell>
                            <TableCell className="text-right">{ta.target}</TableCell>
                            <TableCell className="text-right font-semibold">{ta.actual}</TableCell>
                            <TableCell className={`text-right font-semibold ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </TableCell>
                            <TableCell className="text-right text-slate-500">{ta.carry_over ?? 0}</TableCell>
                            <TableCell className={`text-right font-bold ${ta.total_balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {ta.total_balance > 0 ? '+' : ''}{ta.total_balance?.toFixed(1)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={ta.is_closed ? 'default' : 'outline'} className="text-xs">
                                {ta.is_closed ? '✓ Abgeschlossen' : 'Offen'}
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

        {/* ── Tab 5: Zertifikate ── */}
        <TabsContent value="zertifikate" className="mt-6 space-y-6">
          <CertificatesTab tenantId={tenantId} employeeId={employeeId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Zertifikate-Tab (read-only) ── */

function CertificatesTab({ tenantId, employeeId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['master-certificates', tenantId, employeeId],
    queryFn: async () => {
      const result = await api.request(`/api/master/certificates/${tenantId}/${employeeId}`);
      return result?.certificates ?? [];
    },
  });

  const certificates = data ?? [];

  const downloadUrl = (certId) => {
    const baseURL = import.meta.env.VITE_API_URL || '';
    const token = localStorage.getItem('radioplan_jwt_token') || '';
    // Use a hidden iframe for inline preview / browser-native download
    return `${baseURL}/api/master/certificates/${tenantId}/${employeeId}/${certId}/download?_t=${encodeURIComponent(token)}`;
  };

  const handleDownload = async (cert) => {
    try {
      const baseURL = import.meta.env.VITE_API_URL || '';
      const token = localStorage.getItem('radioplan_jwt_token') || '';
      const response = await fetch(
        `${baseURL}/api/master/certificates/${tenantId}/${employeeId}/${cert.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = cert.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download fehlgeschlagen:', e);
    }
  };

  const handlePreview = (cert) => {
    if (!cert.mime_type?.startsWith('image/') && cert.mime_type !== 'application/pdf') return;
    window.open(downloadUrl(cert.id), '_blank', 'noopener,noreferrer');
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
        <CardTitle className="text-base flex items-center gap-2">
          <Award className="w-4 h-4" /> Hochgeladene Zertifikate
        </CardTitle>
        <CardDescription>
          Qualifikations-Nachweise (PDF/Bilder) aus der zentralen Master-Datenbank. Ansicht ist schreibgeschützt.
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
            <Award className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">Keine Zertifikate hochgeladen</p>
            <p className="text-xs mt-1">Hochgeladene Qualifikations-Nachweise erscheinen hier.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datei</TableHead>
                <TableHead>Qualifikation</TableHead>
                <TableHead>Gültig von</TableHead>
                <TableHead>Gültig bis</TableHead>
                <TableHead>Hochgeladen</TableHead>
                <TableHead>Prüfung</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {certificates.map((cert) => (
                <TableRow key={cert.id}>
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

/* ── Hilfskomponenten ── */

function FieldRow({ label, icon: Icon, value, editable, type = 'text', placeholder, multiline }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500 flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </Label>
      {editable ? (
        multiline ? (
          <textarea
            defaultValue={value || ''}
            placeholder={placeholder || `${label} eingeben…`}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : (
          <Input
            defaultValue={value || ''}
            type={type}
            placeholder={placeholder || `${label} eingeben…`}
          />
        )
      ) : (
        <p className="text-sm text-slate-900">{value || <span className="text-slate-400">{placeholder || '–'}</span>}</p>
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
