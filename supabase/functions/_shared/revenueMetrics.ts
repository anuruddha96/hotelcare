// Revenue numbers for the assistant, derived from the SAME authoritative
// dataset the Revenue screen reads: the completed payload returned by
// `get_revenue_published_payload`.
//
// The derivation below is a faithful port of `src/lib/revenueAnalytics.ts`
// (`buildDayMetrics`) and the inventory rules in `src/hooks/useRevenueHotelData.ts`.
// `supabase/functions/_shared/__tests__/revenueMetrics.parity.test.ts` asserts the
// two produce identical numbers, so the assistant can never quote a figure the
// Revenue screen does not show.
//
// This file is intentionally free of Deno APIs so the parity test can import it.

export const BUDAPEST_TZ = "Europe/Budapest";

export function budapestToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUDAPEST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function budapestDayOf(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUDAPEST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoTimestamp));
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

/** The engine's rolling 48h pickup window, encoded as a negative day count. */
export const PICKUP_WINDOW_48H = -48;

export function isRollingPickupWindow(windowDays: number): boolean {
  return windowDays < 0;
}

export function pickupWindowStartMs(windowDays: number, now: number = Date.now()): number {
  if (isRollingPickupWindow(windowDays)) return now - Math.abs(windowDays) * 3_600_000;
  const firstDay = addDays(budapestDayOf(new Date(now).toISOString()), -Math.max(0, windowDays - 1));
  return Date.parse(`${firstDay}T00:00:00Z`) - 2 * 3_600_000;
}

export function pickupWindowFirstDay(windowDays: number, now: number = Date.now()): string {
  return budapestDayOf(new Date(pickupWindowStartMs(windowDays, now)).toISOString());
}

export interface BookingNight {
  stay_date: string;
  res_id: string;
  room_key?: string | null;
  obk_id?: string | null;
  room_type_name?: string | null;
  nightly_price_eur?: number | null;
  created_at_pms?: string | null;
  guests?: number | null;
}

export interface DailySnapshot {
  stay_date: string;
  captured_date: string;
  rooms_sold: number;
  rooms_available: number;
  occupancy_pct: number;
  revenue_eur: number;
  adr_eur: number | null;
  new_bookings?: number;
  captured_at?: string | null;
}

export interface CancelledNight {
  stay_date: string;
  res_id: string;
  room_key?: string | null;
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
  captured_at?: string | null;
}

export interface RevenueRoomType {
  id: string;
  name: string;
  num_rooms: number;
  is_sellable?: boolean;
  counts_toward_inventory?: boolean;
}

export interface DayMetrics {
  stay_date: string;
  roomsSold: number;
  roomsAvailable: number;
  occupancyPct: number;
  revenueEur: number;
  adrEur: number | null;
  revparEur: number | null;
  roomsLeft: number;
  newBookings: number;
  cancelledBookings: number;
  newRevenueEur: number;
  lostRevenueEur: number;
  roomsLost: number;
  baselineAvailable: boolean;
  netPickup: number | null;
  pickupGained: number;
  pickupLost: number;
  hasData: boolean;
}

