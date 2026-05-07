import React, { useMemo, useRef, useState } from 'react';
import { format, differenceInCalendarDays, isValid, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import {
    FileCheck, Upload, Trash2, Eye, AlertTriangle, Loader2,
    CalendarClock, FileText, Save, Sparkles, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useCertificates, openCertificateInNewTab } from '@/hooks/useCertificates';

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const MAX_SIZE = 5 * 1024 * 1024;
const WARN_DAYS = 60;

function formatDate(value) {
    if (!value) return '–';
    try {
        const d = typeof value === 'string' ? parseISO(value) : value;
        return isValid(d) ? format(d, 'dd.MM.yyyy', { locale: de }) : '–';
    } catch {
        return '–';
    }
}

function getExpiryStatus(expiry_date) {
    if (!expiry_date) return null;
    const d = typeof expiry_date === 'string' ? parseISO(expiry_date) : expiry_date;
    if (!isValid(d)) return null;
    const days = differenceInCalendarDays(d, new Date());
    if (days < 0) return { kind: 'expired', days, label: `Abgelaufen seit ${Math.abs(days)} Tagen` };
    if (days <= WARN_DAYS) return { kind: 'soon', days, label: `Läuft in ${days} Tagen ab` };
    return { kind: 'ok', days, label: `Gültig bis ${formatDate(expiry_date)}` };
}

function AnalysisBadge({ cert }) {
    const status = cert.analysis_status;
    if (!status || status === 'skipped') return null;

    const map = {
        pending:  { cls: 'bg-slate-100 text-slate-600 border-slate-300', icon: <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />, label: 'KI-Prüfung läuft...' },
        passed:   { cls: 'bg-emerald-50 text-emerald-700 border-emerald-300', icon: <ShieldCheck className="w-2.5 h-2.5 mr-1" />, label: 'KI-geprüft' },
        warning:  { cls: 'bg-amber-50 text-amber-700 border-amber-300', icon: <ShieldAlert className="w-2.5 h-2.5 mr-1" />, label: 'KI: Scope passt evtl. nicht' },
        failed:   { cls: 'bg-red-50 text-red-700 border-red-300', icon: <ShieldAlert className="w-2.5 h-2.5 mr-1" />, label: 'KI: kein Zertifikat erkannt' },
        error:    { cls: 'bg-slate-100 text-slate-500 border-slate-300', icon: <AlertTriangle className="w-2.5 h-2.5 mr-1" />, label: 'KI-Prüfung fehlgeschlagen' },
    };
    const cfg = map[status] || map.error;

    const tooltipParts = [];
    if (cert.analysis_scope_detected) tooltipParts.push(`Erkannt: ${cert.analysis_scope_detected}`);
    if (typeof cert.analysis_confidence === 'number') tooltipParts.push(`Konfidenz: ${(cert.analysis_confidence * 100).toFixed(0)}%`);
    if (cert.analysis_reasoning) tooltipParts.push(cert.analysis_reasoning);

    return (
        <div className="mt-1">
            <Badge
                variant="outline"
                className={`text-[10px] ${cfg.cls}`}
                title={tooltipParts.join('\n') || undefined}
            >
                {cfg.icon}
                {cfg.label}
            </Badge>
            {(status === 'warning' || status === 'failed') && cert.analysis_reasoning && (
                <div className="text-[11px] text-slate-600 mt-1 italic">{cert.analysis_reasoning}</div>
            )}
        </div>
    );
}

export default function CertificateManager({
    doctorId,
    qualificationId,
    qualificationName,
    qualificationDescription,
    doctorQualificationId = null,
    canEdit = true,
}) {
    const { toast } = useToast();
    const fileInputRef = useRef(null);
    const [pendingFile, setPendingFile] = useState(null);
    const [grantedDate, setGrantedDate] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [notes, setNotes] = useState('');
    const [editId, setEditId] = useState(null);
    const [editGranted, setEditGranted] = useState('');
    const [editExpiry, setEditExpiry] = useState('');
    const [editNotes, setEditNotes] = useState('');

    const {
        certificates, isLoading, uploadCertificate, deleteCertificate, updateCertificate,
        reanalyzeCertificate, isUploading, isDeleting, isUpdating, isReanalyzing,
    } = useCertificates({
        doctorId,
        qualificationId,
        enabled: !!doctorId && !!qualificationId,
    });

    const sorted = useMemo(() => {
        return [...certificates].sort((a, b) => {
            const ax = a.expiry_date || a.uploaded_at || '';
            const bx = b.expiry_date || b.uploaded_at || '';
            return String(bx).localeCompare(String(ax));
        });
    }, [certificates]);

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!ALLOWED_TYPES.includes(file.type)) {
            toast({ variant: 'destructive', title: 'Dateityp nicht erlaubt', description: 'Erlaubt: PDF, JPEG, PNG.' });
            e.target.value = '';
            return;
        }
        if (file.size > MAX_SIZE) {
            toast({ variant: 'destructive', title: 'Datei zu groß', description: 'Maximal 5 MB.' });
            e.target.value = '';
            return;
        }
        setPendingFile(file);
    };

    const resetUploadForm = () => {
        setPendingFile(null);
        setGrantedDate('');
        setExpiryDate('');
        setNotes('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleUpload = async () => {
        if (!pendingFile) return;
        try {
            await uploadCertificate({
                file: pendingFile,
                doctor_id: doctorId,
                qualification_id: qualificationId,
                doctor_qualification_id: doctorQualificationId,
                granted_date: grantedDate || undefined,
                expiry_date: expiryDate || undefined,
                notes: notes || undefined,
                qualification_name: qualificationName,
                qualification_description: qualificationDescription,
            });
            toast({ title: 'Zertifikat hochgeladen', description: `${pendingFile.name} – Analyse läuft...` });
            resetUploadForm();
        } catch (err) {
            toast({ variant: 'destructive', title: 'Upload fehlgeschlagen', description: err.message });
        }
    };

    const handleReanalyze = async (cert) => {
        try {
            await reanalyzeCertificate({
                id: cert.id,
                qualification_name: qualificationName,
                qualification_description: qualificationDescription,
            });
            toast({ title: 'Analyse gestartet', description: 'Ergebnis erscheint in Kürze.' });
        } catch (err) {
            toast({ variant: 'destructive', title: 'Analyse fehlgeschlagen', description: err.message });
        }
    };

    const handleDelete = async (cert) => {
        try {
            await deleteCertificate(cert.id);
            toast({ title: 'Zertifikat gelöscht', description: cert.file_name });
        } catch (err) {
            toast({ variant: 'destructive', title: 'Löschen fehlgeschlagen', description: err.message });
        }
    };

    const handleView = async (cert) => {
        try {
            await openCertificateInNewTab(cert.id);
        } catch (err) {
            toast({ variant: 'destructive', title: 'Datei kann nicht geöffnet werden', description: err.message });
        }
    };

    const startEdit = (cert) => {
        setEditId(cert.id);
        setEditGranted(cert.granted_date || '');
        setEditExpiry(cert.expiry_date || '');
        setEditNotes(cert.notes || '');
    };

    const cancelEdit = () => {
        setEditId(null);
        setEditGranted('');
        setEditExpiry('');
        setEditNotes('');
    };

    const saveEdit = async () => {
        if (!editId) return;
        try {
            await updateCertificate({
                id: editId,
                granted_date: editGranted || null,
                expiry_date: editExpiry || null,
                notes: editNotes || null,
            });
            toast({ title: 'Zertifikat aktualisiert' });
            cancelEdit();
        } catch (err) {
            toast({ variant: 'destructive', title: 'Speichern fehlgeschlagen', description: err.message });
        }
    };

    return (
        <div className="border rounded-md bg-amber-50/30 border-amber-200 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                <FileCheck className="w-4 h-4" />
                Zertifikat erforderlich – {qualificationName || 'Qualifikation'}
            </div>

            {isLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin" /> Wird geladen...
                </div>
            ) : sorted.length === 0 ? (
                <div className="text-xs text-slate-500 italic">
                    Noch kein Zertifikat hinterlegt.
                </div>
            ) : (
                <ul className="space-y-2">
                    {sorted.map((cert) => {
                        const status = getExpiryStatus(cert.expiry_date);
                        const isEditing = editId === cert.id;
                        return (
                            <li key={cert.id} className="bg-white border rounded p-2 text-sm">
                                <div className="flex items-start gap-2">
                                    <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <button
                                            type="button"
                                            onClick={() => handleView(cert)}
                                            className="font-medium text-slate-800 truncate text-left hover:text-indigo-600"
                                            title={cert.file_name}
                                        >
                                            {cert.file_name}
                                        </button>
                                        <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                            <span>Ausgestellt: {formatDate(cert.granted_date)}</span>
                                            <span>Gültig bis: {formatDate(cert.expiry_date)}</span>
                                            <span>{(cert.file_size / 1024).toFixed(0)} KB</span>
                                        </div>
                                        {status && (
                                            <Badge
                                                variant="outline"
                                                className={`text-[10px] mt-1 ${
                                                    status.kind === 'expired'
                                                        ? 'bg-red-50 text-red-700 border-red-300'
                                                        : status.kind === 'soon'
                                                        ? 'bg-amber-50 text-amber-700 border-amber-300'
                                                        : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                                }`}
                                            >
                                                {status.kind !== 'ok' && <AlertTriangle className="w-2.5 h-2.5 mr-1" />}
                                                {status.label}
                                            </Badge>
                                        )}
                                        <AnalysisBadge cert={cert} />
                                        {cert.notes && (
                                            <div className="text-xs text-slate-500 mt-1 italic">{cert.notes}</div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-1 shrink-0">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => handleView(cert)}
                                            title="Anzeigen"
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                        </Button>
                                        {canEdit && !isEditing && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => startEdit(cert)}
                                                title="Daten bearbeiten"
                                            >
                                                <CalendarClock className="w-3.5 h-3.5" />
                                            </Button>
                                        )}
                                        {canEdit && cert.analysis_status !== 'pending' && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-indigo-500 hover:text-indigo-700"
                                                onClick={() => handleReanalyze(cert)}
                                                title="KI-Prüfung neu starten"
                                                disabled={isReanalyzing}
                                            >
                                                <Sparkles className="w-3.5 h-3.5" />
                                            </Button>
                                        )}
                                        {canEdit && (
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-red-500 hover:text-red-700"
                                                        title="Löschen"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Zertifikat löschen?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            „{cert.file_name}" wird unwiderruflich gelöscht.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={() => handleDelete(cert)}
                                                            className="bg-red-600 hover:bg-red-700"
                                                            disabled={isDeleting}
                                                        >
                                                            Löschen
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        )}
                                    </div>
                                </div>
                                {isEditing && (
                                    <div className="mt-2 grid gap-2 sm:grid-cols-2 border-t pt-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Ausstellungsdatum</Label>
                                            <Input
                                                type="date"
                                                value={editGranted}
                                                onChange={(e) => setEditGranted(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Ablaufdatum</Label>
                                            <Input
                                                type="date"
                                                value={editExpiry}
                                                onChange={(e) => setEditExpiry(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1 sm:col-span-2">
                                            <Label className="text-xs">Notiz</Label>
                                            <Input
                                                value={editNotes}
                                                onChange={(e) => setEditNotes(e.target.value)}
                                                placeholder="optional"
                                                maxLength={500}
                                            />
                                        </div>
                                        <div className="sm:col-span-2 flex justify-end gap-2">
                                            <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>
                                                Abbrechen
                                            </Button>
                                            <Button type="button" size="sm" onClick={saveEdit} disabled={isUpdating}>
                                                {isUpdating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                                                Speichern
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {canEdit && (
                <div className="border-t pt-3 space-y-2">
                    <div className="text-xs font-semibold text-slate-600">Neues Zertifikat hochladen</div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        onChange={handleFileChange}
                        className="block w-full text-xs file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-amber-100 file:text-amber-700 hover:file:bg-amber-200"
                    />
                    {pendingFile && (
                        <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label className="text-xs">Ausstellungsdatum</Label>
                                <Input
                                    type="date"
                                    value={grantedDate}
                                    onChange={(e) => setGrantedDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Ablaufdatum (optional)</Label>
                                <Input
                                    type="date"
                                    value={expiryDate}
                                    onChange={(e) => setExpiryDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                                <Label className="text-xs">Notiz (optional)</Label>
                                <Input
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="z.B. ausstellende Stelle"
                                    maxLength={500}
                                />
                            </div>
                            <div className="sm:col-span-2 flex justify-end gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={resetUploadForm}>
                                    Abbrechen
                                </Button>
                                <Button type="button" size="sm" onClick={handleUpload} disabled={isUploading}>
                                    {isUploading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}
                                    Hochladen
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
