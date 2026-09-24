import { describe, expect, it } from 'vitest';
import { generateSmartHousekeepingPlan } from './housekeepingSmartPlanner';
import type { AssignmentPreview, RoomForAssignment, StaffForAssignment } from './roomAssignmentAlgorithm';
import { autoAssignRooms } from './roomAssignmentAlgorithm';
import { sameHousekeepingRoomGroups } from './housekeepingCandidateDiversification';

const staff: StaffForAssignment[] = [
  { id: 'a', full_name: 'Alice', nickname: null },
  { id: 'b', full_name: 'Bea', nickname: null },
];
const room = (id: string, hotel = 'mika-downtown', checkout = false): RoomForAssignment => ({
  id, room_number: id, hotel, floor_number: 1, room_size_sqm: 21,
  room_capacity: 2, status: 'dirty', is_checkout_room: checkout,
});
const rooms = [room('101'), room('102'), room('103'), room('104'), room('105'), room('106')];
const basic = (partial: Record<string, any> = {}) => ({
  rooms, staff, organizationSlug: 'rdhotels', hotelId: 'mika-downtown',
  hotelConfig: { hotelName: 'Hotel Mika Downtown' }, goal: 'rebalance' as const,
  ...partial,
});

describe('Smart housekeeping regeneration', () => {
  it('changes the actual partition instead of just exchanging staff names', () => {
    const previous = autoAssignRooms(rooms, staff, undefined, undefined,
      { hotelName: 'Hotel Mika Downtown', randomSeed: 5 });
    const managerEdit: AssignmentPreview[] = previous.map((person, i) => ({
      ...person,
      rooms: i === 0 ? rooms : [],
      estimatedMinutes: i === 0 ? 90 : 0,
      totalWithBreak: i === 0 ? 120 : 30,
      dailyCount: i === 0 ? 6 : 0,
      checkoutCount: 0,
      totalWeight: i === 0 ? 6 : 0,
    }));
    const result = generateSmartHousekeepingPlan(basic({ previous: managerEdit, seed: 15 }));
    expect(result.changed).toBe(true);
    expect(result.plan).not.toBeNull();
    expect(sameHousekeepingRoomGroups(result.plan!, managerEdit)).toBe(false);
    expect(result.plan!.flatMap(person => person.rooms)).toHaveLength(6);
    expect(new Set(result.plan!.flatMap(person => person.rooms.map(item => item.id))).size).toBe(6);
    expect(result.reason).toMatch(/room reassignment/i);
  });

  it('keeps manual locks on their original cleaner', () => {
    const previous = autoAssignRooms(rooms, staff, undefined, undefined,
      { hotelName: 'Hotel Mika Downtown', randomSeed: 5 });
    const locked = previous[0].rooms[0].id;
    const result = generateSmartHousekeepingPlan(basic({
      previous, lockedRoomIds: new Set([locked]), seed: 88,
    }));
    expect(result.plan!.find(person => person.rooms.some(item => item.id === locked))?.staffId)
      .toBe(previous[0].staffId);
  });

  it('rebalances across a smaller cleaner pool while preserving explicit active-room ownership', () => {
    const previous = autoAssignRooms(rooms, staff, undefined, undefined,
      { hotelName: 'Hotel Mika Downtown', randomSeed: 5 });
    const fixedRoom = previous.find(person => person.staffId === 'a')!.rooms[0].id;
    const result = generateSmartHousekeepingPlan(basic({
      staff: staff.slice(0, 1),
      previous,
      lockedRoomIds: new Set([fixedRoom]),
      fixedRoomOwners: new Map([[fixedRoom, 'a']]),
      seed: 44,
    }));
    expect(result.changed).toBe(true);
    expect(result.plan).not.toBeNull();
    expect(result.plan).toHaveLength(1);
    expect(result.plan![0].staffId).toBe('a');
    expect(result.plan![0].rooms).toHaveLength(rooms.length);
    expect(result.plan![0].rooms.some(item => item.id === fixedRoom)).toBe(true);
  });

  it('rejects infeasible short shifts, including public-area workload', () => {
    const tiny = [room('201')];
    expect(generateSmartHousekeepingPlan(basic({ rooms: tiny, staff: staff.slice(0, 1),
      shiftMinutes: new Map([['a', 30]]) })).changed).toBe(false);
    const templates = [{ id: 'lobby', section_id: 'floor-1', section_name: 'Floor 1',
      floor_number: 1, task_name: 'Lobby', icon: 'broom', estimated_duration: 65,
      auto_assign: true, is_active: true, sort_order: 1 }];
    const result = generateSmartHousekeepingPlan(basic({ rooms: tiny, staff: staff.slice(0, 1),
      shiftMinutes: new Map([['a', 90]]), publicAreaTemplates: templates }));
    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/No feasible assignment/i);
  });

  it('fails closed for mixed-property inventory rather than creating cross-property allocations', () => {
    const result = generateSmartHousekeepingPlan(basic({ rooms: [room('101'), room('103', 'slnt-hotel')] }));
    expect(result.changed).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.reason).toMatch(/Mixed-property/i);
  });

  it('never assigns an unavailable cleaner and does not mutate source rooms', () => {
    const initial = rooms.map(r => ({ ...r }));
    const result = generateSmartHousekeepingPlan(basic({ staff: staff.slice(0, 1) }));
    expect(result.plan!.every(person => person.staffId === 'a')).toBe(true);
    expect(rooms).toEqual(initial);
  });

  it('does not claim learning when there are insufficient samples', () => {
    const result = generateSmartHousekeepingPlan(basic({ historicalSampleCount: 1 }));
    expect(result.reason).not.toContain('hotel history');
  });
});
