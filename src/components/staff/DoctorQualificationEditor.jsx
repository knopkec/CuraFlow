import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Award, Check, X, FileCheck } from 'lucide-react';
import { useQualifications } from '@/hooks/useQualifications';
import CertificateManager from '@/components/staff/CertificateManager';

/**
 * Editor-Komponente zum Zuweisen/Entfernen von Qualifikationen für einen einzelnen Mitarbeiter.
 * Wird im DoctorForm oder als eigenständige Komponente verwendet.
 * 
 * @param {Object} props
 * @param {string|null} props.doctorId - ID des Arztes (null für Neuanlage)
 * @param {string[]} [props.selectedQualIds] - Kontrollierte Liste ausgewählter Qualifikationen (wenn doctorId null)
 * @param {Function} [props.onToggle] - Callback beim Aktivieren/Deaktivieren einer Qualifikation (nur bei doctorId null)
 * @param {boolean} [props.compact] - Kompakte Darstellung (Badges zum Anklicken)
 */
export default function DoctorQualificationEditor({ doctorId, selectedQualIds = [], onToggle, compact = false }) {
    const queryClient = useQueryClient();
    const { qualifications, qualificationsByCategory, categories, isLoading: qualsLoading } = useQualifications();

    const { data: doctorQuals = [], isLoading: dqLoading } = useQuery({
        queryKey: ['doctorQualifications', doctorId],
        queryFn: () => db.DoctorQualification.filter({ doctor_id: doctorId }),
        enabled: !!doctorId,
    });

    const assignMutation = useMutation({
        mutationFn: (qualificationId) => db.DoctorQualification.create({
            doctor_id: doctorId,
            qualification_id: qualificationId,
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['doctorQualifications', doctorId] });
            queryClient.invalidateQueries({ queryKey: ['allDoctorQualifications'] });
        },
    });

    const removeMutation = useMutation({
        mutationFn: (dqId) => db.DoctorQualification.delete(dqId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['doctorQualifications', doctorId] });
            queryClient.invalidateQueries({ queryKey: ['allDoctorQualifications'] });
        },
    });

    // Active qualifications only
    const activeQuals = qualifications.filter(q => q.is_active !== false);

    const isLoading = qualsLoading || (!!doctorId && dqLoading);

    if (isLoading) {
        return <div className="text-xs text-slate-400 p-2">Wird geladen...</div>;
    }

    if (activeQuals.length === 0) {
        return (
            <div className="text-xs text-slate-400 italic p-2">
                Noch keine Qualifikationen angelegt. Verwenden Sie den Qualifikations-Manager, um welche anzulegen.
            </div>
        );
    }

    // Determine assigned IDs: from server if doctor exists, otherwise from controlled props
    const assignedQualIds = doctorId ? doctorQuals.map(dq => dq.qualification_id) : selectedQualIds;
    const toggleHandler = doctorId
        ? (qualId) => {
            const existingAssignment = doctorQuals.find(dq => dq.qualification_id === qualId);
            if (existingAssignment) {
                removeMutation.mutate(existingAssignment.id);
            } else {
                assignMutation.mutate(qualId);
            }
        }
        : onToggle;

    if (!doctorId && !onToggle) {
        return (
            <div className="text-xs text-slate-400 italic p-2">
                Bitte speichern Sie das Teammitglied zuerst, um Qualifikationen zuzuweisen.
            </div>
        );
    }

    if (compact) {
        // Compact: Badge-Chips zum Anklicken + Upload-Bereich für zertifikatpflichtige Qualifikationen
        const certRequiredAssigned = doctorId
            ? activeQuals.filter(q => q.requires_certificate === true && assignedQualIds.includes(q.id))
            : [];
        return (
            <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5" />
                    Qualifikationen
                </Label>
                <div className="flex flex-wrap gap-1.5">
                    {activeQuals.map(qual => {
                        const isAssigned = assignedQualIds.includes(qual.id);
                        const needsCertHint = qual.requires_certificate === true;
                        return (
                            <button
                                key={qual.id}
                                type="button"
                                onClick={() => toggleHandler(qual.id)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                                    isAssigned 
                                        ? 'ring-2 ring-offset-1 ring-indigo-400' 
                                        : 'opacity-40 hover:opacity-70'
                                }`}
                                style={{ 
                                    backgroundColor: qual.color_bg || '#e0e7ff', 
                                    color: qual.color_text || '#3730a3' 
                                }}
                                title={`${qual.description || qual.name}${needsCertHint ? ' (Zertifikat erforderlich)' : ''}`}
                            >
                                {isAssigned && <Check className="w-3 h-3" />}
                                {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                                {needsCertHint && <FileCheck className="w-3 h-3" />}
                            </button>
                        );
                    })}
                </div>
                {certRequiredAssigned.length > 0 && (
                    <div className="space-y-2 pt-2">
                        {certRequiredAssigned.map(qual => {
                            const dqEntry = doctorQuals.find(dq => dq.qualification_id === qual.id);
                            return (
                                <CertificateManager
                                    key={qual.id}
                                    doctorId={doctorId}
                                    qualificationId={qual.id}
                                    qualificationName={qual.name}
                                    doctorQualificationId={dqEntry?.id || null}
                                />
                            );
                        })}
                    </div>
                )}
                {!doctorId && activeQuals.some(q => q.requires_certificate === true && assignedQualIds.includes(q.id)) && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                        Hinweis: Für Qualifikationen mit Zertifikatspflicht können Sie Dateien hochladen,
                        sobald das Teammitglied gespeichert ist.
                    </div>
                )}
            </div>
        );
    }

    // Full view: kompakte 2-Spalten Chip-Grid pro Kategorie + Cert-Manager unter zugewiesenen pflichtigen
    return (
        <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5" />
                Qualifikationen & Berechtigungen
            </Label>
            {categories.map(cat => {
                const catQuals = (qualificationsByCategory[cat] || []).filter(q => q.is_active !== false);
                if (catQuals.length === 0) return null;
                const certRequiredAssigned = doctorId
                    ? catQuals.filter(q => q.requires_certificate === true && assignedQualIds.includes(q.id))
                    : [];
                return (
                    <div key={cat} className="space-y-2">
                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                            {cat}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {catQuals.map(qual => {
                                const isAssigned = assignedQualIds.includes(qual.id);
                                const requiresCert = qual.requires_certificate === true;
                                return (
                                    <button
                                        key={qual.id}
                                        type="button"
                                        onClick={() => toggleHandler(qual.id)}
                                        title={qual.description || qual.name}
                                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-all ${
                                            isAssigned
                                                ? 'border-indigo-300 bg-white shadow-sm'
                                                : 'border-slate-200 bg-slate-50/60 hover:bg-white hover:border-slate-300 opacity-80'
                                        }`}
                                    >
                                        <Checkbox
                                            checked={isAssigned}
                                            onCheckedChange={() => toggleHandler(qual.id)}
                                            className="pointer-events-none shrink-0"
                                        />
                                        <Badge
                                            style={{
                                                backgroundColor: qual.color_bg || '#e0e7ff',
                                                color: qual.color_text || '#3730a3',
                                            }}
                                            className="border-0 text-[10px] shrink-0"
                                        >
                                            {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                                        </Badge>
                                        <span className="text-xs font-medium text-slate-700 truncate flex-1">
                                            {qual.name}
                                        </span>
                                        {requiresCert && (
                                            <FileCheck
                                                className="w-3.5 h-3.5 text-amber-600 shrink-0"
                                                title="Zertifikat erforderlich"
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        {certRequiredAssigned.length > 0 && (
                            <div className="space-y-2 pt-1">
                                {certRequiredAssigned.map(qual => {
                                    const dqEntry = doctorQuals.find(dq => dq.qualification_id === qual.id);
                                    return (
                                        <CertificateManager
                                            key={qual.id}
                                            doctorId={doctorId}
                                            qualificationId={qual.id}
                                            qualificationName={qual.name}
                                            doctorQualificationId={dqEntry?.id || null}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
            {!doctorId && activeQuals.some(q => q.requires_certificate === true && assignedQualIds.includes(q.id)) && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    Hinweis: Zertifikate können erst nach dem Speichern des Teammitglieds hochgeladen werden.
                </div>
            )}
        </div>
    );
}

/**
 * Readonly Badge-Anzeige der Qualifikationen eines Mitarbeiters.
 * Für die Team-Liste und den Dienstplan.
 */
export function DoctorQualificationBadges({ doctorId, qualificationMap, allDoctorQualifications }) {
    // Get this doctor's qualification IDs
    const doctorQualIds = allDoctorQualifications
        ? (allDoctorQualifications[doctorId] || []).map(dq => dq.qualification_id)
        : [];

    if (doctorQualIds.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-1">
            {doctorQualIds.map(qualId => {
                const qual = qualificationMap?.[qualId];
                if (!qual || qual.is_active === false) return null;
                return (
                    <Badge
                        key={qualId}
                        style={{ 
                            backgroundColor: qual.color_bg || '#e0e7ff', 
                            color: qual.color_text || '#3730a3' 
                        }}
                        className="border-0 text-[10px] px-1.5 py-0"
                        title={`${qual.name}${qual.description ? ': ' + qual.description : ''}`}
                    >
                        {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                    </Badge>
                );
            })}
        </div>
    );
}
