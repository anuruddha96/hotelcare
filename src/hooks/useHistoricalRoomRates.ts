import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { historyStart, historicalRateKey } from "@/lib/rateCalendarPresentation";
import { addDays } from "@/lib/revenueAnalytics";
import { historicalMonthDates } from "@/lib/rateCalendarWindow";

export interface HistoricalRate {
  stay_date: string;
  obk_id: string;
  occupancy: number;
  price: number;
  captured_at: string;
}

export interface HistoricalDayKpis {
  stay_date: string;
  rooms_sold: number;
  rooms_available: number;
  occupancy_pct: number | null;
  adr_eur: number | null;
  revpar_eur: number | null;
  captured_at: string;
}
export interface ArchivedRevenueEvent {
  title: string;
  impact: string;
  category?: string | null;
  venue?: string | null;
  url?: string | null;
  start?: string;
  end?: string;
}
interface HistoricalResponse {
  ratesByCell: Map<string, HistoricalRate>;
  kpisByDate: Map<string, HistoricalDayKpis>;
  eventsByDate: Map<string, ArchivedRevenueEvent[]>;
  loading: boolean;
  error: string | null;
  hasRecords: boolean;
}
interface ArchiveRow {
  stay_date: string;
  rooms_sold: number | null;
  rooms_available: number | null;
  occupancy_pct: number | null;
  adr_eur: number | null;
  revpar_eur: number | null;
  captured_at: string | null;
  rates: Array<{ obk_id: string; occupancy: number; price: number; captured_at: string }>;
  events: ArchivedRevenueEvent[];
}
const empty = () => ({
  ratesByCell: new Map<string, HistoricalRate>(),
  kpisByDate: new Map<string, HistoricalDayKpis>(),
  eventsByDate: new Map<string, ArchivedRevenueEvent[]>(),
  hasRecords: false,
});
function normalize(rows: ArchiveRow[]): Pick<HistoricalResponse, "ratesByCell" | "kpisByDate" | "eventsByDate" | "hasRecords"> {
  const out = empty();
  for (const day of rows) {
    if (day.rooms_sold != null && day.rooms_available != null) {
      out.kpisByDate.set(day.stay_date, {
        stay_date: day.stay_date, rooms_sold: Number(day.rooms_sold),
        rooms_available: Number(day.rooms_available),
        occupancy_pct: day.occupancy_pct == null ? null : Number(day.occupancy_pct),
        adr_eur: day.adr_eur == null ? null : Number(day.adr_eur),
        revpar_eur: day.revpar_eur == null ? null : Number(day.revpar_eur),
        captured_at: day.captured_at ?? "",
      });
    }
    for (const rate of Array.isArray(day.rates) ? day.rates : []) {
      if (!(Number(rate.price) > 0)) continue;
      const key = historicalRateKey(rate.obk_id, Number(rate.occupancy), day.stay_date);
      const prev = out.ratesByCell.get(key);
      if (!prev || rate.captured_at > prev.captured_at)
        out.ratesByCell.set(key, { ...rate, stay_date: day.stay_date, price: Number(rate.price) });
    }
    if (Array.isArray(day.events) && day.events.length)
      out.eventsByDate.set(day.stay_date, day.events);
  }
  out.hasRecords = rows.length > 0;
  return out;
}

/** One indexed read per explicitly requested historical month; default read is
 * only three days. Archive reads NEVER trigger Previo, pricing or data refresh.
 * A tiny in-memory LRU avoids extra requests when revisiting a saved month. */
export function useHistoricalRoomRates(
  hotelId: string | null | undefined, today: string, enabled: boolean, month: string | null = null,
): HistoricalResponse {
  const [data, setData] = useState<HistoricalResponse>(() => ({ ...empty(), loading: false, error: null }));
  const cache = useRef(new Map<string, ReturnType<typeof normalize>>());
  const dates = month ? historicalMonthDates(today, month) : [];
  const start = month ? (dates[0] ?? "") : historyStart(today);
  const end = month ? (dates.at(-1) ?? "") : addDays(today, -1);
  const key = enabled && hotelId && start && end ? `${hotelId}|${start}|${end}` : "";

  useEffect(() => {
    let cancelled = false;
    if (!key || !hotelId) {
      setData({ ...empty(), loading: false, error: null });
      return () => { cancelled = true; };
    }
    const saved = cache.current.get(key);
    if (saved) {
      setData({ ...saved, loading: false, error: null });
      return () => { cancelled = true; };
    }
    setData({ ...empty(), loading: true, error: null });
    void (async () => {
      try {
        const { data: rows, error } = await (supabase as any)
          .from("revenue_calendar_history_archive")
          .select("stay_date,rooms_sold,rooms_available,occupancy_pct,adr_eur,revpar_eur,captured_at,rates,events")
          .eq("hotel_id", hotelId)
          .gte("stay_date", start)
          .lte("stay_date", end)
          .order("stay_date", { ascending: true })
          .limit(31);
        if (error) throw error;
        const normalized = normalize((rows ?? []) as ArchiveRow[]);
        if (cancelled) return;
        cache.current.set(key, normalized);
        if (cache.current.size > 4) cache.current.delete(cache.current.keys().next().value!);
        setData({ ...normalized, loading: false, error: null });
      } catch (error) {
        if (!cancelled) setData({ ...empty(), loading: false,
          error: error instanceof Error ? error.message : "Could not load archived prices" });
      }
    })();
    return () => { cancelled = true; };
  }, [key, hotelId, start, end]);
  return data;
}
