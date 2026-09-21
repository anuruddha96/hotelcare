export interface NightTotal {
  currentNight: number;
  totalNights: number;
}

export interface PmsHousekeepingClassification {
  departureTime: string | null;
  nightTotal: NightTotal | null;
  isScheduledDeparture: boolean;
  isCheckedOut: boolean;
  isCheckoutRoom: boolean;
  isDepartureTomorrow: boolean;
  isDailyRoom: boolean;
  /**
   * PMS positively states the guest stays past today (departure date in the
   * future and no departure/checkout signal for today). Used to break stale
   * checkout flags that would otherwise be preserved forever.
   */
  isStayThrough: boolean;
  /** Reservation starts today but the guest has not checked in yet. */
  isNotArrived: boolean;
  isCancelled: boolean;
  isNoShow: boolean;
}

export const excelTimeToString = (val: any): string | null => {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") {
    const totalMinutes = Math.round(val * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }
  const s = String(val).trim();
  return s.length > 0 ? s : null;
};

export const parseNightTotal = (val: any): NightTotal | null => {
  if (!val) return null;
  const m = String(val).match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const currentNight = parseInt(m[1], 10);
  const totalNights = parseInt(m[2], 10);
  if (!Number.isFinite(currentNight) || !Number.isFinite(totalNights) || currentNight <= 0 || totalNights <= 0) {
    return null;
  }
  return { currentNight, totalNights };
};

const occupiedYes = (val: any): boolean => {
  if (val === true) return true;
  const s = String(val ?? "").trim().toLowerCase();
  return ["yes", "igen", "ano", "si", "ja", "true", "1"].includes(s);
};

const statusLooksCheckedOut = (val: any): boolean => {
  const s = String(val ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  // Previo: 5 = checked-in (in-house), 6 = checked-out. Only 6 (and legacy 9)
  // means the guest has physically checked out.
  return ["checkedout", "departed", "left", "leaved"].includes(s) || s === "6" || s === "9";
};

/** Date-only business dates must not be converted to local instants. */
const pmsBusinessDate = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  const date = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

const followingBusinessDate = (date: string): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

export const classifyPmsHousekeepingRow = (
  row: any,
  today?: string,
): PmsHousekeepingClassification => {
  const departureTime = excelTimeToString(row.Departure);
  const nightTotal = parseNightTotal(row["Night / Total"]);
  const rawStatusId = Number(row.RawReservationStatusId ?? row.ReservationStatusId ?? 0);
  const isCancelled = rawStatusId === 7 || row.IsCancelled === true;
  const arrivalDate = pmsBusinessDate(row.ArrivalDate);
  const departureDate = pmsBusinessDate(row.DepartureDate);
  // Occupancy guard: a guest who is physically in the room (PMS says Occupied,
  // or the stay started before today and runs past today) can never be a
  // no-show. Only a reservation with no occupancy today may be flagged.
  const hasOccupancyToday = occupiedYes(row.Occupied)
    || (!!today && !!arrivalDate && !!departureDate
      && arrivalDate < today && departureDate > today);
  const isNoShow = (rawStatusId === 8 || row.IsNoShow === true) && !hasOccupancyToday;
  const inactiveReservation = isCancelled || isNoShow;

  // The dated reservation is authoritative for the requested Budapest workday.
  // A clock time alone is ambiguous (it may belong to tomorrow), so only fall
  // back to the legacy Departure field when no dated reservation is available.
  const hasDatedDeparture = !!today && !!departureDate;
  const isScheduledDeparture = !inactiveReservation && (hasDatedDeparture
    ? departureDate === today
    : departureTime !== null);
  // Scheduled departure is NOT a confirmed physical checkout/RTC signal.
  const isCheckedOut = !inactiveReservation && (row.CheckedOut === true
    || statusLooksCheckedOut(row.Status ?? row.ReservationStatus ?? row.ReservationStatusId));
  const isCheckoutRoom = isScheduledDeparture || isCheckedOut;
  const isDepartureTomorrow = !inactiveReservation && !isCheckoutRoom && (hasDatedDeparture
    ? departureDate === followingBusinessDate(today!)
    : row.DepartureTomorrow === true ||
      (nightTotal !== null && nightTotal.currentNight === nightTotal.totalNights));
  const isNotArrived = !inactiveReservation && (row.NotArrived === true
    || (!!today && !!arrivalDate && arrivalDate === today && !isCheckoutRoom && !occupiedYes(row.Occupied)));
  const isDailyRoom = !inactiveReservation && !isNotArrived && !isCheckoutRoom && (
    occupiedYes(row.Occupied) ||
    (nightTotal !== null && nightTotal.currentNight > 0)
  );

  // A future departure with confirmed occupancy is a stay-through, even when
  // a stale time-only field erroneously says 11:00. Date always takes priority.
  const isStayThrough = !inactiveReservation
    && !isNotArrived
    && !isCheckoutRoom
    && !!today
    && !!departureDate
    && departureDate > today
    && (occupiedYes(row.Occupied) || (!!arrivalDate && arrivalDate <= today));

  return {
    departureTime,
    nightTotal,
    isScheduledDeparture,
    isCheckedOut,
    isCheckoutRoom,
    isDepartureTomorrow,
    isDailyRoom,
    isStayThrough,
    isNotArrived,
    isCancelled,
    isNoShow,
  };
};
