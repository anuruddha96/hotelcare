import { beforeEach, describe, expect, it } from 'vitest';
import * as original from './roomAssignmentAlgorithmGozsduLegacy';
import { autoAssignRooms, moveRoom } from './roomAssignmentAlgorithm';
import { clearGozsduLaundryDutySession, setGozsduLaundryDutySession } from './gozsduLaundryDutySession';

const cleaner = { id: 'cleaner', full_name: 'Cleaner', nickname: null };
const laundryner = { id: 'laundryner', full_name: 'Laundryner', nickname: null };
const room = {
  id: 'room', hotel: 'gozsdu-court', room_number: '101', floor_number: 1,
  status: 'dirty', room_size_sqm: 30, room_capacity: 3, is_checkout_room: true,
  housekeeping_section_id: 'hollo-12-id', housekeeping_section_name: 'Holló 12',
  pms_metadata: { gozsduAvailability: { status: 'operating' },
    gozsduAutoAssign: { cleaningSize: 'medium', verifiedBedCount: 3, checkoutMinutes: 50 } },
} as const;

beforeEach(() => {
  clearGozsduLaundryDutySession('2026-09-17');
});

describe('Gozsdu Laundryner Auto Assign exclusion', () => {
  it('gives zero Gozsdu rooms to the selected Laundryner and retains the operating workload', () => {
    setGozsduLaundryDutySession('2026-09-17', ['laundryner']);
    const result = autoAssignRooms([room], [cleaner, laundryner]);
    expect(result.flatMap(person => person.rooms.map(item => item.id))).toEqual(['room']);
    expect(result.find(person => person.staffId === 'laundryner')).toBeUndefined();
    expect(result[0].staffId).toBe('cleaner');
  });

  it('does not filter other hotels or permit moves to the Gozsdu Laundryner', () => {
    setGozsduLaundryDutySession('2026-09-17', ['laundryner']);
    const otherRoom = { ...room, id: 'mika', hotel: 'mika-downtown' };
    const config = { hotelName: 'Hotel Mika Downtown', randomSeed: 3 };
    expect(autoAssignRooms([otherRoom], [cleaner, laundryner], undefined, undefined, config))
      .toEqual(original.autoAssignRooms([otherRoom], [cleaner, laundryner], undefined, undefined, config));
    const preview = [{ staffId: 'cleaner', rooms: [room] },
      { staffId: 'laundryner', rooms: [] }] as any;
    expect(moveRoom(preview, 'room', 'cleaner', 'laundryner')).toBe(preview);
  });
});
