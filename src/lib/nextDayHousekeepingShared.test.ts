import { describe, expect, it } from 'vitest';
import {
  partitionSharedPlanItems,
  removeStaffFromSharedRooms,
  setSharedRoomHelper,
  splitSharedDuration,
} from './nextDayHousekeepingShared';

describe('next-day shared housekeeping planning', () => {
  it('restores one primary row and one explicit shared helper', () => {
    const result = partitionSharedPlanItems([
      {
        room_id: 'room-101',
        assigned_to: 'staff-a',
        source: 'manager',
        recommendation_context: { assignment_role: 'primary' },
      },
      {
        room_id: 'room-101',
        assigned_to: 'staff-b',
        source: 'shared',
        recommendation_context: { assignment_role: 'shared' },
      },
    ]);

    expect(result.primaryItems).toHaveLength(1);
    expect(result.primaryItems[0].assigned_to).toBe('staff-a');
    expect(result.sharedByRoom.get('room-101')).toBe('staff-b');
  });

  it('preserves an old duplicate room row as a helper instead of losing it', () => {
    const result = partitionSharedPlanItems([
      { room_id: 'room-202', assigned_to: 'staff-a', source: 'auto' },
      { room_id: 'room-202', assigned_to: 'staff-c', source: 'manual' },
    ]);

    expect(result.primaryItems).toHaveLength(1);
    expect(result.primaryItems[0].assigned_to).toBe('staff-a');
    expect(result.sharedByRoom.get('room-202')).toBe('staff-c');
  });

  it('never allows the primary cleaner to also be their own shared helper', () => {
    const previous = new Map<string, string>();
    const result = setSharedRoomHelper(previous, 'room-303', 'staff-a', 'staff-a');
    expect(result.has('room-303')).toBe(false);
  });

  it('replaces the helper atomically and removes a deselected helper everywhere', () => {
    let state = setSharedRoomHelper(new Map(), 'room-1', 'staff-b', 'staff-a');
    state = setSharedRoomHelper(state, 'room-1', 'staff-c', 'staff-a');
    state = setSharedRoomHelper(state, 'room-2', 'staff-c', 'staff-b');

    expect(state.get('room-1')).toBe('staff-c');
    expect(state.get('room-2')).toBe('staff-c');

    state = removeStaffFromSharedRooms(state, 'staff-c');
    expect(state.size).toBe(0);
  });

  it('splits a room duration without creating zero-minute work', () => {
    expect(splitSharedDuration(45)).toBe(23);
    expect(splitSharedDuration(15)).toBe(8);
    expect(splitSharedDuration(1)).toBe(1);
  });
});
