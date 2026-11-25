import { describe, expect, it } from 'vitest';
import { planRestrictions, type RateChangeRow } from '../../../supabase/functions/_shared/channex/ariPlan.ts';
import { planRevision } from '../../../supabase/functions/_shared/channex/revision.ts';

/**
 * Channex certification scenarios on the native (HotelCare-as-PMS) path:
 * two rate plans per room type, keyed by HotelCare rate_plans.id.
 * Each test = one save in Reception -> Rates & Availability = one restrictions request.
 */
const P = 'prop-1';
const today = '2026-11-13';
const ratePlanByRoomType = new Map([
  ['twin-bar', 'cx-twin-bar'], ['twin-bb', 'cx-twin-bb'], ['dbl-bar', 'cx-dbl-bar'], ['dbl-bb', 'cx-dbl-bb'],
]);
const ctx = { propertyId: P, currency: 'USD', today, ratePlanByRoomType };
const ROOM: Record<string, string> = { 'twin-bar': 'twin', 'twin-bb': 'twin', 'dbl-bar': 'dbl', 'dbl-bb': 'dbl' };

let seq = 0;
function range(plan: string, from: string, to: string, patch: Record<string, unknown>): RateChangeRow[] {
  const out: RateChangeRow[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push({ id: ++seq, room_type_id: ROOM[plan], rate_plan_id: plan, stay_date: d.toISOString().slice(0, 10), currency: 'USD', patch });
  }
  return out;
}

describe('certification tests 2-8 (native, several rate plans per room type)', () => {
  it('test 3: three single dates on three plans = one message, three values', () => {
    const { values, skipped } = planRestrictions([
      ...range('twin-bar', '2027-11-21', '2027-11-21', { rate: '333.00' }),
      ...range('dbl-bar', '2027-11-25', '2027-11-25', { rate: '444.00' }),
      ...range('dbl-bb', '2027-11-29', '2027-11-29', { rate: '456.23' }),
    ], ctx);
    expect(skipped).toEqual([]);
    expect(values.map((v) => [v.rate_plan_id, v.rate])).toEqual(expect.arrayContaining([
      ['cx-twin-bar', 33300], ['cx-dbl-bar', 44400], ['cx-dbl-bb', 45623],
    ]));
    expect(values).toHaveLength(3);
  });

  it('BAR and B&B of the same room type stay separate', () => {
    const { values } = planRestrictions([
      ...range('twin-bar', '2027-11-01', '2027-11-10', { rate: '241.00' }),
      ...range('twin-bb', '2027-11-01', '2027-11-10', { rate: '261.00' }),
    ], ctx);
    expect(values).toHaveLength(2);
    expect(new Set(values.map((v) => v.rate_plan_id))).toEqual(new Set(['cx-twin-bar', 'cx-twin-bb']));
  });

  it('test 4: date ranges compress to one value per plan', () => {
    const { values } = planRestrictions([
      ...range('twin-bar', '2027-11-01', '2027-11-10', { rate: '241.00' }),
      ...range('dbl-bar', '2027-11-10', '2027-11-16', { rate: '312.66' }),
      ...range('dbl-bb', '2027-11-01', '2027-11-20', { rate: '111.00' }),
    ], ctx);
    expect(values).toHaveLength(3);
    expect(values.find((v) => v.rate_plan_id === 'cx-dbl-bb')).toMatchObject({ date_from: '2027-11-01', date_to: '2027-11-20', rate: 11100 });
  });

  it('test 7: mixed restrictions send only the fields that were set', () => {
    const { values } = planRestrictions([
      ...range('twin-bar', '2027-11-01', '2027-11-10', { closed_to_arrival: true, closed_to_departure: false, max_stay: 4, min_stay_arrival: 1 }),
      ...range('twin-bb', '2027-11-12', '2027-11-16', { closed_to_arrival: false, closed_to_departure: true, min_stay_arrival: 6 }),
      ...range('dbl-bar', '2027-11-10', '2027-11-16', { closed_to_arrival: true, min_stay_arrival: 2 }),
      ...range('dbl-bb', '2027-11-01', '2027-11-20', { min_stay_arrival: 10 }),
    ], ctx);
    expect(values).toHaveLength(4);
    expect(values.find((v) => v.rate_plan_id === 'cx-dbl-bb')).toEqual({ property_id: P, rate_plan_id: 'cx-dbl-bb', date_from: '2027-11-01', date_to: '2027-11-20', min_stay_arrival: 10 });
  });

  it('test 8: half-year rate + restrictions = one value per plan', () => {
    const { values } = planRestrictions([
      ...range('twin-bar', '2027-12-01', '2028-05-01', { rate: '432.00', closed_to_arrival: false, closed_to_departure: false, min_stay_arrival: 2 }),
      ...range('dbl-bar', '2027-12-01', '2028-05-01', { rate: '342.00', min_stay_arrival: 3 }),
    ], ctx);
    expect(values).toHaveLength(2);
  });

  it('rows without rate_plan_id still use the room type mapping (Previo hotels)', () => {
    const { values } = planRestrictions([{ id: 1, room_type_id: 'twin-bar', stay_date: '2027-01-15', currency: 'USD', patch: { rate: '99.00' } }], ctx);
    expect(values[0].rate_plan_id).toBe('cx-twin-bar');
  });
});

describe('OTA modifications', () => {
  const rev = {
    id: 'rev-2',
    attributes: {
      id: 'rev-2', booking_id: 'bk-1', property_id: P, status: 'modified', currency: 'USD', ota_name: 'Booking.com',
      arrival_date: '2027-12-10', departure_date: '2027-12-13', customer: { name: 'Anna', surname: 'Kovacs' },
      rooms: [{ room_type_id: 'cx-room-twin', checkin_date: '2027-12-10', checkout_date: '2027-12-13', amount: '300.00', occupancy: { adults: 2 } }],
    },
  };
  const base = { hotelId: 'h', propertyId: P, currency: 'USD', roomTypes: new Map([['cx-room-twin', { localRoomTypeId: 'twin', name: 'Twin Room' }]]) };

  it('become review cases on normal hotels', () => {
    expect(planRevision(rev, base).action).toBe('review');
  });

  it('are applied on sandbox hotels when fully mapped', () => {
    const plan = planRevision(rev, { ...base, applyModifications: true });
    expect(plan.action).toBe('modify');
    if (plan.action === 'modify') expect(plan.rooms[0]).toMatchObject({ room_index: 0, room_type_name: 'Twin Room', check_out_date: '2027-12-13', total_amount: '300.00' });
  });

  it('still go to review on sandbox hotels when a room type is unmapped', () => {
    const unmapped = { ...rev, attributes: { ...rev.attributes, rooms: [{ ...rev.attributes.rooms[0], room_type_id: 'cx-unknown' }] } };
    expect(planRevision(unmapped, { ...base, applyModifications: true }).action).toBe('review');
  });
});
