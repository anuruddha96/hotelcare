import { describe, expect, it } from 'vitest';
import type { AssignmentPreview, RoomForAssignment } from './roomAssignmentAlgorithm';
import { TOMORROW_PMS_REUSE_MS, compatibleHousekeepingSnapshotTime } from './nextDayAutoAssignBridge';

describe('unified next-day Auto Assign bridge', () => {
  it('keeps the short PMS reuse window at fifteen minutes', () => {
    expect(TOMORROW_PMS_REUSE_MS).toBe(15 * 60 * 1000);
  });

  it('accepts a valid older work row when a no-service PMS row is newer', () => {
    expect(compatibleHousekeepingSnapshotTime('2026-09-22T14:10:00Z', '2026-09-22T14:09:00Z')).toBe(true);
    expect(compatibleHousekeepingSnapshotTime('2026-09-22T14:10:00Z', '2026-09-22T14:10:00Z')).toBe(true);
  });

  it('rejects work rows newer than the authoritative snapshot, stale and missing timestamps', () => {
    expect(compatibleHousekeepingSnapshotTime('2026-09-22T14:10:00Z', '2026-09-22T14:10:01Z')).toBe(false);
    expect(compatibleHousekeepingSnapshotTime('2026-09-22T14:10:00Z', '2026-09-22T13:54:59Z')).toBe(false);
    expect(compatibleHousekeepingSnapshotTime('2026-09-22T14:10:00Z', null)).toBe(false);
    expect(compatibleHousekeepingSnapshotTime('', '2026-09-22T14:10:00Z')).toBe(false);
  });

  it('keeps tomorrow planning data structurally compatible with the Auto Assign preview', () => {
    const room = {
      id: 'room-1',
      room_number: 'SUITE - 1/2',
      is_checkout_room: true,
      floor_number: 0,
      pms_metadata: { plannedHousekeepingDate: '2026-09-10' },
    } as RoomForAssignment;
    const preview: AssignmentPreview = {
      staffId: 'staff-1',
      staffName: 'Cleaner',
      rooms: [room],
      totalWeight: 1,
      checkoutCount: 1,
      dailyCount: 0,
      estimatedMinutes: 30,
      totalWithBreak: 30,
      exceedsShift: false,
      overageMinutes: 0,
    };

    expect(preview.rooms[0].room_number).toBe('SUITE - 1/2');
    expect(preview.checkoutCount).toBe(1);
  });
});
