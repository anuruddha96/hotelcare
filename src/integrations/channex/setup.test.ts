import { describe, expect, it } from 'vitest';
import { compareAvailability, planContentSync, ratePlanTitle } from '../../../supabase/functions/_shared/channex/setup.ts';

const P = 'prop-1';
const base = { propertyId: P, currency: 'EUR', primaryOccupancy: 2, mappings: [], remoteRoomTypes: [], remoteRatePlans: [] };
const double = { id: 'l-double', name: 'Double', num_rooms: 10, is_sellable: true };

describe('Channex content sync planning', () => {
  it('creates room type then rate plan when nothing exists', () => {
    const { items } = planContentSync({ ...base, locals: [double] });
    expect(items[0].roomType).toMatchObject({ kind: 'create', attrs: { property_id: P, title: 'Double', count_of_rooms: 10, occ_adults: 2, default_occupancy: 2 } });
    expect(items[0].ratePlan.kind).toBe('create_after_room');
    if (items[0].ratePlan.kind === 'create_after_room') {
      expect(items[0].ratePlan.build('crt-1')).toMatchObject({ room_type_id: 'crt-1', title: 'Double – Standard', sell_mode: 'per_room', rate_mode: 'manual', options: [{ occupancy: 2, is_primary: true, rate: 0 }] });
    }
  });

  it('adopts existing remote objects by name instead of duplicating (retry safety)', () => {
    const { items } = planContentSync({
      ...base, locals: [double],
      remoteRoomTypes: [{ id: 'crt-1', attributes: { title: '  double ', property_id: P } }],
      remoteRatePlans: [{ id: 'crp-1', attributes: { title: ratePlanTitle('Double'), room_type_id: 'crt-1' } }],
    });
    expect(items[0].roomType).toEqual({ kind: 'adopt', channexId: 'crt-1' });
    expect(items[0].ratePlan).toEqual({ kind: 'adopt', channexId: 'crp-1' });
  });

  it('keeps or updates mapped objects that still exist under the property', () => {
    const mappings = [{ kind: 'room_type' as const, local_id: 'l-double', channex_id: 'crt-1' }, { kind: 'rate_plan' as const, local_id: 'l-double', channex_id: 'crp-1' }];
    const { items } = planContentSync({
      ...base, locals: [{ ...double, num_rooms: 12 }], mappings,
      remoteRoomTypes: [{ id: 'crt-1', attributes: { title: 'Double', count_of_rooms: 10 } }],
      remoteRatePlans: [{ id: 'crp-1', attributes: { room_type_id: 'crt-1' } }],
    });
    expect(items[0].roomType).toEqual({ kind: 'update', channexId: 'crt-1', attrs: { title: 'Double', count_of_rooms: 12 } });
    expect(items[0].ratePlan).toEqual({ kind: 'keep', channexId: 'crp-1' });
  });

  it('reports a mapping that no longer exists instead of silently recreating it', () => {
    const { items } = planContentSync({ ...base, locals: [double], mappings: [{ kind: 'room_type', local_id: 'l-double', channex_id: 'gone' }] });
    expect(items[0].roomType.kind).toBe('error');
    expect(items[0].ratePlan.kind).toBe('error');
  });

  it('does not adopt a remote room already mapped to another local type', () => {
    const { items } = planContentSync({
      ...base, locals: [double], mappings: [{ kind: 'room_type', local_id: 'l-other', channex_id: 'crt-1' }],
      remoteRoomTypes: [{ id: 'crt-1', attributes: { title: 'Double' } }],
    });
    expect(items[0].roomType.kind).toBe('create');
  });

  it('skips non-sellable and empty room types', () => {
    const { items, skipped } = planContentSync({ ...base, locals: [{ ...double, is_sellable: false }, { ...double, id: 'x', num_rooms: 0 }] });
    expect(items).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['not sellable', 'no rooms of this type']);
  });

  it('lets managers raise max adults but keeps default occupancy at the priced occupancy', () => {
    const { items } = planContentSync({ ...base, locals: [double], settings: { 'l-double': { max_adults: 4, max_children: 2 } } });
    expect(items[0].roomType).toMatchObject({ kind: 'create', attrs: { occ_adults: 4, occ_children: 2, default_occupancy: 2 } });
  });
});

describe('ARI readback comparison', () => {
  it('reports mismatches and missing values', () => {
    const r = compareAvailability(
      [{ channex_room_type_id: 'a', stay_date: '2027-01-10', availability: 2 }, { channex_room_type_id: 'a', stay_date: '2027-01-11', availability: 0 }, { channex_room_type_id: 'b', stay_date: '2027-01-10', availability: 1 }],
      { a: { '2027-01-10': 2, '2027-01-11': 1 } },
    );
    expect(r.checked).toBe(3);
    expect(r.mismatches).toEqual([
      { room_type_id: 'a', date: '2027-01-11', hotelcare: 0, channex: 1 },
      { room_type_id: 'b', date: '2027-01-10', hotelcare: 1, channex: null },
    ]);
  });
});
