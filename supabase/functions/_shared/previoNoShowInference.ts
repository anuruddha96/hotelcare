// Advisory signal that an unarrived reservation needs reception verification.
// It is NEVER sufficient to classify a room as a no-show or prove vacancy;
// only explicit Previo status 8 or a manager-confirmed absence can do that.
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
    && !!arrivalDate && arrivalDate < previousBusinessDate(businessDate)
    && !!departureDate && departureDate >= businessDate;
}

// Reception often records Previo check-ins late, so one unrecorded night is
// not enough to suspect a no-show; inference starts on day 2 after arrival.
function previousBusinessDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Any positive occupancy evidence overrides every no-show flag. */
export function hasOccupancyEvidence(meta: Record<string, any> | null | undefined, guestCount?: number | null): boolean {
  if (!meta) return false;
  const status = Number(meta.reservationStatusId);
  return [3, 5, 6, 9].includes(status)
    || meta.occupiedToday === true
    || meta.pmsOccupancyStatus === 'stayover'
    || meta.stayThroughToday === true
    || (typeof guestCount === 'number' && guestCount > 0 && meta.noShowSource === 'inferred_never_checked_in');
}


// Mika Downtown often has delayed status updates; retain the property
// identifier for older compatibility paths that rely on it.
export function isMikaDowntownProperty(...identifiers: Array<string | null | undefined>): boolean {
  return identifiers.some((identifier) => {
    const key = String(identifier ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return key === "mika" || key === "mikadowntown" || key === "hotelmikadowntown";
  });
}

// Browser compatibility guard for an older deployed edge function across ALL
// Previo properties: discard an inferred no-show while retaining reservation
// dates. An inference is not a confirmed absence; do not modify Previo itself.
export function normalizeInferredNoShowRow<T extends Record<string, any>>(
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

// Backwards-compatible export for older callers and Mika-specific tests.
export const normalizeMikaInferredNoShowRow = normalizeInferredNoShowRow;
