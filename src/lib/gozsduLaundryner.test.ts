import { describe, expect, it } from 'vitest';
import { getLaundryBucket, groupLaundryRooms, isEligibleLaundryRoom, type LaundryRoom } from './gozsduLaundryner';

const makeRoom = (roomNumber: string, overrides: Partial<LaundryRoom> = {}): LaundryRoom => ({
  id: roomNumber,
  room_number: roomNumber,
  hotel: 'gozsdu-court',
  status: 'dirty',
  is_checkout_room: false,
  is_dnd: false,
  pms_metadata: { currentNight: 1, gozsduAvailability: { status: 'operating' } },
  ...overrides,
});

describe('Gozsdu Laundryner collection buckets', () => {
  it('prioritizes checkout, every even-night service-due stayover, then other operating rooms', () => {
    const rooms = [
      makeRoom('10', { pms_metadata: { currentNight: 3, gozsduAvailability: { status: 'operating' } } }),
      makeRoom('2', { pms_metadata: { currentNight: 2, gozsduAvailability: { status: 'operating' } } }),
      makeRoom('4', { pms_metadata: { currentNight: 4, gozsduAvailability: { status: 'operating' } } }),
      makeRoom('6', { pms_metadata: { currentNight: 6, gozsduAvailability: { status: 'operating' } } }),
      makeRoom('1', { is_checkout_room: true }),
      makeRoom('12', { is_dnd: true }),
    ];
    const groups = groupLaundryRooms(rooms);
    expect(groups.checkout.map(r => r.id)).toEqual(['1']);
    expect(groups.second_day.map(r => r.id)).toEqual(['2', '4', '6']);
    expect(groups.other.map(r => r.id)).toEqual(['10', '12']);
    expect(getLaundryBucket(rooms[0])).toBe('other');
  });

  it('keeps checkout precedence when an even-night room is departing today', () => {
    const room = makeRoom('204', {
      pms_metadata: { currentNight: 4, scheduledDepartureToday: true, gozsduAvailability: { status: 'operating' } },
    });
    expect(getLaundryBucket(room)).toBe('checkout');
  });

  it('does not treat missing, zero, negative, fractional or invalid night values as service due', () => {
    const values = [undefined, 0, -2, 2.5, 'unknown'];
    for (const currentNight of values) {
      const room = makeRoom(`room-${String(currentNight)}`, {
        pms_metadata: { currentNight, gozsduAvailability: { status: 'operating' } },
      });
      expect(getLaundryBucket(room)).toBe('other');
    }
  });

  it('excludes inactive, non-guest, no-show, out-of-order and other hotels', () => {
    const rooms = [
      makeRoom('active'),
      makeRoom('private', { pms_metadata: { gozsduAvailability: { status: 'non_guest' } } }),
      makeRoom('closed', { pms_metadata: { gozsduAvailability: { status: 'unavailable' } } }),
      makeRoom('no-show', { pms_metadata: { isNoShow: true, gozsduAvailability: { status: 'operating' } } }),
      makeRoom('out', { status: 'out_of_order' }),
      makeRoom('mika', { hotel: 'mika-downtown' }),
      makeRoom('unknown', { pms_metadata: {} }),
    ];
    expect(rooms.filter(isEligibleLaundryRoom).map(r => r.id)).toEqual(['active']);
    expect(groupLaundryRooms(rooms).other.map(r => r.id)).toEqual(['active']);
  });
});
