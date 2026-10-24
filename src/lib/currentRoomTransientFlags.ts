import { isMikaDowntownProperty, hasOccupancyEvidence } from '../../supabase/functions/_shared/previoNoShowInference';

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
  // A checked-in / occupied guest is never a no-show, whatever the stale flag
  // says. Previo status 8 alone is not occupancy, so it still shows.
  if (meta.manual_no_show !== true && hasOccupancyEvidence(meta as Record<string, any>)) return false;
  // Discard legacy inferred Mika flags immediately on the live room board.
  // An explicit manager no-show or Previo status 8 remains authoritative.
  if (isMikaDowntownProperty(hotelName)
    && meta.noShowSource === 'inferred_never_checked_in'
    && meta.manual_no_show !== true
    && Number(meta.reservationStatusId) !== 8) return false;

  if (meta.manual_no_show === true) {
    return budapestDateOf(meta.manual_no_show_at) === businessDate;
  }

  return meta.pmsSyncDate === businessDate || meta.lastPmsRefreshDate === businessDate;
}
