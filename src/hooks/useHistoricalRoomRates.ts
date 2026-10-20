import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { historyStart, historicalRateKey } from "@/lib/rateCalendarPresentation";

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

interface HistoricalResponse {
  ratesByCell: Map<string, HistoricalRate>;
  kpisByDate: Map<string, HistoricalDayKpis>;
  loading: boolean;
  error: string | null;
}

/**
 * On-demand read of saved Previo prices for the three nights before "today".
 * The normal published payload begins today, so NEVER use it to fill these
 * cells. A missing/unsaved historical price remains empty.
 *
 * This is deliberately read-only. No Previo refresh, rate publish, database
 * writes, or additional requests happen until the user reveals history.
 */
export function useHistoricalRoomRates(hotelId: string | null | undefined, today: string, enabled: boolean): HistoricalResponse {
  const [ratesByCell, setRatesByCell] = useState<Map<string, HistoricalRate>>(() => new Map());
  const [kpisByDate, setKpisByDate] = useState<Map<string, HistoricalDayKpis>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    if (!enabled || !hotelId) {
      setRatesByCell(new Map());
      setKpisByDate(new Map());
      setError(null);
      setLoading(false);
      return () => { canceled = true; };
    }

    setLoading(true);
    setError(null);
    setRatesByCell(new Map());
    setKpisByDate(new Map());
    const start = historyStart(today);
    const end = historyStart(today) === today ? today : new Date(Date.parse(today + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);

    void (async () => {
      try {
        const collected: HistoricalRate[] = [];
        // PostgREST pages at 1,000 by default. Three dates are normally a few
        // dozen cells, but paginate to avoid silently dropping larger hotels.
        for (let offset = 0; ; offset += 500) {
          const { data, error: readError } = await supabase
            .from("revenue_room_type_rates")
            .select("stay_date,obk_id,occupancy,price,captured_at")
            .eq("hotel_id", hotelId)
            .eq("source", "previo")
            .gte("stay_date", start)
            .lte("stay_date", end)
            .order("stay_date", { ascending: true })
            .order("obk_id", { ascending: true })
            .order("occupancy", { ascending: true })
            .range(offset, offset + 499);
          if (readError) throw readError;
          collected.push(...((data ?? []) as HistoricalRate[]));
          if (!data || data.length < 500) break;
        }

        const map = new Map<string, HistoricalRate>();
        for (const rate of collected) {
          if (!(Number(rate.price) > 0) || rate.stay_date < start || rate.stay_date > end) continue;
          // Historical cells show the last saved Previo rate for this stay night,
          // not a newly calculated rate, draft or a rate for another date.
          const key = historicalRateKey(rate.obk_id, rate.occupancy, rate.stay_date);
          const previous = map.get(key);
          if (!previous || rate.captured_at > previous.captured_at) map.set(key, rate);
        }

        // Daily historical KPIs already have their own non-PII snapshot table.
        // Show only a same-day observation, never today's recalculated metrics.
        const { data: daily, error: kpiError } = await supabase
          .from("revenue_historical_daily")
          .select("stay_date,observed_date,rooms_sold,rooms_available,occupancy_pct,adr_eur,revpar_eur,captured_at")
          .eq("hotel_id", hotelId)
          .gte("stay_date", start)
          .lte("stay_date", end)
          .gte("observed_date", start)
          .lte("observed_date", end)
          .order("captured_at", { ascending: false })
          .limit(500);
        const kpis = new Map<string, HistoricalDayKpis>();
        if (!kpiError) {
          for (const row of daily ?? []) {
            if (row.observed_date !== row.stay_date || kpis.has(row.stay_date)) continue;
            kpis.set(row.stay_date, row);
          }
        }
        if (!canceled) {
          setRatesByCell(map);
          setKpisByDate(kpis);
        }
      } catch (e) {
        if (!canceled) setError(e instanceof Error ? e.message : "Could not load historical prices");
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => { canceled = true; };
  }, [hotelId, today, enabled]);

  return { ratesByCell, kpisByDate, loading, error };
}
