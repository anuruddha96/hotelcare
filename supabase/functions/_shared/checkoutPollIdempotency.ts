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
