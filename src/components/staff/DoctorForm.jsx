import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { db, api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import EmployeeSelect from '@/components/staff/EmployeeSelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useTeamRoles, DEFAULT_TEAM_ROLES } from "@/components/settings/TeamRoleSettings";
import DoctorQualificationEditor from "@/components/staff/DoctorQualificationEditor";
import { toast } from "sonner";
import { Mail, Loader2, Link2, Unlink } from "lucide-react";

// Fallback falls Rollen noch nicht geladen
const FALLBACK_ROLES = DEFAULT_TEAM_ROLES.map(r => r.name);
const COLORS = [
  { label: "Rot (Chef)", value: "bg-red-100 text-red-800" },
  { label: "Blau (Oberarzt)", value: "bg-blue-100 text-blue-800" },
  { label: "Grün (Fachartz)", value: "bg-green-100 text-green-800" },
  { label: "Gelb (Assistenz)", value: "bg-yellow-100 text-yellow-800" },
  { label: "Lila", value: "bg-purple-100 text-purple-800" },
  { label: "Grau", value: "bg-gray-100 text-gray-800" },
];

export default function DoctorForm({ open, onOpenChange, doctor, onSubmit }) {
  // Dynamisch Rollen aus DB laden
  const { roleNames, isLoading: rolesLoading } = useTeamRoles();
  const availableRoles = roleNames.length > 0 ? roleNames : FALLBACK_ROLES;
  
  // Default-Rolle (letzte in der Liste, typischerweise niedrigste Priorität)
  const defaultRole = availableRoles[availableRoles.length - 1] || "Assistenzarzt";

  // Liste aller existierenden Ärzte für Kürzel-Validierung
  const { data: allDoctors = [] } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => db.Doctor.list(),
  });

  // Zentrale Mitarbeiterliste laden (für Verknüpfung)
  const { data: centralEmployees = [] } = useQuery({
    queryKey: ["central-employees-for-linking"],
    queryFn: async () => {
      try {
        const res = await api.request('/api/master/employees?active=true');
        return res.employees || [];
      } catch {
        return [];
      }
    },
  });

  const [sendingTestMail, setSendingTestMail] = useState(false);
  const [selectedQualIds, setSelectedQualIds] = useState([]);

  const centralEmployeeOptions = React.useMemo(() => (
    [
      {
        value: '__none__',
        label: 'Nicht verknupft (lokaler Mitarbeiter)',
        triggerLabel: 'Nicht verknupft (lokaler Mitarbeiter)',
        sortLabel: '',
        keywords: ['lokal', 'keine zentrale verknupfung'],
      },
      ...centralEmployees.map((employee) => {
        const fullName = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.last_name;
        return {
          value: employee.id,
          label: fullName,
          triggerLabel: fullName,
          description: employee.work_time_model_name || undefined,
          searchText: [employee.first_name, employee.last_name, employee.work_time_model_name].filter(Boolean).join(' '),
          sortLabel: fullName,
        };
      }),
    ]
  ), [centralEmployees]);

  const handleSendTestMail = async () => {
    const email = formData.email;
    if (!email) {
      toast.error("Bitte zuerst eine E-Mail-Adresse eingeben");
      return;
    }
    setSendingTestMail(true);
    try {
      const result = await api.request('/api/staff/send-test-email', {
        method: 'POST',
        body: JSON.stringify({ to: email }),
      });
      toast.success(result.message || `Testmail an ${email} gesendet`);
    } catch (error) {
      toast.error(error.message || "Testmail konnte nicht gesendet werden");
    } finally {
      setSendingTestMail(false);
    }
  };

  const [formData, setFormData] = useState(
    doctor || {
      name: "",
      initials: "",
      role: defaultRole,
      google_email: "",
    }
  );

  useEffect(() => {
    if (doctor) {
      setFormData({
        ...doctor,
        fte: doctor.fte !== undefined ? Math.round(parseFloat(doctor.fte) * 100) / 100 : 1.0,
        target_weekly_hours: doctor.target_weekly_hours || '',
        central_employee_id: doctor.central_employee_id || '',
      });
      // Für Bearbeitung keine separaten selectedQualIds – wird über den Editor selbst gesteuert
      setSelectedQualIds([]);
    } else if (open) {
      // Neuanlage: zurücksetzen
      setFormData({
        name: "",
        initials: "",
        role: defaultRole,
        google_email: "",
        fte: 1.0,
        target_weekly_hours: '',
        contract_end_date: "",
        exclude_from_staffing_plan: false,
        central_employee_id: '',
      });
      setSelectedQualIds([]);
    }
  }, [doctor, open]);

  const handleToggleQual = (qualId) => {
    setSelectedQualIds(prev =>
      prev.includes(qualId) ? prev.filter(id => id !== qualId) : [...prev, qualId]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Kürzel-Validierung: Prüfen ob bereits vergeben
    const trimmedInitials = formData.initials?.trim();
    if (!trimmedInitials) {
      toast.error("Bitte geben Sie ein Kürzel ein");
      return;
    }
    
    // Prüfen ob Kürzel bereits existiert (außer beim aktuellen Arzt bei Bearbeitung)
    const existingDoctor = allDoctors.find(
      d => d.initials?.toLowerCase() === trimmedInitials.toLowerCase() && d.id !== doctor?.id
    );
    
    if (existingDoctor) {
      toast.error(`Das Kürzel "${trimmedInitials}" wird bereits von ${existingDoctor.name} verwendet. Bitte wählen Sie ein anderes Kürzel.`);
      return;
    }
    
    // Ensure fte is a number, rounded to 2 decimal places
    const dataToSubmit = {
        ...formData,
        initials: trimmedInitials,
        fte: Math.round((parseFloat(formData.fte) || 1.0) * 100) / 100,
        target_weekly_hours: formData.central_employee_id
          ? undefined  // Zentral verknüpft → nicht lokal überschreiben
          : (formData.target_weekly_hours ? parseFloat(formData.target_weekly_hours) : null),
        central_employee_id: formData.central_employee_id || null,
        _qualificationIds: selectedQualIds,  // für Staff.jsx
    };
    onSubmit(dataToSubmit);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl lg:max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="staff-doctor-form">
        <DialogHeader>
          <DialogTitle>{doctor ? "Teammitglied bearbeiten" : "Neues Teammitglied hinzufügen"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                data-testid="staff-form-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="initials">Kürzel</Label>
              <Input
                id="initials"
                data-testid="staff-form-initials"
                value={formData.initials}
                onChange={(e) => setFormData({ ...formData, initials: e.target.value })}
                required
                maxLength={5}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Funktion</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value })}
              >
                <SelectTrigger data-testid="staff-form-role-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">E-Mail (für Benachrichtigungen)</Label>
            <div className="flex gap-2">
              <Input
                id="email"
                data-testid="staff-form-email"
                type="email"
                value={formData.email || ''}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="name@klinik.de"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSendTestMail}
                disabled={!formData.email || sendingTestMail}
                title="Testmail senden"
              >
                {sendingTestMail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="google_email">E-Mail (für Kalender / Dienstplan)</Label>
              <Input
                id="google_email"
                data-testid="staff-form-google-email"
                type="email"
                value={formData.google_email || ''}
                onChange={(e) => setFormData({ ...formData, google_email: e.target.value })}
              placeholder="name@klinik.de"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="fte">Stellenanteil (1.0 = Vollzeit)</Label>
                <Input
                    id="fte"
                    data-testid="staff-form-fte"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={formData.fte !== undefined ? formData.fte : 1.0}
                    onChange={(e) => setFormData({ ...formData, fte: e.target.value })}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="target_weekly_hours">Wochen-h (Soll)</Label>
                {formData.central_employee_id ? (
                  <div>
                    <Input
                      id="target_weekly_hours"
                      data-testid="staff-form-target-hours"
                      type="number"
                      value={(() => {
                        const emp = centralEmployees.find(e => e.id === formData.central_employee_id);
                        return emp?.model_hours_per_week || formData.target_weekly_hours || '';
                      })()}
                      disabled
                      className="bg-slate-100"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">Aus Zentrale</p>
                  </div>
                ) : (
                  <Input
                    id="target_weekly_hours"
                    data-testid="staff-form-target-hours"
                    type="number"
                    step="0.5"
                    min="0"
                    max="48"
                    placeholder="z.B. 38.5"
                    value={formData.target_weekly_hours || ''}
                    onChange={(e) => setFormData({ ...formData, target_weekly_hours: e.target.value })}
                  />
                )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="contract_end_date">Befristet bis (Optional)</Label>
                <Input
                    id="contract_end_date"
                    data-testid="staff-form-contract-end-date"
                    type="date"
                    value={formData.contract_end_date || ''}
                    onChange={(e) => setFormData({ ...formData, contract_end_date: e.target.value })}
                />
            </div>
          </div>

          <div className="flex items-center justify-between border p-3 rounded-lg bg-slate-50">
              <div className="space-y-0.5">
                  <Label htmlFor="exclude_from_staffing_plan" className="text-base">Im Stellenplan ausblenden</Label>
                  <div className="text-xs text-slate-500">
                      Diese Person wird in der Stellenplan-Berechnung ignoriert.
                  </div>
              </div>
              <Switch
                  id="exclude_from_staffing_plan"
                  checked={formData.exclude_from_staffing_plan || false}
                  onCheckedChange={(checked) => setFormData({ ...formData, exclude_from_staffing_plan: checked })}
              />
          </div>
          
          {/* Zentrale Mitarbeiterverknüpfung */}
          <div className="border rounded-lg p-3 bg-slate-50 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base flex items-center gap-1.5">
                <Link2 className="w-4 h-4" />
                Zentrale Verknüpfung
              </Label>
              {formData.central_employee_id && (
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-slate-500"
                  onClick={() => setFormData({ ...formData, central_employee_id: '' })}>
                  <Unlink className="w-3 h-3 mr-1" /> Trennen
                </Button>
              )}
            </div>
            <EmployeeSelect
              value={formData.central_employee_id || '__none__'}
              onValueChange={(value) => {
                const empId = value === '__none__' ? '' : value;
                setFormData({ ...formData, central_employee_id: empId });
                if (empId) {
                  const emp = centralEmployees.find((employee) => employee.id === empId);
                  if (emp) {
                    const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(' ');
                    if (fullName && !formData.name) {
                      setFormData((prev) => ({ ...prev, central_employee_id: empId, name: fullName }));
                    }
                  }
                }
              }}
              options={centralEmployeeOptions}
              placeholder="Nicht verknüpft (lokaler Mitarbeiter)"
              searchPlaceholder="Zentralen Mitarbeiter suchen..."
              triggerClassName="bg-white"
            />
            <p className="text-[11px] text-slate-400">
              Verknüpfte Mitarbeiter erben Vertragsdaten (Arbeitszeit, Urlaub) aus der Zentrale.
            </p>
          </div>

          {/* Qualifikations-Zuordnung immer anzeigen */}
          <div className="border rounded-lg p-3 bg-slate-50">
              <DoctorQualificationEditor 
                doctorId={doctor?.id} 
                selectedQualIds={selectedQualIds} 
                onToggle={handleToggleQual} 
              />
          </div>

          <DialogFooter>
            <Button type="submit" data-testid="staff-form-submit">Speichern</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
