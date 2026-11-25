import { describe, it, expect } from 'vitest';
import {
  maintenanceQueueBucket,
  maintenanceQueueCounts,
  maintenanceLocation,
  maintenanceMatchesFilter,
  isMaintenanceOverdue,
  isMaintenanceDueSoon,
  sortMaintenanceTickets,
} from './maintenanceQueue';

describe('shared maintenance queue', () => {
  it('classifies each issue exactly once across both views', () => {
    const rows = [
      { status: 'open' as const },
      { status: 'in_progress' as const },
      { status: 'in_progress' as const, on_hold: true },
      { status: 'in_progress' as const, on_hold: true, pending_supervisor_approval: true },
      { status: 'completed' as const, on_hold: true, pending_supervisor_approval: true },
    ];
    expect(rows.map(maintenanceQueueBucket)).toEqual(['active', 'progress', 'hold', 'approval', 'done']);
    expect(maintenanceQueueCounts(rows)).toEqual({
      total: 5, work: 4, overdue: 0, dueSoon: 0,
      active: 1, progress: 1, hold: 1, approval: 1, done: 1,
    });
  });

  it('keeps a completed issue in history regardless of stale pending flags', () => {
    expect(maintenanceQueueBucket({ status: 'completed', pending_supervisor_approval: true })).toBe('done');
    expect(maintenanceMatchesFilter({ status: 'completed' }, 'work')).toBe(false);
    expect(maintenanceMatchesFilter({ status: 'completed' }, 'done')).toBe(true);
  });

  it('identifies breached and soon-due active tickets without flagging completed work', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    const overdue = { status: 'open' as const, sla_due_date: '2026-09-26T11:00:00Z' };
    const soon = { status: 'in_progress' as const, sla_due_date: '2026-09-26T16:00:00Z' };
    const later = { status: 'open' as const, sla_due_date: '2026-09-27T12:00:00Z' };
    const done = { status: 'completed' as const, sla_due_date: '2026-09-25T12:00:00Z' };
    expect(isMaintenanceOverdue(overdue, now)).toBe(true);
    expect(isMaintenanceDueSoon(soon, now)).toBe(true);
    expect(isMaintenanceDueSoon(later, now)).toBe(false);
    expect(isMaintenanceOverdue(done, now)).toBe(false);
  });

  it('sorts the working queue by operational urgency before priority', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    const rows = [
      { id: 'done', status: 'completed' as const, priority: 'urgent' as const, created_at: '2026-09-20T00:00:00Z' },
      { id: 'hold', status: 'in_progress' as const, on_hold: true, priority: 'urgent' as const, created_at: '2026-09-20T00:00:00Z' },
      { id: 'open', status: 'open' as const, priority: 'high' as const, created_at: '2026-09-24T00:00:00Z' },
      { id: 'approval', status: 'in_progress' as const, pending_supervisor_approval: true, priority: 'low' as const, created_at: '2026-09-23T00:00:00Z' },
      { id: 'soon', status: 'open' as const, priority: 'low' as const, sla_due_date: '2026-09-26T15:00:00Z', created_at: '2026-09-25T00:00:00Z' },
      { id: 'overdue', status: 'open' as const, priority: 'medium' as const, sla_due_date: '2026-09-26T10:00:00Z', created_at: '2026-09-26T00:00:00Z' },
    ];
    expect(sortMaintenanceTickets(rows, now).map(row => row.id)).toEqual([
      'overdue', 'soon', 'approval', 'open', 'hold', 'done',
    ]);
  });

  it('uses explicit common-area location rather than Room N/A', () => {
    expect(maintenanceLocation('N/A', 'Location: Reception\nBroken door')).toBe('Location: Reception');
    expect(maintenanceLocation('N/A', 'No location')).toBe('Common area');
    expect(maintenanceLocation('1B-110', 'Broken door')).toBe('Room 1B-110');
    expect(maintenanceLocation('1B-110', 'Broken door', 'hu')).toBe('Szoba 1B-110');
  });

  it('reconciles Gozsdu mixed display-name and slug rows without losing completed issues', () => {
    const make = (status: 'open' | 'in_progress' | 'completed', count: number, pending = false) =>
      Array.from({ length: count }, () => ({ status, pending_supervisor_approval: pending }));
    const legacyNameRows = [ ...make('completed', 7), ...make('in_progress', 2, true), ...make('open', 3) ];
    const slugRows = [ ...make('completed', 2), ...make('in_progress', 1, true), ...make('in_progress', 1), ...make('open', 1) ];
    expect(maintenanceQueueCounts([...legacyNameRows, ...slugRows])).toEqual({
      total: 17, work: 8, overdue: 0, dueSoon: 0,
      active: 4, progress: 1, hold: 0, approval: 3, done: 9,
    });
  });
});
