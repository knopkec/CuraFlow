import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

const DEFAULT_WARNING_DAYS = 60;

/**
 * Liefert Zertifikate eines bestimmten Mitarbeiters (oder einer Qualifikation).
 * Nicht-Admins erhalten serverseitig automatisch nur eigene Datensätze.
 */
export function useCertificates({ doctorId = null, qualificationId = null, enabled = true } = {}) {
    const queryClient = useQueryClient();

    const queryKey = ['certificates', { doctorId, qualificationId }];

    // Wenn mindestens eine Analyse noch im Status 'pending' steht, automatisch
    // alle 3s neu laden, bis das Ergebnis vorliegt.
    const { data: certificates = [], isLoading, refetch } = useQuery({
        queryKey,
        queryFn: () => api.listCertificates({
            doctor_id: doctorId || undefined,
            qualification_id: qualificationId || undefined,
        }),
        enabled,
        refetchInterval: (query) => {
            const data = query.state.data;
            if (Array.isArray(data) && data.some((c) => c.analysis_status === 'pending')) {
                return 3000;
            }
            return false;
        },
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['certificates'] });
        queryClient.invalidateQueries({ queryKey: ['certificates-expiring'] });
    };

    const uploadMutation = useMutation({
        mutationFn: (payload) => api.uploadCertificate(payload),
        onSuccess: invalidate,
    });

    const checkMutation = useMutation({
        mutationFn: (payload) => api.checkCertificate(payload),
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, ...rest }) => api.updateCertificate(id, rest),
        onSuccess: invalidate,
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => api.deleteCertificate(id),
        onSuccess: invalidate,
    });

    const reanalyzeMutation = useMutation({
        mutationFn: ({ id, qualification_name, qualification_description }) =>
            api.reanalyzeCertificate(id, { qualification_name, qualification_description }),
        onSuccess: invalidate,
    });

    return {
        certificates,
        isLoading,
        refetch,
        checkCertificate: checkMutation.mutateAsync,
        uploadCertificate: uploadMutation.mutateAsync,
        updateCertificate: updateMutation.mutateAsync,
        deleteCertificate: deleteMutation.mutateAsync,
        reanalyzeCertificate: reanalyzeMutation.mutateAsync,
        isChecking: checkMutation.isPending,
        isUploading: uploadMutation.isPending,
        isUpdating: updateMutation.isPending,
        isDeleting: deleteMutation.isPending,
        isReanalyzing: reanalyzeMutation.isPending,
    };
}

/**
 * Liefert Zertifikate, die innerhalb des Warnzeitraums ablaufen oder
 * bereits abgelaufen sind. Server-seitig auf den eigenen Mitarbeiter
 * beschränkt für Nicht-Admins.
 */
export function useExpiringCertificates({ days = DEFAULT_WARNING_DAYS, enabled = true } = {}) {
    const { data = [], isLoading, refetch } = useQuery({
        queryKey: ['certificates-expiring', days],
        queryFn: () => api.listExpiringCertificates(days),
        enabled,
        staleTime: 5 * 60 * 1000,
    });

    return { expiring: data, isLoading, refetch };
}

/**
 * Lädt eine Datei vom Server und öffnet sie in einem neuen Tab via Blob-URL.
 */
export async function openCertificateInNewTab(certificateId) {
    const blob = await api.fetchCertificateBlob(certificateId);
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    // Revoke nach kurzer Zeit, damit der neue Tab den Inhalt laden konnte.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (!win) {
        // Pop-up-Blocker: alternativ als Download-Link triggern.
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}
