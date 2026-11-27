import { describe, expect, it } from 'vitest';
import { buildRoomServiceToggle, matchesCommittedRoomPatch, readCommittedRoomServices } from './roomServiceToggle';

const state = readCommittedRoomServices({notes: null, towel_change_required: false, linen_change_required: true});

describe('manager room-service toggles', () => {
  it('clears and re-enables room 131 Change Room from the saved value', () => {
    const clear = buildRoomServiceToggle('linen', state);
    expect(clear.patch).toEqual({ linen_change_required: false });
    expect(matchesCommittedRoomPatch(state, clear.expected)).toBe(false);
    const saved = readCommittedRoomServices({notes: null, towel_change_required: false, linen_change_required: false});
    expect(matchesCommittedRoomPatch(saved, clear.expected)).toBe(true);
    expect(buildRoomServiceToggle('linen', saved).patch).toEqual({ linen_change_required: true });
  });
  it('toggles towel change in both directions', () => {
    const set = buildRoomServiceToggle('towel', state);
    expect(set.patch).toEqual({towel_change_required: true});
    expect(matchesCommittedRoomPatch(state, set.expected)).toBe(false);
    const saved = readCommittedRoomServices({notes: null, towel_change_required: true, linen_change_required: true});
    expect(matchesCommittedRoomPatch(saved, set.expected)).toBe(true);
    expect(buildRoomServiceToggle('towel', saved).patch).toEqual({towel_change_required: false});
  });
  it('clears a legacy full-clean note marker without removing other instructions', () => {
    const legacy = readCommittedRoomServices({notes: '[ROOM_CLEANING] [COLLECT_EXTRA_TOWELS] Guest request', towel_change_required: false, linen_change_required: true});
    expect(buildRoomServiceToggle('linen', legacy).patch).toEqual({linen_change_required: false, notes: '[COLLECT_EXTRA_TOWELS] Guest request'});
  });
  it('adds and clears extra towel collection without changing saved human or planned notes', () => {
    const saved = readCommittedRoomServices({notes: '[HotelCare planned] Please knock', towel_change_required: false, linen_change_required: false});
    const add = buildRoomServiceToggle('extra-towels', saved);
    expect(add.patch).toEqual({notes:'[COLLECT_EXTRA_TOWELS] [HotelCare planned] Please knock'});
    expect(matchesCommittedRoomPatch(saved, add.expected)).toBe(false);
    const updated = readCommittedRoomServices({notes: String(add.patch.notes), towel_change_required: false, linen_change_required: false});
    expect(matchesCommittedRoomPatch(updated, add.expected)).toBe(true);
    expect(buildRoomServiceToggle('extra-towels', updated).patch).toEqual({notes:'[HotelCare planned] Please knock'});
  });
});
