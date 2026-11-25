import { describe, expect, it } from 'vitest';
import { LOST_FOUND_AREAS, lostFoundAreaLabel, lostFoundLocationLabel } from './lostFoundLocation';

describe('Lost & Found location display', () => {
  it('uses the room link as the authoritative location', () => {
    expect(lostFoundLocationLabel({
      rooms: { room_number: '103' },
      found_location: 'Lobby',
    })).toBe('Guest room 103');
  });

  it('shows a hotel area when no room is linked', () => {
    expect(lostFoundLocationLabel({
      rooms: null,
      found_location: 'Reception',
    })).toBe('Reception');
    expect(lostFoundAreaLabel('Lobby', 'hu')).toBe('Előtér');
  });

  it('preserves a custom location without alteration', () => {
    expect(lostFoundLocationLabel({
      rooms: null,
      found_location: '  Conference centre - second floor  ',
    })).toBe('Conference centre - second floor');
  });

  it('handles legacy general reports without a location', () => {
    expect(lostFoundLocationLabel({ rooms: null, found_location: null })).toBe('Not specified');
    expect(lostFoundLocationLabel({ rooms: null, found_location: null }, 'hu')).toBe('Nincs megadva');
  });

  it('offers expected hotel areas', () => {
    expect(LOST_FOUND_AREAS).toEqual(expect.arrayContaining([
      'Reception', 'Lobby', 'Conference room', 'Restaurant', 'Gym',
    ]));
  });
});
