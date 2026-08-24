import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface PublishedRevenuePayload {
  roomTypes: RevenueRoomType[];
  nights: BookingNight[];
  snapshots: DailySnapshot[];
  rates: RoomTypeRate[];
  cancellations: CancelledNight[];
  movements: PickupMovement[];
  settings: Record<string, unknown>;
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
  /** True while later dates of the horizon are still being fetched. */
  extending: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads every Revenue Management input for ONE hotel.
 * `pickupWindowDays` controls how far back "pickup" looks.
 */
export function useRevenueHotelData(
  hotelId: string | null,
  horizonDays = 365,
  pickupWindowDays = 1,
): RevenueHotelData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<PublishedRevenuePayload | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncBy, setLastSyncBy] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const today = budapestToday();
  const horizonEnd = addDays(today, horizonDays);

  const runLoad = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    if (inFlightRef.current) return inFlightRef.current;
    const requestVersion = ++requestVersionRef.current;
    const request = (async () => {
    if (!payload) setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await (supabase as any).rpc("get_revenue_published_payload", {
        _hotel_id: hotelId,
      });
      if (rpcError) throw rpcError;
      if (requestVersion !== requestVersionRef.current) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.payload) throw new Error("No completed Revenue dataset is available yet");
      const next = row.payload as PublishedRevenuePayload;
      setPayload({
        ...next,
        roomTypes: (next.roomTypes ?? []).map((room) => ({
          ...room,
          name_translations: room.name_translations ?? {},
        })),
        nights: next.nights ?? [],
        snapshots: next.snapshots ?? [],
        rates: next.rates ?? [],
        cancellations: next.cancellations ?? [],
        movements: next.movements ?? [],
        settings: next.settings ?? {},
      });
      setLastSyncAt(row.sync_completed_at ?? null);
      setLastSyncBy(row.sync_completed_by_name ?? null);
    } catch (e) {
      if (requestVersion !== requestVersionRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false);
    }
    })();
    inFlightRef.current = request;
    try { await request; } finally {
      if (inFlightRef.current === request) inFlightRef.current = null;
    }
  }, [hotelId, payload]);

  /** A full re-read: used after a sync or a price push. */
  const reload = useCallback(async () => { await runLoad(); }, [runLoad]);

  useEffect(() => {
    // Only a property switch invalidates what is on screen. Growing the horizon
    // must keep the current calendar mounted (no blocking spinner).
    requestVersionRef.current += 1;
    inFlightRef.current = null;
    setPayload(null);
  }, [hotelId]);


  useEffect(() => {
    void runLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runLoad]);

  // Physical inventory. Previo lists the same physical rooms twice (unit groups
  // AND rate-plan room types) plus non-room products, so summing every row
  // massively inflates the denominator and pushes occupancy down. Count only
  // sellable room types explicitly flagged as inventory, and let an admin
  // override win outright.
  const roomTypes = payload?.roomTypes ?? [];
  const nights = useMemo(() => (payload?.nights ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const snapshots = useMemo(() => (payload?.snapshots ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const rates = useMemo(() => (payload?.rates ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const cancellations = useMemo(() => (payload?.cancellations ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const movements = useMemo(() => (payload?.movements ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const settings = payload?.settings ?? {};
  const sellableOverride = (settings.sellable_rooms as number | null) ?? null;
  const baseCur = String(settings.base_currency ?? "EUR").toUpperCase();
  const eurRate = Number(settings.eur_conversion_rate) || 0;
  const scale = baseCur !== "EUR" && eurRate > 0 ? eurRate : 1;
  const thresholds: RevenueThresholds = {
    rateWarnBelowEur: Number(settings.rate_warn_below_eur ?? DEFAULT_THRESHOLDS.rateWarnBelowEur) * scale,
    rateCriticalBelowEur: Number(settings.rate_critical_below_eur ?? DEFAULT_THRESHOLDS.rateCriticalBelowEur) * scale,
    rateMaxSaneEur: Number(settings.rate_max_sane_eur ?? DEFAULT_THRESHOLDS.rateMaxSaneEur) * scale,
    occupancyLowPct: Number(settings.occupancy_low_pct ?? DEFAULT_THRESHOLDS.occupancyLowPct),
    occupancyHighPct: Number(settings.occupancy_high_pct ?? DEFAULT_THRESHOLDS.occupancyHighPct),
    pickupStrongThreshold: Number(settings.pickup_strong_threshold ?? DEFAULT_THRESHOLDS.pickupStrongThreshold),
  };

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

  const ratedDates = new Set(rates.map((r) => r.stay_date));

  const metrics = buildDayMetrics({
    from: today,
    to: horizonEnd,
    nights,
    snapshots,
    cancellations,
    movements,
    roomsAvailable,
    windowDays: pickupWindowDays,
    ratedDates,
  });

  return {
    loading, error, today, horizonEnd, roomTypes, roomsAvailable,
    nights, snapshots, rates, cancellations, metrics, lastSyncAt, lastSyncBy, thresholds, reload,
    extending: false,
  };
}
