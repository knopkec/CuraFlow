import { describe, expect, it } from 'vitest';
import { createScheduleShiftLookup, getShiftsForScheduleCell } from '@/components/schedule/scheduleShiftLookup';

describe('schedule shift lookup', () => {
    const shifts = [
        { id: 'late', date: '2026-05-26', position: 'CT', doctor_id: 'doc-2', timeslot_id: 'pm', order: 2 },
        { id: 'early', date: '2026-05-26', position: 'CT', doctor_id: 'doc-1', timeslot_id: 'am', order: 1 },
        { id: 'free', date: '2026-05-26', position: 'Frei', doctor_id: 'doc-3', order: 1 },
        { id: 'other-day', date: '2026-05-27', position: 'CT', doctor_id: 'doc-4', timeslot_id: 'am', order: 1 },
    ];

    it('returns ordered shifts for a date and position without scanning unrelated cells', () => {
        const shiftLookup = createScheduleShiftLookup(shifts);

        expect(getShiftsForScheduleCell({
            shiftLookup,
            dateStr: '2026-05-26',
            rowName: 'CT',
        }).map((shift) => shift.id)).toEqual(['early', 'late']);
    });

    it('limits shifts to the requested timeslot row', () => {
        const shiftLookup = createScheduleShiftLookup(shifts);

        expect(getShiftsForScheduleCell({
            shiftLookup,
            dateStr: '2026-05-26',
            rowName: 'CT',
            timeslotId: 'pm',
        }).map((shift) => shift.id)).toEqual(['late']);
    });

    it('deduplicates doctors in collapsed timeslot groups', () => {
        const shiftLookup = createScheduleShiftLookup([
            { id: 'am', date: '2026-05-26', position: 'CT', doctor_id: 'doc-1', timeslot_id: 'am', order: 1 },
            { id: 'pm', date: '2026-05-26', position: 'CT', doctor_id: 'doc-1', timeslot_id: 'pm', order: 2 },
            { id: 'other', date: '2026-05-26', position: 'CT', doctor_id: 'doc-2', timeslot_id: 'pm', order: 3 },
        ]);

        expect(getShiftsForScheduleCell({
            shiftLookup,
            dateStr: '2026-05-26',
            rowName: 'CT',
            allTimeslotIds: ['am', 'pm'],
        }).map((shift) => shift.id)).toEqual(['am', 'other']);
    });

    it('includes legacy unassigned shifts in compact timeslot-enabled rows', () => {
        const shiftLookup = createScheduleShiftLookup([
            { id: 'legacy', date: '2026-05-26', position: 'CT', doctor_id: 'doc-1', order: 1 },
            { id: 'pm', date: '2026-05-26', position: 'CT', doctor_id: 'doc-2', timeslot_id: 'pm', order: 2 },
        ]);

        expect(getShiftsForScheduleCell({
            shiftLookup,
            dateStr: '2026-05-26',
            rowName: 'CT',
            allTimeslotIds: ['am', 'pm'],
        }).map((shift) => shift.id)).toEqual(['legacy', 'pm']);
    });

    it('hides group-header shifts when timeslots are enabled', () => {
        const shiftLookup = createScheduleShiftLookup(shifts);

        expect(getShiftsForScheduleCell({
            shiftLookup,
            dateStr: '2026-05-26',
            rowName: 'CT',
            timeslotsEnabled: true,
        })).toEqual([]);
    });
});
