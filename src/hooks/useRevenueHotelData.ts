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
import { retryTransient } from "@/lib/transientRetry";
import { runWhenRevenueEditorsClosed } from "@/lib/revenueEditGuard";
import { EXECUTIVE_RESUME_EVENT } from "@/components/system/ExecutiveResumeRefresh";
import {
  readCachedRevenuePayload,
  readCachedRevenueRoomMetadata,
  writeCachedRevenuePayload,
  writeCachedRevenueRoomMetadata,
} from "@/lib/revenuePayloadCache";

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

/** The price a room type closed at, frozen when it first sold out. */
export interface SoldOutPrice {
  room_type_name: string;
  stay_date: string;
  occupancy: number;
  price: number;
  currency: string;
  captured_at: string;
}

interface PublishedRevenuePayload {
  roomTypes: RevenueRoomType[];
  nights: BookingNight[];
  snapshots: DailySnapshot[];
  rates: RoomTypeRate[];
  cancellations: CancelledNight[];
  movements: PickupMovement[];
  soldOutPrices: SoldOutPrice[];
  settings: Record<string, unknown>;
}

type CachedRevenuePayload = {
  payload: PublishedRevenuePayload;
  lastSyncAt: string | null;
  lastSyncBy: string | null;
};

/** Keep the last verified dataset available during transient reload failures. */
const revenuePayloadCache = new Map<string, CachedRevenuePayload>();

/**
 * First paint only needs the dates a manager can immediately act on. The rest
 * of the selected horizon is fetched after that first useful paint.
 */
const FIRST_WINDOW_DAYS = 45;

