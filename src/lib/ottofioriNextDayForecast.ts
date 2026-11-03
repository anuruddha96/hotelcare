/**
 * Previo daily-overview business_date is the MORNING AFTER an occupied night.
 * A housekeeping plan for Nov 4 uses the Nov 4 morning roster (Nov 3 night).
 * Occupancy and check-ins for Nov 4 NIGHT come from Nov 5 morning.
 *
 * Never describe the morning housekeeping roster as "rooms booked tonight".
 * Fail closed if the two dated snapshots were not captured together.
 */
export type OttofioriMorningRow = {
  room_number: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  captured_at: string | null;
};

export type OttofioriNightForecast = {
  date: string;
  nightBooked: number;
  nightUnbooked: number;
  checkIns: number;
  checkInRooms: string[];
  stayoversTonight: number;
  morningOccupied: number;
  capturedAt: string;
};

export function nextMorningDate(selectedDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) throw new Error('Invalid housekeeping date');
  const date = new Date(`${selectedDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== selectedDate) {
    throw new Error('Invalid housekeeping date');
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function buildOttofioriNightForecast(args: {
  selectedDate: string;
  physicalRoomCount: number;
  housekeepingMorning: readonly OttofioriMorningRow[];
  followingMorning: readonly OttofioriMorningRow[];
  now?: number;
  maxAgeMs?: number;
}): OttofioriNightForecast | null {
  const { selectedDate, physicalRoomCount, housekeepingMorning, followingMorning,
    now = Date.now(), maxAgeMs = 15 * 60_000 } = args;

  if (!Number.isInteger(physicalRoomCount) || physicalRoomCount <= 0
    || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0
    || housekeepingMorning.length === 0 || followingMorning.length === 0
    || housekeepingMorning.length > physicalRoomCount || followingMorning.length > physicalRoomCount) return null;

  try { nextMorningDate(selectedDate); } catch { return null; }

  const captureTimes: number[] = [];
  const checkUniqueRooms = (rows: readonly OttofioriMorningRow[], morningDate: string): boolean => {
    const seen = new Set<string>();
    for (const row of rows) {
      const room = String(row.room_number ?? '').trim();
      const capture = Date.parse(row.captured_at || '');
      if (!room || seen.has(room) || !Number.isFinite(capture)
        || capture > now + 60_000 || now - capture > maxAgeMs
        || !row.arrival_date || !row.departure_date
        || row.arrival_date >= morningDate || row.departure_date < morningDate) return false;
      seen.add(room);
      captureTimes.push(capture);
    }
    return true;
  };

  const followingDate = nextMorningDate(selectedDate);
  if (!checkUniqueRooms(housekeepingMorning, selectedDate)
    || !checkUniqueRooms(followingMorning, followingDate)) return null;
  if (Math.max(...captureTimes) - Math.min(...captureTimes) > 60_000) return null;

  // The following morning contains every stay that occupied the selected
  // night: existing stayovers + arrivals on that day (not yesterday's checkouts).
  const checkInRows = followingMorning.filter(row => row.arrival_date === selectedDate);
  const stayoversTonight = followingMorning.filter(row => row.arrival_date! < selectedDate).length;
  const morningStays = housekeepingMorning.filter(row => row.departure_date! > selectedDate);
  const carryoverRooms = new Set(morningStays.map(row => row.room_number));
  const validCarryovers = followingMorning.filter(row => row.arrival_date! < selectedDate
    && carryoverRooms.has(row.room_number)).length;
  if (validCarryovers !== stayoversTonight || morningStays.length !== stayoversTonight) return null;

  const checkInRooms = checkInRows.map(row => String(row.room_number)).sort((a,b) =>
    a.localeCompare(b, undefined, { numeric: true }));
  return {
    date: selectedDate,
    nightBooked: followingMorning.length,
    nightUnbooked: physicalRoomCount - followingMorning.length,
    checkIns: checkInRows.length,
    checkInRooms,
    stayoversTonight,
    morningOccupied: housekeepingMorning.length,
    capturedAt: new Date(Math.max(...captureTimes)).toISOString(),
  };
}
