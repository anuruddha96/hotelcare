import { hasOccupancyEvidence } from '../../supabase/functions/_shared/previoNoShowInference';

export interface DailyTransientRoomFlagsInput {
  is_dnd?: boolean | null;
  dnd_marked_at?: string | null;
  pms_metadata?: Record<string, unknown> | null;
}

function budapestDateOf(timestamp: unknown): string | null {
  if (typeof timestamp !== 'string' || !timestamp.trim()) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * DND is an operational state for one business day only.
 *
 * rooms.is_dnd is intentionally retained in the live row until the DND flow
 * clears it, but that flag must never make yesterday's DND appear on today's
 * board. Historical snapshots remain untouched.
 */
export function isDndForBusinessDate(
  room: DailyTransientRoomFlagsInput,
  businessDate: string,
  assignmentStatus?: string | null,
  isCheckoutRoom = false,
): boolean {
  // DND is a stayover/daily-cleaning state only. A checkout clean must never
  // surface DND, even when yesterday's room mirror or a stale retry assignment
  // still carries the flag.
  if (isCheckoutRoom) return false;

  // The dated assignment state is authoritative even if the room mirror has
  // not been written yet.
  if (assignmentStatus === 'dnd_pending_retry') return true;
  if (room.is_dnd !== true) return false;

  // A room-level DND without a date cannot safely be carried into a new day.
  // The assignment/snapshot history is the place for undated legacy evidence.
  return budapestDateOf(room.dnd_marked_at) === businessDate;
}

/**
 * No-show is also a same-day reservation signal.
 *
 * Previo writes pmsSyncDate/lastPmsRefreshDate for the live business date.
 * Manual no-show actions are independently timestamped. Free-text room notes
 * are deliberately ignored because they can survive into the following day.
 */
export function isNoShowForBusinessDate(
  room: DailyTransientRoomFlagsInput,
  businessDate: string,
  hotelName?: string | null,
): boolean {
  const meta = room.pms_metadata || {};
  if (meta.isNoShow !== true) return false;
  // A check-in or actual checkout is positive evidence of arrival.
  // Date-derived occupiedToday alone cannot veto a reception-confirmed
  // absence when Previo still calls the booking "Reserved".
  if ([3, 5, 6, 9].includes(Number(meta.reservationStatusId))) return false;
  const manuallyMarkedToday = meta.manual_no_show === true
    && budapestDateOf(meta.manual_no_show_at) === businessDate;
  if (meta.manual_no_show === true) return manuallyMarkedToday;
  // For PMS-inferred/confirmed flags without a manager override, additional
  // occupancy evidence always wins.
  if (hasOccupancyEvidence(meta as Record<string, any>)) return false;
  if (meta.manual_no_show === false
    && budapestDateOf(meta.manual_no_show_at) === businessDate) return false;

  // No-shows require affirmative evidence, not a prior arrival date or a
  // high property-wide check-in ratio. This also protects the board when an
  // older sync deployment has persisted "inferred_never_checked_in".
  if (meta.noShowSource === 'inferred_never_checked_in') return false;
  if (Number(meta.reservationStatusId) !== 8
    && meta.noShowSource !== 'previo_status_8') return false;

  return meta.pmsSyncDate === businessDate || meta.lastPmsRefreshDate === businessDate;
}
