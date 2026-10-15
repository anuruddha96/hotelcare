// Conservative property-level evidence for a reservation that remains unarrived
// after its scheduled arrival. This only affects HotelCare housekeeping buckets:
// it never changes a reservation status in Previo.
export interface PrevioCheckInEvidence {
  statusId: number;
  arrivalDate: string | null;
  departureDate: string | null;
}

export function propertyReliablyTracksPrevioCheckIns(
  roomReservations: PrevioCheckInEvidence[],
  businessDate: string,
): boolean {
  // Look only at present/past stays, not future reservations (which are
  // legitimately still Reserved). A partial check-in workflow is unsafe.
  const expectedInHouse = roomReservations.filter(({ statusId, arrivalDate, departureDate }) =>
    [1, 2, 3, 5, 6, 9].includes(statusId)
    && !!arrivalDate && arrivalDate < businessDate
    && !!departureDate && departureDate >= businessDate,
  );
  const checkedInOrOut = expectedInHouse.filter(({ statusId }) =>
    [3, 5, 6, 9].includes(statusId),
  ).length;

  return expectedInHouse.length >= 5
    && checkedInOrOut >= 3
    && checkedInOrOut / expectedInHouse.length >= 0.8;
}

export function isStaleUnarrivedPrevioReservation(input: {
  statusId: number;
  arrivalDate: string | null;
  departureDate: string | null;
  businessDate: string;
  propertyTracksCheckIns: boolean;
  extensionLinked: boolean;
}): boolean {
  const { statusId, arrivalDate, departureDate, businessDate, propertyTracksCheckIns, extensionLinked } = input;
  return propertyTracksCheckIns
    && !extensionLinked
    && (statusId === 1 || statusId === 2)
    && !!arrivalDate && arrivalDate < businessDate
    && !!departureDate && departureDate >= businessDate;
}
