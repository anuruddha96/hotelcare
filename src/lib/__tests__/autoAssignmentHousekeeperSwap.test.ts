import { describe, expect, it } from 'vitest';
import type { AssignmentPreview, RoomForAssignment } from '../roomAssignmentAlgorithm';
import {
  swapAssignmentOwnerId,
  swapAssignmentPreviewOwners,
} from '../autoAssignmentHousekeeperSwap';

function room(id: string, number: string): RoomForAssignment {
  return {
    id,
    room_number: number,
    hotel: 'Hotel Memories Budapest',
    floor_number: 1,
    room_size_sqm: 20,
    room_capacity: 2,
    is_checkout_room: false,
    status: 'dirty',
  };
}

function preview(staffId: string, staffName: string, rooms: RoomForAssignment[]): AssignmentPreview {
  return {
    staffId,
    staffName,
    rooms,
    totalWeight: rooms.length,
    checkoutCount: 0,
    dailyCount: rooms.length,
    estimatedMinutes: rooms.length * 15,
    totalWithBreak: rooms.length * 15 + 30,
    exceedsShift: false,
    overageMinutes: 0,
  };
}

describe('whole-housekeeper Auto Assign swaps', () => {
  it('exchanges staff identities while keeping each complete room bundle in place', () => {
    const side100Rooms = [room('101', '101'), room('102', '102'), room('103', '103')];
    const side200Rooms = [room('201', '201'), room('202', '202')];
    const original = [
      preview('antti', 'Antti', side100Rooms),
      preview('liny', 'Liny', side200Rooms),
    ];

    const swapped = swapAssignmentPreviewOwners(original, 'antti', 'liny');

    expect(swapped[0].staffId).toBe('liny');
    expect(swapped[0].staffName).toBe('Liny');
    expect(swapped[0].rooms.map(item => item.room_number)).toEqual(['101', '102', '103']);

    expect(swapped[1].staffId).toBe('antti');
    expect(swapped[1].staffName).toBe('Antti');
    expect(swapped[1].rooms.map(item => item.room_number)).toEqual(['201', '202']);

    expect(original[0].staffId).toBe('antti');
    expect(original[1].staffId).toBe('liny');
  });

  it('swaps mapped public-area owner ids through the same exchange', () => {
    expect(swapAssignmentOwnerId('antti', 'antti', 'liny')).toBe('liny');
    expect(swapAssignmentOwnerId('liny', 'antti', 'liny')).toBe('antti');
    expect(swapAssignmentOwnerId('christy', 'antti', 'liny')).toBe('christy');
  });

  it('does nothing when either housekeeper is missing from the preview', () => {
    const original = [preview('antti', 'Antti', [room('101', '101')])];
    expect(swapAssignmentPreviewOwners(original, 'antti', 'missing')).toBe(original);
  });
});
