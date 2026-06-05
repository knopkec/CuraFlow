import { describe, it, expect } from 'vitest';
import { buildRowQualSets, matchesRowQualFilter, rowKey } from '../rowQualFilter';

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

        it('separates Pflicht into requiredIds (AND), Sollte into optionalIds (OR), Sollte-nicht into discouragedIds, Nicht into excludeIds', () => {
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
                matchesRowQualFilter({ requiredIds: [], optionalIds: [], excludeIds: [] }, ['q1'])
            ).toBe(true);
        });

        describe('required (Pflicht) — AND', () => {
            it('passes when doctor holds all required qualifications', () => {
                const filter = { requiredIds: ['a', 'b'], optionalIds: [], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['a', 'b'])).toBe(true);
                expect(matchesRowQualFilter(filter, ['a', 'b', 'c'])).toBe(true);
            });

            it('rejects when doctor is missing any required qualification', () => {
                const filter = { requiredIds: ['a', 'b'], optionalIds: [], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['a'])).toBe(false);
                expect(matchesRowQualFilter(filter, ['b'])).toBe(false);
                expect(matchesRowQualFilter(filter, ['c'])).toBe(false);
            });
        });

        describe('optional (Sollte|Sollte-nicht) — OR', () => {
            it('passes when doctor holds at least one optional qualification', () => {
                const filter = { requiredIds: [], optionalIds: ['a', 'b'], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
                expect(matchesRowQualFilter(filter, ['b'])).toBe(true);
            });

            it('rejects when doctor holds none of the optional qualifications', () => {
                const filter = { requiredIds: [], optionalIds: ['a', 'b'], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['c'])).toBe(false);
                expect(matchesRowQualFilter(filter, [])).toBe(false);
            });

            it('skipped when no positive intent (no required, no optional, only excludes)', () => {
                const filter = { requiredIds: [], optionalIds: [], excludeIds: ['n1'] };
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

        describe('discouraged (Sollte-nicht) — soft exclude with fallback', () => {
            it('excludes doctors with discouraged qualification when a preferred candidate exists', () => {
                const filter = { requiredIds: ['a'], optionalIds: [], discouragedIds: ['d1'], excludeIds: [] };
                const allDoctors = [
                    { id: 'd1', qualification_ids: ['a', 'd1'] }, // preferred but discouraged
                    { id: 'd2', qualification_ids: ['a'] },        // preferred, clean
                ];
                expect(matchesRowQualFilter(filter, ['a', 'd1'], allDoctors)).toBe(false);
                expect(matchesRowQualFilter(filter, ['a'], allDoctors)).toBe(true);
            });

            it('relaxes discouraged rule when no clean preferred candidate exists', () => {
                // The only doctor in the list passes the preferred rule (optional 'a')
                // but is also discouraged ('d1'). The relaxed rule must let this
                // doctor through so the staffing list is not empty.
                const filter = { requiredIds: [], optionalIds: ['a'], discouragedIds: ['d1'], excludeIds: [] };
                const allDoctors = [
                    { id: 'd1', qualification_ids: ['a', 'd1'] },
                ];
                expect(matchesRowQualFilter(filter, ['a', 'd1'], allDoctors)).toBe(true);
            });

            it('passes when doctor is clean of discouraged qualifications', () => {
                const filter = { requiredIds: [], optionalIds: [], discouragedIds: ['d1'], excludeIds: [] };
                expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
            });
        });

        describe('combined: required AND, optional OR, discouraged soft, exclude AND-NOT', () => {
            const filter = {
                requiredIds: ['a', 'b'],
                optionalIds: ['c', 'd'],
                discouragedIds: ['x'],
                excludeIds: ['z'],
            };

            it('passes with all required, one optional, no discourage, no exclude', () => {
                expect(matchesRowQualFilter(filter, ['a', 'b', 'c'])).toBe(true);
                expect(matchesRowQualFilter(filter, ['a', 'b', 'd'])).toBe(true);
            });

            it('rejects when missing any required (AND semantics)', () => {
                expect(matchesRowQualFilter(filter, ['a', 'c'])).toBe(false);
            });

            it('rejects when missing all optional (OR semantics)', () => {
                expect(matchesRowQualFilter(filter, ['a', 'b'])).toBe(false);
                expect(matchesRowQualFilter(filter, ['a', 'b', 'e'])).toBe(false);
            });

            it('rejects when holding an exclude qualification', () => {
                expect(matchesRowQualFilter(filter, ['a', 'b', 'c', 'z'])).toBe(false);
            });

            it('rejects when holding a discouraged qualification (preferred path)', () => {
                expect(matchesRowQualFilter(filter, ['a', 'b', 'c', 'x'])).toBe(false);
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
