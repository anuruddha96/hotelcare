import { describe, expect, it } from 'vitest';
import { buildGozsduOptionalRooms, selectGozsduOptionalRooms } from './gozsduTomorrowOptionalRooms';

const selectedDate = '2026-09-22';
function room(id: string, name: string, overrides: any = {}) {
  return {
    id, hotel: 'gozsdu-court', room_number: name, status: 'clean',
    pms_metadata: { gozsduAvailability: { pmsRoomName: name, status: 'operating' }, ...overrides },
  };
}
function row(name: string, arrival: string, departure: string) {
  return { room_label: name, arrival_date: arrival, departure_date: departure };
}
function build(rooms: any[], selected: any[] = [], preceding: any[] = [], following: any[] = []) {
  return buildGozsduOptionalRooms({
    selectedDate, roomRows: rooms, selectedRows: selected,
    precedingRows: preceding, followingRows: following,
  });
}

describe('Gozsdu tomorrow PMS-only optional room reconciliation', () => {
  it('never reclassifies a verified departure or stayover as an optional empty room', () => {
    expect(build([room('a','1B-113'), room('b','1B-114')],
      [row('1B-113','2026-09-20',selectedDate), row('1B-114','2026-09-20','2026-09-23')])).toEqual([]);
  });
  it('keeps arrival-only rooms separate from vacancy and selected-date checkout', () => {
    const result = build([room('a','1BBALC-B16')], [], [], [row('1BBALC-B16',selectedDate,'2026-09-23')]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('arrival_only');
    expect(result[0].room.is_checkout_room).toBe(false);
    expect(result[0].room.pms_metadata.scheduledDepartureToday).toBe(false);
  });
  it('labels yesterday checkout without tomorrow occupancy as vacant, not a new checkout', () => {
    const result = build([room('a','2B-1/2/4')], [], [row('2B-1/2/4','2026-09-20','2026-09-21')]);
    expect(result[0].kind).toBe('vacant');
    expect(result[0].evidence).toContain('Previous-day departure');
    expect(result[0].room.is_checkout_room).toBe(false);
  });
  it('requires an exact-date no-show flag and never treats a missing reservation alone as no-show', () => {
    const rooms = [room('a','ST-101',{ isNoShow: true }), room('b','ST-102',{ isNoShow: true, noShowDate: selectedDate })];
    const result = build(rooms);
    expect(result.map(item => item.kind)).toEqual(['vacant','no_show']);
  });
  it('does not offer unavailable or manager-held units even if absent from the PMS feed', () => {
    const blocked = room('a','1B-2/2/2');
    blocked.pms_metadata.gozsduAvailability.status = 'unavailable';
    expect(build([blocked, room('b','ST-103',{manualHousekeepingHold:true}), {...room('c','ST-104'),status:'out_of_order'}])).toEqual([]);
  });
  it('selects none by default and rejects a stale or fabricated selection', () => {
    const candidates = build([room('a','ST-109')]);
    expect(selectGozsduOptionalRooms(candidates, new Set())).toEqual([]);
    expect(selectGozsduOptionalRooms(candidates, new Set(['a']))).toHaveLength(1);
    expect(() => selectGozsduOptionalRooms(candidates, new Set(['not-a-current-room']))).toThrow('availability changed');
  });
  it('fails closed on ambiguous registry room aliases', () => {
    expect(() => build([room('a','ST-109'), room('b','ST-109')])).toThrow('Duplicate Gozsdu registry mapping');
  });
});
