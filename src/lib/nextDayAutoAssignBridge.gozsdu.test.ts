import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomForAssignment } from './roomAssignmentAlgorithm';

vi.mock('./nextDayAutoAssignBridgeCore', () => ({
  buildTomorrowAutoAssignRooms: vi.fn(),
}));

import * as original from './nextDayAutoAssignBridgeCore';
import { buildTomorrowAutoAssignRooms } from './nextDayAutoAssignBridge';

const hotelId = 'gozsdu-court';
const args = { organizationSlug: 'rd-hotels', hotelId, selectedDate: '2026-09-17', roomRows: [] };
function room(id: string, currentNight: number, totalNights: number, options: {
  checkout?: boolean; availability?: string;
} = {}): RoomForAssignment {
  return {
    id, hotel: hotelId, room_number: id, room_capacity: 2, room_size_sqm: null,
    floor_number: null, status: 'dirty', is_checkout_room: !!options.checkout,
    pms_metadata: {
      currentNight, totalNights, scheduledDepartureToday: !!options.checkout,
      gozsduAvailability: { status: options.availability || 'operating' },
    },
    towel_change_required: false, linen_change_required: false,
  };
}
function mockWorkload(rooms: RoomForAssignment[], source: 'metadata-fallback' | 'selected-date' = 'metadata-fallback') {
  vi.mocked(original.buildTomorrowAutoAssignRooms).mockResolvedValue({ rooms, source, capturedAt: null });
}

beforeEach(() => vi.resetAllMocks());

describe('Gozsdu next-day Auto Assign metadata fallback', () => {
  it('keeps checkout, selects tomorrow PMS 3/N and 5/N service, and excludes inactive rooms', async () => {
    mockWorkload([
      room('checkout', 1, 2, { checkout: true }),
      room('not_due', 3, 6), room('towel', 2, 5), room('full', 4, 7),
      room('private', 4, 7, { availability: 'non_guest' }),
      room('unavailable', 4, 7, { availability: 'unavailable' }),
    ]);
    const result = await buildTomorrowAutoAssignRooms(args);
    expect(result.rooms.map(r => r.id)).toEqual(['checkout', 'towel', 'full']);
    expect(result.rooms[0].is_checkout_room).toBe(true);
    expect(result.rooms[1].towel_change_required).toBe(true);
    expect(result.rooms[1].linen_change_required).toBe(false);
    expect(result.rooms[2].linen_change_required).toBe(true);
  });

  it('does not rewrite authoritative selected-date PMS snapshots', async () => {
    const unchanged = [room('snapshot', 3, 6)];
    mockWorkload(unchanged, 'selected-date');
    const result = await buildTomorrowAutoAssignRooms(args);
    expect(result.rooms).toBe(unchanged);
  });

  it('does not alter another hotel in metadata fallback', async () => {
    const mika = { ...room('mika', 2, 6), hotel: 'mika-downtown' };
    mockWorkload([mika]);
    const result = await buildTomorrowAutoAssignRooms({ ...args, hotelId: 'mika-downtown' });
    expect(result.rooms).toEqual([mika]);
  });
});
