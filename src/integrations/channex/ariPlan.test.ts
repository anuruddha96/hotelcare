import { describe, expect, it } from 'vitest';
import { callsAllowedNow, chunk, planAvailability, planRestrictions } from '../../../supabase/functions/_shared/channex/ariPlan.ts';

const P = 'prop-1';
const today = '2027-01-10';
const ctx = { propertyId: P, currency: 'EUR', today, ratePlanByRoomType: new Map([['rt-double', 'rp-double']]) };

describe('Channex ARI planning', () => {
  it('compresses availability, drops past nights and keeps zero', () => {
    const values = planAvailability(P, [
      { channex_room_type_id: 'crt', stay_date: '2027-01-09', availability: 4 },
      { channex_room_type_id: 'crt', stay_date: '2027-01-10', availability: 0 },
      { channex_room_type_id: 'crt', stay_date: '2027-01-11', availability: 0 },
      { channex_room_type_id: 'crt', stay_date: '2027-01-12', availability: 2 },
    ], today);
    expect(values).toEqual([
      { property_id: P, room_type_id: 'crt', date_from: '2027-01-10', date_to: '2027-01-11', availability: 0 },
      { property_id: P, room_type_id: 'crt', date_from: '2027-01-12', date_to: '2027-01-12', availability: 2 },
    ]);
  });

  it('sends minor-unit integers and merges later edits field by field', () => {
    const { values, usedIds, skipped } = planRestrictions([
      { id: 1, room_type_id: 'rt-double', stay_date: '2027-01-15', currency: 'EUR', patch: { rate: '120.00' } },
      { id: 2, room_type_id: 'rt-double', stay_date: '2027-01-15', currency: 'EUR', patch: { rate: '123.40' } },
      { id: 3, room_type_id: 'rt-double', stay_date: '2027-01-15', currency: 'EUR', patch: { min_stay_arrival: 2 } },
    ], ctx);
    expect(skipped).toEqual([]);
    expect(usedIds).toEqual([1, 2, 3]);
    expect(values).toEqual([{ property_id: P, rate_plan_id: 'rp-double', date_from: '2027-01-15', date_to: '2027-01-15', rate: 12340, min_stay_arrival: 2 }]);
  });

  it('never adds restriction fields that did not change', () => {
    const { values } = planRestrictions([{ id: 1, room_type_id: 'rt-double', stay_date: '2027-01-15', currency: 'EUR', patch: { rate: '99.00' } }], ctx);
    expect(Object.keys(values[0]).sort()).toEqual(['date_from', 'date_to', 'property_id', 'rate', 'rate_plan_id']);
  });

  it('compresses equal prices across consecutive nights', () => {
    const rows = ['2027-01-15', '2027-01-16', '2027-01-17'].map((d, i) => ({ id: i + 1, room_type_id: 'rt-double', stay_date: d, currency: 'EUR', patch: { rate: '100.00' } }));
    expect(planRestrictions(rows, ctx).values).toEqual([{ property_id: P, rate_plan_id: 'rp-double', date_from: '2027-01-15', date_to: '2027-01-17', rate: 10000 }]);
  });

  it('skips unmapped room types, past dates, foreign currency and over-precise amounts with a reason', () => {
    const { values, skipped } = planRestrictions([
      { id: 1, room_type_id: 'rt-unknown', stay_date: '2027-01-15', currency: 'EUR', patch: { rate: '1.00' } },
      { id: 2, room_type_id: 'rt-double', stay_date: '2027-01-01', currency: 'EUR', patch: { rate: '1.00' } },
      { id: 3, room_type_id: 'rt-double', stay_date: '2027-01-15', currency: 'HUF', patch: { rate: '30000.00' } },
      { id: 4, room_type_id: 'rt-double', stay_date: '2027-01-15', currency: 'EUR', patch: { rate: '1.005' } },
    ], ctx);
    expect(values).toEqual([]);
    expect(skipped.map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(skipped[2].reason).toMatch(/currency/);
  });

  it('accepts Channex max_stay zero as unlimited while minimum stays remain positive', () => {
    const { values, skipped } = planRestrictions([
      { id: 11, room_type_id: 'rt-double', stay_date: '2027-01-15', currency: 'EUR', patch: { rate: '120.00', max_stay: 0, min_stay_arrival: 1 } },
    ], ctx);
    expect(skipped).toEqual([]);
    expect(values[0]).toMatchObject({ rate: 12000, max_stay: 0, min_stay_arrival: 1 });
    expect(() => planRestrictions([
      { id: 12, room_type_id: 'rt-double', stay_date: '2027-01-15', currency: 'EUR', patch: { min_stay_arrival: 0 } },
    ], ctx)).toThrow('Invalid positive stay limit');
  });

  it('stays under the Channex per-property call limit', () => {
    expect(callsAllowedNow(0)).toBe(5);
    expect(callsAllowedNow(7)).toBe(2);
    expect(callsAllowedNow(9)).toBe(0);
    expect(callsAllowedNow(15)).toBe(0);
  });

  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
