import { describe, expect, it } from 'vitest';
import {
  findLegacyAreaConflicts,
  legacyOverlapsArea,
  planAreaPayload,
  sameAreaAssignments,
} from '../nextDayPropertyAreaSafety';

const catalog = [
  { id: 'reception', name: 'Recepció', task_type: 'reception_cleaning', is_active: true },
  { id: 'office', name: 'Director and manager office', task_type: 'back_office_cleaning', is_active: true },
  { id: 'custom', name: 'New gym', task_type: 'public_area_cleaning', is_active: true },
  { id: 'archived', name: 'Old lobby', task_type: 'lobby_cleaning', is_active: false },
];
const prior = [
  { task_name: 'Reception', task_type: 'reception_cleaning', source: 'manual', assigned_to: 'housekeeper-a' },
  { task_name: 'Back Office', task_type: 'back_office_cleaning', source: 'manual', assigned_to: 'housekeeper-b' },
];

describe('next-day property public-area safety', () => {
  it('flags translated or legacy names by non-generic type even with the same assignee', () => {
    expect(findLegacyAreaConflicts(catalog, new Map([
      ['reception', 'housekeeper-a'], ['office', 'housekeeper-c'],
    ]), prior)).toEqual(['Recepció', 'Director and manager office']);
  });

  it('does not confuse separate generic areas merely because their types match', () => {
    expect(legacyOverlapsArea(catalog[2], {
      task_name: 'Different common area', task_type: 'public_area_cleaning', source: 'manual', assigned_to: 'a',
    })).toBe(false);
  });

  it('detects an exact-name duplicate regardless of type', () => {
    expect(legacyOverlapsArea(catalog[2], {
      task_name: ' new GYM ', task_type: 'gym_cleaning', source: 'mapped', assigned_to: 'a',
    })).toBe(true);
  });

  it('does not block unassigned or archived catalogue areas', () => {
    expect(findLegacyAreaConflicts(catalog, new Map([['archived', 'a']]), prior)).toEqual([]);
  });

  it('detects concurrent owner changes, additions and removals', () => {
    const saved = new Map([['reception', 'a']]);
    expect(sameAreaAssignments(saved, new Map([['reception', 'a']]))).toBe(true);
    expect(sameAreaAssignments(saved, new Map([['reception', 'b']]))).toBe(false);
    expect(sameAreaAssignments(saved, new Map())).toBe(false);
    expect(sameAreaAssignments(saved, new Map([['reception', 'a'], ['office', 'b']]))).toBe(false);
  });

  it('preserves already scheduled archived entries without writing unknown IDs', () => {
    expect(planAreaPayload(catalog, new Map([
      ['reception', 'a'], ['archived', 'b'], ['another-hotel-area', 'c'],
    ]))).toEqual([
      { public_area_id: 'reception', assigned_to: 'a' },
      { public_area_id: 'archived', assigned_to: 'b' },
    ]);
  });
});
