import React, { useMemo, useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Award, User, Check, X, Shield, AlertTriangle, FileCheck } from 'lucide-react';
import { useQualifications, useAllDoctorQualifications } from '@/hooks/useQualifications';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Interaktive Übersichts-Matrix: Welcher Mitarbeiter hat welche Qualifikation.
 * Qualifikationen können direkt per Klick gesetzt/entfernt werden.
 */
export default function QualificationOverview({ doctors = [], isReadOnly = false }) {
    const queryClient = useQueryClient();
    const { qualifications, qualificationMap, isLoading: qualsLoading } = useQualifications();
    const { allDoctorQualifications, byDoctor, isLoading: dqLoading } = useAllDoctorQualifications();

    // Load all certificates (admins get all in tenant; non-admins only their own)
    // to detect doctor+qualification combos missing a required certificate.
    const { data: allCertificates = [], isLoading: certsLoading } = useQuery({
        queryKey: ['certificates', { doctorId: null, qualificationId: null }],
        queryFn: () => api.listCertificates(),
    });
    const certKeySet = useMemo(() => {
        const set = new Set();
        for (const c of allCertificates) {
            set.add(`${c.doctor_id}:${c.qualification_id}`);
        }
        return set;
    }, [allCertificates]);

    // Confirmation dialog state when assigning a cert-required qualification
    const [pendingAssign, setPendingAssign] = useState(null); // { doctorId, qual }

    const assignMutation = useMutation({
        mutationFn: (data) => db.DoctorQualification.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['allDoctorQualifications'] });
            queryClient.invalidateQueries({ queryKey: ['doctorQualifications'] });
        },
    });

    const removeMutation = useMutation({
        mutationFn: (id) => db.DoctorQualification.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['allDoctorQualifications'] });
            queryClient.invalidateQueries({ queryKey: ['doctorQualifications'] });
        },
    });

    const handleToggle = useCallback((doctorId, qualId) => {
        if (isReadOnly) return;
        const doctorEntries = byDoctor[doctorId] || [];
        const existing = doctorEntries.find(dq => dq.qualification_id === qualId);
        if (existing) {
            removeMutation.mutate(existing.id);
            return;
        }
        const qual = qualificationMap?.[qualId];
        if (qual?.requires_certificate) {
            // Defer the actual assignment until the user confirms.
            setPendingAssign({ doctorId, qual });
            return;
        }
        assignMutation.mutate({ doctor_id: doctorId, qualification_id: qualId });
    }, [byDoctor, isReadOnly, assignMutation, removeMutation, qualificationMap]);

    const confirmAssign = () => {
        if (!pendingAssign) return;
        assignMutation.mutate({
            doctor_id: pendingAssign.doctorId,
            qualification_id: pendingAssign.qual.id,
        });
        setPendingAssign(null);
    };

    const activeQuals = qualifications.filter(q => q.is_active !== false);
    const isLoading = qualsLoading || dqLoading || certsLoading;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-32 text-slate-400">
                Wird geladen...
            </div>
        );
    }

    if (activeQuals.length === 0) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-slate-500">
                    <Award className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <h3 className="font-semibold text-lg mb-2">Noch keine Qualifikationen angelegt</h3>
                    <p className="text-sm">
                        Verwenden Sie den <Shield className="w-4 h-4 inline" /> Qualifikations-Manager oben rechts, um Qualifikationen anzulegen.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                    <Award className="w-5 h-5" />
                    Qualifikations-Matrix
                </CardTitle>
                <p className="text-sm text-slate-500">
                    Übersicht aller Qualifikationen und ihrer Zuordnung zu Teammitgliedern.
                    {!isReadOnly && " Klicken Sie auf eine Zelle, um eine Qualifikation zuzuweisen oder zu entfernen."}
                </p>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 px-3 font-medium text-slate-600 sticky left-0 bg-white min-w-[180px]">
                                    Mitarbeiter
                                </th>
                                {activeQuals.map(qual => (
                                    <th key={qual.id} className="text-center py-2 px-2 font-medium min-w-[80px]">
                                        <div className="flex flex-col items-center gap-1">
                                            <Badge
                                                style={{ 
                                                    backgroundColor: qual.color_bg || '#e0e7ff', 
                                                    color: qual.color_text || '#3730a3' 
                                                }}
                                                className="border-0 text-[10px]"
                                            >
                                                {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                                            </Badge>
                                            <span className="text-[10px] text-slate-500 font-normal whitespace-nowrap">
                                                {qual.name}
                                            </span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {doctors.map(doctor => {
                                const doctorQualIds = (byDoctor[doctor.id] || []).map(dq => dq.qualification_id);
                                return (
                                    <tr key={doctor.id} className="border-b hover:bg-slate-50">
                                        <td className="py-2 px-3 sticky left-0 bg-white">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 flex-shrink-0">
                                                    {doctor.initials || <User className="w-3 h-3" />}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-slate-900 text-sm">{doctor.name}</div>
                                                    <div className="text-[10px] text-slate-400">{doctor.role}</div>
                                                </div>
                                            </div>
                                        </td>
                                        {activeQuals.map(qual => {
                                            const hasQual = doctorQualIds.includes(qual.id);
                                            const isPending = assignMutation.isPending || removeMutation.isPending;
                                            const requiresCert = qual.requires_certificate === true;
                                            const hasCert = certKeySet.has(`${doctor.id}:${qual.id}`);
                                            const missingCert = hasQual && requiresCert && !hasCert;
                                            const tooltip = !isReadOnly
                                                ? (missingCert
                                                    ? `${qual.name}: kein Zertifikat hinterlegt – bitte im Mitarbeiter-Profil hochladen`
                                                    : (hasQual ? `${qual.name} entfernen` : `${qual.name} zuweisen`))
                                                : (missingCert ? `${qual.name}: kein Zertifikat hinterlegt` : '');
                                            return (
                                                <td 
                                                    key={qual.id} 
                                                    className={`text-center py-2 px-2 ${
                                                        !isReadOnly ? 'cursor-pointer hover:bg-slate-100 transition-colors' : ''
                                                    } ${missingCert ? 'bg-amber-50/60' : ''}`}
                                                    onClick={() => !isPending && handleToggle(doctor.id, qual.id)}
                                                    title={tooltip}
                                                >
                                                    {hasQual ? (
                                                        missingCert ? (
                                                            <span className="inline-flex items-center justify-center gap-0.5" aria-label="Zertifikat fehlt">
                                                                <Check className="w-4 h-4 text-green-600" />
                                                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                                            </span>
                                                        ) : (
                                                            <Check className="w-4 h-4 text-green-600 mx-auto" />
                                                        )
                                                    ) : (
                                                        <span className={`inline-block w-4 h-4 mx-auto rounded border ${
                                                            !isReadOnly ? 'border-slate-300 hover:border-indigo-400' : 'border-transparent'
                                                        }`}>
                                                            {isReadOnly && <X className="w-4 h-4 text-slate-200" />}
                                                        </span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                        {/* Footer: Count per qualification */}
                        <tfoot>
                            <tr className="border-t bg-slate-50">
                                <td className="py-2 px-3 text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50">
                                    Gesamt
                                </td>
                                {activeQuals.map(qual => {
                                    const count = doctors.filter(doc => {
                                        const dqIds = (byDoctor[doc.id] || []).map(dq => dq.qualification_id);
                                        return dqIds.includes(qual.id);
                                    }).length;
                                    return (
                                        <td key={qual.id} className="text-center py-2 px-2 text-xs font-semibold text-slate-600">
                                            {count}/{doctors.length}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </CardContent>

            {/* Hinweis-Dialog beim Zuweisen einer zertifikatpflichtigen Qualifikation */}
            <AlertDialog open={!!pendingAssign} onOpenChange={(open) => { if (!open) setPendingAssign(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-amber-800">
                            <FileCheck className="w-5 h-5" />
                            Zertifikat-Upload erforderlich
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm text-slate-600">
                                <p>
                                    Für die Qualifikation <strong>{pendingAssign?.qual?.name}</strong> ist ein
                                    Nachweis (PDF, JPEG oder PNG, max. 5 MB) erforderlich.
                                </p>
                                <p>
                                    Nach dem Bestätigen wird die Qualifikation zugewiesen.
                                    Bitte laden Sie das Zertifikat anschließend hoch:
                                </p>
                                <ol className="list-decimal list-inside space-y-1 text-xs bg-slate-50 p-3 rounded">
                                    <li>Mitarbeiter öffnen (Stift-Symbol in der Liste).</li>
                                    <li>Im Bereich <em>Qualifikationen &amp; Berechtigungen</em> erscheint unter
                                        „{pendingAssign?.qual?.name}“ ein gelbes Upload-Feld.</li>
                                    <li>Datei auswählen, optional Ausstellungs- und Ablaufdatum eintragen,
                                        dann <em>Hochladen</em>.</li>
                                </ol>
                                <p className="text-xs text-amber-700">
                                    Solange kein Zertifikat hinterlegt ist, wird die Qualifikation in dieser
                                    Matrix mit einem Warn-Symbol markiert.
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmAssign} className="bg-amber-600 hover:bg-amber-700">
                            Verstanden, jetzt zuweisen
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
