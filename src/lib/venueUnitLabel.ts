/**
 * Display-only label shortening for portfolio tenants (SLNT).
 *
 * Unit names repeat the property they belong to ("Silver Rooms 12",
 * "K4 – Room 5", "St King 11 – Room 2"). On a board that already groups units
 * under their property row, that prefix is pure noise and forces every chip to
 * wrap. This strips the repeated property name for display only — the stored
 * room_number, tooltips, selection tray and every other surface keep the full
 * name.
 */

const SEPARATORS = /^[\s\u2013\u2014\-–—·:,/|]+/;
const ROOM_WORD = /^(room|apartment|apt|flat|studio|unit)\b[\s.:#-]*/i;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param roomNumber Full stored unit name.
 * @param venueName  Property/venue name the unit is grouped under.
 * @param fallback   Shown when nothing distinctive remains (single-unit flats).
 */
export function shortUnitLabel(
  roomNumber: string,
  venueName: string | null | undefined,
  fallback = 'Unit',
): string {
  const full = (roomNumber ?? '').trim();
  if (!full) return fallback;
  if (!venueName) return full;

  const normalizedVenue = normalize(venueName);
  if (!normalizedVenue) return full;

  const normalizedFull = normalize(full);
  if (!normalizedFull.startsWith(normalizedVenue)) return full;

  // Cut the same number of visible characters from the original string so the
  // remainder keeps its original casing and digits.
  let remainder = full.slice(venueName.trim().length);
  remainder = remainder.replace(SEPARATORS, '');
  remainder = remainder.replace(ROOM_WORD, '');
  remainder = remainder.trim();

  return remainder.length > 0 ? remainder : fallback;
}
