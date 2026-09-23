import { shortUnitLabel } from './venueUnitLabel';

/**
 * SLNT single-apartment venues should have ONE actionable chip, labelled with
 * the whole property name, not a second "Unit" chip under a repeated heading.
 * Keep a distinctive room/unit suffix if the PMS supplies one.
 * This is presentation only: room_number and venue IDs are never changed.
 */
export function slntSingleRoomLabel(roomNumber: string, venueName: string): string {
  const fullVenue = venueName.trim();
  const suffix = shortUnitLabel(roomNumber, fullVenue, '');
  if (!suffix || /^(unit|room|apartment)$/i.test(suffix.trim())) {
    return fullVenue || roomNumber;
  }
  return fullVenue ? `${fullVenue} · ${suffix}` : suffix;
}

/**
 * Filter TODAY's visible SLNT chip board only. Never alter the underlying
 * section counts, housekeeping assignments, PMS room buckets or saved history.
 */
export function matchesSlntBoardFilter(
  roomNumber: string,
  venueName: string,
  searchTerm: string,
  onlyUnassigned: boolean,
  isUnassigned: boolean,
): boolean {
  if (onlyUnassigned && !isUnassigned) return false;
  const query = searchTerm.trim().toLocaleLowerCase();
  return !query || `${venueName} ${roomNumber}`.toLocaleLowerCase().includes(query);
}
