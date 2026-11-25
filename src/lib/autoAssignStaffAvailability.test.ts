import { describe, expect, it } from 'vitest';
import {
  activeWorkOwnedByExcludedStaff,
  hasAutoAssignStaffPoolChanged,
  selectedOwnerOverrides,
} from './autoAssignStaffAvailability';

describe('Auto Assign staff availability', () => {
  it('allows a manager to remove one checked-in cleaner from the pool', () => {
    const previews = [{ staffId: 'frank' }, { staffId: 'anna' }, { staffId: 'maria' }];
    expect(hasAutoAssignStaffPoolChanged(previews, new Set(['anna', 'maria']))).toBe(true);
  });

  it('does not treat the unchanged cleaner pool as a staffing change', () => {
    const previews = [{ staffId: 'anna' }, { staffId: 'maria' }];
    expect(hasAutoAssignStaffPoolChanged(previews, new Set(['maria', 'anna']))).toBe(false);
  });

  it('blocks only already-started work owned by a deselected cleaner', () => {
    const rows = [
      { room_id: '101', assigned_to: 'frank', status: 'assigned' },
      { room_id: '102', assigned_to: 'frank', status: 'in_progress' },
      { room_id: '103', assigned_to: 'anna', status: 'dnd_pending_retry' },
    ];
    expect(activeWorkOwnedByExcludedStaff(rows, new Set(['anna']))).toEqual([
      { room_id: '102', assigned_to: 'frank', status: 'in_progress' },
    ]);
  });

  it('drops movable public-area owner overrides for deselected cleaners', () => {
    const owners = new Map([
      ['lobby', 'frank'],
      ['stairs', 'anna'],
    ]);
    expect([...selectedOwnerOverrides(owners, new Set(['anna']))]).toEqual([
      ['stairs', 'anna'],
    ]);
  });
});
