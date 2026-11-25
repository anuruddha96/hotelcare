// Do not re-write room rows when Previo confirms the SAME physical checkout
// repeatedly. PostgreSQL UPDATE always generates a new WAL record and fires
// room triggers; that can flood Realtime even when the values are unchanged.
// Still require a new write for any missing/old business-day evidence, a
// changed reservation, or a room not yet marked RTC.
type CheckoutSnapshot = {
  is_checkout_room: boolean | null;
  checkout_time: string | null;
  pms_metadata: Record<string, unknown> | null;
};

const businessDateOf = (value: string): string | null => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Budapest",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
};

/** True if the new authoritative physical-departure evidence needs persisting. */
export function needsCheckoutRoomWrite(
  room: CheckoutSnapshot,
  businessDate: string,
  confirmedReservationId: string,
): boolean {
  const meta = room.pms_metadata;
  if (!room.is_checkout_room || !room.checkout_time || !meta) return true;
  if (meta.checkedOutToday !== true || meta.readyToClean !== true) return true;
  if (typeof meta.checkedOutAt !== "string"
      || businessDateOf(meta.checkedOutAt) !== businessDate) return true;

  // On a same-day room turnover the second guest's checkout is a NEW event.
  // Never treat a different reservation ID as an existing confirmation.
  const priorReservationId = String(meta.reservationId ?? "").trim();
  if (confirmedReservationId && priorReservationId
      && confirmedReservationId !== priorReservationId) return true;

  return false;
}

type CheckoutAssignment = {
  id: string;
  assignment_type: string;
  ready_to_clean: boolean | null;
  pms_hold: boolean | null;
  pms_hold_reason: string | null;
  pms_hold_event_id: string | null;
};

/** Only pending checkout assignments require the RTC-release UPDATE. */
export function checkoutAssignmentsNeedingRelease(assignments: CheckoutAssignment[]): string[] {
  return assignments.filter((a) =>
    a.assignment_type === "checkout_cleaning"
    && (a.ready_to_clean !== true || a.pms_hold !== false
      || a.pms_hold_reason !== null || a.pms_hold_event_id !== null)
  ).map((a) => a.id);
}


/** Positive same-day in-house evidence from XML; never infer occupancy from
 * a missing reservation, a dirty room, a scheduled departure or a room label. */
export function xmlInHouseDepartureRoomId(
  block: string,
  departure: string,
  statusId: string,
  today: string,
): number | null {
  if (departure !== today || statusId.trim() !== "3") return null;
  const object = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<\/object>/);
  const id = Number(object?.[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A live in-house signal wins over an old checkout on the same mapped room.
 * A confirmed checkout can still be processed for any other physical room. */
export function hasXmlInHouseConflict(
  roomId: unknown,
  inHouseIds: ReadonlySet<number>,
): boolean {
  const id = Number(roomId);
  return Number.isSafeInteger(id) && id > 0 && inHouseIds.has(id);
}

export function clearedCheckoutMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  return {
    ...meta,
    checkedOutToday: false,
    readyToClean: false,
    checkedOutAt: null,
    readyToCleanDate: null,
    scheduledDepartureToday: true,
  };
}
