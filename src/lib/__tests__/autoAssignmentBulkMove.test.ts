import { describe, expect, it } from 'vitest';
import { moveSelectedRooms } from '../autoAssignmentBulkMove';
import { calculateTimeEstimation, type AssignmentPreview, type RoomForAssignment } from '../roomAssignmentAlgorithm';

const room = (id: string, checkout = false): RoomForAssignment => ({
  id, room_number: id, hotel: 'Hotel Mika Downtown', floor_number: 1,
  room_size_sqm: 20, room_capacity: 2, is_checkout_room: checkout,
  status: 'dirty', notes: `note-${id}`, ready_to_clean: checkout,
});
const preview = (staffId: string, rooms: RoomForAssignment[]): AssignmentPreview => ({
  staffId, staffName: staffId, rooms, totalWeight: 0,
  checkoutCount: rooms.filter(r => r.is_checkout_room).length,
  dailyCount: rooms.filter(r => !r.is_checkout_room).length,
  ...calculateTimeEstimation(rooms),
});
const initial = () => [preview('alice', [room('101', true), room('102')]), preview('bob', [room('201')]), preview('cara', [])];

describe('moveSelectedRooms', () => {
  it('moves a checkout and a daily room from different source cards together, preserving metadata', () => {
    const before = initial();
    const result = moveSelectedRooms(before, ['101', '201', '101'], 'cara');
    expect(result.error).toBeNull();
    expect(result.movedRoomIds).toEqual(['101', '201']);
    expect(result.previews.find(p => p.staffId === 'cara')?.rooms.map(r => r.id).sort()).toEqual(['101', '201']);
    expect(result.previews.find(p => p.staffId === 'cara')?.checkoutCount).toBe(1);
    expect(result.previews.find(p => p.staffId === 'cara')?.dailyCount).toBe(1);
    expect(result.previews.find(p => p.staffId === 'cara')?.rooms.find(r => r.id === '101')?.notes).toBe('note-101');
    expect(before[0].rooms.map(r => r.id)).toEqual(['101', '102']);
  });

  it('ignores rooms already with the destination instead of duplicating them', () => {
    const result = moveSelectedRooms(initial(), ['101', '201'], 'bob');
    expect(result.error).toBeNull();
    expect(result.movedRoomIds).toEqual(['101']);
    expect(result.previews[1].rooms.filter(r => r.id === '201')).toHaveLength(1);
  });

  it('rejects stale selection atomically without moving the other rooms', () => {
    const before = initial();
    const result = moveSelectedRooms(before, ['101', 'missing'], 'cara');
    expect(result.error).toBe('missing_room');
    expect(result.previews).toBe(before);
    expect(result.movedRoomIds).toEqual([]);
  });

  it('blocks missing and Laundryner destinations', () => {
    const before = initial();
    expect(moveSelectedRooms(before, ['101'], 'outside').error).toBe('invalid_destination');
    const result = moveSelectedRooms(before, ['101'], 'cara', { destinationIsLaundryner: true });
    expect(result.error).toBe('laundryner_destination');
    expect(result.previews).toBe(before);
  });

  it('refuses duplicate room identity across different source cards rather than copying it', () => {
    const before = [preview('alice', [room('101')]), preview('bob', [room('101')]), preview('cara', [])];
    const result = moveSelectedRooms(before, ['101'], 'cara');
    expect(result.error).toBe('duplicate_room');
    expect(result.previews).toBe(before);
  });

  it('does not add a history-worthy change when nothing needs to move', () => {
    const before = initial();
    expect(moveSelectedRooms(before, [], 'cara').error).toBe('nothing_to_move');
    const result = moveSelectedRooms(before, ['201'], 'bob');
    expect(result.error).toBe('nothing_to_move');
    expect(result.previews).toBe(before);
  });
});
