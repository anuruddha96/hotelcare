import { describe, expect, it } from 'vitest';
import { buildPriceList, formatPrice, priceListDates, shiftDate, todayInBudapest, type PriceListResponse } from '@/lib/revenue/priceList';

const response: PriceListResponse = {
  hotel_id: 'ottofiori',
  from: '2026-11-20',
  to: '2026-11-21',
  synced_at: '2026-11-17T19:00:00Z',
  room_types: [
    { id: 'rt-2', name: 'Suite', pms_room_id: 'obk-2', num_rooms: 2, sort_order: 2, name_translations: {} },
    { id: 'rt-1', name: 'Double room', pms_room_id: 'obk-1', num_rooms: '10', sort_order: 1, name_translations: { hu: 'Kétágyas szoba' } },
    { id: 'rt-9', name: 'Technikai szoba', pms_room_id: 'obk-9', num_rooms: 1, sort_order: 9 },
    { id: 'rt-0', name: 'Breakfast', pms_room_id: 'obk-0', num_rooms: 0, sort_order: 0 },
  ],
  rates: [
    { stay_date: '2026-11-20', obk_id: 'obk-1', occupancy: 2, price: 120, currency: 'EUR' },
    { stay_date: '2026-11-20', obk_id: 'obk-1', occupancy: 1, price: '105', currency: 'EUR' },
    { stay_date: '2026-11-21', obk_id: 'obk-1', occupancy: 2, price: 130, currency: 'EUR' },
    // A later row for the same cell wins, like the Revenue grid.
    { stay_date: '2026-11-21', obk_id: 'obk-1', occupancy: 2, price: 135, currency: 'EUR' },
    { stay_date: '2026-11-20', obk_id: 'obk-9', occupancy: 1, price: 1, currency: 'EUR' },
  ],
};

describe('price list', () => {
  const dates = priceListDates('2026-11-20', 2);

  it('lists sellable room types in order, one row per guest count', () => {
    const table = buildPriceList(response, 'en', dates);
    expect(table.rows.map((r) => `${r.roomName}/${r.guests}`)).toEqual(['Double room/1', 'Double room/2', 'Suite/null']);
    expect(table.rows[0].firstOfRoom).toBe(true);
    expect(table.rows[1].firstOfRoom).toBe(false);
    expect(table.currency).toBe('EUR');
  });

  it('shows the published price per date and nothing where Previo has none', () => {
    const table = buildPriceList(response, 'en', dates);
    const double2 = table.rows.find((r) => r.guests === 2)!;
    expect(double2.prices).toEqual({ '2026-11-20': 120, '2026-11-21': 135 });
    const single = table.rows.find((r) => r.guests === 1)!;
    expect(single.prices['2026-11-21']).toBeNull();
    expect(table.rows.find((r) => r.roomName === 'Suite')!.prices).toEqual({ '2026-11-20': null, '2026-11-21': null });
  });

  it('uses the translated room name', () => {
    expect(buildPriceList(response, 'hu', dates).rows[0].roomName).toBe('Kétágyas szoba');
  });

  it('handles an empty answer', () => {
    expect(buildPriceList(null, 'en', dates).rows).toEqual([]);
  });

  it('walks the calendar across month ends', () => {
    expect(priceListDates('2026-11-29', 3)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
    expect(shiftDate('2026-12-30', 7)).toBe('2027-01-06');
    expect(shiftDate('2026-12-06', -7)).toBe('2026-11-29');
    expect(todayInBudapest(new Date('2026-11-17T23:30:00Z'))).toBe('2026-11-18');
  });

  it('prints whole prices in the hotel currency', () => {
    expect(formatPrice(120, 'EUR', 'en-GB')).toBe('€120');
    expect(formatPrice(null, 'EUR', 'en-GB')).toBe('–');
    expect(formatPrice(33000, 'HUF', 'hu-HU').replace(/\s/g, ' ')).toBe('33 000 Ft');
  });
});
