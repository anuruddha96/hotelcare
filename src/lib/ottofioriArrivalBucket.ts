/**
 * Derive today's arrival bucket from dated PMS evidence, not a sticky
 * arrivalToday/notArrived flag carried over from the previous workday.
 *
 * A guest who arrived yesterday and is on night 2/3 is a daily/stayover room
 * even if Previo's optional occupiedToday boolean has not been populated.
 */
export function isPmsArrivalForDate(metadata: Record<string, any> | null | undefined, businessDate: string): boolean {
  if (!metadata || metadata.pmsSyncDate !== businessDate) return false;
  if (metadata.isNoShow === true || metadata.isCancelled === true) return false;
  if (metadata.arrivalToday !== true) return false;

  // A reliable dated arrival overrides a stale boolean. Check both earlier
  // and future dates; only the workday's real arrivals belong in this bucket.
  const arrivalDate = typeof metadata.arrivalDate === 'string'
    ? metadata.arrivalDate.slice(0, 10)
    : null;
  if (arrivalDate && arrivalDate !== businessDate) return false;

  // Explicit in-house/stayover evidence must never appear as an Arrival Room.
  if (metadata.pmsOccupancyStatus === 'stayover' || metadata.occupiedToday === true) return false;
  if ([3, 5].includes(Number(metadata.reservationStatusId))) return false;

  return true;
}
