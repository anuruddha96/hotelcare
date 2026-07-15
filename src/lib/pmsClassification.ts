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

const occupiedNo = (val: any): boolean => {
  if (val === false) return true;
  const s = String(val ?? "").trim().toLowerCase();
  return ["no", "nem", "ne", "nein", "false", "0"].includes(s);
};

const statusLooksCheckedOut = (val: any): boolean => {
  const s = String(val ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return ["checkedout", "departed", "departure", "left", "leaved"].includes(s) || s === "5" || s === "9";
};

export const classifyPmsHousekeepingRow = (row: any): PmsHousekeepingClassification => {
  const departureTime = excelTimeToString(row.Departure);
  const nightTotal = parseNightTotal(row["Night / Total"]);
  const isScheduledDeparture = departureTime !== null;
  const isCheckedOut = row.CheckedOut === true
    || statusLooksCheckedOut(row.Status ?? row.ReservationStatus ?? row.ReservationStatusId)
    || (isScheduledDeparture && occupiedNo(row.Occupied));

  // Checkout is intentionally strict: a room belongs in Checkout Rooms only
  // when PMS gives a real departure time/date for today or says the guest has
  // checked out. Last-night Night/Total rows with blank Departure remain Daily.
  const isCheckoutRoom = isScheduledDeparture || isCheckedOut;
  const isDepartureTomorrow = !isCheckoutRoom && (
    row.DepartureTomorrow === true ||
    (nightTotal !== null && nightTotal.currentNight === nightTotal.totalNights)
  );
  const isDailyRoom = !isCheckoutRoom && (
    occupiedYes(row.Occupied) ||
    (nightTotal !== null && nightTotal.currentNight > 0)
  );

  return {
    departureTime,
    nightTotal,
    isScheduledDeparture,
    isCheckedOut,
    isCheckoutRoom,
    isDepartureTomorrow,
    isDailyRoom,
  };
};