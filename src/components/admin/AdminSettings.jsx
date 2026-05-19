import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Settings, ShieldCheck, Mail } from 'lucide-react';
import SectionConfigDialog from '@/components/settings/SectionConfigDialog';

export default function AdminSettings() {
    const queryClient = useQueryClient();

    const { data: settings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
        staleTime: 10 * 60 * 1000, // 10 Minuten
        cacheTime: 15 * 60 * 1000, // 15 Minuten
        refetchOnWindowFocus: false,
    });

    const { data: workplaces = [] } = useQuery({
        queryKey: ['workplaces'],
        queryFn: () => db.Workplace.list(),
        staleTime: 10 * 60 * 1000,
        cacheTime: 15 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const updateSettingMutation = useMutation({
        mutationFn: async ({ key, value }) => {
            const existing = settings.find(s => s.key === key);
            if (existing) {
                return db.SystemSetting.update(existing.id, { value });
            } else {
                return db.SystemSetting.create({ key, value });
            }
        },
        onSuccess: () => queryClient.invalidateQueries(['systemSettings'])
    });

    const wishDeadlineMonths = settings.find(s => s.key === 'wish_deadline_months')?.value || '';
    const wishReminderEnabled = settings.find(s => s.key === 'wish_reminder_email_enabled')?.value === 'true';
    const allowAbsenceOncallOverlap = settings.find(s => s.key === 'allow_absence_oncall_overlap')?.value === 'true';
    
    // Approval Settings
    const approvalSettingRaw = settings.find(s => s.key === 'wish_approval_rules')?.value;
    const approvalRules = approvalSettingRaw ? JSON.parse(approvalSettingRaw) : {
        service_requires_approval: true,
        no_service_requires_approval: false,
        position_overrides: {}, // { "Dienst Hintergrund": false } means this position doesn't require approval
        auto_create_shift_on_approval: false // If true, automatically create shift entry when wish is approved
    };

    const updateApprovalRules = (newRules) => {
        updateSettingMutation.mutate({ 
            key: 'wish_approval_rules', 
            value: JSON.stringify(newRules) 
        });
    };

    // Get service positions (Dienste category)
    const servicePositions = workplaces
        .filter(w => w.category === 'Dienste')
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-slate-100 rounded-lg">
                        <Settings className="w-5 h-5 text-slate-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900">System-Einstellungen</h3>
                        <p className="text-sm text-slate-500">Globale Konfigurationen für die Anwendung</p>
                    </div>
                </div>

                <div className="max-w-xl space-y-6">
                    <div className="border p-4 rounded-lg bg-slate-50 space-y-3">
                        <div className="space-y-0.5">
                            <Label>Einsendefrist für Wünsche</Label>
                            <p className="text-xs text-slate-500">Vorlaufzeit in Monaten (z.B. 2 = Eingabe nur für Termine, die mind. 2 Monate in der Zukunft liegen).</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Input 
                                type="number" 
                                min="0"
                                max="24"
                                placeholder="Keine Frist"
                                value={wishDeadlineMonths}
                                onChange={(e) => updateSettingMutation.mutate({ key: 'wish_deadline_months', value: e.target.value })}
                                className="h-9 w-32 bg-white"
                            />
                            <span className="text-sm text-slate-600">Monate im Voraus</span>
                        </div>

                        {wishDeadlineMonths && parseInt(wishDeadlineMonths) > 0 && (
                            <div className="flex items-start gap-3 pt-3 mt-3 border-t border-slate-200">
                                <Checkbox
                                    id="wish-reminder-email"
                                    checked={wishReminderEnabled}
                                    onCheckedChange={(checked) => updateSettingMutation.mutate({ 
                                        key: 'wish_reminder_email_enabled', 
                                        value: checked ? 'true' : 'false' 
                                    })}
                                    className="mt-0.5"
                                />
                                <div className="space-y-1">
                                    <Label htmlFor="wish-reminder-email" className="cursor-pointer flex items-center gap-2 text-slate-900">
                                        <Mail className="w-4 h-4 text-blue-500" />
                                        Erinnerungsmail 2 Wochen vor Sperrtermin
                                    </Label>
                                    <p className="text-xs text-slate-500">
                                        Alle Mitarbeiter werden automatisch per E-Mail erinnert, ihre Dienstwünsche einzutragen, 
                                        14 Tage bevor der Eintragungszeitraum abläuft.
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="flex items-start gap-3 pt-3 mt-3 border-t border-slate-200">
                            <Checkbox
                                id="allow-absence-oncall-overlap"
                                checked={allowAbsenceOncallOverlap}
                                onCheckedChange={(checked) => updateSettingMutation.mutate({
                                    key: 'allow_absence_oncall_overlap',
                                    value: checked ? 'true' : 'false'
                                })}
                                className="mt-0.5"
                            />
                            <div className="space-y-1">
                                <Label htmlFor="allow-absence-oncall-overlap" className="cursor-pointer text-slate-900">
                                    Gleichzeitige Abwesenheit und Dienst erlauben
                                </Label>
                                <p className="text-xs text-slate-500">
                                    Erlaubt global Überschneidungen zwischen Abwesenheiten und Diensten. Standardmäßig deaktiviert.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Approval Rules Section */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-amber-100 rounded-lg">
                        <ShieldCheck className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900">Genehmigungspflicht für Wünsche</h3>
                        <p className="text-sm text-slate-500">Festlegen, welche Wunscharten eine Admin-Genehmigung erfordern</p>
                    </div>
                </div>

                <div className="max-w-xl space-y-6">
                    {/* General Rules */}
                    <div className="border p-4 rounded-lg bg-slate-50 space-y-4">
                        <Label className="text-sm font-semibold text-slate-700">Allgemeine Regeln</Label>
                        
                        <div className="flex items-center justify-between py-2 border-b border-slate-200">
                            <div>
                                <p className="font-medium text-slate-900">Dienstwunsch</p>
                                <p className="text-xs text-slate-500">Wunsch für einen bestimmten Dienst</p>
                            </div>
                            <Switch 
                                checked={approvalRules.service_requires_approval}
                                onCheckedChange={(checked) => updateApprovalRules({
                                    ...approvalRules,
                                    service_requires_approval: checked
                                })}
                            />
                        </div>

                        <div className="flex items-center justify-between py-2">
                            <div>
                                <p className="font-medium text-slate-900">Kein Dienst</p>
                                <p className="text-xs text-slate-500">Wunsch, an einem Tag keinen Dienst zu haben</p>
                            </div>
                            <Switch 
                                checked={approvalRules.no_service_requires_approval}
                                onCheckedChange={(checked) => updateApprovalRules({
                                    ...approvalRules,
                                    no_service_requires_approval: checked
                                })}
                            />
                        </div>

                        <div className="flex items-center justify-between py-2 border-t border-slate-200 pt-4 mt-2">
                            <div>
                                <p className="font-medium text-slate-900">Bei Genehmigung im Dienstplan eintragen</p>
                                <p className="text-xs text-slate-500">Genehmigte Dienstwünsche automatisch als Schicht anlegen</p>
                            </div>
                            <Switch 
                                checked={approvalRules.auto_create_shift_on_approval}
                                onCheckedChange={(checked) => updateApprovalRules({
                                    ...approvalRules,
                                    auto_create_shift_on_approval: checked
                                })}
                            />
                        </div>
                    </div>

                    {/* Position Overrides */}
                    {servicePositions.length > 0 && (
                        <div className="border p-4 rounded-lg bg-slate-50 space-y-4">
                            <div className="space-y-0.5">
                                <Label className="text-sm font-semibold text-slate-700">Ausnahmen für Dienstpositionen</Label>
                                <p className="text-xs text-slate-500">
                                    Überschreibt die allgemeine Regel für "Dienstwunsch". Deaktiviert = keine Genehmigung nötig für diese Position.
                                </p>
                            </div>
                            
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {servicePositions.map(pos => {
                                    const positionOverride = approvalRules.position_overrides?.[pos.name];
                                    // If no override, inherit from general rule
                                    const effectiveValue = positionOverride !== undefined 
                                        ? positionOverride 
                                        : approvalRules.service_requires_approval;
                                    const isOverridden = positionOverride !== undefined;

                                    return (
                                        <div 
                                            key={pos.id} 
                                            className={`flex items-center justify-between py-2 px-3 rounded-md ${
                                                isOverridden ? 'bg-amber-50 border border-amber-200' : 'bg-white border border-slate-200'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-slate-900">{pos.name}</span>
                                                {isOverridden && (
                                                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                                        Überschrieben
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Switch 
                                                    checked={effectiveValue}
                                                    onCheckedChange={(checked) => {
                                                        const newOverrides = { ...approvalRules.position_overrides };
                                                        // If setting to same as general rule, remove override
                                                        if (checked === approvalRules.service_requires_approval) {
                                                            delete newOverrides[pos.name];
                                                        } else {
                                                            newOverrides[pos.name] = checked;
                                                        }
                                                        updateApprovalRules({
                                                            ...approvalRules,
                                                            position_overrides: newOverrides
                                                        });
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <p className="text-xs text-slate-500 italic">
                        Wünsche ohne Genehmigungspflicht werden automatisch mit Status "Genehmigt" erstellt.
                    </p>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-indigo-100 rounded-lg">
                        <Settings className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900">Bereichs-Captions</h3>
                        <p className="text-sm text-slate-500">Mandantenspezifische Bezeichnungen für Bereiche und Standard-Arbeitsbereiche.</p>
                    </div>
                </div>
                <div className="flex items-center justify-between border rounded-lg p-4 bg-slate-50">
                    <p className="text-sm text-slate-600">
                        Passen Sie Begriffe wie Abwesenheiten, Anwesenheiten, Dienste, Rotationen oder Demos für den aktiven Mandanten an.
                    </p>
                    <SectionConfigDialog />
                </div>
            </div>
        </div>
    );
}