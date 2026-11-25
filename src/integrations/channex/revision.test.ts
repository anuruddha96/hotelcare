import { describe, expect, it } from 'vitest';
import {
  parseWebhook, planGuest, planRevision, sanitizeRevisionPayload, summarizeRevision, moneyString,
} from '../../../supabase/functions/_shared/channex/revision.ts';

const PROPERTY = '11111111-1111-1111-1111-111111111111';
const ROOM = '33333333-3333-3333-3333-333333333333';
const ctx = {
  hotelId: 'sandbox-hotel', propertyId: PROPERTY, currency: 'EUR',
  roomTypes: new Map([[ROOM, { localRoomTypeId: 'local-double', name: 'Double' }]]),
};

const revision = (attrs: Record<string, unknown>) => ({
  id: 'rev-1',
  attributes: {
    booking_id: 'bk-1', property_id: PROPERTY, status: 'new', ota_name: 'Booking.com', ota_reservation_code: 'BDC-123',
    arrival_date: '2027-03-10', departure_date: '2027-03-12', amount: '230.00', currency: 'EUR', payment_collect: 'ota',
    customer: { name: 'Anna', surname: 'Kovács', mail: 'anna@example.test', phone: '+36 1 234', country: 'hu' },
    rooms: [{ room_type_id: ROOM, checkin_date: '2027-03-10', checkout_date: '2027-03-12', amount: '230.00', occupancy: { adults: 2, children: 1, infants: 0 } }],
    guarantee: { card_number: '4111111111111111', cvv: '123', expiration_date: '12/30' },
    ...attrs,
  },
});

describe('Channex booking revision mapping', () => {
  it('maps a new booking to one reservation per room with nightly rate', () => {
    const plan = planRevision(revision({}), ctx);
    expect(plan.action).toBe('new');
    if (plan.action !== 'new') return;
    expect(plan.reviewReason).toBeNull();
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0]).toMatchObject({ room_type_name: 'Double', adults: 2, children: 1, total_amount: '230.00', rate_per_night: '115.00', currency: 'EUR' });
    expect(plan.guest).toMatchObject({ first_name: 'Anna', last_name: 'Kovács', country: 'HU', payment_collect: 'ota' });
  });

  it('keeps an unmapped room booking (blocks the calendar) and opens a review case', () => {
    const plan = planRevision(revision({ rooms: [{ room_type_id: 'unknown', checkin_date: '2027-03-10', checkout_date: '2027-03-12', amount: '100' }] }), ctx);
    expect(plan.action).toBe('new');
    if (plan.action !== 'new') return;
    expect(plan.rooms[0].room_type_name).toBeNull();
    expect(plan.reviewReason).toContain('unmapped_room_type');
  });

  it('flags a currency mismatch instead of silently converting', () => {
    const plan = planRevision(revision({ currency: 'HUF' }), ctx);
    expect(plan.action === 'new' && plan.reviewReason).toContain('currency_mismatch');
  });

  it('never auto-applies an OTA modification', () => {
    const plan = planRevision(revision({ status: 'modified' }), ctx);
    expect(plan).toMatchObject({ action: 'review', reviewReason: 'ota_modification' });
  });

  it('cancels by booking id', () => {
    expect(planRevision(revision({ status: 'cancelled' }), ctx).action).toBe('cancelled');
  });

  it('refuses a revision for another property', () => {
    expect(planRevision(revision({ property_id: 'other' }), ctx)).toMatchObject({ action: 'review', reviewReason: 'property_mismatch' });
  });

  it('holds a booking without room lines on the booking dates', () => {
    const plan = planRevision(revision({ rooms: [] }), ctx);
    expect(plan.action === 'new' && plan.rooms[0]).toMatchObject({ check_in_date: '2027-03-10', check_out_date: '2027-03-12', total_amount: '230.00' });
  });

  it('removes card and guarantee data before storage', () => {
    const clean = sanitizeRevisionPayload(revision({}).attributes) as Record<string, unknown>;
    expect(JSON.stringify(clean)).not.toMatch(/4111|cvv|card_number|guarantee/);
    expect(clean.ota_reservation_code).toBe('BDC-123');
  });

  it('splits a single full name and drops invalid countries', () => {
    expect(planGuest({ customer: { name: 'Nagy Péter Pál', country: 'Hungary' } })).toMatchObject({ first_name: 'Nagy Péter', last_name: 'Pál', country: null });
  });

  it('summarises id, property and dates defensively', () => {
    expect(summarizeRevision({ id: 'r', attributes: { status: 'weird', arrival_date: '2027-01-01T00:00:00Z' } }))
      .toMatchObject({ revisionId: 'r', status: null, arrivalDate: '2027-01-01', propertyId: null });
  });

  it('formats money without float artefacts', () => {
    expect(moneyString('115')).toBe('115.00');
    expect(moneyString(0.1 + 0.2)).toBe('0.30');
    expect(moneyString(-5)).toBe('0.00');
  });

  it('parses the webhook notification', () => {
    expect(parseWebhook({ event: 'booking', payload: { revision_id: 'r1', property_id: PROPERTY, booking_id: 'b1' } }))
      .toEqual({ event: 'booking', revisionId: 'r1', propertyId: PROPERTY, bookingId: 'b1' });
  });

  it('parses a webhook whose payload is the full revision (id = revision id)', () => {
    expect(parseWebhook({ event: 'booking', payload: { id: 'r2', booking_id: 'b2', property_id: PROPERTY, status: 'new' } }))
      .toEqual({ event: 'booking', revisionId: 'r2', propertyId: PROPERTY, bookingId: 'b2' });
    // API-shaped payload {id, attributes:{...}}
    expect(parseWebhook({ event: 'booking', payload: { id: 'r3', attributes: { booking_id: 'b3', property_id: PROPERTY } } }))
      .toEqual({ event: 'booking', revisionId: 'r3', propertyId: PROPERTY, bookingId: 'b3' });
  });

  it('reads a top-level property_id and never treats a non-booking payload id as a revision', () => {
    expect(parseWebhook({ event: 'booking', property_id: PROPERTY, payload: { revision_id: 'r4' } }).propertyId).toBe(PROPERTY);
    expect(parseWebhook({ event: 'ari', payload: { id: 'not-a-revision' } }).revisionId).toBeNull();
    expect(parseWebhook({ event: 'booking', payload: { id: 'plain-id-no-booking-fields' } }).revisionId).toBeNull();
  });
});
