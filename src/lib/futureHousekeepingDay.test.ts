import { describe, expect, it } from 'vitest';
import { groupFutureHousekeepingRooms } from './futureHousekeepingDay';
import type { RoomForAssignment } from './roomAssignmentAlgorithm';

function room(id: string, checkout: boolean, arrival?: string, unsold = false): RoomForAssignment {
  return {
    id,
    room_number: id,
    is_checkout_room: checkout,
    pms_metadata: {
      selectedDateArrival: arrival || null,
      unsoldAtPlanning: unsold,
    },
  } as RoomForAssignment;
}

describe('selected-date future housekeeping buckets', () => {
  it('distinguishes actual checkouts, day-two and later stayovers, and unbooked provisional work', () => {
    const result = groupFutureHousekeepingRooms([
      room('checkout', true, '2026-11-10'),
      room('night2', false, '2026-11-11'),
      room('night4', false, '2026-11-09'),
      room('unknown', false),
      room('unsold', true, undefined, true),
    ], '2026-11-12');
    expect(result.checkouts.map(r => r.id)).toEqual(['checkout']);
    expect(result.dayTwoStayovers.map(r => r.id)).toEqual(['night2']);
    expect(result.laterStayovers.map(r => r.id)).toEqual(['night4']);
    expect(result.otherStayovers.map(r => r.id)).toEqual(['unknown']);
    expect(result.unbookedMorning.map(r => r.id)).toEqual(['unsold']);
    expect(result.stayoverCount).toBe(3);
    expect(result.roomCount).toBe(5);
  });

  it('rejects invalid business dates rather than showing live room classifications', () => {
    expect(() => groupFutureHousekeepingRooms([], '2026-02-30')).toThrow('Invalid');
    expect(() => groupFutureHousekeepingRooms([], 'today')).toThrow('Invalid');
  });

  it('does not classify a same-day arrival as a second-day stayover', () => {
    const result = groupFutureHousekeepingRooms([room('same-day', false, '2026-11-12')], '2026-11-12');
    expect(result.dayTwoStayovers).toHaveLength(0);
    expect(result.otherStayovers).toHaveLength(1);
  });
});
