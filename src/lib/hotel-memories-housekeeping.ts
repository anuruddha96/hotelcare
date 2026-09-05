export const MEMORIES_GREEN_BOARD_MARKER = '[GREEN_BOARD_CLEAN_REQUEST]';
export const MEMORIES_NO_BOARD_MARKER = '[NO_BOARD_NO_CLEANING]';

const normalizeHotelName = (value?: string | null) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Property guard for the Hotel Memories Budapest stayover-cleaning policy.
 * Keep this intentionally narrow so no other property inherits the rule.
 */
export function isHotelMemoriesBudapest(hotel?: string | null): boolean {
  const normalized = normalizeHotelName(hotel);
  return normalized === 'hotel memories budapest' || normalized === 'memories budapest';
}

export function hasMemoriesGreenBoardRequest(notes?: string | null): boolean {
  return !!notes?.includes(MEMORIES_GREEN_BOARD_MARKER);
}

export function appendAssignmentMarker(
  existingNotes: string | null | undefined,
  marker: string,
  message: string,
): string {
  const current = (existingNotes || '').trim();
  if (current.includes(marker)) return current;
  return [current, `${marker} ${message}`].filter(Boolean).join('\n');
}