/** In-memory first (complete requested horizon), then the per-tab window. */
function readAnyCache(cacheKey: string): CachedRevenuePayload | undefined {
  const memory = revenuePayloadCache.get(cacheKey);
  if (memory) return memory;
  const stored = readCachedRevenuePayload<PublishedRevenuePayload>(cacheKey);
  if (!stored) return undefined;
  const restored: CachedRevenuePayload = {
    payload: stored.payload,
    lastSyncAt: stored.lastSyncAt,
    lastSyncBy: stored.lastSyncBy,
  };
  revenuePayloadCache.set(cacheKey, restored);
  return restored;
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
  /** Frozen closing prices for room type / date combinations that sold out. */
  soldOutPrices: SoldOutPrice[];
  metrics: DayMetrics[];
  lastSyncAt: string | null;
  /** Who triggered the last revenue sync (null = automatic / unknown). */
  lastSyncBy: string | null;
  thresholds: RevenueThresholds;
  /** True while later dates of the requested horizon are still being fetched. */
  extending: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads every Revenue Management input for ONE hotel.
 * `pickupWindowDays` controls how far back "pickup" looks.
 */
export function useRevenueHotelData(
  hotelId: string | null,
  organizationSlug: string | null,
  horizonDays = 365,
  pickupWindowDays = 1,
): RevenueHotelData {
  const [loading, setLoading] = useState(true);
  const [extending, setExtending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheKey = hotelId && organizationSlug ? `${organizationSlug}:${hotelId}` : null;
  const initialCache = cacheKey ? readAnyCache(cacheKey) : undefined;
  const initialRoomMetadata = cacheKey
    ? readCachedRevenueRoomMetadata<RevenueRoomType[]>(cacheKey) ?? []
    : [];
  const [payload, setPayload] = useState<PublishedRevenuePayload | null>(initialCache?.payload ?? null);
  const [roomMetadata, setRoomMetadata] = useState<RevenueRoomType[]>(
    initialCache?.payload.roomTypes?.length ? initialCache.payload.roomTypes : initialRoomMetadata,
  );
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(initialCache?.lastSyncAt ?? null);
  const [lastSyncBy, setLastSyncBy] = useState<string | null>(initialCache?.lastSyncBy ?? null);
  const payloadRef = useRef<PublishedRevenuePayload | null>(initialCache?.payload ?? null);
  const requestVersionRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const today = budapestToday();
  const horizonEnd = addDays(today, horizonDays);

  const runLoad = useCallback(async () => {
    if (!hotelId || !organizationSlug || !cacheKey) { setLoading(false); return; }
    if (inFlightRef.current) return inFlightRef.current;
    const requestVersion = ++requestVersionRef.current;

    const fetchStage = async (windowDays: number) => {
      const { data } = await retryTransient(async () => {
        const result = await (supabase as any).rpc("get_revenue_published_payload_window", {
          _hotel_id: hotelId,
          _horizon_days: Math.max(1, Math.min(365, Math.ceil(windowDays))),
        });
        if (result.error) throw result.error;
        return result;
      }, { attempts: 3, baseDelayMs: 500, maxDelayMs: 1800, timeoutMs: 30000 });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.payload) throw new Error("No completed Revenue dataset is available yet");
      return row;
    };

    const apply = (row: any, cacheFirstWindow: boolean) => {
      const next = row.payload as PublishedRevenuePayload;
      const normalisedRoomTypes = (next.roomTypes ?? []).map((room) => ({
        ...room,
        name_translations: room.name_translations ?? {},
      }));
      const completedPayload: PublishedRevenuePayload = {
        ...next,
        roomTypes: normalisedRoomTypes,
        nights: next.nights ?? [],
        snapshots: next.snapshots ?? [],
        rates: next.rates ?? [],
        cancellations: next.cancellations ?? [],
        movements: next.movements ?? [],
        soldOutPrices: next.soldOutPrices ?? [],
        settings: next.settings ?? {},
      };
      const nextSyncAt = row.sync_completed_at ?? null;
      const nextSyncBy = row.sync_completed_by_name ?? null;
      payloadRef.current = completedPayload;
      setPayload(completedPayload);
      if (normalisedRoomTypes.length > 0) {
        setRoomMetadata(normalisedRoomTypes);
        writeCachedRevenueRoomMetadata(cacheKey, normalisedRoomTypes);
      }
      setLastSyncAt(nextSyncAt);
      setLastSyncBy(nextSyncBy);
      revenuePayloadCache.set(cacheKey, {
        payload: completedPayload,
        lastSyncAt: nextSyncAt,
        lastSyncBy: nextSyncBy,
      });
      if (cacheFirstWindow) {
        writeCachedRevenuePayload<PublishedRevenuePayload>(cacheKey, {
          payload: completedPayload,
          lastSyncAt: nextSyncAt,
          lastSyncBy: nextSyncBy,
        });
      }
    };

    const request = (async () => {
      const hadData = !!payloadRef.current;
      if (!hadData) setLoading(true);
      setError(null);
      const wantsWindow = !hadData && horizonDays > FIRST_WINDOW_DAYS;
      try {
        if (wantsWindow) {
          const first = await fetchStage(FIRST_WINDOW_DAYS);
          if (requestVersion !== requestVersionRef.current) return;
          apply(first, true);
          setLoading(false);
          setExtending(true);
        }

        if (!wantsWindow || horizonDays > FIRST_WINDOW_DAYS) {
          const requested = await fetchStage(horizonDays);
          if (requestVersion !== requestVersionRef.current) return;
          apply(requested, !wantsWindow);
        }
      } catch (e) {
        if (requestVersion !== requestVersionRef.current) return;
        if (!payloadRef.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (requestVersion === requestVersionRef.current) {
          setLoading(false);
          setExtending(false);
        }
      }
    })();
    inFlightRef.current = request;
    try { await request; } finally {
      if (inFlightRef.current === request) inFlightRef.current = null;
    }
  }, [hotelId, organizationSlug, cacheKey, horizonDays]);

  /** Re-read the currently requested horizon: used after a sync or price push. */
  const reload = useCallback(async () => { await runLoad(); }, [runLoad]);

  useEffect(() => {
    requestVersionRef.current += 1;
    inFlightRef.current = null;
    const cached = cacheKey ? readAnyCache(cacheKey) : undefined;
    const cachedMeta = cacheKey ? readCachedRevenueRoomMetadata<RevenueRoomType[]>(cacheKey) ?? [] : [];
    payloadRef.current = cached?.payload ?? null;
    setPayload(cached?.payload ?? null);
    setRoomMetadata(cached?.payload.roomTypes?.length ? cached.payload.roomTypes : cachedMeta);
    setLastSyncAt(cached?.lastSyncAt ?? null);
    setLastSyncBy(cached?.lastSyncBy ?? null);
    setError(null);
  }, [cacheKey]);

  useEffect(() => {
    void runLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runLoad]);

  useEffect(() => {
    if (!hotelId) return;
    const onResume = () => {
      runWhenRevenueEditorsClosed(() => { void runLoad(); });
    };
    window.addEventListener(EXECUTIVE_RESUME_EVENT, onResume);
    return () => window.removeEventListener(EXECUTIVE_RESUME_EVENT, onResume);
  }, [hotelId, runLoad]);

  // Local room metadata is intentionally NOT exposed as a half-built calendar.
  // It remains cached so the next verified payload can be normalised quickly,
  // but the page shows its stable skeleton until room types and their real rate
  // rows arrive together. This prevents the confusing first paint where the
  // date table was visible and the room/guest structure appeared afterwards.
  const roomTypes = payload?.roomTypes?.length ? payload.roomTypes : [];
  const nights = useMemo(() => (payload?.nights ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const snapshots = useMemo(() => (payload?.snapshots ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const rates = useMemo(() => (payload?.rates ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const cancellations = useMemo(() => (payload?.cancellations ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const movements = useMemo(() => (payload?.movements ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
  const soldOutPrices = useMemo(() => (payload?.soldOutPrices ?? []).filter((row) => row.stay_date <= horizonEnd), [payload, horizonEnd]);
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
  const snapshotRooms = snapshots[0]?.rooms_available ?? 0;
  const typesLookInflated = snapshotRooms > 0 && inventoryFromTypes > snapshotRooms * 1.2;
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
    nights, snapshots, rates, cancellations, soldOutPrices, metrics, lastSyncAt, lastSyncBy, thresholds, reload,
    extending,
  };
}
