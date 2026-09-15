import { describe, expect, it } from 'vitest';
import {
  availableStatusActions,
  buildReadonlyPrevioStays,
  computeFrontDeskMetrics,
  reservationOverlapsWindow,
  type PMSReservation,
} from './pmsFrontDesk';

function reservation(overrides: Partial<PMSReservation> = {}): PMSReservation {
  return {
    id: 'r-1',
    organization_slug: 'rdhotels',
    hotel_id: 'hotel-1',
    source_system: 'hotelcare',
    source_channel: 'manual',
    external_reservation_id: null,
    confirmation_code: 'HC-12345678',
    status: 'confirmed',
    arrival_date: '2026-09-15',
    departure_date: '2026-09-17',
    adults: 2,
    children: 0,
    primary_guest_name: 'Test Guest',
    primary_guest_email: null,
    primary_guest_phone: null,
    currency: 'EUR',
    total_amount: 300,
    notes: null,
    created_at: '2026-09-15T08:00:00Z',
    updated_at: '2026-09-15T08:00:00Z',
    rooms: [{
      id: 'rr-1',
      room_type_id: 'double',
      room_id: 'room-101',
      external_room_id: null,
      adults: 2,
      children: 0,
      assigned_at: '2026-09-15T08:00:00Z',
      nightly_rate: 150,
      nightly_rate_max: 150,
    }],
    ...overrides,
  };
}

describe('PMS front desk lifecycle actions', () => {
  it('offers only valid actions from confirmed', () => {
    expect(availableStatusActions('confirmed')).toEqual(['checked_in', 'cancelled', 'no_show']);
  });

  it('only offers checkout after check-in and nothing after terminal states', () => {
    expect(availableStatusActions('checked_in')).toEqual(['checked_out']);
    expect(availableStatusActions('checked_out')).toEqual([]);
    expect(availableStatusActions('cancelled')).toEqual([]);
    expect(availableStatusActions('no_show')).toEqual([]);
  });
});

describe('Previo snapshot adapter', () => {
  it('deduplicates the same stay repeated across daily snapshots', () => {
    const result = buildReadonlyPrevioStays([
      {
        id: 's1',
        business_date: '2026-09-15',
        room_number: '101',
        arrival_date: '2026-09-15',
        departure_date: '2026-09-18',
        status: 'arrival',
        guest_names: '  Jane   Doe ',
        source: 'previo',
      },
      {
        id: 's2',
        business_date: '2026-09-16',
        room_number: '101',
        arrival_date: '2026-09-15',
        departure_date: '2026-09-18',
        status: 'daily',
        guest_names: 'Jane Doe',
        source: 'previo',
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ roomNumber: '101', guestName: 'Jane Doe' });
  });

  it('ignores snapshot rows that cannot form a real stay', () => {
    expect(buildReadonlyPrevioStays([
      {
        id: 's1',
        business_date: '2026-09-15',
        room_number: null,
        arrival_date: '2026-09-15',
        departure_date: '2026-09-16',
        status: null,
        guest_names: null,
        source: 'previo',
      },
    ])).toEqual([]);
  });
});

describe('front desk counters', () => {
  it('counts arrivals, in-house, departures and unassigned native reservations', () => {
    const rows = [
      reservation({ id: 'arrival', arrival_date: '2026-09-15', status: 'confirmed' }),
      reservation({ id: 'in-house', arrival_date: '2026-09-14', departure_date: '2026-09-17', status: 'checked_in' }),
      reservation({ id: 'departure', arrival_date: '2026-09-12', departure_date: '2026-09-15', status: 'checked_in' }),
      reservation({
        id: 'unassigned',
        arrival_date: '2026-09-16',
        rooms: [{
          id: 'rr-unassigned',
          room_type_id: null,
          room_id: null,
          external_room_id: null,
          adults: 1,
          children: 0,
          assigned_at: null,
          nightly_rate: 120,
          nightly_rate_max: 120,
        }],
      }),
      reservation({ id: 'cancelled', status: 'cancelled', arrival_date: '2026-09-15' }),
    ];

    expect(computeFrontDeskMetrics(rows, '2026-09-15')).toEqual({
      arrivals: 1,
      inHouse: 2,
      departures: 1,
      unassigned: 1,
    });
  });
});

describe('board window overlap', () => {
  it('uses arrival-inclusive, departure-exclusive overlap semantics', () => {
    expect(reservationOverlapsWindow('2026-09-15', '2026-09-17', '2026-09-16', '2026-09-20')).toBe(true);
    expect(reservationOverlapsWindow('2026-09-15', '2026-09-17', '2026-09-17', '2026-09-20')).toBe(false);
    expect(reservationOverlapsWindow('2026-09-20', '2026-09-22', '2026-09-15', '2026-09-20')).toBe(false);
  });
});
