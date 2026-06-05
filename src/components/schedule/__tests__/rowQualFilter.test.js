import { describe, it, expect } from 'vitest';
import {
    buildRowQualSets,
    matchesRowQualFilter,
    getDoctorRowQualHint,
    getDoctorRowQualRingClass,
    rowKey,
} from '../rowQualFilter';

describe('rowQualFilter helpers', () => {
    describe('buildRowQualSets', () => {
        it('returns empty sets when workplaceId is missing', () => {
            const result = buildRowQualSets({
                workplaceId: null,
                getRequired: () => ['a'],
                getOptional: () => ['b'],
                getDiscouraged: () => ['c'],
                getExcluded: () => ['d'],
            });
            expect(result).toEqual({ requiredIds: [], optionalIds: [], discouragedIds: [], excludeIds: [] });
        });

        it('separates Pflicht into requiredIds, Sollte into optionalIds, Sollte-nicht into discouragedIds, Nicht into excludeIds', () => {
            const result = buildRowQualSets({
                workplaceId: 'wp-1',
                getRequired: () => ['q-pflicht'],
                getOptional: () => ['q-sollte'],
                getDiscouraged: () => ['q-sollte-nicht'],
                getExcluded: () => ['q-nicht'],
            });
            expect(result.requiredIds).toEqual(['q-pflicht']);
            expect(result.optionalIds).toEqual(['q-sollte']);
            expect(result.discouragedIds).toEqual(['q-sollte-nicht']);
            expect(result.excludeIds).toEqual(['q-nicht']);
        });

        it('deduplicates ids within each set', () => {
            const result = buildRowQualSets({
                workplaceId: 'wp-1',
                getRequired: () => ['q1', 'q2'],
                getOptional: () => ['q1', 'q3'],
                getDiscouraged: () => ['q2', 'q4'],
                getExcluded: () => ['q1'],
            });
            expect([...result.requiredIds].sort()).toEqual(['q1', 'q2']);
            expect([...result.optionalIds].sort()).toEqual(['q1', 'q3']);
            expect([...result.discouragedIds].sort()).toEqual(['q2', 'q4']);
            expect(result.excludeIds).toEqual(['q1']);
        });

        it('tolerates missing getter functions', () => {
            const result = buildRowQualSets({
                workplaceId: 'wp-1',
                getRequired: undefined,
                getOptional: () => ['q1'],
                getDiscouraged: null,
                getExcluded: () => ['q2'],
            });
            expect(result.requiredIds).toEqual([]);
            expect(result.optionalIds).toEqual(['q1']);
            expect(result.discouragedIds).toEqual([]);
            expect(result.excludeIds).toEqual(['q2']);
        });
    });

    describe('matchesRowQualFilter', () => {
        it('passes when no filter is active', () => {
            expect(matchesRowQualFilter(null, ['q1'])).toBe(true);
            expect(matchesRowQualFilter(undefined, ['q1'])).toBe(true);
        });

        it('passes when filter has no ids (no qualifications defined)', () => {
            expect(
                matchesRowQualFilter({ requiredIds: [], optionalIds: [], discouragedIds: [], excludeIds: [] }, ['q1'])
            ).toBe(true);
        });

        describe('required (Pflicht) — AND', () => {
            it('passes when doctor holds all required qualifications', () => {
                const filter = { requiredIds: ['a', 'b'], optionalIds: [], discouragedIds: [], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['a', 'b'])).toBe(true);
                expect(matchesRowQualFilter(filter, ['a', 'b', 'c'])).toBe(true);
            });

            it('rejects when doctor is missing any required qualification', () => {
                const filter = { requiredIds: ['a', 'b'], optionalIds: [], discouragedIds: [], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['a'])).toBe(false);
                expect(matchesRowQualFilter(filter, ['b'])).toBe(false);
                expect(matchesRowQualFilter(filter, ['c'])).toBe(false);
            });
        });

        describe('optional (Sollte) — OR', () => {
            it('passes when doctor holds at least one optional qualification', () => {
                const filter = { requiredIds: [], optionalIds: ['a', 'b'], discouragedIds: [], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
                expect(matchesRowQualFilter(filter, ['b'])).toBe(true);
            });

            it('rejects when doctor holds none of the optional qualifications', () => {
                const filter = { requiredIds: [], optionalIds: ['a', 'b'], discouragedIds: [], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['c'])).toBe(false);
                expect(matchesRowQualFilter(filter, [])).toBe(false);
            });

            it('skipped when no positive intent (only excludes configured)', () => {
                const filter = { requiredIds: [], optionalIds: [], discouragedIds: [], excludeIds: ['n1'] };
                expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
                expect(matchesRowQualFilter(filter, [])).toBe(true);
            });
        });

        describe('exclude (Nicht) — AND-NOT', () => {
            it('excludes doctors that hold an exclude qualification', () => {
                const filter = { requiredIds: ['a'], optionalIds: [], discouragedIds: [], excludeIds: ['n1'] };
                expect(matchesRowQualFilter(filter, ['a', 'n1'])).toBe(false);
                expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
            });
        });

        describe('Sollte-nicht is NOT a filter (visual hint only)', () => {
            it('does NOT exclude a doctor with discouraged qualification', () => {
                // This is the whole point of the redesign: Sollte-nicht is a
                // suggestion, not a hard rule. The doctor is allowed through
                // so the planner can still see — and choose — them, but the
                // UI flags the doctor chip with a red ring.
                const filter = { requiredIds: ['a'], optionalIds: [], discouragedIds: ['d1'], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['a', 'd1'])).toBe(true);
                expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
            });

            it('does NOT exclude when only discouraged is configured', () => {
                const filter = { requiredIds: [], optionalIds: [], discouragedIds: ['d1'], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['d1'])).toBe(true);
                expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
            });
        });

        describe('combined: required AND, optional OR, exclude AND-NOT', () => {
            const filter = {
                requiredIds: ['a', 'b'],
                optionalIds: ['c', 'd'],
                discouragedIds: ['x'], // ignored by the strict filter
                excludeIds: ['z'],
            };

            it('passes with all required, one optional, no exclude', () => {
                expect(matchesRowQualFilter(filter, ['a', 'b', 'c'])).toBe(true);
                expect(matchesRowQualFilter(filter, ['a', 'b', 'd'])).toBe(true);
            });

            it('passes even when holding the discouraged qualification', () => {
                expect(matchesRowQualFilter(filter, ['a', 'b', 'c', 'x'])).toBe(true);
            });

            it('rejects when missing any required', () => {
                expect(matchesRowQualFilter(filter, ['a', 'c'])).toBe(false);
            });

            it('rejects when missing all optional', () => {
                expect(matchesRowQualFilter(filter, ['a', 'b'])).toBe(false);
            });

            it('rejects when holding an exclude qualification', () => {
                expect(matchesRowQualFilter(filter, ['a', 'b', 'c', 'z'])).toBe(false);
            });
        });

        it('treats missing doctorQualIds as empty array', () => {
            const filter = { requiredIds: ['a'], optionalIds: [], discouragedIds: [], excludeIds: [] };
            expect(matchesRowQualFilter(filter, undefined)).toBe(false);
            expect(matchesRowQualFilter(filter, null)).toBe(false);
        });

        it('when only Nicht is set, only excludes doctors with that qualification', () => {
            const filter = { requiredIds: [], optionalIds: [], discouragedIds: [], excludeIds: ['n1'] };
            expect(matchesRowQualFilter(filter, [])).toBe(true);
            expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
            expect(matchesRowQualFilter(filter, ['a', 'b'])).toBe(true);
            expect(matchesRowQualFilter(filter, ['n1'])).toBe(false);
            expect(matchesRowQualFilter(filter, ['a', 'n1'])).toBe(false);
        });
    });

    describe('getDoctorRowQualHint', () => {
        it('returns null when no filter is active', () => {
            expect(getDoctorRowQualHint(null, ['q1'])).toBe(null);
        });

        it('returns null when no positive intent (required/optional/discouraged all empty)', () => {
            const filter = { requiredIds: [], optionalIds: [], discouragedIds: [], excludeIds: ['n1'] };
            expect(getDoctorRowQualHint(filter, ['n1'])).toBe(null);
        });

        it('returns "preferred" when doctor holds an optional qualification', () => {
            const filter = { requiredIds: [], optionalIds: ['a'], discouragedIds: [], excludeIds: [] };
            expect(getDoctorRowQualHint(filter, ['a'])).toBe('preferred');
        });

        it('returns "discouraged" when doctor holds a discouraged qualification', () => {
            const filter = { requiredIds: [], optionalIds: [], discouragedIds: ['d1'], excludeIds: [] };
            expect(getDoctorRowQualHint(filter, ['d1'])).toBe('discouraged');
        });

        it('returns "discouraged" when doctor holds both preferred and discouraged (warning wins)', () => {
            const filter = { requiredIds: [], optionalIds: ['a'], discouragedIds: ['d1'], excludeIds: [] };
            expect(getDoctorRowQualHint(filter, ['a', 'd1'])).toBe('discouraged');
        });

        it('returns null when doctor holds none of the optional/discouraged qualifications', () => {
            const filter = { requiredIds: [], optionalIds: ['a'], discouragedIds: ['d1'], excludeIds: [] };
            expect(getDoctorRowQualHint(filter, ['b'])).toBe(null);
        });

        it('treats missing doctorQualIds as empty', () => {
            const filter = { requiredIds: [], optionalIds: ['a'], discouragedIds: [], excludeIds: [] };
            expect(getDoctorRowQualHint(filter, undefined)).toBe(null);
            expect(getDoctorRowQualHint(filter, null)).toBe(null);
        });
    });

    describe('getDoctorRowQualRingClass', () => {
        it('returns emerald ring for "preferred"', () => {
            expect(getDoctorRowQualRingClass('preferred')).toBe('ring-2 ring-emerald-500');
        });

        it('returns rose ring for "discouraged"', () => {
            expect(getDoctorRowQualRingClass('discouraged')).toBe('ring-2 ring-rose-500');
        });

        it('returns null for null/undefined hint', () => {
            expect(getDoctorRowQualRingClass(null)).toBe(null);
            expect(getDoctorRowQualRingClass(undefined)).toBe(null);
            expect(getDoctorRowQualRingClass('something-else')).toBe(null);
        });
    });

    describe('rowKey', () => {
        it('returns just the name when there is no timeslot', () => {
            expect(rowKey('Dienst Vordergrund', null)).toBe('Dienst Vordergrund');
            expect(rowKey('Dienst Vordergrund', undefined)).toBe('Dienst Vordergrund');
        });

        it('combines name and timeslot id with __ separator', () => {
            expect(rowKey('Mammographie', 'ts-1')).toBe('Mammographie__ts-1');
        });
    });
});
