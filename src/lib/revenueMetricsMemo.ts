import { useMemo } from "react";
import { buildDayMetrics, type BookingNight, type CancelledNight, type DailySnapshot, type PickupMovement, type RoomTypeRate } from "@/lib/revenueAnalytics";

/** Computes the full revenue matrix only when its actual data changes. */
export function useRevenueMetrics(params: {
  today: string;
  horizonEnd: string;
  nights: BookingNight[];
  snapshots: DailySnapshot[];
  cancellations: CancelledNight[];
  movements: PickupMovement[];
  rates: RoomTypeRate[];
  roomsAvailable: number;
  pickupWindowDays: number;
}) {
  const ratedDates = useMemo(() => new Set(params.rates.map((r) => r.stay_date)), [params.rates]);
  return useMemo(() => buildDayMetrics({
    from: params.today,
    to: params.horizonEnd,
    nights: params.nights,
    snapshots: params.snapshots,
    cancellations: params.cancellations,
    movements: params.movements,
    roomsAvailable: params.roomsAvailable,
    windowDays: params.pickupWindowDays,
    ratedDates,
  }), [params.today, params.horizonEnd, params.nights, params.snapshots, params.cancellations, params.movements, params.roomsAvailable, params.pickupWindowDays, ratedDates]);
}
