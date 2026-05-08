import React, { useMemo, useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Award, User, Check, X, Shield, AlertTriangle, FileCheck, Loader2, Mail } from 'lucide-react';
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
    const { toast } = useToast();
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

    const { data: loginUsers = [], isLoading: usersLoading } = useQuery({
        queryKey: ['authUsersForCertificateReminder'],
        queryFn: () => api.listUsers(),
        enabled: !isReadOnly,
    });

    // Confirmation dialog state when assigning a cert-required qualification
    const [pendingAssign, setPendingAssign] = useState(null); // { doctorId, qual }
    const [isReminderDialogOpen, setIsReminderDialogOpen] = useState(false);
    const [selectedReminderDoctorIds, setSelectedReminderDoctorIds] = useState([]);
    const [isSendingReminders, setIsSendingReminders] = useState(false);

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

    const activeQuals = useMemo(() => qualifications.filter(q => q.is_active !== false), [qualifications]);
    const isLoading = qualsLoading || dqLoading || certsLoading;

    const reminderCandidates = useMemo(() => {
        const usersByDoctor = loginUsers.reduce((acc, user) => {
            if (!user?.doctor_id || !user?.email) return acc;
            if (!acc[user.doctor_id]) acc[user.doctor_id] = [];
            acc[user.doctor_id].push(user);
            return acc;
        }, {});

        return doctors
            .map((doctor) => {
                const doctorQuals = byDoctor[doctor.id] || [];
                const linkedUsers = usersByDoctor[doctor.id] || [];
                const pendingQualifications = activeQuals
                    .map((qual) => {
                        const dqEntry = doctorQuals.find((dq) => dq.qualification_id === qual.id);
                        const hasQual = !!dqEntry;
                        const requiresCert = qual.requires_certificate === true;
                        const hasCert = certKeySet.has(`${doctor.id}:${qual.id}`);
                        const certStatus = dqEntry?.certificate_status || null;
                        const missingCert = hasQual && requiresCert && !hasCert;
                        const certWarning = hasQual && requiresCert && (
                            missingCert
                            || certStatus === 'expired'
                            || certStatus === 'incomplete'
                            || certStatus === 'missing'
                        );

                        if (!certWarning) return null;

                        let statusLabel = 'Nachweise unvollstaendig';
                        if (missingCert) statusLabel = 'kein Zertifikat hinterlegt';
                        else if (certStatus === 'expired') statusLabel = 'Nachweis abgelaufen';

                        return {
                            id: qual.id,
                            name: qual.name,
                            statusLabel,
                        };
                    })
                    .filter(Boolean);

                return {
                    doctor_id: doctor.id,
                    doctor_name: doctor.name,
                    qualification_ids: pendingQualifications.map((qualification) => qualification.id),
                    pendingQualifications,
                    recipientEmails: Array.from(new Set(linkedUsers.map((user) => user.email).filter(Boolean))),
                    hasCentralLink: !!doctor.central_employee_id,
                };
            })
            .filter((candidate) => candidate.pendingQualifications.length > 0);
    }, [activeQuals, byDoctor, certKeySet, doctors, loginUsers]);

    const eligibleReminderCandidates = useMemo(() => {
        return reminderCandidates.filter((candidate) => candidate.hasCentralLink && candidate.recipientEmails.length > 0);
    }, [reminderCandidates]);

    const excludedReminderCandidates = reminderCandidates.length - eligibleReminderCandidates.length;

    const toggleReminderDoctor = useCallback((doctorId) => {
        setSelectedReminderDoctorIds((current) => (
            current.includes(doctorId)
                ? current.filter((id) => id !== doctorId)
                : [...current, doctorId]
        ));
    }, []);

    const handleSendReminders = useCallback(async () => {
        const recipients = eligibleReminderCandidates
            .filter((candidate) => selectedReminderDoctorIds.includes(candidate.doctor_id))
            .map((candidate) => ({
                doctor_id: candidate.doctor_id,
                qualification_ids: candidate.qualification_ids,
            }));

        if (recipients.length === 0) {
            toast({
                variant: 'destructive',
                title: 'Keine Empfaenger ausgewaehlt',
                description: 'Waehlen Sie mindestens einen Mitarbeiter mit regularem Login und Zentral-Verknuepfung aus.',
            });
            return;
        }

        setIsSendingReminders(true);
        try {
            const result = await api.sendCertificateReminderEmails(recipients);
            toast({
                title: 'Erinnerungen gesendet',
                description: `${result.sent_count || 0} E-Mail(s) wurden verschickt.`,
            });
            setIsReminderDialogOpen(false);
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Versand fehlgeschlagen',
                description: error.message,
            });
        } finally {
            setIsSendingReminders(false);
        }
    }, [eligibleReminderCandidates, selectedReminderDoctorIds, toast]);

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
        <Card className="flex h-full min-h-0 flex-col">
            <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Award className="w-5 h-5" />
                            Qualifikations-Matrix
                        </CardTitle>
                        <p className="text-sm text-slate-500 mt-1">
                            Übersicht aller Qualifikationen und ihrer Zuordnung zu Teammitgliedern.
                            {!isReadOnly && " Klicken Sie auf eine Zelle, um eine Qualifikation zuzuweisen oder zu entfernen."}
                        </p>
                    </div>
                    {!isReadOnly && (
                        <Button
                            type="button"
                            variant="outline"
                            className="gap-2"
                            disabled={usersLoading || eligibleReminderCandidates.length === 0}
                            onClick={() => {
                                setSelectedReminderDoctorIds(eligibleReminderCandidates.map((candidate) => candidate.doctor_id));
                                setIsReminderDialogOpen(true);
                            }}
                        >
                            {usersLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                            Zertifikats-Erinnerung
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
                <div className="h-full overflow-auto rounded-lg border border-slate-200">
                    <table className="min-w-max text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="sticky left-0 top-0 z-20 min-w-[180px] bg-white px-3 py-2 text-left font-medium text-slate-600">
                                    Mitarbeiter
                                </th>
                                {activeQuals.map(qual => (
                                    <th key={qual.id} className="sticky top-0 z-10 min-w-[80px] bg-white px-2 py-2 text-center font-medium">
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
                                        <td className="sticky left-0 bg-white px-3 py-2">
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
                                            const dqEntry = (byDoctor[doctor.id] || []).find(dq => dq.qualification_id === qual.id);
                                            const hasQual = !!dqEntry;
                                            const isPending = assignMutation.isPending || removeMutation.isPending;
                                            const requiresCert = qual.requires_certificate === true;
                                            const hasCert = certKeySet.has(`${doctor.id}:${qual.id}`);
                                            const certStatus = dqEntry?.certificate_status || null;
                                            const certValidUntil = dqEntry?.certificate_valid_until || dqEntry?.expiry_date || null;
                                            const missingCert = hasQual && requiresCert && !hasCert;
                                            const certWarning = hasQual && requiresCert && (
                                                missingCert
                                                || certStatus === 'expired'
                                                || certStatus === 'incomplete'
                                                || certStatus === 'missing'
                                            );
                                            const tooltip = !isReadOnly
                                                ? (certWarning
                                                    ? `${qual.name}: ${missingCert ? 'kein Zertifikat hinterlegt' : (certStatus === 'expired' ? `Nachweis abgelaufen${certValidUntil ? ` (${certValidUntil})` : ''}` : 'Nachweise unvollständig')} – bitte im Mitarbeiter-Profil prüfen`
                                                    : (hasQual ? `${qual.name} entfernen` : `${qual.name} zuweisen`))
                                                : (certWarning
                                                    ? `${qual.name}: ${missingCert ? 'kein Zertifikat hinterlegt' : (certStatus === 'expired' ? `abgelaufen${certValidUntil ? ` bis ${certValidUntil}` : ''}` : 'Nachweise unvollständig')}`
                                                    : '');
                                            return (
                                                <td 
                                                    key={qual.id} 
                                                    className={`text-center py-2 px-2 ${
                                                        !isReadOnly ? 'cursor-pointer hover:bg-slate-100 transition-colors' : ''
                                                    } ${certWarning ? 'bg-amber-50/60' : ''}`}
                                                    onClick={() => !isPending && handleToggle(doctor.id, qual.id)}
                                                    title={tooltip}
                                                >
                                                    {hasQual ? (
                                                        certWarning ? (
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
                                <td className="sticky left-0 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
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
                        <AlertDialogDescription>
                            Für die Qualifikation <strong>{pendingAssign?.qual?.name}</strong> ist ein
                            Nachweis (PDF, JPEG oder PNG, max. 5 MB) erforderlich.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2 text-sm text-slate-600">
                        <p>
                            Nach dem Bestätigen wird die Qualifikation zugewiesen.
                            Bitte laden Sie das Zertifikat anschließend hoch:
                        </p>
                        <ol className="list-decimal list-inside space-y-1 text-xs bg-slate-50 p-3 rounded">
                            <li>Mitarbeiter öffnen (Stift-Symbol in der Liste).</li>
                            <li>Im Bereich <em>Qualifikationen &amp; Berechtigungen</em> erscheint unter
                                „{pendingAssign?.qual?.name}" ein gelbes Upload-Feld.</li>
                            <li>Datei auswählen, optional Ausstellungs- und Ablaufdatum eintragen,
                                dann <em>Hochladen</em>.</li>
                        </ol>
                        <p className="text-xs text-amber-700">
                            Solange kein Zertifikat hinterlegt ist, wird die Qualifikation in dieser
                            Matrix mit einem Warn-Symbol markiert.
                        </p>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmAssign} className="bg-amber-600 hover:bg-amber-700">
                            Verstanden, jetzt zuweisen
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={isReminderDialogOpen} onOpenChange={(open) => {
                setIsReminderDialogOpen(open);
                if (!open) {
                    setSelectedReminderDoctorIds([]);
                }
            }}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Mail className="h-5 w-5" /> Zertifikats-Erinnerungen senden
                        </DialogTitle>
                        <DialogDescription>
                            Beruecksichtigt werden nur Mitarbeiter mit offenem oder ungueltigem Nachweis, aktivem regulaerem Login, doctor_id-Verknuepfung und zentraler Mitarbeiter-Verknuepfung.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            <span>{eligibleReminderCandidates.length} Mitarbeiter koennen benachrichtigt werden.</span>
                            {excludedReminderCandidates > 0 && (
                                <span>{excludedReminderCandidates} weitere Faelle sind wegen fehlender Verknuepfung ausgeschlossen.</span>
                            )}
                        </div>

                        {eligibleReminderCandidates.length > 0 && (
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => setSelectedReminderDoctorIds(eligibleReminderCandidates.map((candidate) => candidate.doctor_id))}>
                                    Alle auswaehlen
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => setSelectedReminderDoctorIds([])}>
                                    Auswahl leeren
                                </Button>
                            </div>
                        )}

                        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                            {eligibleReminderCandidates.length === 0 ? (
                                <div className="rounded-md border border-slate-200 px-3 py-6 text-sm text-slate-500">
                                    Aktuell gibt es keine versandfaehigen Empfaenger nach den vorgegebenen Kriterien.
                                </div>
                            ) : eligibleReminderCandidates.map((candidate) => {
                                const isSelected = selectedReminderDoctorIds.includes(candidate.doctor_id);
                                return (
                                    <button
                                        type="button"
                                        key={candidate.doctor_id}
                                        onClick={() => toggleReminderDoctor(candidate.doctor_id)}
                                        className="flex gap-3 rounded-md border border-slate-200 px-3 py-3 hover:bg-slate-50"
                                    >
                                        <Checkbox
                                            checked={isSelected}
                                            className="mt-0.5 pointer-events-none"
                                        />
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <div className="font-medium text-slate-900">{candidate.doctor_name}</div>
                                                <Badge variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-800">
                                                    {candidate.pendingQualifications.length} offene Qualifikation{candidate.pendingQualifications.length === 1 ? '' : 'en'}
                                                </Badge>
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {candidate.recipientEmails.join(', ')}
                                            </div>
                                            <div className="flex flex-wrap gap-2 pt-1">
                                                {candidate.pendingQualifications.map((qualification) => (
                                                    <Badge key={qualification.id} variant="outline" className="text-[10px] border-slate-300 text-slate-700">
                                                        {qualification.name}: {qualification.statusLabel}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsReminderDialogOpen(false)} disabled={isSendingReminders}>
                            Abbrechen
                        </Button>
                        <Button type="button" onClick={handleSendReminders} disabled={isSendingReminders || selectedReminderDoctorIds.length === 0}>
                            {isSendingReminders ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                            Erinnerung senden
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
