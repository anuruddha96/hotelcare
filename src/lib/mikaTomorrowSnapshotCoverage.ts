import { nextDayRoomMatchTokens, type DailyOverviewWorkRow } from '@/lib/nextDayHousekeepingSnapshot';

export type MikaInventoryRoom = { id: string; room_number: string };

/**
 * Previo may omit rooms that checked out on the previous business day and have
 * no new reservation. Never interpret a missing booked room as a vacant room.
 * Validate both date-scoped feeds against the actual hotel room inventory.
 * This function is read-only; it neither creates PMS rows nor changes rooms.
 */
export function verifyMikaTomorrowCoverage(
  inventory: MikaInventoryRoom[],
  today: DailyOverviewWorkRow[],
  tomorrow: DailyOverviewWorkRow[],
  todayDate: string,
  tomorrowDate: string,
): boolean {
  if (!inventory.length || today.length !== inventory.length || !tomorrow.length || tomorrow.length > inventory.length) return false;
  const inventoryIds = new Set(inventory.map(room => room.id));
  if (inventoryIds.size !== inventory.length || inventory.some(room => !room.id || !room.room_number)) return false;

  const tokenIndex = new Map<string, Set<string>>();
  for (const room of inventory) {
    for (const token of nextDayRoomMatchTokens(room.room_number)) {
      const ids = tokenIndex.get(token) || new Set<string>();
      ids.add(room.id);
      tokenIndex.set(token, ids);
    }
  }
  function identify(row: DailyOverviewWorkRow): string | null {
    const exact = nextDayRoomMatchTokens(row.room_label).filter(token => token.startsWith('full:'));
    const aliases = [
      ...exact,
      ...nextDayRoomMatchTokens(row.room_number),
      ...nextDayRoomMatchTokens(row.room_label),
    ];
    for (const token of aliases) {
      const ids = tokenIndex.get(token);
      if (ids?.size === 1) return [...ids][0];
    }
    return null;
  }
  function mapped(rows: DailyOverviewWorkRow[], date: string): Map<string, DailyOverviewWorkRow> | null {
    const seen = new Map<string, DailyOverviewWorkRow>();
    for (const row of rows) {
      const id = identify(row);
      if (!id || seen.has(id) || !row.captured_at || !Number.isFinite(Date.parse(row.captured_at))) return null;
      if (!row.arrival_date || !row.departure_date || row.arrival_date > date || row.departure_date < date
        || row.departure_date <= row.arrival_date) return null;
      seen.set(id, row);
    }
    return seen;
  }
  const previous = mapped(today, todayDate);
  const next = mapped(tomorrow, tomorrowDate);
  if (!previous || !next || previous.size !== inventory.length) return false;

  // A missing unit is safe only when the complete previous day's PMS feed
  // explicitly confirms departure on that date. All remaining units must be
  // present in the exact tomorrow feed, including same-day turnovers.
  return inventory.every(room => next.has(room.id) || previous.get(room.id)?.departure_date === todayDate);
}
