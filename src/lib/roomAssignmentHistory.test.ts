import { describe, expect, it } from 'vitest';
import { historyWindow, missingAssignmentSnapshots, groupAssignmentHistory } from './roomAssignmentHistory';

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

describe('daily assignment timeline', () => {
  it('retains repeated same-day ownership changes in chronological order, including ties', () => {
    const day = '2026-11-24';
    const events = [
      { id: 4, assignment_date: day, occurred_at: day + 'T11:00:00Z', owner: 'A' },
      { id: 1, assignment_date: day, occurred_at: day + 'T07:00:00Z', owner: 'A' },
      { id: 3, assignment_date: day, occurred_at: day + 'T11:00:00Z', owner: 'C' },
      { id: 2, assignment_date: day, occurred_at: day + 'T09:00:00Z', owner: 'B' },
    ];
    const records = [
      { id: 'r2', assignment_date: day, created_at: day + 'T08:00:00Z' },
      { id: 'r1', assignment_date: day, created_at: day + 'T07:00:00Z' },
    ];
    const days = groupAssignmentHistory(events, records, [{ business_date: '2026-11-23' }], day);
    expect(days.map(d => d.date)).toEqual([day, '2026-11-23']);
    expect(days[0].events.map(e => e.id)).toEqual([1, 2, 3, 4]);
    expect(days[0].records.map(r => r.id)).toEqual(['r1','r2']);
    expect(days[1].events).toEqual([]);
    expect(days[1].snapshots).toHaveLength(1);
  });
  it('keeps a selected date visible even when no audit evidence survives', () => {
    expect(groupAssignmentHistory([], [], [], '2026-11-24')).toEqual([
      { date: '2026-11-24', events: [], records: [], snapshots: [] },
    ]);
  });
});
