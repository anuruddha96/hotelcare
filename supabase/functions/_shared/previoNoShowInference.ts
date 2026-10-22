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


// Mika Downtown exposes occupied stayovers whose reservation status may remain
// "Reserved". A property-wide check-in ratio is not room-level proof of a
// no-show. Only Previo status 8 or an explicit manager action can mark NS here.
export function isMikaDowntownProperty(...identifiers: Array<string | null | undefined>): boolean {
  return identifiers.some((identifier) => {
    const key = String(identifier ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return key === "mika" || key === "mikadowntown" || key === "hotelmikadowntown";
  });
}

// Browser compatibility guard for a stale edge-function deployment: recover
// active Mika stayovers from its *inferred* flag, never from Previo status 8.
// This does not modify the PMS reservation or manufacture a checkout event.
export function normalizeMikaInferredNoShowRow<T extends Record<string, any>>(
  row: T,
  businessDate: string,
  fallbackGuestCount: number | null = null,
): T {
  if (row.NoShowSource !== "inferred_never_checked_in" || Number(row.RawReservationStatusId) === 8) {
    return row;
  }
  const arrival = String(row.ArrivalDate ?? "").slice(0, 10);
  const departure = String(row.DepartureDate ?? "").slice(0, 10);
  const activeStay = /^\d{4}-\d{2}-\d{2}$/.test(arrival)
    && /^\d{4}-\d{2}-\d{2}$/.test(departure)
    && arrival < businessDate && departure > businessDate;

  return {
    ...row,
    IsNoShow: false,
    NoShowSource: null,
    ...(activeStay ? {
      Occupied: "Yes",
      NotArrived: false,
      People: Number(row.People) > 0 ? row.People : (fallbackGuestCount ?? row.People),
    } : {}),
  } as T;
}
