/** One shared physical room is offered in two room types.
 * The closing decision uses total confirmed/occupied physical room nights.
 * This is a post-booking rule; it does not lock OTA reservations atomically. */
export function shouldCloseSharedLastRoom(
  baselineBooked: number,
  currentBooked: number,
  sharedUnits = 1,
): boolean {
  return Number.isInteger(baselineBooked) && baselineBooked >= 0 &&
    Number.isInteger(currentBooked) && currentBooked >= 0 &&
    sharedUnits === 1 && currentBooked >= baselineBooked + sharedUnits;
}

export function canOfferOneSharedRoom(
  physicalRooms: number,
  bookedRooms: number,
  units: number,
): boolean {
  return Number.isInteger(physicalRooms) && physicalRooms > 0 &&
    Number.isInteger(bookedRooms) && bookedRooms >= 0 &&
    units === 1 && physicalRooms - bookedRooms === 1;
}

/**
 * Preserve both directions of a prior capacity-neutral move.
 * A manager reopening the original Quad must restore the *existing* pair;
 * they must not be asked to borrow the smaller promoted Queen as if it
 * were a new physical source room.
 */
export interface RecordedRoomTransfer {
  source_obk_id: string;
  target_obk_id: string;
  stay_date: string;
  status: string;
}
export function activeTransferLookups(rules: RecordedRoomTransfer[]) {
  const originalByPromoted = new Map<string, string>();
  const promotedByOriginal = new Map<string, string>();
  for (const rule of rules) {
    if (rule.status !== "active" || !rule.source_obk_id || !rule.target_obk_id) continue;
    originalByPromoted.set(`${rule.target_obk_id}|${rule.stay_date}`, rule.source_obk_id);
    promotedByOriginal.set(`${rule.source_obk_id}|${rule.stay_date}`, rule.target_obk_id);
  }
  return { originalByPromoted, promotedByOriginal };
}
