import { describe, expect, it } from 'vitest';
import { projectVerifiedGozsduWorkload } from './gozsduVerifiedAutoAssign';
import type { RoomForAssignment } from './roomAssignmentAlgorithmCore';

describe('Gozsdu Auto Assign uses the same verified morning PMS dates as its room board', () => {
  it('restores missed checkout, removes false checkout and preserves bed/size settings without writes', () => {
    const now = new Date().toISOString();
    const rooms = [
      { id: 'a', hotel: 'gozsdu-court', room_number: '101', is_checkout_room: false,
        pms_metadata: { scheduledDepartureToday: false, gozsduAvailability: { status: 'operating' },
          gozsduAutoAssign: { cleaningSize: 'large', verifiedBedCount: 6, checkoutMinutes: 60 } } },
      { id: 'b', hotel: 'gozsdu-court', room_number: '102', is_checkout_room: true,
        pms_metadata: { scheduledDepartureToday: true, gozsduAvailability: { status: 'operating' },
          gozsduAutoAssign: { cleaningSize: 'small', verifiedBedCount: 2, checkoutMinutes: 40 } } },
    ] as RoomForAssignment[];
    const registry = [
      { room_id: 'a', pms_room_name: '101', service_status: 'operating' },
      { room_id: 'b', pms_room_name: '102', service_status: 'operating' },
    ];
    const snapshots = [
      { room_label: '101', room_number: '101', arrival_date: '2026-09-14', departure_date: '2026-09-16',
        status: 'departing', housekeeping_dep: 'DEP', captured_at: now },
      { room_label: '102', room_number: '102', arrival_date: '2026-09-15', departure_date: '2026-09-19',
        status: 'ongoing', housekeeping_dep: '', captured_at: now },
    ];
    const result = projectVerifiedGozsduWorkload(rooms, registry, snapshots, '2026-09-16');
    expect(result[0].is_checkout_room).toBe(true);
    expect(result[0].pms_metadata.scheduledDepartureToday).toBe(true);
    expect(result[1].is_checkout_room).toBe(false);
    expect(result[1].pms_metadata.scheduledDepartureToday).toBe(false);
    expect(result[0].pms_metadata.gozsduAutoAssign).toEqual(rooms[0].pms_metadata.gozsduAutoAssign);
    expect(result[1].pms_metadata.gozsduAutoAssign).toEqual(rooms[1].pms_metadata.gozsduAutoAssign);
    expect(rooms[0].is_checkout_room).toBe(false);
    expect(rooms[1].is_checkout_room).toBe(true);
  });
});
