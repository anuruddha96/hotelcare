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
