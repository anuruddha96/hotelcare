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
  const [sellableOverride, setSellableOverride] = useState<number | null>(null);
  const [thresholds, setThresholds] = useState<RevenueThresholds>(DEFAULT_THRESHOLDS);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const today = budapestToday();
  const horizonEnd = addDays(today, horizonDays);

  const reload = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [rt, nightRows, snapRows, rateRows, cancelRows, settings, sync] = await Promise.all([
        supabase.from("room_types")
          .select("id, name, pms_room_id, num_rooms, is_reference, derivation_mode, derivation_value, sort_order, is_sellable, counts_toward_inventory, name_translations")
          .eq("hotel_id", hotelId).order("sort_order"),
        fetchAll<BookingNight>(
          () => supabase.from("revenue_booking_nights") as any,
          (q) => q.select("stay_date, res_id, obk_id, room_type_name, nightly_price_eur, created_at_pms, guests")
            .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd)
            .order("stay_date"),
        ),
        fetchAll<DailySnapshot>(
          () => supabase.from("revenue_daily_snapshots") as any,
          (q) => q.select("stay_date, captured_date, rooms_sold, rooms_available, occupancy_pct, revenue_eur, adr_eur, new_bookings")
            .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd)
            .order("captured_date", { ascending: false }),
        ),
        fetchAll<RoomTypeRate>(
          () => supabase.from("revenue_room_type_rates") as any,
          (q) => q.select("stay_date, obk_id, room_type_name, occupancy, price, currency")
            .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd)
            .order("stay_date"),
        ),
        fetchAll<CancelledNight>(
          () => supabase.from("revenue_cancelled_nights") as any,
          (q) => q.select("stay_date, res_id, obk_id, cancelled_at")
            .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd)
            .order("stay_date"),
        ),
        supabase.from("hotel_revenue_settings")
          .select("sellable_rooms, rate_warn_below_eur, rate_critical_below_eur, rate_max_sane_eur, occupancy_low_pct, occupancy_high_pct, pickup_strong_threshold")
          .eq("hotel_id", hotelId).maybeSingle(),
        supabase.from("pms_sync_history")
          .select("created_at").eq("hotel_id", hotelId).eq("sync_type", "revenue_sync")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      
      setRoomTypes(((rt.data ?? []) as any[]).map((r) => ({
        ...r,
        name_translations: (r.name_translations ?? {}) as Record<string, string>,
      })) as RevenueRoomType[]);
      setNights(nightRows);
      setSnapshots(snapRows);
      setRates(rateRows);
      setCancellations(cancelRows);
      const s = (settings as any)?.data ?? null;
      setSellableOverride((s?.sellable_rooms as number | null) ?? null);
      setThresholds({
        rateWarnBelowEur: Number(s?.rate_warn_below_eur ?? DEFAULT_THRESHOLDS.rateWarnBelowEur),
        rateCriticalBelowEur: Number(s?.rate_critical_below_eur ?? DEFAULT_THRESHOLDS.rateCriticalBelowEur),
        rateMaxSaneEur: Number(s?.rate_max_sane_eur ?? DEFAULT_THRESHOLDS.rateMaxSaneEur),
        occupancyLowPct: Number(s?.occupancy_low_pct ?? DEFAULT_THRESHOLDS.occupancyLowPct),
        occupancyHighPct: Number(s?.occupancy_high_pct ?? DEFAULT_THRESHOLDS.occupancyHighPct),
        pickupStrongThreshold: Number(s?.pickup_strong_threshold ?? DEFAULT_THRESHOLDS.pickupStrongThreshold),
      });
      setLastSyncAt((sync.data as { created_at?: string } | null)?.created_at ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, horizonDays]);

  useEffect(() => { void reload(); }, [reload]);

  // Physical inventory. Previo lists the same physical rooms twice (unit groups
  // AND rate-plan room types) plus non-room products, so summing every row
  // massively inflates the denominator and pushes occupancy down. Count only
  // sellable room types explicitly flagged as inventory, and let an admin
  // override win outright.
  const inventoryFromTypes = roomTypes
    .filter((r) => r.is_sellable !== false && r.counts_toward_inventory !== false)
    .reduce((s, r) => s + (r.num_rooms || 0), 0);
  const roomsAvailable = sellableOverride
    || inventoryFromTypes
    || (snapshots[0]?.rooms_available ?? 0);

  const metrics = buildDayMetrics({
    from: today,
    to: horizonEnd,
    nights,
    snapshots,
    cancellations,
    roomsAvailable,
    windowDays: pickupWindowDays,
  });

  return {
    loading, error, today, horizonEnd, roomTypes, roomsAvailable,
    nights, snapshots, rates, cancellations, metrics, lastSyncAt, reload,
  };
}
