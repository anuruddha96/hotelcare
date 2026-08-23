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

/**
 * The pickup window the automation engine itself uses: a ROLLING 48 hours, not
 * a Budapest calendar day. Encoded as a negative number of hours so the single
 * `pickupWindowDays` value can carry either mode without a second prop.
 *
 * This is why the calendar and the automation used to disagree: a booking taken
 * yesterday at 21:00 is inside the engine's window but outside "Today", so a
 * price rose against an empty pickup cell.
 */
export const PICKUP_WINDOW_48H = -48;

/** True when the value means "the last N hours" rather than "the last N days". */
export function isRollingPickupWindow(windowDays: number): boolean {
  return windowDays < 0;
}

/** Epoch ms at which the selected pickup window opens. */
export function pickupWindowStartMs(windowDays: number, now: number = Date.now()): number {
  if (isRollingPickupWindow(windowDays)) return now - Math.abs(windowDays) * 3_600_000;
  const firstDay = addDays(budapestDayOf(new Date(now).toISOString()), -Math.max(0, windowDays - 1));
  return Date.parse(`${firstDay}T00:00:00Z`) - 2 * 3_600_000; // Budapest midnight, DST-tolerant
}

/** First Budapest calendar day the window can touch (used for day-keyed data). */
export function pickupWindowFirstDay(windowDays: number, now: number = Date.now()): string {
  return budapestDayOf(new Date(pickupWindowStartMs(windowDays, now)).toISOString());
}

