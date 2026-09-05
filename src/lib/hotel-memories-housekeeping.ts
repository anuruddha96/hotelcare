export const MEMORIES_GREEN_BOARD_MARKER = '[GREEN_BOARD_CLEAN_REQUEST]';
export const MEMORIES_NO_BOARD_MARKER = '[NO_BOARD_NO_CLEANING]';
export const LEGACY_NO_SERVICE_MARKER = '[NO_SERVICE]';

export const HOUSEKEEPING_SERVICE_RESULT_CLEANED = 'cleaned' as const;
export const HOUSEKEEPING_SERVICE_RESULT_GUEST_DECLINED = 'guest_declined' as const;

export type HousekeepingServiceResult =
  | typeof HOUSEKEEPING_SERVICE_RESULT_CLEANED
  | typeof HOUSEKEEPING_SERVICE_RESULT_GUEST_DECLINED;

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

/**
 * New records use service_result as the source of truth, while this legacy
 * marker fallback keeps cached clients and historical assignments readable.
 */
export function isGuestDeclinedService(
  serviceResult?: string | null,
  notes?: string | null,
): boolean {
  return serviceResult === HOUSEKEEPING_SERVICE_RESULT_GUEST_DECLINED
    || !!notes?.includes(LEGACY_NO_SERVICE_MARKER);
}

/**
 * Returns only the human comment that belongs to a No Service outcome.
 * Technical markers and an earlier green-board request are intentionally not
 * returned so supervisor cards show the final outcome instead of conflicting
 * implementation details.
 */
export function getGuestDeclinedServiceComment(notes?: string | null): string | null {
  if (!notes) return null;

  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const cleanDetail = (value: string) => value
    .replace(LEGACY_NO_SERVICE_MARKER, '')
    .replace(MEMORIES_NO_BOARD_MARKER, '')
    .replace(/^Guest confirmed no service required\s*[—–-]?\s*/i, '')
    .replace(/^No Service\s*[—–-]\s*Guest declined(?:\s*\/\s*no cleaning requested today)?\.?\s*/i, '')
    .replace(/^Door checked\s*[—–-]\s*no green Clean My Room card\s*\/\s*no cleaning request\.?\s*/i, '')
    .trim();

  // Prefer the explicit No Service line because it is the housekeeper's final
  // decision and often contains the guest's comment.
  const noServiceLine = lines.find((line) => line.includes(LEGACY_NO_SERVICE_MARKER));
  if (noServiceLine) {
    const detail = cleanDetail(noServiceLine);
    if (detail) return detail;
  }

  // Hotel Memories' optional-room flow historically stored the door-check
  // comment on a separate marker line.
  const noBoardLine = lines.find((line) => line.includes(MEMORIES_NO_BOARD_MARKER));
  if (noBoardLine) {
    const detail = cleanDetail(noBoardLine);
    if (detail) return detail;
  }

  // First-class records may already contain a friendly No Service note with no
  // legacy marker.
  const friendlyLine = lines.find((line) => /^No Service\s*[—–-]\s*Guest declined/i.test(line));
  if (friendlyLine) {
    const detail = cleanDetail(friendlyLine);
    if (detail) return detail;
  }

  return null;
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
