import { parseRoomFlags } from './room-service-flags';

export type RoomServiceKey = 'towel' | 'linen' | 'extra-towels';

export type RoomServiceState = {
  towelChangeRequired: boolean;
  linenChangeRequired: boolean;
  roomCleaning: boolean;
  collectExtraTowels: boolean;
  roomNotes: string | null;
};

export function buildRoomServiceToggle(service: RoomServiceKey, state: RoomServiceState) {
  const patch: Record<string, boolean | string | null> = {};
  const expected: Partial<RoomServiceState> = {};
  let next: boolean;
  if (service === 'extra-towels') {
    next = !state.collectExtraTowels;
    const base = (state.roomNotes || '').replaceAll('[COLLECT_EXTRA_TOWELS]', '').trim();
    patch.notes = [next ? '[COLLECT_EXTRA_TOWELS]' : '', base].filter(Boolean).join(' ') || null;
    expected.collectExtraTowels = next;
  } else if (service === 'towel') {
    next = !state.towelChangeRequired;
    patch.towel_change_required = next;
    expected.towelChangeRequired = next;
  } else {
    next = !(state.linenChangeRequired || state.roomCleaning);
    patch.linen_change_required = next;
    if (state.roomCleaning) {
      patch.notes = (state.roomNotes || '').replaceAll('[ROOM_CLEANING]', '').trim() || null;
    }
    expected.linenChangeRequired = next;
    expected.roomCleaning = false;
  }
  return { patch, expected, next };
}

export function readCommittedRoomServices(row: {
  notes: string | null;
  towel_change_required: boolean | null;
  linen_change_required: boolean | null;
}): RoomServiceState {
  const flags = parseRoomFlags(row.notes);
  return {
    roomNotes: row.notes ?? null,
    towelChangeRequired: !!row.towel_change_required,
    linenChangeRequired: !!row.linen_change_required,
    roomCleaning: flags.roomCleaning,
    collectExtraTowels: flags.collectExtraTowels,
  };
}

export function matchesCommittedRoomPatch(
  persisted: Partial<RoomServiceState> & { roomStatus?: string | null },
  expected: Partial<RoomServiceState> & { roomStatus?: string | null },
): boolean {
  return (['roomStatus', 'towelChangeRequired', 'linenChangeRequired', 'roomCleaning', 'collectExtraTowels'] as const)
    .every((key) => !(key in expected) || persisted[key] === expected[key]);
}