export function pickupWindowLabel(windowDays: number): string {
  if (isRollingPickupWindow(windowDays)) return `Last ${Math.abs(windowDays)} hours`;
  if (windowDays <= 1) return "Today";
  if (windowDays === 2) return "Yesterday + today";
  return `Last ${windowDays} days`;
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
  captured_at?: string | null;
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

export interface PickupMovement {
  stay_date: string;
  delta: number;
  captured_at: string;
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
  /**
   * Rooms GAINED inside the window (always >= 0). Kept separate from the net so
   * a date that gained one room and gave one back is still visible instead of
   * disappearing behind a net of zero.
   */
  pickupGained: number;
  /** Rooms GIVEN BACK inside the window (always >= 0). */
  pickupLost: number;
  /**
   * True when this date carries real synced evidence (a snapshot, a booked
   * room-night, a cancellation or a published rate). A date without evidence
   * is one the sync has not reached yet — it must read as "loading", never as
   * a genuine 0% / €0.
   */
  hasData: boolean;
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
  movements?: PickupMovement[];
  roomsAvailable: number;
  windowDays: number;
  /** Stay dates that have a published rate — evidence the sync reached them. */
  ratedDates?: Set<string>;
}): DayMetrics[] {
  const { from, to, nights, snapshots, roomsAvailable, windowDays } = params;
  const cancellations = params.cancellations ?? [];
  const movements = params.movements ?? [];
  const ratedDates = params.ratedDates ?? new Set<string>();
  const evidence = new Set<string>(ratedDates);
  for (const n of nights) evidence.add(n.stay_date);
  for (const s of snapshots) evidence.add(s.stay_date);
  for (const c of cancellations) evidence.add(c.stay_date);
  const today = budapestToday();
  const now = Date.now();
  // One rule for "is this inside the window", shared by bookings, cancellations
  // and sync movements, so a rolling 48h window behaves exactly like the engine.
  const windowStartMs = pickupWindowStartMs(windowDays, now);
  const windowStart = pickupWindowFirstDay(windowDays, now);
  const inWindow = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t >= windowStartMs : budapestDayOf(iso) >= windowStart;
  };


  const sold = new Map<string, number>();
  const revenue = new Map<string, number>();
  // Rooms that actually carry a price. A group booking often puts the whole
  // amount on one room and sends the others at 0, so those must not drag the
  // ADR average down.
  const pricedRooms = new Map<string, number>();
  // Pickup is counted in ROOMS per reservation, so a second room added to a
  // booking that already covered that night still reads as one pickup, while a
  // physical room-key change on the same room does not.
  const createdRes = new Map<string, Set<string>>();
  const createdRevenue = new Map<string, number>();
  for (const n of nights) {
    sold.set(n.stay_date, (sold.get(n.stay_date) ?? 0) + 1);
    revenue.set(n.stay_date, (revenue.get(n.stay_date) ?? 0) + (n.nightly_price_eur ?? 0));
    if ((n.nightly_price_eur ?? 0) > 0) {
      pricedRooms.set(n.stay_date, (pricedRooms.get(n.stay_date) ?? 0) + 1);
    }
    if (n.created_at_pms) {
      if (inWindow(n.created_at_pms)) {

        const set = createdRes.get(n.stay_date) ?? new Set<string>();
        set.add(`${n.res_id}|${(n as { room_key?: string | null }).room_key ?? ""}`);
        createdRes.set(n.stay_date, set);
        createdRevenue.set(n.stay_date, (createdRevenue.get(n.stay_date) ?? 0) + (n.nightly_price_eur ?? 0));
      }
    }
  }

  const created = new Map<string, number>();
  for (const [date, set] of createdRes) created.set(date, set.size);

  // Cancellations that happened inside the same window pull pickup negative,
  // again counted in rooms per reservation.
  const cancelledRes = new Map<string, Set<string>>();
  for (const c of cancellations) {
    if (!c.cancelled_at) continue;
    if (!inWindow(c.cancelled_at)) continue;
    const set = cancelledRes.get(c.stay_date) ?? new Set<string>();
    set.add(`${c.res_id}|${(c as { room_key?: string | null }).room_key ?? ""}`);
    cancelledRes.set(c.stay_date, set);
  }

  const cancelled = new Map<string, number>();
  for (const [date, set] of cancelledRes) cancelled.set(date, set.size);

  // Every Previo sync stores its reservation-level gain/loss. Summing captures
  // within the selected Budapest window matches the PMS pickup report and does
  // not depend on unsupported cancellation-status filters.
  //
  // A capture reports what changed since the PREVIOUS sync, so its movement
  // happened BEFORE its timestamp. The midnight run (00:00 Budapest) therefore
  // carries the last minutes of yesterday; counting it as "today" made the
  // calendar disagree with Previo's pick-up report. Shifting the attribution
  // back by half a sync interval puts each movement on the day it happened.
  const MOVEMENT_LAG_MS = 30 * 60 * 1000;
  const syncedMovement = new Map<string, number>();
  // Gains and losses are also kept apart: a date that booked one room and gave
  // one back nets to zero, and reporting only the net made real movement (and
  // the booking the user can see in the PMS) invisible on the chart.
  const syncedGained = new Map<string, number>();
  const syncedLost = new Map<string, number>();
  for (const movement of movements) {
    const parsed = Date.parse(movement.captured_at);
    const happenedAt = Number.isFinite(parsed) ? parsed - MOVEMENT_LAG_MS : NaN;
    const inside = Number.isFinite(happenedAt)
      ? inWindow(new Date(happenedAt).toISOString())
      : inWindow(movement.captured_at);
    if (!inside) continue;

    const delta = Number(movement.delta || 0);
    syncedMovement.set(movement.stay_date, (syncedMovement.get(movement.stay_date) ?? 0) + delta);
    if (delta > 0) syncedGained.set(movement.stay_date, (syncedGained.get(movement.stay_date) ?? 0) + delta);
    if (delta < 0) syncedLost.set(movement.stay_date, (syncedLost.get(movement.stay_date) ?? 0) - delta);
  }

  // Baseline = the NEWEST capture before the day the window opened.
  // Picking the first row we happen to meet made the comparison point depend
  // on query order, which is how real losses went missing.
  const compareDate = addDays(windowStart, -1);
  const baseline = new Map<string, { captured: string; capturedMs: number; sold: number }>();
  for (const s of snapshots) {
    const captured = s.captured_at ?? `${s.captured_date}T23:59:59Z`;
    const capturedMs = Date.parse(captured);
    if (Number.isFinite(capturedMs) ? budapestDayOf(captured) >= windowStart : s.captured_date > compareDate) continue;
    const prev = baseline.get(s.stay_date);
    if (!prev || capturedMs > prev.capturedMs) {
      baseline.set(s.stay_date, { captured, capturedMs, sold: s.rooms_sold });
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
    // This remains a fallback for historical periods captured before the
    // reservation-level sync movement feed was introduced.
    const snapDelta = base === undefined ? null : rs - base.sold;
    let net: number | null;
    const durableMovement = syncedMovement.get(d);
    // The movement feed only stores non-zero changes, so "no row" inside a
    // window that has movements at all means this date simply did not move.
    if (durableMovement !== undefined) net = durableMovement;
    else if (movements.length > 0) net = 0;
    else if (!hasBookings) net = null;
    else if (snapDelta !== null) net = snapDelta;
    else net = bookingDelta;


    // ADR averages only the rooms that carry a price: a group booking's €0
    // companion rooms have no rate and must not dilute it.
    const priced = pricedRooms.get(d) ?? 0;
    const adr = priced ? rev / priced : null;
    // Rooms lost: explicit cancellations, or whatever the snapshot says went
    // missing beyond the bookings we can see.
    const impliedLost = snapDelta !== null ? Math.max(0, -snapDelta) : 0;
    const roomsLost = Math.max(cancelledN, impliedLost);

    return {
      stay_date: d,
      roomsSold: rs,
      roomsAvailable: avail,
      occupancyPct: avail ? Math.round((rs / avail) * 1000) / 10 : 0,
      revenueEur: rev,
      adrEur: adr !== null ? Math.round(adr * 100) / 100 : null,

      revparEur: avail ? Math.round((rev / avail) * 100) / 100 : null,
      roomsLeft: Math.max(0, avail - rs),
      newBookings: createdN,
      cancelledBookings: cancelledN < 0 ? 0 : cancelledN,
      newRevenueEur: Math.round((createdRevenue.get(d) ?? 0) * 100) / 100,
      lostRevenueEur: adr ? Math.round(roomsLost * adr * 100) / 100 : 0,
      roomsLost,
      // Prefer the sync feed (matches the PMS pick-up report); fall back to the
      // booking/cancellation timestamps we can see for the same window.
      pickupGained: syncedGained.get(d) ?? (durableMovement !== undefined || movements.length > 0 ? 0 : Math.max(0, createdN)),
      pickupLost: syncedLost.get(d) ?? (durableMovement !== undefined || movements.length > 0 ? 0 : Math.max(0, cancelledN)),
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
