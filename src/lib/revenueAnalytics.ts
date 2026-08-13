// Revenue Management analytics helpers.
//
// Everything here works off the three Previo-backed tables:
//   revenue_booking_nights   — one row per booked room-night (+ booking creation time)
//   revenue_daily_snapshots  — rooms sold / available / revenue captured once per day
//   revenue_room_type_rates  — base rate plan price per room type / date / occupancy
//
// All calendar maths is done in Budapest time, matching the property clock.

import { money } from "@/lib/revenueCurrency";

export const BUDAPEST_TZ = "Europe/Budapest";

export function budapestToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUDAPEST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** 0 = Sunday … 6 = Saturday, for a plain YYYY-MM-DD. */
export function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function isWeekend(isoDate: string): boolean {
  const d = dayOfWeek(isoDate);
  return d === 0 || d === 5 || d === 6; // Fri / Sat / Sun
}

export function formatDay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    day: "numeric",
  });
}

export function formatWeekday(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
  });
}

export function formatMonth(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

export interface BookingNight {
  stay_date: string;
  res_id: string;
  room_key?: string | null;
  obk_id: string | null;
  room_type_name: string | null;
  nightly_price_eur: number | null;
  total_price_eur?: number | null;
  stay_from?: string | null;
  stay_to?: string | null;
  source_name?: string | null;
  created_at_pms: string | null;
  guests: number | null;
}

export interface DailySnapshot {
  stay_date: string;
  captured_date: string;
  rooms_sold: number;
  rooms_available: number;
  occupancy_pct: number;
  revenue_eur: number;
  adr_eur: number | null;
  new_bookings: number;
}

export interface CancelledNight {
  stay_date: string;
  res_id: string;
  room_key?: string | null;
  obk_id: string | null;
  room_type_name?: string | null;
  nightly_price_eur?: number | null;
  total_price_eur?: number | null;
  stay_from?: string | null;
  stay_to?: string | null;
  source_name?: string | null;
  created_at_pms?: string | null;
  guests?: number | null;
  cancelled_at: string | null;
}

export interface RoomTypeRate {
  stay_date: string;
  obk_id: string;
  room_type_name: string | null;
  occupancy: number;
  price: number;
  currency: string;
  rate_plan_id?: string | null;
  captured_at?: string | null;
  updated_at?: string | null;
}

export interface DayMetrics {
  stay_date: string;
  roomsSold: number;
  roomsAvailable: number;
  occupancyPct: number;
  revenueEur: number;
  adrEur: number | null;
  revparEur: number | null;
  /** Rooms still sellable on this date (inventory minus rooms sold). */
  roomsLeft: number;
  /** Bookings created inside the pickup window (never negative). */
  newBookings: number;
  /** Room-nights cancelled inside the pickup window (never negative). */
  cancelledBookings: number;
  /** Room revenue of the room-nights booked inside the window. */
  newRevenueEur: number;
  /** Best estimate of the revenue lost inside the window (ADR × rooms lost). */
  lostRevenueEur: number;
  /** Rooms lost inside the window, from cancellations or the snapshot delta. */
  roomsLost: number;
  /** True when a snapshot old enough to compare against exists for this date. */
  baselineAvailable: boolean;
  /**
   * Net movement inside the pickup window: new bookings minus cancellations.
   * Negative means the date lost more rooms than it gained. Null only when we
   * have no way to tell (no creation timestamps and no baseline snapshot).
   */
  netPickup: number | null;
}

/**
 * Build per-date metrics for [from, to].
 *
 * `newBookings` is exact and always available: it counts booked room-nights whose
 * booking was created inside the pickup window (Budapest calendar days).
 * The snapshot delta compares today's rooms-sold against the newest snapshot
 * captured BEFORE the window opened, so it also catches rooms lost without a
 * cancellation timestamp. Whichever source is more pessimistic wins, so a loss
 * is never hidden.
 */
export function buildDayMetrics(params: {
  from: string;
  to: string;
  nights: BookingNight[];
  snapshots: DailySnapshot[];
  cancellations?: CancelledNight[];
  roomsAvailable: number;
  windowDays: number;
}): DayMetrics[] {
  const { from, to, nights, snapshots, roomsAvailable, windowDays } = params;
  const cancellations = params.cancellations ?? [];
  const today = budapestToday();
  const windowStart = addDays(today, -Math.max(0, windowDays - 1));

  const sold = new Map<string, number>();
  const revenue = new Map<string, number>();
  // Pickup is counted in RESERVATIONS, not room-nights, so it reads exactly
  // like Previo's pick-up report: one booking that takes two rooms on the same
  // night is one pickup, not two.
  const createdRes = new Map<string, Set<string>>();
  const createdRevenue = new Map<string, number>();
  for (const n of nights) {
    sold.set(n.stay_date, (sold.get(n.stay_date) ?? 0) + 1);
    revenue.set(n.stay_date, (revenue.get(n.stay_date) ?? 0) + (n.nightly_price_eur ?? 0));
    if (n.created_at_pms) {
      const createdDay = budapestDayOf(n.created_at_pms);
      if (createdDay >= windowStart) {
        const set = createdRes.get(n.stay_date) ?? new Set<string>();
        set.add(String(n.res_id));
        createdRes.set(n.stay_date, set);
        createdRevenue.set(n.stay_date, (createdRevenue.get(n.stay_date) ?? 0) + (n.nightly_price_eur ?? 0));
      }
    }
  }
  const created = new Map<string, number>();
  for (const [date, set] of createdRes) created.set(date, set.size);

  // Cancellations that happened inside the same window pull pickup negative,
  // again counted per reservation.
  const cancelledRes = new Map<string, Set<string>>();
  let hasCreationData = false;
  for (const n of nights) if (n.created_at_pms) { hasCreationData = true; break; }
  for (const c of cancellations) {
    if (!c.cancelled_at) continue;
    if (budapestDayOf(c.cancelled_at) < windowStart) continue;
    const set = cancelledRes.get(c.stay_date) ?? new Set<string>();
    set.add(String(c.res_id));
    cancelledRes.set(c.stay_date, set);
  }
  const cancelled = new Map<string, number>();
  for (const [date, set] of cancelledRes) cancelled.set(date, set.size);

  // Baseline = the NEWEST capture at or before the day the window opened.
  // Picking the first row we happen to meet made the comparison point depend
  // on query order, which is how real losses went missing.
  const compareDate = addDays(windowStart, -1);
  const baseline = new Map<string, { captured: string; sold: number }>();
  for (const s of snapshots) {
    if (s.captured_date > compareDate) continue;
    const prev = baseline.get(s.stay_date);
    if (!prev || s.captured_date > prev.captured) {
      baseline.set(s.stay_date, { captured: s.captured_date, sold: s.rooms_sold });
    }
  }

  // With no reservations loaded at all the horizon is simply not synced yet.
  // Comparing "0 rooms sold" against old snapshots would invent a huge
  // negative pickup, so report "unknown" instead.
  const hasBookings = nights.length > 0;

  return dateRange(from, to).map((d) => {
    const rs = sold.get(d) ?? 0;
    const rev = Math.round((revenue.get(d) ?? 0) * 100) / 100;
    const avail = roomsAvailable || 0;
    const base = baseline.get(d);
    const createdN = created.get(d) ?? 0;
    const cancelledN = cancelled.get(d) ?? 0;
    const bookingDelta = createdN - cancelledN;
    // Snapshot delta = ROOMS sold now vs rooms sold when the window opened.
    // It is only used when we have no booking creation timestamps at all:
    // mixing it with the reservation count would re-introduce the room-night
    // inflation that made Hotel Care read higher than Previo.
    const snapDelta = base === undefined ? null : rs - base.sold;
    let net: number | null;
    if (!hasBookings) net = null;
    else if (!hasCreationData) net = snapDelta;
    else net = bookingDelta;

    const adr = rs ? rev / rs : null;
    // Rooms lost: explicit cancellations, or whatever the snapshot says went
    // missing beyond the bookings we can see.
    const impliedLost = !hasCreationData && snapDelta !== null ? Math.max(0, -snapDelta) : 0;
    const roomsLost = Math.max(cancelledN, impliedLost);

    return {
      stay_date: d,
      roomsSold: rs,
      roomsAvailable: avail,
      occupancyPct: avail ? Math.round((rs / avail) * 1000) / 10 : 0,
      revenueEur: rev,
      adrEur: rs ? Math.round((rev / rs) * 100) / 100 : null,
      revparEur: avail ? Math.round((rev / avail) * 100) / 100 : null,
      roomsLeft: Math.max(0, avail - rs),
      newBookings: createdN,
      cancelledBookings: cancelledN < 0 ? 0 : cancelledN,
      newRevenueEur: Math.round((createdRevenue.get(d) ?? 0) * 100) / 100,
      lostRevenueEur: adr ? Math.round(roomsLost * adr * 100) / 100 : 0,
      roomsLost,
      baselineAvailable: base !== undefined,
      netPickup: net,
    };
  });
}


/** Budapest calendar day of an ISO timestamp. */
export function budapestDayOf(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUDAPEST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoTimestamp));
}

