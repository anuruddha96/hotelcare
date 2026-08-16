import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  addDays,
  budapestToday,
  buildDayMetrics,
  type BookingNight,
  type CancelledNight,
  type DailySnapshot,
  type DayMetrics,
  type PickupMovement,
  type RoomTypeRate,
} from "@/lib/revenueAnalytics";
import { DEFAULT_THRESHOLDS, type RevenueThresholds } from "@/lib/revenueThresholds";

export interface RevenueRoomType {
  id: string;
  name: string;
  pms_room_id: string | null;
  num_rooms: number;
  is_reference: boolean;
  derivation_mode: string;
  derivation_value: number;
  sort_order: number;
  /** False for non-room products (breakfast, coffee, visitor centre …). */
  is_sellable: boolean;
  /** False for duplicated PMS groupings that would double-count inventory. */
  counts_toward_inventory: boolean;
  /** { en: "Economy double room", hu: "…" } produced by the translate job. */
  name_translations: Record<string, string>;
}

/** Supabase caps a single select at 1000 rows — page through everything. */
async function fetchAll<T>(
  build: () => ReturnType<typeof supabase.from>,
  apply: (q: any) => any,
): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let offset = 0; offset < 20000; offset += page) {
    const { data, error } = await apply(build()).range(offset, offset + page - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export interface RevenueHotelData {
  loading: boolean;
  error: string | null;
  today: string;
  horizonEnd: string;
  roomTypes: RevenueRoomType[];
  roomsAvailable: number;
  nights: BookingNight[];
  snapshots: DailySnapshot[];
  rates: RoomTypeRate[];
  cancellations: CancelledNight[];
  metrics: DayMetrics[];
  lastSyncAt: string | null;
  /** Who triggered the last revenue sync (null = automatic / unknown). */
  lastSyncBy: string | null;
  thresholds: RevenueThresholds;
  reload: () => Promise<void>;
}

/**
 * Loads every Revenue Management input for ONE hotel.
 * `pickupWindowDays` controls how far back "pickup" looks.
 */
export function useRevenueHotelData(
  hotelId: string | null,
  horizonDays = 190,
  pickupWindowDays = 1,
): RevenueHotelData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomTypes, setRoomTypes] = useState<RevenueRoomType[]>([]);
  const [nights, setNights] = useState<BookingNight[]>([]);
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([]);
  const [rates, setRates] = useState<RoomTypeRate[]>([]);
  const [cancellations, setCancellations] = useState<CancelledNight[]>([]);
  const [movements, setMovements] = useState<PickupMovement[]>([]);
  const [sellableOverride, setSellableOverride] = useState<number | null>(null);
  const [thresholds, setThresholds] = useState<RevenueThresholds>(DEFAULT_THRESHOLDS);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncBy, setLastSyncBy] = useState<string | null>(null);

  const today = budapestToday();
  const horizonEnd = addDays(today, horizonDays);

  const reload = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    // Keep the last successful calendar mounted during background refreshes.
    // `loading` is only a blocking state before the first successful payload.
    if (roomTypes.length === 0 && rates.length === 0) setLoading(true);
    setError(null);
    try {
      const [rt, nightRows, snapRows, rateRows, cancelRows, movementRows, settings, sync] = await Promise.all([
        supabase.from("room_types")
          .select("id, name, pms_room_id, num_rooms, is_reference, derivation_mode, derivation_value, sort_order, is_sellable, counts_toward_inventory, name_translations")
          .eq("hotel_id", hotelId).order("sort_order"),
        fetchAll<BookingNight>(
          () => supabase.from("revenue_booking_nights") as any,
          (q) => q.select("stay_date, res_id, room_key, obk_id, room_type_name, nightly_price_eur, total_price_eur, stay_from, stay_to, source_name, created_at_pms, guests")
            .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd)
            .order("stay_date").order("res_id").order("room_key", { nullsFirst: true }),
        ),
        fetchAll<DailySnapshot>(
          () => supabase.from("revenue_daily_snapshots") as any,
          // Paging needs a total order: thousands of rows share the same
          // captured_date, and ties make Postgres return them in an arbitrary
          // order per page, so rows get skipped or repeated between pages.
          (q) => q.select("stay_date, captured_date, captured_at, rooms_sold, rooms_available, occupancy_pct, revenue_eur, adr_eur, new_bookings")
            .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd)
            .order("stay_date").order("captured_at", { ascending: false }),
        ),
        fetchAll<RoomTypeRate>(
          () => supabase.from("revenue_room_type_rates") as any,
          // Same here — captured_at is identical across a whole sync batch,
          // which is exactly how whole months of rates went missing.
          (q) => q.select("stay_date, obk_id, room_type_name, occupancy, price, currency, rate_plan_id, captured_at, updated_at")
            .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd)
            .order("stay_date").order("obk_id").order("occupancy").order("captured_at", { ascending: false }),
        ),
        fetchAll<CancelledNight>(
          () => supabase.from("revenue_cancelled_nights") as any,
          (q) => q.select("stay_date, res_id, room_key, obk_id, room_type_name, nightly_price_eur, total_price_eur, stay_from, stay_to, source_name, created_at_pms, guests, cancelled_at")
            .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd)
            .order("stay_date").order("res_id").order("room_key", { nullsFirst: true }),
        ),
        fetchAll<PickupMovement>(
          () => supabase.from("pickup_snapshots") as any,
          (q) => q.select("stay_date, delta, captured_at")
            .eq("hotel_id", hotelId)
            .eq("source", "previo_sync_diff")
            .gte("captured_at", `${addDays(today, -90)}T00:00:00Z`)
            .order("captured_at", { ascending: true })
            .order("stay_date"),
        ),
        supabase.from("hotel_revenue_settings")
          .select("sellable_rooms, rate_warn_below_eur, rate_critical_below_eur, rate_max_sane_eur, occupancy_low_pct, occupancy_high_pct, pickup_strong_threshold, base_currency, eur_conversion_rate")
          .eq("hotel_id", hotelId).maybeSingle(),

        supabase.from("revenue_sync_state")
          .select("last_success_at, last_success_by_name")
          .eq("hotel_id", hotelId).maybeSingle(),
      ]);

      
      setRoomTypes(((rt.data ?? []) as any[]).map((r) => ({
        ...r,
        name_translations: (r.name_translations ?? {}) as Record<string, string>,
      })) as RevenueRoomType[]);
      setNights(nightRows);
      setSnapshots(snapRows);
      // Previo can retain historical rows for an older pricelist. Keep the
      // newest capture for each visible cell so stale duplicates never win by
      // database return order after a successful push.
      const newestRates = new Map<string, RoomTypeRate>();
      rateRows.sort((a, b) => {
        const aTime = Date.parse(a.updated_at ?? a.captured_at ?? "") || 0;
        const bTime = Date.parse(b.updated_at ?? b.captured_at ?? "") || 0;
        return bTime - aTime;
      });
      for (const rate of rateRows) {
        const key = `${rate.stay_date}|${rate.obk_id}|${rate.occupancy}`;
        if (!newestRates.has(key)) newestRates.set(key, rate);
      }
      setRates(Array.from(newestRates.values()));
      setCancellations(cancelRows);
      setMovements(movementRows);
      const s = (settings as any)?.data ?? null;
      setSellableOverride((s?.sellable_rooms as number | null) ?? null);
      // The safety-net limits are stored as euro amounts. A property that
      // publishes forints would otherwise have every price flagged "critical",
      // so scale the euro limits into the property's own currency.
      const baseCur = String(s?.base_currency ?? "EUR").toUpperCase();
      const eurRate = Number(s?.eur_conversion_rate) || 0;
      const scale = baseCur !== "EUR" && eurRate > 0 ? eurRate : 1;
      setThresholds({
        rateWarnBelowEur: Number(s?.rate_warn_below_eur ?? DEFAULT_THRESHOLDS.rateWarnBelowEur) * scale,
        rateCriticalBelowEur: Number(s?.rate_critical_below_eur ?? DEFAULT_THRESHOLDS.rateCriticalBelowEur) * scale,
        rateMaxSaneEur: Number(s?.rate_max_sane_eur ?? DEFAULT_THRESHOLDS.rateMaxSaneEur) * scale,
        occupancyLowPct: Number(s?.occupancy_low_pct ?? DEFAULT_THRESHOLDS.occupancyLowPct),
        occupancyHighPct: Number(s?.occupancy_high_pct ?? DEFAULT_THRESHOLDS.occupancyHighPct),
        pickupStrongThreshold: Number(s?.pickup_strong_threshold ?? DEFAULT_THRESHOLDS.pickupStrongThreshold),
      });

      const syncRow = sync.data as { last_success_at?: string; last_success_by_name?: string | null } | null;
      setLastSyncAt(syncRow?.last_success_at ?? null);
      setLastSyncBy(syncRow?.last_success_by_name ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, horizonDays, roomTypes.length, rates.length]);

  useEffect(() => { void reload(); }, [reload]);

  // Physical inventory. Previo lists the same physical rooms twice (unit groups
  // AND rate-plan room types) plus non-room products, so summing every row
  // massively inflates the denominator and pushes occupancy down. Count only
  // sellable room types explicitly flagged as inventory, and let an admin
  // override win outright.
  const inventoryFromTypes = roomTypes
    .filter((r) => r.is_sellable !== false && r.counts_toward_inventory !== false)
    .reduce((s, r) => s + (r.num_rooms || 0), 0);
  // Safety net: Previo's nightly snapshot knows the true sellable room count.
  // If the summed room types are wildly larger (duplicated unit groups), trust
  // the snapshot instead of halving every occupancy figure.
  const snapshotRooms = snapshots[0]?.rooms_available ?? 0;
  const typesLookInflated =
    snapshotRooms > 0 && inventoryFromTypes > snapshotRooms * 1.2;
  const roomsAvailable = sellableOverride
    || (typesLookInflated ? snapshotRooms : inventoryFromTypes)
    || snapshotRooms;

  const metrics = buildDayMetrics({
    from: today,
    to: horizonEnd,
    nights,
    snapshots,
    cancellations,
    movements,
    roomsAvailable,
    windowDays: pickupWindowDays,
  });

  return {
    loading, error, today, horizonEnd, roomTypes, roomsAvailable,
    nights, snapshots, rates, cancellations, metrics, lastSyncAt, lastSyncBy, thresholds, reload,
  };
}
