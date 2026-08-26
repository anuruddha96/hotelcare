// Competitive-set data for the market intelligence chart.
//
// One hook loads the watched hotels, their captured nightly prices and the
// server-side market aggregate (trimmed average, median, cheapest, dearest and
// freshness per night). It is used by the merged horizon chart and by the
// compset management drawer, so both always read the same numbers.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** The generated Supabase types lag behind new tables and RPCs. */
const db = supabase as unknown as {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export interface CompetitorProperty {
  id: string;
  name: string;
  source_url: string | null;
  active: boolean;
  last_scan_at: string | null;
  last_scan_status: string | null;
  last_scan_error: string | null;
  last_scan_prices: number | null;
}

export interface CompetitorRateRow {
  competitor_id: string;
  stay_date: string;
  rate: number | null;
  currency: string | null;
  room_type: string | null;
  board: string | null;
  refundable: boolean | null;
  source_page_url: string | null;
  confidence: number | null;
  captured_at: string | null;
}

export interface MarketDay {
  stay_date: string;
  sample_size: number;
  avg_rate: number | null;
  trimmed_avg_rate: number | null;
  median_rate: number | null;
  min_rate: number | null;
  max_rate: number | null;
  freshest_at: string | null;
  stale: boolean;
}

export interface MarketRatesResult {
  competitors: CompetitorProperty[];
  /** competitor id -> stay date -> price */
  ratesByCompetitor: Map<string, Map<string, number>>;
  /** competitor id -> average reliability (0-1) of its plotted prices */
  reliabilityByCompetitor: Map<string, number>;
  /** stay date -> market aggregate */
  marketByDate: Map<string, MarketDay>;
  rows: CompetitorRateRow[];
  loading: boolean;
  reload: () => void;
}

const HORIZON_DAYS = 200;

/** Reconciled prices below this score are treated as unreliable and hidden. */
export const MIN_CONFIDENCE = 0.45;

export function useMarketRates(hotelId: string | null): MarketRatesResult {
  const [competitors, setCompetitors] = useState<CompetitorProperty[]>([]);
  const [rows, setRows] = useState<CompetitorRateRow[]>([]);
  const [market, setMarket] = useState<MarketDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!hotelId) { setCompetitors([]); setRows([]); setMarket([]); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
      const [comps, rates, agg] = await Promise.all([
        db.from("competitor_properties")
          .select("id, name, source_url, active, last_scan_at, last_scan_status, last_scan_error, last_scan_prices")
          .eq("hotel_id", hotelId).order("name"),
        db.from("competitor_rates")
          .select("competitor_id, stay_date, rate, currency, room_type, board, refundable, source_page_url, confidence, captured_at")
          .eq("hotel_id", hotelId).gte("stay_date", from).lte("stay_date", to).order("stay_date"),
        db.rpc("market_rates_by_date", { _hotel_id: hotelId, _from: from, _to: to }),
      ]);
      if (cancelled) return;
      setCompetitors((comps?.data ?? []) as CompetitorProperty[]);
      setRows((rates?.data ?? []) as CompetitorRateRow[]);
      setMarket(((agg?.data ?? []) as MarketDay[]).map((m) => ({
        ...m,
        stay_date: String(m.stay_date).slice(0, 10),
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [hotelId, nonce]);

  // Only reconciled prices the scanner is reasonably sure about are plotted:
  // a low-confidence quote (one lonely observation, wide disagreement between
  // scrapes, or a stale reading) would make the comp-set look precise when it
  // is not, so it is held back rather than drawn.
  const ratesByCompetitor = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (r.rate == null) continue;
      if (r.confidence != null && Number(r.confidence) < MIN_CONFIDENCE) continue;
      const m = map.get(r.competitor_id) ?? new Map<string, number>();
      m.set(String(r.stay_date).slice(0, 10), Math.round(Number(r.rate)));
      map.set(r.competitor_id, m);
    }
    return map;
  }, [rows]);

  const reliabilityByCompetitor = useMemo(() => {
    const totals = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      if (r.rate == null) continue;
      const conf = r.confidence == null ? 0.6 : Number(r.confidence);
      if (conf < MIN_CONFIDENCE) continue;
      const t = totals.get(r.competitor_id) ?? { sum: 0, n: 0 };
      t.sum += conf; t.n += 1;
      totals.set(r.competitor_id, t);
    }
    const map = new Map<string, number>();
    for (const [id, t] of totals) map.set(id, t.n ? t.sum / t.n : 0);
    return map;
  }, [rows]);

  const marketByDate = useMemo(() => {
    const map = new Map<string, MarketDay>();
    for (const m of market) map.set(m.stay_date, m);
    return map;
  }, [market]);

  return { competitors, ratesByCompetitor, reliabilityByCompetitor, marketByDate, rows, loading, reload };
}

/** How many prices a competitor currently holds in the loaded horizon. */
export function priceCount(ratesByCompetitor: Map<string, Map<string, number>>, id: string) {
  return ratesByCompetitor.get(id)?.size ?? 0;
}
