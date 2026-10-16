/**
 * The daily occupied-night overview can omit a same-day departure while the
 * current physical-room Previo roster still contains the in-house booking.
 * Reconstruct ONLY its scheduled departure, never evidence of vacancy/RTC.
 *
 * Applied exclusively by the Gozsdu morning sequence after both fresh Previo
 * sources have been fetched for the SAME Budapest business date.
 */
export type RecoveredDeparture = {
  status: "departing";
  arrival_date: string;
  departure_date: string;
  pax: number | null;
};

export function recoverGozsduScheduledDeparture(
  raw: unknown,
  mappedPmsRoomId: unknown,
  businessDate: string,
): RecoveredDeparture | null {
  if (!raw || typeof raw !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return null;
  const live = raw as Record<string, unknown>;
  const roomId = String(live.RoomId ?? "");
  const mappedId = String(mappedPmsRoomId ?? "");
  if (!roomId || !mappedId || roomId !== mappedId) return null;

  const arrival = String(live.ArrivalDate ?? live.ReservationArrivalDate ?? "").slice(0, 10);
  const departure = String(live.DepartureDate ?? live.ReservationDepartureDate ?? "").slice(0, 10);
  const status = Number(live.RawReservationStatusId);
  // Status 3/5 = checked in. 6/9 are explicit checked-out states. Never infer
  // departure from an unarrived, cancelled, no-show or future booking.
  if (!(arrival < businessDate && departure === businessDate)
      || ![3, 5, 6, 9].includes(status)
      || live.Occupied !== "Yes"
      || live.IsCheckoutRoom !== true
      || !live.Departure
      || Boolean(live.Arrival)
      || live.NotArrived === true
      || live.IsNoShow === true
      || live.IsCancelled === true
      || (live.CheckedOut === true && ![6, 9].includes(status))) return null;

  const people = Number(live.People);
  return {
    status: "departing",
    arrival_date: arrival,
    departure_date: departure,
    pax: Number.isFinite(people) && people >= 0 ? people : null,
  };
}
