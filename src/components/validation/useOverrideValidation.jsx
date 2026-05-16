import { useState, useCallback } from 'react';
import { db } from '@/api/client';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

/**
 * Hook für Override-Validierung mit Dialog und Logging
 * 
 * Dieser Hook verwaltet:
 * - Den Override-Dialog-State
 * - Das Logging von Overrides
 * - Die Integration mit der Shift-Validierung
 */
export function useOverrideValidation({ user, doctors = [] } = {}) {
    const [overrideDialog, setOverrideDialog] = useState({
        open: false,
        blockers: [],
        warnings: [],
        context: {},
        pendingAction: null,
        resolve: null
    });

    /**
     * Loggt einen Override ins SystemLog
     */
    const logOverride = useCallback(async ({
        doctorId,
        doctorName,
        date,
        position,
        blockers,
        warnings,
        reason,
        userName
    }) => {
        const formattedDate = typeof date === 'string' 
            ? date 
            : format(date, 'dd.MM.yyyy', { locale: de });

        const conflicts = [
            ...blockers.map(b => `[BLOCKER] ${b}`),
            ...warnings.map(w => `[WARNUNG] ${w}`)
        ];

        try {
            await db.SystemLog.create({
                level: 'override',
                source: 'Konflikt-Override',
                message: `Override für ${doctorName} am ${formattedDate} (${position})`,
                details: JSON.stringify({
                    doctor_id: doctorId,
                    doctor_name: doctorName,
                    date: formattedDate,
                    position: position,
                    conflicts: conflicts,
                    override_reason: reason,
                    overridden_by: userName,
                    timestamp: new Date().toISOString()
                })
            });
        } catch (err) {
            console.error("Override-Log fehlgeschlagen:", err);
        }
    }, []);

    /**
     * Öffnet den Override-Dialog und wartet auf Benutzerinteraktion
     * @returns Promise<{ confirmed: boolean, reason?: string }>
     */
    const requestOverride = useCallback(({
        blockers = [],
        warnings = [],
        doctorId,
        doctorName,
        date,
        position,
        onConfirm
    }) => {
        return new Promise((resolve) => {
            const formattedDate = typeof date === 'string' 
                ? date 
                : format(new Date(date), 'dd.MM.yyyy', { locale: de });

            setOverrideDialog({
                open: true,
                blockers,
                warnings,
                context: {
                    doctorId,
                    doctorName: doctorName || doctors.find(d => d.id === doctorId)?.name || 'Unbekannt',
                    date: formattedDate,
                    position
                },
                pendingAction: onConfirm,
                resolve
            });
        });
    }, [doctors]);

    /**
     * Bestätigt den Override
     */
    const confirmOverride = useCallback(async (reason) => {
        const { context, blockers, warnings, pendingAction, resolve } = overrideDialog;

        // Log the override
        await logOverride({
            doctorId: context.doctorId,
            doctorName: context.doctorName,
            date: context.date,
            position: context.position,
            blockers,
            warnings,
            reason,
            userName: user?.email || user?.name || 'Unbekannt'
        });

        // Close dialog
        setOverrideDialog({
            open: false,
            blockers: [],
            warnings: [],
            context: {},
            pendingAction: null,
            resolve: null
        });

        // Execute pending action if provided
        if (pendingAction) {
            await pendingAction();
        }

        // Resolve the promise
        if (resolve) {
            resolve({ confirmed: true, reason });
        }
    }, [overrideDialog, logOverride, user]);

    /**
     * Bricht den Override ab
     */
    const cancelOverride = useCallback(() => {
        const { resolve } = overrideDialog;

        setOverrideDialog({
            open: false,
            blockers: [],
            warnings: [],
            context: {},
            pendingAction: null,
            resolve: null
        });

        if (resolve) {
            resolve({ confirmed: false });
        }
    }, [overrideDialog]);

    /**
     * Ändert den Dialog-State
     */
    const setOverrideDialogOpen = useCallback((open) => {
        if (!open) {
            cancelOverride();
        }
    }, [cancelOverride]);

    return {
        overrideDialog,
        requestOverride,
        confirmOverride,
        cancelOverride,
        setOverrideDialogOpen,
        logOverride
    };
}
