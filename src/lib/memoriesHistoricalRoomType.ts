export interface MemoriesHistoricalRoomTypeInput {
  is_checkout_room: boolean | null;
  pms_metadata?: {
    manual_daily?: boolean;
    manual_checkout?: boolean;
    scheduledDepartureToday?: boolean;
  } | null;
  assignment_type?: string | null;
}

/**
 * Replaying a completed housekeeping date must use the saved room classification,
 * not the type of cleaning task carried out on that date. A checkout-cleaning
 * assignment can remain on an extended/reclassified daily room, and it is
 * important to preserve that task for audit without recategorizing the room.
 */
export function isMemoriesHistoricalCheckout(row: MemoriesHistoricalRoomTypeInput): boolean {
  if (row.pms_metadata?.manual_daily === true) return false;
  if (row.pms_metadata?.manual_checkout === true) return true;
  if (row.is_checkout_room !== null) return row.is_checkout_room;
  return row.pms_metadata?.scheduledDepartureToday === true;
}

/** The work record is retained, but cannot silently override the saved room category. */
export function hasMemoriesHistoricalRoomTypeConflict(row: MemoriesHistoricalRoomTypeInput): boolean {
  if (!row.assignment_type) return false;
  const assignmentIsCheckout = row.assignment_type === 'checkout_cleaning';
  const assignmentIsDaily = row.assignment_type === 'daily_cleaning';
  return (assignmentIsCheckout || assignmentIsDaily)
    && assignmentIsCheckout !== isMemoriesHistoricalCheckout(row);
}
