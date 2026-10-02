import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';

/**
 * Stable operational venue key for SLNT Team B. The room registry currently
 * carries venue identity in the room label (for example "Silver Rooms 12",
 * "K4 – Room 2", "WR Pension 101"). Keep this deterministic so preferences
 * survive reservation changes and future planning dates.
 */
export function slntVenueKey(room: Pick<RoomForAssignment, 'room_number'>): string {
  const raw = String(room.room_number || '').trim();
  if (!raw) return 'Unknown venue';

  const dashRoom = raw.match(/^(.+?)\s*[–—-]\s*Room\s+\S+/i);
  if (dashRoom) return dashRoom[1].trim();

  const namedRoom = raw.match(/^(.+?)\s+Room\s+\S+/i);
  if (namedRoom) return namedRoom[1].trim();

  const knownNumbered = raw.match(/^(Silver Rooms|WR Pension)\s+\S+/i);
  if (knownNumbered) return knownNumbered[1].trim();

  if (/\bApartment\b/i.test(raw)) {
    return raw.replace(/\s*[–—-]?\s*Room\s+\S+$/i, '').trim();
  }

  return raw.replace(/\s+\d+[A-Za-z]?$/, '').trim() || raw;
}

export type VenuePreference = {
  venue_key: string;
  preferred_user_id: string;
};

export function applyVenuePreferences(
  rooms: RoomForAssignment[],
  selectedStaffIds: Set<string>,
  preferences: Map<string, string>,
  owners: Map<string, string> = new Map(),
): Map<string, string> {
  const next = new Map(owners);
  for (const room of rooms) {
    const preferred = preferences.get(slntVenueKey(room));
    if (preferred && selectedStaffIds.has(preferred)) next.set(room.id, preferred);
  }
  return next;
}
