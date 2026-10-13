/** One physical pool marketed under two Previo room types.
 * A confirmed room night occupies one real room, regardless of how many
 * virtual categories advertise it. This calculates the upper limit, not an
 * atomic online-booking guarantee.
 */
export function permittedSharedAvailability(
  initialSharedUnits: number,
  physicalCapacity: number,
  confirmedRoomNights: number,
): number | null {
  if (![initialSharedUnits, physicalCapacity, confirmedRoomNights].every(Number.isInteger) ||
      initialSharedUnits < 1 || initialSharedUnits > 20 ||
      physicalCapacity < initialSharedUnits || confirmedRoomNights < 0)
    return null;
  return Math.max(0, Math.min(initialSharedUnits, physicalCapacity - confirmedRoomNights));
}

export function sharedPoolRequiresClosing(
  currentAvailable: number,
  maximumPermitted: number,
): boolean {
  return Number.isInteger(currentAvailable) && Number.isInteger(maximumPermitted) &&
    currentAvailable > maximumPermitted;
}
