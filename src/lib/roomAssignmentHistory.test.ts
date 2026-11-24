import { describe, expect, it } from 'vitest';
import { historyWindow, missingAssignmentSnapshots } from './roomAssignmentHistory';

describe('room assignment history', () => {
  it('uses adjacent 30-day periods without timezone drift', () => {
    expect(historyWindow('2026-11-24', 0)).toEqual({ from: '2026-10-26', to: '2026-11-24' });
    expect(historyWindow('2026-11-24', 1)).toEqual({ from: '2026-09-26', to: '2026-10-25' });
  });
  it('retains historical snapshot evidence without duplicating identical assignments', () => {
    const rows = [{ id: 'a', assignment_date: '2026-11-24', assigned_to: 'new' }];
    const snapshots = [
      { business_date: '2026-11-24', assignment_id: 'a', assigned_to: 'new' },
      { business_date: '2026-11-24', assignment_id: 'a', assigned_to: 'old' },
      { business_date: '2026-11-23', assignment_id: 'b', assigned_to: 'another' },
      { business_date: '2026-11-22', assignment_id: null, assigned_to: null },
    ];
    expect(missingAssignmentSnapshots(rows, snapshots)).toEqual(snapshots.slice(1, 3));
  });
});
