// Pure reservation helpers shared by Front Desk, Reservations list,
// planner and detail views. No I/O here — everything is unit-testable.

export interface ReservationGuestJoin {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  vip_status?: string | null;
}

export interface ReservationLike {
  id?: string;
  reservation_number?: string | null;
  status: string;
  check_in_date: string;
  check_out_date: string;
  source?: string | null;
  source_reservation_id?: string | null;
  pms_guest_name?: string | null;
  guests?: ReservationGuestJoin | null;
  total_amount?: number | string | null;
  balance_due?: number | string | null;
  currency?: string | null;
  adults?: number | null;
  children?: number | null;
  room_id?: string | null;
}

export const ACTIVE_STATUSES = ["pending", "confirmed", "checked_in"] as const;

export const RESERVATION_STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  confirmed: "bg-primary/10 text-primary",
  checked_in: "bg-green-500/10 text-green-700 dark:text-green-400",
  checked_out: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  no_show: "bg-destructive/10 text-destructive",
};

export const RESERVATION_SOURCES = [
  "direct",
  "walk_in",
  "phone",
  "email",
  "booking_com",
  "expedia",
  "other",
] as const;

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd). */
export function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Previo-origin bookings: booking-core fields are read-only locally. */
export function isPmsManaged(r: Pick<ReservationLike, "source">): boolean {
  return (r.source || "").toLowerCase() === "previo";
}

/**
 * Human label for the reservation's guest. Never invents a name:
 * joined guest profile -> PMS-provided guest label -> PMS booking ref.
 */
export function reservationGuestLabel(
  r: ReservationLike,
  pmsFallbackPrefix = "Previo",
): string {
  const g = r.guests;
  const joined = `${g?.first_name ?? ""} ${g?.last_name ?? ""}`.trim();
  if (joined) return joined;
  const pmsName = (r.pms_guest_name ?? "").trim();
  if (pmsName) return pmsName;
  if (isPmsManaged(r) && r.source_reservation_id) {
    return `${pmsFallbackPrefix} #${r.source_reservation_id.split(":")[0]}`;
  }
  return r.reservation_number || "—";
}

export type QuickFilter =
  | "all"
  | "arrivals"
  | "departures"
  | "inhouse"
  | "today"
  | "future"
  | "cancelled"
  | "no_show";

export function matchesQuickFilter(
  r: ReservationLike,
  filter: QuickFilter,
  today: string,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "arrivals":
      return r.check_in_date === today && ["pending", "confirmed"].includes(r.status);
    case "departures":
      return r.check_out_date === today && r.status === "checked_in";
    case "inhouse":
      return r.status === "checked_in";
    case "today":
      return (
        (r.check_in_date <= today && r.check_out_date > today && ACTIVE_STATUSES.includes(r.status as never)) ||
        r.check_in_date === today ||
        (r.check_out_date === today && r.status === "checked_in")
      );
    case "future":
      return r.check_in_date > today && ["pending", "confirmed"].includes(r.status);
    case "cancelled":
      return r.status === "cancelled";
    case "no_show":
      return r.status === "no_show";
    default:
      return true;
  }
}

/** Confirmed/pending bookings whose arrival date already passed — no-show candidates. */
export function isLateArrivalCandidate(r: ReservationLike, today: string): boolean {
  return r.check_in_date < today && ["pending", "confirmed"].includes(r.status);
}

export function reservationSearchText(r: ReservationLike & { rooms?: { room_number?: string | null } | null }): string {
  const g = r.guests;
  return [
    g?.first_name,
    g?.last_name,
    g?.email,
    g?.phone,
    r.pms_guest_name,
    r.reservation_number,
    r.source_reservation_id,
    r.rooms?.room_number,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function balanceOf(r: Pick<ReservationLike, "balance_due">): number {
  const n = Number(r.balance_due ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Whole-number money formatting with thin locale grouping ("26 041 Ft"). */
export function formatMoney(
  amount: number | string | null | undefined,
  currency?: string | null,
): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return "—";
  const cur = (currency || "").toUpperCase();
  const rounded = Math.round(n);
  const grouped = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 }).format(rounded);
  if (cur === "HUF") return `${grouped} Ft`;
  if (cur === "EUR") return `€${grouped}`;
  return cur ? `${grouped} ${cur}` : grouped;
}

export type RoomReadiness = "clean" | "dirty" | "occupied" | "other" | "unassigned";

export function roomReadiness(room?: { status?: string | null } | null): RoomReadiness {
  if (!room) return "unassigned";
  const s = (room.status || "").toLowerCase();
  if (s === "clean") return "clean";
  if (s === "dirty") return "dirty";
  if (s === "occupied") return "occupied";
  return "other";
}

/** Lifecycle error codes raised by the pms_* RPCs -> translation keys. */
export const LIFECYCLE_ERROR_KEYS: Record<string, string> = {
  RESERVATION_NOT_FOUND: "pms.err.reservationNotFound",
  ACCESS_DENIED: "pms.err.accessDenied",
  INVALID_STATUS: "pms.err.invalidStatus",
  ROOM_NOT_FOUND: "pms.err.roomNotFound",
  ROOM_WRONG_HOTEL: "pms.err.roomWrongHotel",
  ROOM_OCCUPIED: "pms.err.roomOccupied",
  ROOM_NOT_CLEAN: "pms.err.roomNotClean",
  ROOM_CONFLICT: "pms.err.roomConflict",
  CAPACITY_EXCEEDED: "pms.err.capacityExceeded",
  DATE_OUT_OF_WINDOW: "pms.err.dateOutOfWindow",
  BALANCE_DUE: "pms.err.balanceDue",
  INVALID_DATES: "pms.err.invalidDates",
  INVALID_PAX: "pms.err.invalidPax",
  INVALID_RATE: "pms.err.invalidRate",
  INVALID_SOURCE: "pms.err.invalidSource",
  INVALID_AMOUNT: "pms.err.invalidAmount",
  INVALID_DESCRIPTION: "pms.err.invalidDescription",
  INVALID_CHARGE_TYPE: "pms.err.invalidChargeType",
  UNSUPPORTED_STATUS: "pms.err.invalidStatus",
  HOTEL_REQUIRED: "pms.err.hotelRequired",
  ROOM_LOCKED_WHILE_CHECKED_IN: "pms.err.roomLockedWhileCheckedIn",
};

/** Extract a lifecycle error code from a thrown Supabase/Postgres error. */
export function lifecycleErrorKey(err: unknown): string | null {
  const msg = String((err as { message?: string })?.message ?? err ?? "");
  for (const code of Object.keys(LIFECYCLE_ERROR_KEYS)) {
    if (msg.includes(code)) return LIFECYCLE_ERROR_KEYS[code];
  }
  return null;
}
