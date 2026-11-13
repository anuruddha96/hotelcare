/**
 * What on the room plan needs reception's attention, and why.
 *
 * Previo shows every booking as the same green bar. HotelCare knows more —
 * housekeeping room state, balances, Previo payment state, option expiry — so
 * the planner can point at the few bookings that need action today.
 *
 * Pure and dependency-free so the rules are unit-tested and reusable (planner,
 * side panels, future notifications).
 */

export type AttentionKind =
  | 'overdue_arrival'   // should have arrived already and is not checked in
  | 'room_not_ready'    // arriving today, room is not clean yet
  | 'unpaid_arrival'    // arriving today/tomorrow with money still due
  | 'unassigned'        // active booking without a room
  | 'option_expiring'   // Previo option ends within 24 hours
  | 'due_out';          // checked in and departing today

export type AttentionSeverity = 'high' | 'medium' | 'info';

export interface AttentionFlag {
  kind: AttentionKind;
  severity: AttentionSeverity;
}

export interface AttentionReservation {
  status?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  room_id?: string | null;
  balance_due?: number | string | null;
  total_amount?: number | string | null;
  source?: string | null;
  pms_payment_status?: string | null;
  pms_status_id?: number | null;
  pms_option_expires_at?: string | null;
  snapshotOnly?: boolean;
}

const SEVERITY: Record<AttentionKind, AttentionSeverity> = {
  overdue_arrival: 'high',
  room_not_ready: 'high',
  unpaid_arrival: 'medium',
  unassigned: 'medium',
  option_expiring: 'medium',
  due_out: 'info',
};

const ORDER: AttentionKind[] = ['overdue_arrival', 'room_not_ready', 'unpaid_arrival', 'unassigned', 'option_expiring', 'due_out'];
const READY_ROOM_STATES = new Set(['clean', 'inspected', 'ready', 'vacant_clean']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function addDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * @param today     hotel-local date (YYYY-MM-DD), e.g. todayBudapest()
 * @param roomState housekeeping status of the booked room, when known
 * @param nowMs     current time, for option expiry
 */
export function reservationAttention(
  r: AttentionReservation,
  today: string,
  roomState?: string | null,
  nowMs: number = Date.now(),
): AttentionFlag[] {
  if (r.snapshotOnly || !DAY.test(today)) return [];
  const status = String(r.status ?? '');
  const arrival = String(r.check_in_date ?? '');
  const departure = String(r.check_out_date ?? '');
  if (!DAY.test(arrival) || !DAY.test(departure)) return [];
  const upcoming = status === 'pending' || status === 'confirmed';
  const kinds = new Set<AttentionKind>();

  if (upcoming && arrival < today && departure > today) kinds.add('overdue_arrival');

  if (upcoming && arrival === today && r.room_id && roomState && !READY_ROOM_STATES.has(roomState.toLowerCase())) {
    kinds.add('room_not_ready');
  }

  const balance = Number(r.balance_due ?? 0);
  const paidInPrevio = r.pms_payment_status === 'paid';
  if (upcoming && (arrival === today || arrival === addDay(today)) && Number.isFinite(balance) && balance > 0 && !paidInPrevio) {
    kinds.add('unpaid_arrival');
  }

  if (!r.room_id && (upcoming || status === 'checked_in') && departure > today) kinds.add('unassigned');

  if (status === 'pending' && Number(r.pms_status_id) === 1 && r.pms_option_expires_at) {
    const expires = Date.parse(r.pms_option_expires_at);
    if (Number.isFinite(expires) && expires - nowMs < 24 * 60 * 60 * 1000) kinds.add('option_expiring');
  }

  if (status === 'checked_in' && departure === today) kinds.add('due_out');

  return ORDER.filter((kind) => kinds.has(kind)).map((kind) => ({ kind, severity: SEVERITY[kind] }));
}

/** Highest severity in a list, or null when nothing needs attention. */
export function topSeverity(flags: readonly AttentionFlag[]): AttentionSeverity | null {
  if (flags.some((f) => f.severity === 'high')) return 'high';
  if (flags.some((f) => f.severity === 'medium')) return 'medium';
  if (flags.length) return 'info';
  return null;
}

/** True when the booking needs a person to act (info-only flags such as due_out do not count). */
export function needsAction(flags: readonly AttentionFlag[]): boolean {
  return flags.some((f) => f.severity !== 'info');
}

/**
 * Occupancy per night for the planner header: rooms with an overnight stay
 * that night divided by sellable rooms. Cancelled/no-show bookings and
 * read-only snapshot rows do not count; a room counts once per night.
 */
export function nightlyOccupancy(
  reservations: readonly AttentionReservation[],
  nights: readonly string[],
  totalRooms: number,
): Array<{ date: string; occupied: number; percent: number | null }> {
  const counted = new Set(['pending', 'confirmed', 'checked_in', 'checked_out']);
  return nights.map((date) => {
    const rooms = new Set<string>();
    for (const r of reservations) {
      if (r.snapshotOnly || !r.room_id || !counted.has(String(r.status ?? ''))) continue;
      const arrival = String(r.check_in_date ?? '');
      const departure = String(r.check_out_date ?? '');
      if (arrival <= date && departure > date) rooms.add(r.room_id);
    }
    return {
      date,
      occupied: rooms.size,
      percent: totalRooms > 0 ? Math.round((rooms.size / totalRooms) * 100) : null,
    };
  });
}

/** Freshness of the latest successful Previo reservation import, for the header pill. */
export function importFreshness(
  lastSuccessIso: string | null | undefined,
  nowMs: number = Date.now(),
): { state: 'fresh' | 'aging' | 'stale' | 'never'; minutes: number | null } {
  const at = lastSuccessIso ? Date.parse(lastSuccessIso) : NaN;
  if (!Number.isFinite(at) || at > nowMs + 60_000) return { state: 'never', minutes: null };
  const minutes = Math.max(0, Math.round((nowMs - at) / 60_000));
  // The scheduled full import runs at least every 6 hours; incremental runs record only changes.
  if (minutes <= 7 * 60) return { state: 'fresh', minutes };
  if (minutes <= 24 * 60) return { state: 'aging', minutes };
  return { state: 'stale', minutes };
}
