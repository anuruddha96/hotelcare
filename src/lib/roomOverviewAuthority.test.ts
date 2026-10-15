import { describe, it, expect } from 'vitest';
import { createOverviewLoadGuard, compareRoomAuthority } from './roomOverviewAuthority';
describe('room view load guard', () => {
  it('ignores an earlier request', () => {
    const guard = createOverviewLoadGuard();
    const older = guard.start('otto');
    const newer = guard.start('otto');
    expect(guard.isCurrent(older, 'otto')).toBe(false);
    expect(guard.isCurrent(newer, 'otto')).toBe(true);
  });

  it('allows a background live update to take ownership of an initial load', () => {
    const guard = createOverviewLoadGuard();
    const initial = guard.start('otto|2026-10-15');
    expect(guard.needsInitialLoad('otto|2026-10-15')).toBe(true);

    const liveUpdate = guard.start('otto|2026-10-15');
    expect(guard.isCurrent(initial, 'otto|2026-10-15')).toBe(false);
    expect(guard.isCurrent(liveUpdate, 'otto|2026-10-15')).toBe(true);

    // Once that latest request resolves, the board stays rendered on refresh.
    guard.markLoaded('otto|2026-10-15');
    expect(guard.needsInitialLoad('otto|2026-10-15')).toBe(false);
    expect(guard.needsInitialLoad('mika|2026-10-15')).toBe(true);
    expect(guard.needsInitialLoad('otto|2026-10-16')).toBe(true);
  });

  it('invalidates requests from a previous property or date', () => {
    const guard = createOverviewLoadGuard();
    const oldScope = guard.start('otto|2026-10-15');
    guard.invalidate();
    const newScope = guard.start('otto|2026-10-16');
    expect(guard.isCurrent(oldScope, 'otto|2026-10-16')).toBe(false);
    expect(guard.isCurrent(newScope, 'otto|2026-10-16')).toBe(true);
  });
});

it('prefers fresh data',()=>{
 const now={id:'a',pms_metadata:{pmsSyncDate:'2026-10-09',lastPmsRefreshDate:'2026-10-09'}};
 const before={id:'b',pms_metadata:{pmsSyncDate:'2026-10-08'}};
 expect(compareRoomAuthority(now,before,'otto','2026-10-09',new Set(['b']))).toBe(1);
});
