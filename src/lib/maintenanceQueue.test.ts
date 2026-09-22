import { describe, it, expect } from 'vitest';
import { maintenanceQueueBucket, maintenanceQueueCounts, maintenanceLocation } from './maintenanceQueue';

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
    expect(maintenanceQueueCounts(rows)).toEqual({ total: 5, active: 1, progress: 1, hold: 1, approval: 1, done: 1 });
  });
  it('keeps a completed issue visible regardless of stale pending flags', () => {
    expect(maintenanceQueueBucket({ status: 'completed', pending_supervisor_approval: true })).toBe('done');
  });
  it('uses explicit common-area location rather than Room N/A', () => {
    expect(maintenanceLocation('N/A', 'Location: Reception\nBroken door')).toBe('Location: Reception');
    expect(maintenanceLocation('N/A', 'No location')).toBe('Common area');
    expect(maintenanceLocation('1B-110', 'Broken door')).toBe('Room 1B-110');
    expect(maintenanceLocation('1B-110', 'Broken door', 'hu')).toBe('Szoba 1B-110');
  });
});
