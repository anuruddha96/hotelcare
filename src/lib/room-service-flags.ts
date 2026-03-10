/**
 * Structured flags stored in room.notes field using bracket notation.
 * This avoids DB migrations while keeping service flags queryable.
 */

const FLAGS = {
  COLLECT_EXTRA_TOWELS: '[COLLECT_EXTRA_TOWELS]',
  ROOM_CLEANING: '[ROOM_CLEANING]',
} as const;

export interface RoomServiceFlags {
  collectExtraTowels: boolean;
  roomCleaning: boolean;
  cleanNotes: string;
}

/**
 * Parse structured flags from room notes field
 */
export function parseRoomFlags(notes: string | null): RoomServiceFlags {
  if (!notes) {
    return { collectExtraTowels: false, roomCleaning: false, cleanNotes: '' };
  }

  const collectExtraTowels = notes.includes(FLAGS.COLLECT_EXTRA_TOWELS);
  const roomCleaning = notes.includes(FLAGS.ROOM_CLEANING);
  
  let cleanNotes = notes;
  Object.values(FLAGS).forEach(flag => {
    cleanNotes = cleanNotes.replace(flag, '');
  });
  cleanNotes = cleanNotes.trim();

  return { collectExtraTowels, roomCleaning, cleanNotes };
}

/**
 * Build notes string from flags and free text
 */
export function buildRoomNotes(
  flags: { collectExtraTowels: boolean; roomCleaning: boolean },
  freeText: string
): string {
  const parts: string[] = [];
  
  if (flags.collectExtraTowels) parts.push(FLAGS.COLLECT_EXTRA_TOWELS);
  if (flags.roomCleaning) parts.push(FLAGS.ROOM_CLEANING);
  
  const trimmed = freeText.trim();
  if (trimmed) parts.push(trimmed);
  
  return parts.join(' ') || '';
}

/**
 * Toggle a single flag in notes string
 */
export function toggleFlag(
  currentNotes: string | null,
  flag: keyof typeof FLAGS,
  newValue: boolean
): string {
  const parsed = parseRoomFlags(currentNotes);
  const updatedFlags = {
    collectExtraTowels: flag === 'COLLECT_EXTRA_TOWELS' ? newValue : parsed.collectExtraTowels,
    roomCleaning: flag === 'ROOM_CLEANING' ? newValue : parsed.roomCleaning,
  };
  return buildRoomNotes(updatedFlags, parsed.cleanNotes);
}