/**
 * Pickup heat colour. 0 = neutral, 1-2 = light -> stronger orange, 3+ = red.
 * Negative pickup (cancellations) reads blue so it never looks like demand.
 */
export function pickupHeat(pickup: number): { bg: string; text: string; label: string } {
  if (pickup <= -2) return { bg: "bg-sky-200 dark:bg-sky-900/60", text: "text-sky-900 dark:text-sky-100", label: "cancellations" };
  if (pickup === -1) return { bg: "bg-sky-100 dark:bg-sky-900/40", text: "text-sky-900 dark:text-sky-100", label: "cancellation" };
  if (pickup <= 0) return { bg: "", text: "text-foreground", label: "no movement" };
  if (pickup === 1) return { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-900 dark:text-orange-100", label: "light pickup" };
  if (pickup === 2) return { bg: "bg-orange-300 dark:bg-orange-800/70", text: "text-orange-950 dark:text-orange-50", label: "building pickup" };
  if (pickup === 3) return { bg: "bg-red-400 dark:bg-red-800", text: "text-white", label: "strong pickup" };
  return { bg: "bg-red-600 dark:bg-red-700", text: "text-white", label: "peak pickup" };
}

export function occupancyTone(pct: number): string {
  if (pct >= 90) return "text-red-600 dark:text-red-400";
  if (pct >= 70) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

/**
 * Formats a money amount in the hotel's real currency. The name is historic —
 * the value is NOT necessarily euros (SLNT's Previo quotes forints), so this
 * delegates to the currency configured for the hotel on screen.
 */
export function eur(value: number | null | undefined, digits = 0): string {
  return money(value, digits);
}
