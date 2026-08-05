import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  addDays,
  budapestToday,
  buildDayMetrics,
  type BookingNight,
  type DailySnapshot,
  type DayMetrics,
  type RoomTypeRate,
} from "@/lib/revenueAnalytics";

export interface RevenueRoomType {
  id: string;
  name: string;
  pms_room_id: string | null;
  num_rooms: number;
  is_reference: boolean;
  derivation_mode: string;
  derivation_value: number;
  sort_order: number;
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
  metrics: DayMetrics[];
  lastSyncAt: string | null;
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
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const today = budapestToday();
  const horizonEnd = addDays(today, horizonDays);

  const reload = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [rt, nightRows, snapRows, rateRows, sync] = await Promise.all([
        supabase.from("room_types")
          .select("id, name, pms_room_id, num_rooms, is_reference, derivation_mode, derivation_value, sort_order")
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
        supabase.from("pms_sync_history")
          .select("created_at").eq("hotel_id", hotelId).eq("sync_type", "revenue_sync")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      setRoomTypes((rt.data ?? []) as RevenueRoomType[]);
      setNights(nightRows);
      setSnapshots(snapRows);
      setRates(rateRows);
      setLastSyncAt((sync.data as { created_at?: string } | null)?.created_at ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, horizonDays]);

  useEffect(() => { void reload(); }, [reload]);

  // Physical inventory: prefer the PMS room counts stored on room_types.
  const roomsAvailable = roomTypes.reduce((s, r) => s + (r.num_rooms || 0), 0)
    || (snapshots[0]?.rooms_available ?? 0);

  const metrics = buildDayMetrics({
    from: today,
    to: horizonEnd,
    nights,
    snapshots,
    roomsAvailable,
    windowDays: pickupWindowDays,
  });

  return {
    loading, error, today, horizonEnd, roomTypes, roomsAvailable,
    nights, snapshots, rates, metrics, lastSyncAt, reload,
  };
}