/** Port of `buildDayMetrics` — keep byte-for-byte behaviour with the UI. */
export function buildDayMetrics(params: {
  from: string;
  to: string;
  nights: BookingNight[];
  snapshots: DailySnapshot[];
  cancellations?: CancelledNight[];
  movements?: PickupMovement[];
  roomsAvailable: number;
  windowDays: number;
  ratedDates?: Set<string>;
  now?: number;
}): DayMetrics[] {
  const { from, to, nights, snapshots, roomsAvailable, windowDays } = params;
  const cancellations = params.cancellations ?? [];
  const movements = params.movements ?? [];
  const ratedDates = params.ratedDates ?? new Set<string>();
  const evidence = new Set<string>(ratedDates);
  for (const n of nights) evidence.add(n.stay_date);
  for (const s of snapshots) evidence.add(s.stay_date);
  for (const c of cancellations) evidence.add(c.stay_date);
  const now = params.now ?? Date.now();
  const windowStartMs = pickupWindowStartMs(windowDays, now);
  const windowStart = pickupWindowFirstDay(windowDays, now);
  const inWindow = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t >= windowStartMs : budapestDayOf(iso) >= windowStart;
  };

  const sold = new Map<string, number>();
  const revenue = new Map<string, number>();
  const pricedRooms = new Map<string, number>();
  const createdRes = new Map<string, Set<string>>();
  const createdRevenue = new Map<string, number>();
  for (const n of nights) {
    sold.set(n.stay_date, (sold.get(n.stay_date) ?? 0) + 1);
    revenue.set(n.stay_date, (revenue.get(n.stay_date) ?? 0) + (n.nightly_price_eur ?? 0));
    if ((n.nightly_price_eur ?? 0) > 0) {
      pricedRooms.set(n.stay_date, (pricedRooms.get(n.stay_date) ?? 0) + 1);
    }
    if (n.created_at_pms && inWindow(n.created_at_pms)) {
      const set = createdRes.get(n.stay_date) ?? new Set<string>();
      set.add(`${n.res_id}|${n.room_key ?? ""}`);
      createdRes.set(n.stay_date, set);
      createdRevenue.set(n.stay_date, (createdRevenue.get(n.stay_date) ?? 0) + (n.nightly_price_eur ?? 0));
    }
  }

  const created = new Map<string, number>();
  for (const [date, set] of createdRes) created.set(date, set.size);

  const cancelledRes = new Map<string, Set<string>>();
  for (const c of cancellations) {
    if (!c.cancelled_at) continue;
    if (!inWindow(c.cancelled_at)) continue;
    const set = cancelledRes.get(c.stay_date) ?? new Set<string>();
    set.add(`${c.res_id}|${c.room_key ?? ""}`);
    cancelledRes.set(c.stay_date, set);
  }
  const cancelled = new Map<string, number>();
  for (const [date, set] of cancelledRes) cancelled.set(date, set.size);

  const MOVEMENT_LAG_MS = 30 * 60 * 1000;
  const syncedMovement = new Map<string, number>();
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

  const hasBookings = nights.length > 0;

  return dateRange(from, to).map((d) => {
    const rs = sold.get(d) ?? 0;
    const rev = Math.round((revenue.get(d) ?? 0) * 100) / 100;
    const avail = roomsAvailable || 0;
    const base = baseline.get(d);
    const createdN = created.get(d) ?? 0;
    const cancelledN = cancelled.get(d) ?? 0;
    const bookingDelta = createdN - cancelledN;
    const snapDelta = base === undefined ? null : rs - base.sold;
    let net: number | null;
    const durableMovement = syncedMovement.get(d);
    if (durableMovement !== undefined) net = durableMovement;
    else if (movements.length > 0) net = 0;
    else if (!hasBookings) net = null;
    else if (snapDelta !== null) net = snapDelta;
    else net = bookingDelta;

    const priced = pricedRooms.get(d) ?? 0;
    const adr = priced ? rev / priced : null;
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
      pickupGained: syncedGained.get(d) ?? (durableMovement !== undefined || movements.length > 0 ? 0 : Math.max(0, createdN)),
      pickupLost: syncedLost.get(d) ?? (durableMovement !== undefined || movements.length > 0 ? 0 : Math.max(0, cancelledN)),
      baselineAvailable: base !== undefined,
      netPickup: net,
      hasData: evidence.has(d),
    };
  });
}

export interface PublishedRevenuePayload {
  roomTypes?: RevenueRoomType[];
  nights?: BookingNight[];
  snapshots?: DailySnapshot[];
  rates?: RoomTypeRate[];
  cancellations?: CancelledNight[];
  movements?: PickupMovement[];
  settings?: Record<string, unknown>;
}

/**
 * Sellable inventory, using exactly the rule the Revenue screen applies:
 * an explicit override wins, otherwise the sellable room types are summed and
 * the nightly snapshot is trusted instead when the room types look duplicated.
 */
