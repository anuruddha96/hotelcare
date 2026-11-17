import { describe, expect, it } from 'vitest';
import {
  addDaysIso, brandColors, countryOptions, distributeGuests, freeCancellationDate, nightsBetween,
  readAttribution, remainingOfType, selectionTotal, stayIcs, toHex, type Offer,
} from './logic';
import { bookingPlural, bookingT, missingTranslations } from './i18n';

const room = (max_adults: number, max_children: number, max_occupancy: number) => ({ max_adults, max_children, max_occupancy });
const offer = (room_type_id: string, rate_plan_id: string, total: number, available: number): Offer => ({
  room_type_id, rate_plan_id, total, available, currency: 'EUR', nightly: [], min_stay: 1, max_stay: null, blocked: null,
});

describe('booking engine translations', () => {
  it('has every guest text in all six languages', () => {
    expect(missingTranslations()).toEqual([]);
  });
  it('fills placeholders and plurals', () => {
    expect(bookingT('en', 'onlyLeft', { n: 2 })).toBe('Only 2 left');
    expect(bookingPlural('de', 'nights', 1)).toBe('1 Nacht');
    expect(bookingPlural('de', 'nights', 3)).toBe('3 Nächte');
    expect(bookingPlural('hu', 'adults', 2)).toBe('2 felnőtt');
  });
});

describe('dates', () => {
  it('counts nights and adds days across months', () => {
    expect(nightsBetween('2027-12-29', '2028-01-02')).toBe(4);
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2027-12-31', 1)).toBe('2028-01-01');
  });
});

describe('distributeGuests', () => {
  it('spreads adults evenly and gives each room an adult', () => {
    expect(distributeGuests(4, 0, [room(2, 0, 2), room(2, 0, 2)])).toEqual([{ adults: 2, children: 0 }, { adults: 2, children: 0 }]);
    expect(distributeGuests(3, 1, [room(3, 2, 3), room(2, 0, 2)])).toEqual([{ adults: 2, children: 1 }, { adults: 1, children: 0 }]);
  });
  it('returns null when the party does not fit or a room would have no adult', () => {
    expect(distributeGuests(3, 0, [room(2, 0, 2)])).toBeNull();
    expect(distributeGuests(1, 0, [room(2, 0, 2), room(2, 0, 2)])).toBeNull();
    expect(distributeGuests(2, 1, [room(2, 0, 2), room(2, 0, 2)])).toBeNull();
  });
});

describe('cancellation terms', () => {
  it('gives the last free day, or null when non-refundable or already inside the window', () => {
    expect(freeCancellationDate({ refundable: true, free_cancellation_days: 2 }, '2027-12-20', '2027-11-17')).toBe('2027-12-18');
    expect(freeCancellationDate({ refundable: false, free_cancellation_days: 2 }, '2027-12-20', '2027-11-17')).toBeNull();
    expect(freeCancellationDate({ refundable: true, free_cancellation_days: 5 }, '2027-11-20', '2027-11-17')).toBeNull();
  });
});

describe('selections', () => {
  const offers = [offer('twin', 'bar', 200, 2), offer('twin', 'bb', 240, 2), offer('dbl', 'bar', 300, 1)];
  it('totals the chosen rooms and never offers more rooms than are free', () => {
    const chosen = [{ roomTypeId: 'twin', ratePlanId: 'bar' }, { roomTypeId: 'twin', ratePlanId: 'bb' }];
    expect(selectionTotal(offers, chosen)).toBe(440);
    expect(remainingOfType(offers, chosen, 'twin')).toBe(0);
    expect(remainingOfType(offers, chosen, 'dbl')).toBe(1);
  });
});

describe('colours', () => {
  it('picks readable text on the brand colour and converts hotel hsl colours', () => {
    expect(brandColors('#8a6a3d').onPrimary).toBe('#ffffff');
    expect(brandColors('#f5e9c8').onPrimary).toBe('#111827');
    expect(brandColors('not-a-colour').primary).toBe('#8a6a3d');
    expect(toHex('hsl(200, 76%, 58%)')).toMatch(/^#[0-9a-f]{6}$/);
    expect(toHex('#AABBCC')).toBe('#aabbcc');
  });
});

describe('attribution and export', () => {
  it('keeps campaign tags and the parent page URL', () => {
    expect(readAttribution('?utm_source=google&gclid=abc&foo=1&ref_url=https%3A%2F%2Fhotel.hu%2Fbook', '')).toEqual({
      utm_source: 'google', gclid: 'abc', referrer: 'https://hotel.hu/book',
    });
  });
  it('builds an all-day calendar event for the stay', () => {
    const ics = stayIcs({ reference: 'W1A2B3C4', hotel: 'Hotel, Budapest', checkIn: '2027-12-20', checkOut: '2027-12-22' });
    expect(ics).toContain('DTSTART;VALUE=DATE:20271220');
    expect(ics).toContain('DTEND;VALUE=DATE:20271222');
    expect(ics).toContain('SUMMARY:Hotel\\, Budapest · W1A2B3C4');
  });
  it('lists countries in the guest language', () => {
    const list = countryOptions('de');
    expect(list.find((c) => c.code === 'HU')?.name).toBe('Ungarn');
    expect(list.length).toBeGreaterThan(190);
  });
});
