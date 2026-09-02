// Competitive-set data for the market intelligence chart.
// Keeps the last good result visible while a fresh scan is loaded so the
// revenue screen never collapses to an empty chart during navigation/refresh.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as unknown as {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export interface CompetitorProperty {
  id: string; name: string; source_url: string | null; active: boolean;
  last_scan_at: string | null; last_scan_status: string | null;
  last_scan_error: string | null; last_scan_prices: number | null;
}
export interface CompetitorRateRow {
  competitor_id: string; stay_date: string; rate: number | null; currency: string | null;
  room_type: string | null; board: string | null; refundable: boolean | null;
  source_page_url: string | null; confidence: number | null; captured_at: string | null;
}
export interface MarketDay {
  stay_date: string; sample_size: number; avg_rate: number | null;
  trimmed_avg_rate: number | null; median_rate: number | null;
  min_rate: number | null; max_rate: number | null; freshest_at: string | null; stale: boolean;
}
export interface MarketRatesResult {
  competitors: CompetitorProperty[];
  ratesByCompetitor: Map<string, Map<string, number>>;
  reliabilityByCompetitor: Map<string, number>;
  coverageByCompetitor: Map<string, string>;
  coverageEnd: string | null;
  marketByDate: Map<string, MarketDay>;
  rows: CompetitorRateRow[];
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
}

type CachedMarket = { competitors: CompetitorProperty[]; rows: CompetitorRateRow[]; market: MarketDay[]; savedAt: number };
const HORIZON_DAYS = 200;
const CACHE_TTL_MS = 5 * 60_000;
const memoryCache = new Map<string, CachedMarket>();
export const MIN_CONFIDENCE = 0.45;

function readSessionCache(hotelId: string): CachedMarket | null {
  const inMemory = memoryCache.get(hotelId);
  if (inMemory) return inMemory;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`market-intelligence:${hotelId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMarket;
    memoryCache.set(hotelId, parsed);
    return parsed;
  } catch { return null; }
}
function writeCache(hotelId: string, value: CachedMarket) {
  memoryCache.set(hotelId, value);
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(`market-intelligence:${hotelId}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function useMarketRates(hotelId: string | null): MarketRatesResult {
  const initial = hotelId ? readSessionCache(hotelId) : null;
  const [competitors, setCompetitors] = useState<CompetitorProperty[]>(initial?.competitors ?? []);
  const [rows, setRows] = useState<CompetitorRateRow[]>(initial?.rows ?? []);
  const [market, setMarket] = useState<MarketDay[]>(initial?.market ?? []);
  const [loading, setLoading] = useState(!initial && !!hotelId);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!hotelId) { setCompetitors([]); setRows([]); setMarket([]); setLoading(false); setRefreshing(false); return; }
    const cached = readSessionCache(hotelId);
    if (cached) { setCompetitors(cached.competitors); setRows(cached.rows); setMarket(cached.market); setLoading(false); }
    else { setLoading(true); }
    const freshEnough = cached && Date.now() - cached.savedAt < CACHE_TTL_MS && nonce === 0;
    if (freshEnough) return;

    let cancelled = false;
    setRefreshing(!!cached);
    void (async () => {
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
      const [comps, rates, agg] = await Promise.all([
        db.from("competitor_properties").select("id, name, source_url, active, last_scan_at, last_scan_status, last_scan_error, last_scan_prices").eq("hotel_id", hotelId).order("name"),
        db.from("competitor_rates").select("competitor_id, stay_date, rate, currency, room_type, board, refundable, source_page_url, confidence, captured_at").eq("hotel_id", hotelId).gte("stay_date", from).lte("stay_date", to).order("stay_date"),
        db.rpc("market_rates_by_date", { _hotel_id: hotelId, _from: from, _to: to }),
      ]);
      if (cancelled) return;
      const nextCompetitors = (comps?.data ?? []) as CompetitorProperty[];
      const nextRows = (rates?.data ?? []) as CompetitorRateRow[];
      const nextMarket = ((agg?.data ?? []) as MarketDay[]).map((m) => ({ ...m, stay_date: String(m.stay_date).slice(0, 10) }));
      // Do not replace a useful cached chart with an accidental empty response.
      if (nextCompetitors.length || nextRows.length || nextMarket.length || !cached) {
        setCompetitors(nextCompetitors); setRows(nextRows); setMarket(nextMarket);
        writeCache(hotelId, { competitors: nextCompetitors, rows: nextRows, market: nextMarket, savedAt: Date.now() });
      }
      setLoading(false); setRefreshing(false);
    })();
    return () => { cancelled = true; };
  }, [hotelId, nonce]);

  const ratesByCompetitor = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (r.rate == null || (r.confidence != null && Number(r.confidence) < MIN_CONFIDENCE)) continue;
      const m = map.get(r.competitor_id) ?? new Map<string, number>();
      m.set(String(r.stay_date).slice(0, 10), Math.round(Number(r.rate))); map.set(r.competitor_id, m);
    }
    return map;
  }, [rows]);
  const reliabilityByCompetitor = useMemo(() => {
    const totals = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      if (r.rate == null) continue; const conf = r.confidence == null ? 0.6 : Number(r.confidence); if (conf < MIN_CONFIDENCE) continue;
      const t = totals.get(r.competitor_id) ?? { sum: 0, n: 0 }; t.sum += conf; t.n += 1; totals.set(r.competitor_id, t);
    }
    const map = new Map<string, number>(); for (const [id, t] of totals) map.set(id, t.n ? t.sum / t.n : 0); return map;
  }, [rows]);
  const marketByDate = useMemo(() => { const map = new Map<string, MarketDay>(); for (const m of market) map.set(m.stay_date, m); return map; }, [market]);
  const coverageByCompetitor = useMemo(() => {
    const map = new Map<string, string>(); for (const [id, byDate] of ratesByCompetitor) { let last = ""; for (const date of byDate.keys()) if (date > last) last = date; if (last) map.set(id, last); } return map;
  }, [ratesByCompetitor]);
  const coverageEnd = useMemo(() => {
    let last = ""; for (const d of coverageByCompetitor.values()) if (d > last) last = d;
    for (const [date, m] of marketByDate) if (m.sample_size > 0 && date > last) last = date; return last || null;
  }, [coverageByCompetitor, marketByDate]);

  return { competitors, ratesByCompetitor, reliabilityByCompetitor, coverageByCompetitor, coverageEnd, marketByDate, rows, loading, refreshing, reload };
}

export function priceCount(ratesByCompetitor: Map<string, Map<string, number>>, id: string) { return ratesByCompetitor.get(id)?.size ?? 0; }