export function resolveRoomsAvailable(payload: PublishedRevenuePayload): number {
  const settings = payload.settings ?? {};
  const sellableOverride = (settings.sellable_rooms as number | null) ?? null;
  const inventoryFromTypes = (payload.roomTypes ?? [])
    .filter((r) => r.is_sellable !== false && r.counts_toward_inventory !== false)
    .reduce((s, r) => s + (r.num_rooms || 0), 0);
  const snapshotRooms = (payload.snapshots ?? [])[0]?.rooms_available ?? 0;
  const typesLookInflated = snapshotRooms > 0 && inventoryFromTypes > snapshotRooms * 1.2;
  return sellableOverride || (typesLookInflated ? snapshotRooms : inventoryFromTypes) || snapshotRooms;
}

export interface RevenueDataset {
  hotelId: string;
  hotelName: string;
  payload: PublishedRevenuePayload;
  roomsAvailable: number;
  currency: string;
  lastSyncAt: string | null;
  metricsFor(from: string, to: string, windowDays?: number): DayMetrics[];
}

/** How confident the assistant may sound about a tool result. */
export type Confidence = "verified" | "partial" | "unverified";

export interface DataEnvelope<T> {
  data: T;
  source: string;
  dataAsOf: string | null;
  lastSyncAt?: string | null;
  confidence: Confidence;
  note?: string;
}

/** Older than this and the assistant must mention the dataset age. */
export const STALE_AFTER_MINUTES = 180;

export function isStale(lastSyncAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!lastSyncAt) return true;
  const t = Date.parse(lastSyncAt);
  if (!Number.isFinite(t)) return true;
  return now - t > STALE_AFTER_MINUTES * 60_000;
}

export function envelope<T>(
  data: T,
  opts: { source: string; lastSyncAt?: string | null; dataAsOf?: string | null; confidence?: Confidence; note?: string },
): DataEnvelope<T> {
  const stale = isStale(opts.lastSyncAt ?? opts.dataAsOf ?? null);
  const confidence: Confidence = opts.confidence ?? (stale ? "partial" : "verified");
  return {
    data,
    source: opts.source,
    dataAsOf: opts.dataAsOf ?? opts.lastSyncAt ?? new Date().toISOString(),
    lastSyncAt: opts.lastSyncAt ?? null,
    confidence,
    ...(opts.note ? { note: opts.note } : stale && opts.lastSyncAt
      ? { note: `This dataset was last completed at ${opts.lastSyncAt}; say so if the user relies on it.` }
      : {}),
  };
}

/**
 * Load the authoritative Revenue dataset for one hotel. Authorization is the
 * caller's responsibility: only pass hotel ids already resolved from the
 * signed-in profile.
 *
 * `get_revenue_published_payload` gates on `auth.uid()`, which is NULL for a
 * service-role client, so a service-role RPC call always returns zero rows.
 * When that happens we read the same `revenue_published_payloads` row directly.
 */
export async function loadRevenueDataset(
  client: {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    from?: (table: string) => any;
  },
  hotelId: string,
  hotelName: string,
): Promise<RevenueDataset | null> {
  let row: any = null;
  const { data, error } = await client.rpc("get_revenue_published_payload", { _hotel_id: hotelId });
  if (!error) row = Array.isArray(data) ? data[0] : data;
  if (!row?.payload && typeof client.from === "function") {
    const fallback = await client
      .from("revenue_published_payloads")
      .select("sync_completed_at,sync_completed_by_name,horizon_from,horizon_to,payload")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    if (!fallback.error && fallback.data?.payload) row = fallback.data;
  }
  if (!row?.payload) return null;

  const payload = row.payload as PublishedRevenuePayload;
  const roomsAvailable = resolveRoomsAvailable(payload);
  const settings = payload.settings ?? {};
  const currency = String(settings.base_currency ?? "EUR").toUpperCase();
  const rates = payload.rates ?? [];
  const ratedDates = new Set(rates.map((r) => r.stay_date));
  return {
    hotelId,
    hotelName,
    payload,
    roomsAvailable,
    currency,
    lastSyncAt: row.sync_completed_at ?? null,
    metricsFor(from, to, windowDays = PICKUP_WINDOW_48H) {
      return buildDayMetrics({
        from,
        to,
        nights: payload.nights ?? [],
        snapshots: payload.snapshots ?? [],
        cancellations: payload.cancellations ?? [],
        movements: payload.movements ?? [],
        roomsAvailable,
        windowDays,
        ratedDates,
      });
    },
  };
}
