import { describe, expect, it } from 'vitest';
import { applyVenuePreferences, slntVenueKey } from '@/lib/slntTeamBVenueAffinity';

const room = (id: string, room_number: string) => ({ id, room_number } as any);

describe('SLNT Team B venue affinity', () => {
  it('groups known SLNT room labels into stable venues', () => {
    expect(slntVenueKey(room('1', 'Silver Rooms 12'))).toBe('Silver Rooms');
    expect(slntVenueKey(room('2', 'K4 – Room 2'))).toBe('K4');
    expect(slntVenueKey(room('3', 'St King 11 – Room 8'))).toBe('St King 11');
    expect(slntVenueKey(room('4', 'WR Pension 101'))).toBe('WR Pension');
    expect(slntVenueKey(room('5', 'Dorothilux Apartment'))).toBe('Dorothilux Apartment');
  });

  it('assigns every room in a preferred venue to the preferred working cleaner', () => {
    const rooms = [room('1', 'Silver Rooms 1'), room('2', 'Silver Rooms 9'), room('3', 'K4 – Room 1')];
    const result = applyVenuePreferences(rooms, new Set(['carmen', 'imre']), new Map([['Silver Rooms', 'carmen']]));
    expect(result.get('1')).toBe('carmen');
    expect(result.get('2')).toBe('carmen');
    expect(result.has('3')).toBe(false);
  });

  it('ignores a preferred cleaner who is not working that day', () => {
    const rooms = [room('1', 'Silver Rooms 1')];
    const result = applyVenuePreferences(rooms, new Set(['imre']), new Map([['Silver Rooms', 'carmen']]));
    expect(result.has('1')).toBe(false);
  });
});
