import { describe, expect, it } from 'vitest';
import { isUnchangedPrevioRoom } from '../../../supabase/functions/_shared/previoRoomSyncDelta';

const meta = {
  roomId: 203,
  roomKindId: 14,
  roomKindName: 'Deluxe Triple',
  roomTypeId: 3,
  roomCleanStatusId: 2,
  manager_instruction: 'Keep existing bed setup',
};

const original = {
  status: 'clean',
  room_type: 'Deluxe Triple',
  pms_metadata: meta,
};

const incoming = {
  status: 'clean',
  room_type: 'Deluxe Triple',
  pms_metadata: { ...meta },
};

describe('Previo unchanged-room sync guard', () => {
  it('does not re-write unchanged rooms even with local housekeeping metadata', () => {
    expect(isUnchangedPrevioRoom(original, incoming)).toBe(true);
    expect(isUnchangedPrevioRoom(
      { ...original, pms_metadata: { ...meta, userNotes: 'Do not erase' } },
      incoming,
    )).toBe(true);
  });
  it('writes only when the incoming Previo fields change', () => {
    expect(isUnchangedPrevioRoom({ ...original, status: 'dirty' }, incoming)).toBe(false);
    expect(isUnchangedPrevioRoom({ ...original, room_type: 'Queen' }, incoming)).toBe(false);
    for (const key of ['roomId', 'roomKindId', 'roomKindName', 'roomTypeId', 'roomCleanStatusId'] as const) {
      expect(isUnchangedPrevioRoom(
        { ...original, pms_metadata: { ...meta, [key]: null } },
        incoming,
      )).toBe(false);
    }
  });
  it('does not skip an incomplete or missing metadata mapping', () => {
    expect(isUnchangedPrevioRoom({ ...original, pms_metadata: null }, incoming)).toBe(false);
    expect(isUnchangedPrevioRoom({ ...original, pms_metadata: { roomId: 203 } }, incoming)).toBe(false);
  });
  it('does not mistake different rooms with the same room type for each other', () => {
    expect(isUnchangedPrevioRoom(original, {
      ...incoming,
      pms_metadata: { ...meta, roomId: 204 },
    })).toBe(false);
  });
});
