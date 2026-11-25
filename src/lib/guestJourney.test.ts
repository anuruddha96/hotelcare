import { describe, expect, it } from 'vitest';
import {
  cleanTags, countryName, formatGuestDate, guestProfilePath, guestTagLabel, isPresetTag, isReservationId,
  isReturningGuest, normalizeGuestSignal, returningLine,
} from './guestJourney';

const t = (key: string) => ({
  'pms.guest.stayNumber': 'Stay #{n}',
  'pms.guest.lastStayUntil': 'last stay until {date}',
  'pms.guestTag.quiet_room': 'Quiet room',
} as Record<string, string>)[key] ?? key;

describe('guest journey helpers', () => {
  it('treats a group under one name as not returning', () => {
    expect(isReturningGuest({ previous_stays: 2, group_size: 1 })).toBe(true);
    expect(isReturningGuest({ previous_stays: 2, group_size: 3 })).toBe(false);
    expect(isReturningGuest({ previous_stays: 0, group_size: 1 })).toBe(false);
    expect(isReturningGuest(null)).toBe(false);
  });

  it('builds profile links for saved and booking-only guests', () => {
    expect(guestProfilePath('/rdhotels', 'memories-budapest', 'n:anna kovacs'))
      .toBe('/rdhotels/guests/k/memories-budapest/n%3Aanna%20kovacs');
    expect(guestProfilePath('/channex', 'x', 'g:00000000-0000-0000-0000-00000000b001'))
      .toBe('/channex/guests/00000000-0000-0000-0000-00000000b001');
  });

  it('cleans tags: trims, removes duplicates case-insensitively, caps length and count', () => {
    expect(cleanTags([' quiet_room ', 'Quiet_Room', '', 'x'.repeat(50)])).toEqual(['quiet_room', 'x'.repeat(40)]);
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(24);
  });

  it('labels preset tags and keeps custom tags as typed', () => {
    expect(isPresetTag('quiet_room')).toBe(true);
    expect(guestTagLabel('quiet_room', t)).toBe('Quiet room');
    expect(guestTagLabel('Room with a view', t)).toBe('Room with a view');
  });

  it('normalises server rows defensively', () => {
    const s = normalizeGuestSignal({ reservation_id: 'r1', previous_stays: '2', group_size: null, vip: true, tags: ['a', 3, 'b'], dietary: '  ', notes: 'n' });
    expect(s).toMatchObject({ reservation_id: 'r1', previous_stays: 2, group_size: 1, vip: true, tags: ['a', 'b'], dietary: null, notes: 'n', profile_key: null });
  });

  it('accepts only reservation uuids', () => {
    expect(isReservationId('00000000-0000-0000-0000-00000000d00c')).toBe(true);
    expect(isReservationId('snapshot-1')).toBe(false);
    expect(isReservationId(undefined)).toBe(false);
  });

  it('formats the returning line in the reader language', () => {
    const line = returningLine({ ...normalizeGuestSignal({ reservation_id: 'r', previous_stays: 2 }), last_stay_end: '2026-10-02' }, t, 'en');
    expect(line).toBe('Stay #3 · last stay until 2 Oct 2026');
    expect(formatGuestDate(null)).toBe('—');
    expect(formatGuestDate('2026-10-02', 'hu')).toMatch(/2026/);
    expect(countryName('hu', 'en')).toBe('Hungary');
  });
});
