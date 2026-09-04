import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, BedDouble, Download, Percent, SlidersHorizontal, TrendingUp } from "lucide-react";
import type { DayMetrics } from "@/lib/revenueAnalytics";
import { budapestToday, daysBetween, pickupWindowLabel, PICKUP_WINDOW_48H } from "@/lib/revenueAnalytics";
import { money, currencySymbol } from "@/lib/revenueCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useMarketRates } from "@/hooks/useMarketRates";
import { usePortfolioSnapshots, type PortfolioSnapshot } from "@/hooks/usePortfolioSnapshots";

const PICKUP_COLOR = "hsl(28 96% 60%)";
const CANCEL_COLOR = "hsl(199 89% 60%)";
const OCC_COLOR = "hsl(221 83% 45%)";
const ADR_COLOR = "hsl(160 84% 39%)";
const DEMAND_COLOR = "hsl(271 76% 53%)";
const OUR_RATE_COLOR = "hsl(330 78% 48%)";
const MARKET_COLOR = "hsl(var(--foreground) / 0.82)";
const MARKET_MEDIAN_COLOR = "hsl(var(--muted-foreground))";

const HOTEL_COLORS: Record<string, string> = {
  "mika-downtown": "#111111",
  "memories-budapest": "#A16207",
  ottofiori: "#0F766E",
  "gozsdu-court": "#B91C1C",
};
const FALLBACK = ["#6D28D9", "#B45309", "#065F46", "#9D174D"];
const colorFor = (id: string, i: number) => HOTEL_COLORS[id] ?? FALLBACK[i % FALLBACK.length];

const MOBILE_RANGES = [
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 60, label: "60d" },
];
const DESKTOP_RANGES = [
  ...MOBILE_RANGES,
  { value: 90, label: "90d" },
  { value: 180, label: "6m" },
];

type PeriodKey = "auto48" | "today" | "yesterday" | "week" | "month" | "custom";
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "auto48", label: "Last 48 hours (automation)" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday + today" },
  { key: "week", label: "This week (Mon–Sun)" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom…" },
];

function windowForPeriod(key: PeriodKey, customDays: number): number {
  const today = budapestToday();
  const d = new Date(`${today}T00:00:00Z`);
  switch (key) {
    case "auto48": return PICKUP_WINDOW_48H;
    case "today": return 1;
    case "yesterday": return 2;
    case "week": return ((d.getUTCDay() + 6) % 7) + 1;
    case "month": return daysBetween(`${today.slice(0, 7)}-01`, today) + 1;
    default: return Math.max(1, customDays);
  }
}

function periodForWindow(windowDays: number, customDays: number): PeriodKey {
  for (const p of PERIODS) {
    if (p.key === "custom") continue;
    if (windowForPeriod(p.key, customDays) === windowDays) return p.key;
  }
  return "custom";
}

function shortDate(date: string | null): string {
  if (!date) return "—";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

function eurMoney(value: number | null): string {
  return value == null ? "—" : `€${Math.round(value).toLocaleString()}`;
}

function barColor(gained: number): string {
  if (gained >= 4) return "hsl(0 72% 45%)";
  if (gained === 3) return "hsl(0 84% 60%)";
  if (gained === 2) return "hsl(28 96% 60%)";
  if (gained === 1) return "hsl(33 100% 75%)";
  return "hsl(var(--muted-foreground) / 0.22)";
}

interface HotelRef {
  hotel_id: string;
  hotel_name: string;
}

interface Props {
  metrics: DayMetrics[];
  pickupWindowDays?: number;
  onPickupWindowChange?: (days: number) => void;
  hotels?: HotelRef[];
  hotelId?: string | null;
  selectedMonth: string;
  eventsByDate?: Map<string, { title: string; impact: string }[]>;
  ourRateByDate?: Map<string, number>;
}

type PrimaryMetric = "occ" | "adr" | "demand";

interface MarketPrefs {
  ourRate: boolean;
  marketAvg: boolean;
  marketMedian: boolean;
  band: boolean;
  competitors: string[];
}

const DEFAULT_PREFS: MarketPrefs = {
  ourRate: true,
  marketAvg: true,
  marketMedian: false,
  band: false,
  competitors: [],
};

const prefsKey = (hotelId?: string | null) => `market-intel-v2:${hotelId ?? "default"}`;

function loadPrefs(hotelId?: string | null): MarketPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(prefsKey(hotelId));
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<MarketPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

interface ChartPoint {
  date: string;
  label: string;
  gained: number;
  lost: number;
  pickup: number;
  occ: number;
  adr: number | null;
  demand: number | null;
  demandForecast: number | null;
  roomsLeft: number;
  ourRate: number | null;
  marketAvg: number | null;
  marketMedian: number | null;
  bandLow: number | null;
  bandSpan: number | null;
  marketMin: number | null;
  marketMax: number | null;
  marketSample: number;
  eventTitles: string[];
  [key: string]: unknown;
}

function competitorColor(index: number): string {
  const hues = [12, 52, 105, 185, 245, 305, 25, 140];
  return `hsl(${hues[index % hues.length]} 68% ${index % 2 ? 38 : 50}%)`;
}

function SummaryTile({ icon, label, value, detail }: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function EventLines({ data, yAxisId }: { data: ChartPoint[]; yAxisId: string }) {
  return (
    <>
      {data.filter((d) => d.eventTitles.length > 0).map((d) => (
        <ReferenceLine
          key={`event-${d.date}`}
          yAxisId={yAxisId}
          x={d.label}
          stroke="hsl(271 76% 53% / 0.4)"
          strokeWidth={1.25}
          strokeDasharray="2 3"
        />
      ))}
    </>
  );
}

function DemandTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as ChartPoint | undefined;
  if (!p) return null;
  return (
    <div className="max-w-[260px] rounded-lg border bg-popover p-3 text-xs shadow-xl">
      <p className="font-semibold">{p.label}</p>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
        <span className="text-muted-foreground">Booked</span><strong>+{p.gained}</strong>
        <span className="text-muted-foreground">Cancelled</span><strong>{p.lost ? `−${Math.abs(p.lost)}` : "0"}</strong>
        <span className="text-muted-foreground">Net pickup</span><strong>{p.pickup > 0 ? "+" : ""}{p.pickup}</strong>
        <span className="text-muted-foreground">Occupancy</span><strong>{p.occ}%</strong>
        <span className="text-muted-foreground">Rooms left</span><strong>{p.roomsLeft}</strong>
        {p.adr != null && <><span className="text-muted-foreground">ADR</span><strong>{money(p.adr)}</strong></>}
        {p.demand != null && <><span className="text-muted-foreground">City demand</span><strong>{p.demand}%</strong></>}
      </div>
      {p.eventTitles.length > 0 && (
        <div className="mt-2 border-t pt-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Events</p>
          {p.eventTitles.slice(0, 3).map((e) => (
            <p key={e} className="mt-0.5 text-[11px] text-purple-700 dark:text-purple-300">{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function RateTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as ChartPoint | undefined;
  if (!p) return null;
  const premium = p.ourRate != null && p.marketAvg != null && p.marketAvg !== 0
    ? Math.round(((p.ourRate - p.marketAvg) / p.marketAvg) * 100)
    : null;
  return (
    <div className="max-w-[270px] rounded-lg border bg-popover p-3 text-xs shadow-xl">
      <p className="font-semibold">{p.label}</p>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
        <span className="text-muted-foreground">Our rate</span><strong>{p.ourRate == null ? "—" : money(p.ourRate)}</strong>
        <span className="text-muted-foreground">Market average</span><strong>{p.marketAvg == null ? "—" : money(p.marketAvg)}</strong>
        {premium != null && <><span className="text-muted-foreground">Position</span><strong>{premium === 0 ? "At market" : `${Math.abs(premium)}% ${premium > 0 ? "above" : "below"}`}</strong></>}
        {p.marketMin != null && p.marketMax != null && <><span className="text-muted-foreground">Market range</span><strong>{money(p.marketMin)}–{money(p.marketMax)}</strong></>}
        <span className="text-muted-foreground">Occupancy</span><strong>{p.occ}%</strong>
        <span className="text-muted-foreground">Rooms left</span><strong>{p.roomsLeft}</strong>
      </div>
      {p.eventTitles.length > 0 && (
        <p className="mt-2 border-t pt-2 text-[11px] text-purple-700 dark:text-purple-300">{p.eventTitles.slice(0, 2).join(" · ")}</p>
      )}
    </div>
  );
}

export default function MarketIntelligenceChart({
  metrics,
  pickupWindowDays,
  onPickupWindowChange,
  hotels = [],
  hotelId,
  selectedMonth,
  eventsByDate,
  ourRateByDate,
}: Props) {
  const isMobile = useIsMobile();
  const [days, setDays] = useState(() => typeof window !== "undefined" && window.innerWidth < 768 ? 14 : 60);
  const [primaryMetric, setPrimaryMetric] = useState<PrimaryMetric>("occ");
  const [compare, setCompare] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const [showEvents, setShowEvents] = useState(true);
  const [customDays, setCustomDays] = useState(7);
  const [baseline, setBaseline] = useState("__ours__");
  const [eurRateByHotel, setEurRateByHotel] = useState<Map<string, number>>(new Map());
  const [prefs, setPrefs] = useState<MarketPrefs>(() => loadPrefs(hotelId));

  useEffect(() => {
    setPrefs(loadPrefs(hotelId));
    setBaseline("__ours__");
  }, [hotelId]);

  useEffect(() => {
    try { window.localStorage.setItem(prefsKey(hotelId), JSON.stringify(prefs)); } catch { /* private mode */ }
  }, [hotelId, prefs]);

  const marketData = useMarketRates(hotelId ?? null);
  const hotelIds = useMemo(() => hotels.map((h) => h.hotel_id), [hotels]);
  const idsKey = hotelIds.join(",");
  const horizonEnd = metrics.length ? metrics[Math.min(metrics.length, 190) - 1].stay_date : null;
  const today = budapestToday();
  const monthStart = `${selectedMonth}-01`;
  const monthEnd = new Date(Date.UTC(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const from = monthStart < today ? monthStart : today;
  const horizonTo = horizonEnd ?? new Date(Date.now() + 190 * 86_400_000).toISOString().slice(0, 10);
  const portfolio = usePortfolioSnapshots(hotelIds, from, horizonTo > monthEnd ? horizonTo : monthEnd);

  useEffect(() => {
    if (hotelIds.length === 0) { setEurRateByHotel(new Map()); return; }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from("hotel_revenue_settings")
        .select("hotel_id, base_currency, eur_conversion_rate").in("hotel_id", hotelIds);
      if (cancelled || error || !data) return;
      const map = new Map<string, number>();
      for (const row of data as Array<{ hotel_id: string; base_currency: string | null; eur_conversion_rate: number | null }>) {
        const code = (row.base_currency ?? "EUR").toUpperCase();
        const rate = Number(row.eur_conversion_rate);
        map.set(row.hotel_id, code === "EUR" ? 1 : rate > 0 ? rate : 1);
      }
      setEurRateByHotel(map);
    })();
    return () => { cancelled = true; };
  }, [idsKey]);

  const latestByHotelDate = useMemo(() => {
    const map = new Map<string, PortfolioSnapshot>();
    for (const row of portfolio.data ?? []) {
      const key = `${row.hotel_id}|${row.stay_date}`;
      if (!map.has(key)) map.set(key, row);
    }
    return map;
  }, [portfolio.data]);

  const demandByDate = useMemo(() => {
    const perDate = new Map<string, number[]>();
    for (const row of latestByHotelDate.values()) {
      if (row.occupancy_pct == null) continue;
      const list = perDate.get(row.stay_date) ?? [];
      list.push(Number(row.occupancy_pct));
      perDate.set(row.stay_date, list);
    }
    const actual = new Map<string, number>();
    const dowBuckets = new Map<number, number[]>();
    for (const [date, values] of perDate) {
      if (!values.length) continue;
      const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      actual.set(date, avg);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const bucket = dowBuckets.get(dow) ?? [];
      bucket.push(avg); dowBuckets.set(dow, bucket);
    }
    const dowAvg = new Map<number, number>();
    for (const [dow, values] of dowBuckets) dowAvg.set(dow, Math.round(values.reduce((a, b) => a + b, 0) / values.length));
    return { actual, dowAvg };
  }, [latestByHotelDate]);

  const baselineRate = useMemo(() => {
    if (baseline === "__ours__") return (date: string) => ourRateByDate?.get(date) ?? null;
    return (date: string) => {
      const row = latestByHotelDate.get(`${baseline}|${date}`);
      return row?.adr_eur == null ? null : Math.round(Number(row.adr_eur));
    };
  }, [baseline, latestByHotelDate, ourRateByDate]);

  const baselineLabel = baseline === "__ours__" ? "This property" : hotels.find((h) => h.hotel_id === baseline)?.hotel_name ?? "Selected property";

  const toggleCompetitor = (id: string) => {
    setPrefs((prev) => {
      if (prev.competitors.includes(id)) return { ...prev, competitors: prev.competitors.filter((x) => x !== id) };
      const next = isMobile ? [...prev.competitors.slice(-1), id] : [...prev.competitors, id];
      return { ...prev, competitors: next };
    });
  };

  const shownCompetitors = useMemo(() => marketData.competitors.filter((c) => prefs.competitors.includes(c.id)), [marketData.competitors, prefs.competitors]);
  const visibleCompetitors = isMobile ? shownCompetitors.slice(0, 2) : shownCompetitors;

  const data = useMemo<ChartPoint[]>(() => metrics.slice(0, days).map((m) => {
    const actualDemand = demandByDate.actual.get(m.stay_date);
    const dow = new Date(`${m.stay_date}T00:00:00Z`).getUTCDay();
    const forecast = demandByDate.dowAvg.get(dow) ?? null;
    const market = marketData.marketByDate.get(m.stay_date);
    const eventTitles = (eventsByDate?.get(m.stay_date) ?? []).map((e) => e.title);
    const point: ChartPoint = {
      date: m.stay_date,
      label: new Date(`${m.stay_date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" }),
      gained: m.pickupGained || 0,
      lost: m.pickupLost ? -m.pickupLost : 0,
      pickup: m.netPickup ?? 0,
      occ: Math.round(m.occupancyPct),
      adr: m.adrEur == null ? null : Math.round(m.adrEur),
      demand: actualDemand ?? null,
      demandForecast: actualDemand == null ? forecast : null,
      roomsLeft: m.roomsLeft,
      ourRate: prefs.ourRate ? baselineRate(m.stay_date) : null,
      marketAvg: prefs.marketAvg && market?.trimmed_avg_rate != null ? Math.round(Number(market.trimmed_avg_rate)) : null,
      marketMedian: prefs.marketMedian && market?.median_rate != null ? Math.round(Number(market.median_rate)) : null,
      bandLow: prefs.band && market?.min_rate != null ? Math.round(Number(market.min_rate)) : null,
      bandSpan: prefs.band && market?.min_rate != null && market?.max_rate != null ? Math.max(0, Math.round(Number(market.max_rate) - Number(market.min_rate))) : null,
      marketMin: market?.min_rate == null ? null : Math.round(Number(market.min_rate)),
      marketMax: market?.max_rate == null ? null : Math.round(Number(market.max_rate)),
      marketSample: market?.sample_size ?? 0,
      eventTitles,
    };
    for (const c of visibleCompetitors) point[`c_${c.id}`] = marketData.ratesByCompetitor.get(c.id)?.get(m.stay_date) ?? null;
    return point;
  }), [metrics, days, demandByDate, marketData.marketByDate, marketData.ratesByCompetitor, visibleCompetitors, eventsByDate, prefs, baselineRate]);

  const activeWindow = pickupWindowDays ?? PICKUP_WINDOW_48H;
  const period = periodForWindow(activeWindow, customDays);
  const ranges = isMobile ? MOBILE_RANGES : DESKTOP_RANGES;
  const totalPickup = data.reduce((sum, d) => sum + d.pickup, 0);
  const totalGained = data.reduce((sum, d) => sum + d.gained, 0);
  const totalLost = data.reduce((sum, d) => sum + Math.abs(d.lost), 0);
  const peak = data.reduce<ChartPoint | null>((best, d) => !best || d.pickup > best.pickup ? d : best, null);
  const todayPoint = data.find((d) => d.date >= budapestToday()) ?? data[0] ?? null;

  const marketStanding = useMemo(() => {
    let ours = 0, market = 0, nights = 0;
    for (const d of data) {
      const our = baselineRate(d.date);
      const avg = marketData.marketByDate.get(d.date)?.trimmed_avg_rate;
      if (our == null || avg == null) continue;
      ours += our; market += Number(avg); nights += 1;
    }
    if (!nights || !market) return null;
    return { pct: Math.round(((ours - market) / market) * 100), nights };
  }, [data, baselineRate, marketData.marketByDate]);

  const comparison = useMemo(() => {
    if (!compare) return [];
    const gridRows = metrics.filter((m) => m.stay_date.slice(0, 7) === selectedMonth && m.roomsAvailable > 0);
    const dates = new Set(gridRows.map((m) => m.stay_date));
    return hotels.map((hotel) => {
      const fx = eurRateByHotel.get(hotel.hotel_id) ?? 1;
      let sold = 0, capacity = 0, revenue = 0, nights = 0;
      if (hotel.hotel_id === hotelId && gridRows.length > 0) {
        for (const m of gridRows) { sold += m.roomsSold; capacity += m.roomsAvailable; revenue += m.revenueEur; nights += 1; }
      } else {
        for (const row of latestByHotelDate.values()) {
          if (row.hotel_id !== hotel.hotel_id) continue;
          if (dates.size ? !dates.has(row.stay_date) : row.stay_date.slice(0, 7) !== selectedMonth) continue;
          const cap = Number(row.rooms_available) || 0;
          if (!cap) continue;
          sold += Number(row.rooms_sold) || 0; capacity += cap; revenue += Number(row.revenue_eur ?? 0) / fx; nights += 1;
        }
      }
      return { ...hotel, nights, occ: capacity > 0 ? Math.round((sold / capacity) * 100) : null, adr: sold > 0 ? Math.round(revenue / sold) : null, revpar: capacity > 0 ? Math.round(revenue / capacity) : null };
    }).sort((a, b) => a.hotel_id === hotelId ? -1 : b.hotel_id === hotelId ? 1 : (b.revpar ?? -1) - (a.revpar ?? -1));
  }, [compare, hotels, metrics, selectedMonth, hotelId, eurRateByHotel, latestByHotelDate]);

  const comparisonBenchmark = useMemo(() => {
    const valid = comparison.filter((x) => x.occ != null && x.adr != null);
    if (valid.length < 2 || portfolio.isError || portfolio.isPending) return { occ: null as number | null, adr: null as number | null };
    return {
      occ: Math.round(valid.reduce((s, x) => s + (x.occ ?? 0), 0) / valid.length),
      adr: Math.round(valid.reduce((s, x) => s + (x.adr ?? 0), 0) / valid.length),
    };
  }, [comparison, portfolio.isError, portfolio.isPending]);

  const rateDomain = useMemo<[number, number] | undefined>(() => {
    const values: number[] = [];
    for (const d of data) {
      [d.ourRate, d.marketAvg, d.marketMedian, d.marketMin, d.marketMax].forEach((v) => { if (typeof v === "number" && Number.isFinite(v)) values.push(v); });
      for (const c of visibleCompetitors) {
        const value = d[`c_${c.id}`];
        if (typeof value === "number" && Number.isFinite(value)) values.push(value);
      }
    }
    if (!values.length) return undefined;
    const min = Math.min(...values), max = Math.max(...values), pad = Math.max(10, Math.round((max - min) * 0.12));
    return [Math.max(0, min - pad), max + pad];
  }, [data, visibleCompetitors]);

  const adrDomain = useMemo<[number, number] | undefined>(() => {
    const values = data.map((d) => d.adr).filter((v): v is number => v != null);
    if (!values.length) return undefined;
    const min = Math.min(...values), max = Math.max(...values), pad = Math.max(10, Math.round((max - min) * 0.12));
    return [Math.max(0, min - pad), max + pad];
  }, [data]);

  function applyPeriod(key: PeriodKey, custom = customDays) { onPickupWindowChange?.(windowForPeriod(key, custom)); }

  const exportCsv = () => {
    const headers = ["Date", "Booked", "Cancelled", "Net pickup", "Occupancy %", "Rooms left", "ADR", "Our rate", "Market average", "Market min", "Market max"];
    const rows = [headers.join(",")];
    for (const d of data) rows.push([d.date, d.gained, Math.abs(d.lost), d.pickup, d.occ, d.roomsLeft, d.adr ?? "", d.ourRate ?? "", d.marketAvg ?? "", d.marketMin ?? "", d.marketMax ?? ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `market-intelligence-${hotelId ?? "hotel"}-${budapestToday()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const demandMetricColor = primaryMetric === "occ" ? OCC_COLOR : primaryMetric === "adr" ? ADR_COLOR : DEMAND_COLOR;
  const demandMetricLabel = primaryMetric === "occ" ? "Occupancy" : primaryMetric === "adr" ? "ADR" : "City demand";
  const activeRateLegend = [
    prefs.ourRate ? { label: `${baselineLabel} rate`, color: OUR_RATE_COLOR, dashed: false } : null,
    prefs.marketAvg ? { label: "Market average", color: MARKET_COLOR, dashed: true } : null,
    prefs.marketMedian ? { label: "Market median", color: MARKET_MEDIAN_COLOR, dashed: true } : null,
    ...visibleCompetitors.map((c, i) => ({ label: c.name, color: competitorColor(i), dashed: false })),
  ].filter(Boolean) as Array<{ label: string; color: string; dashed: boolean }>;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg"><Activity className="h-5 w-5 text-primary" />Market intelligence</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">What is selling, how full you are becoming, and where your rate sits against the market.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={totalPickup >= 0 ? "secondary" : "destructive"} className="font-normal">{totalPickup > 0 ? "+" : ""}{totalPickup} net rooms <span className="ml-1 text-muted-foreground">(+{totalGained} booked · −{totalLost} lost)</span></Badge>
            {peak && peak.pickup > 0 && <Badge variant={peak.pickup >= 3 ? "destructive" : "secondary"}>Peak {peak.label}: +{peak.pickup}</Badge>}
            {marketStanding && <Badge variant="outline" className="font-normal">{baselineLabel} {marketStanding.pct === 0 ? "at market" : `${Math.abs(marketStanding.pct)}% ${marketStanding.pct > 0 ? "above" : "below"} market`}<span className="ml-1 text-muted-foreground">· {marketStanding.nights} nights</span></Badge>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <SummaryTile icon={<TrendingUp className="h-3.5 w-3.5" />} label="Pickup" value={`${totalPickup > 0 ? "+" : ""}${totalPickup}`} detail={`${totalGained} booked · ${totalLost} lost`} />
          <SummaryTile icon={<Percent className="h-3.5 w-3.5" />} label="Occupancy" value={todayPoint ? `${todayPoint.occ}%` : "—"} detail={todayPoint ? `${todayPoint.roomsLeft} room${todayPoint.roomsLeft === 1 ? "" : "s"} left` : "No current data"} />
          <SummaryTile icon={<BedDouble className="h-3.5 w-3.5" />} label="Peak pickup" value={peak && peak.pickup > 0 ? `+${peak.pickup}` : "—"} detail={peak && peak.pickup > 0 ? peak.label : "No positive pickup"} />
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          {onPickupWindowChange && <div className="flex min-w-0 items-center gap-2">
            <Select value={period} onValueChange={(v) => applyPeriod(v as PeriodKey)}><SelectTrigger className="h-9 min-w-0 flex-1 lg:w-[210px] lg:flex-none"><SelectValue /></SelectTrigger><SelectContent>{PERIODS.map((p) => <SelectItem key={p.key} value={p.key}>Pickup: {p.label}</SelectItem>)}</SelectContent></Select>
            {period === "custom" && <Input type="number" min={1} max={90} value={activeWindow > 0 ? activeWindow : customDays} className="h-9 w-20" onChange={(e) => { const n = Math.max(1, Math.min(90, Number(e.target.value) || 1)); setCustomDays(n); onPickupWindowChange(n); }} />}
          </div>}
          <div className="flex rounded-lg border p-0.5">{ranges.map((r) => <Button key={r.value} size="sm" variant={days === r.value ? "default" : "ghost"} className="h-8 rounded-md px-2.5 text-xs" onClick={() => setDays(r.value)}>{r.label}</Button>)}</div>
          <div className="flex rounded-lg border p-0.5">{([ ["occ", "Occupancy"], ["adr", "ADR"], ["demand", "Demand"] ] as Array<[PrimaryMetric, string]>).map(([key, label]) => <Button key={key} size="sm" variant={primaryMetric === key ? "default" : "ghost"} className="h-8 rounded-md px-2.5 text-xs" onClick={() => setPrimaryMetric(key)}>{label}</Button>)}</div>
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            {hotels.length > 1 && <Button size="sm" variant={compare ? "default" : "outline"} className="h-9 text-xs" onClick={() => setCompare((v) => !v)}>Compare hotels</Button>}
            <Popover><PopoverTrigger asChild><Button size="sm" variant="outline" className="h-9 text-xs"><SlidersHorizontal className="mr-1 h-3.5 w-3.5" />Market series</Button></PopoverTrigger><PopoverContent align="end" className="w-80 p-3"><div className="space-y-3"><div><p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Rate comparison</p><SeriesTick label="Our selling rate" checked={prefs.ourRate} onChange={(v) => setPrefs((p) => ({ ...p, ourRate: v }))} /><SeriesTick label="Market average" checked={prefs.marketAvg} onChange={(v) => setPrefs((p) => ({ ...p, marketAvg: v }))} /><SeriesTick label="Market median" checked={prefs.marketMedian} onChange={(v) => setPrefs((p) => ({ ...p, marketMedian: v }))} /><SeriesTick label="Cheapest–dearest band" checked={prefs.band} onChange={(v) => setPrefs((p) => ({ ...p, band: v }))} /><SeriesTick label="Event markers" checked={showEvents} onChange={setShowEvents} /></div><div><p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Competitors {isMobile ? "· max 2 on mobile" : ""}</p><div className="max-h-52 overflow-y-auto">{marketData.competitors.length === 0 && <p className="text-xs text-muted-foreground">No watched competitors yet.</p>}{marketData.competitors.map((c, i) => <SeriesTick key={c.id} label={c.name} color={competitorColor(i)} checked={prefs.competitors.includes(c.id)} onChange={() => toggleCompetitor(c.id)} hint={`${marketData.ratesByCompetitor.get(c.id)?.size ?? 0} nights`} />)}</div></div></div></PopoverContent></Popover>
            {!isMobile && hotels.length > 1 && <Select value={baseline} onValueChange={setBaseline}><SelectTrigger className="h-9 w-[210px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__ours__">Baseline: this property</SelectItem>{hotels.filter((h) => h.hotel_id !== hotelId).map((h) => <SelectItem key={h.hotel_id} value={h.hotel_id}>Baseline: {h.hotel_name}</SelectItem>)}</SelectContent></Select>}
            <Button size="sm" variant="ghost" className="h-9 px-2 text-xs" onClick={exportCsv}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Pickup measures {pickupWindowLabel(activeWindow).toLowerCase()} of bookings. Hover or tap a date for the full revenue story.</p>
      </CardHeader>

      <CardContent className="space-y-5 px-2 pb-4 sm:px-4">
        {compare && comparison.length > 0 && (
          <section aria-label="Hotel comparison" aria-busy={portfolio.isFetching}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">Hotel comparison</p>
                <p className="text-[10px] text-muted-foreground">Same nights in {selectedMonth}. Occupancy, average daily rate and revenue per available room.</p>
              </div>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={portfolio.isFetching} onClick={() => void portfolio.refetch()}>
                {portfolio.isFetching ? "Loading comparison…" : portfolio.isError ? "Retry comparison" : "Refresh comparison"}
              </Button>
            </div>
            {portfolio.isError && (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {portfolio.data?.length ? "Comparison could not refresh. Showing the last loaded figures." : "Comparison figures could not load. Please retry."}
              </p>
            )}
            <div className={isMobile ? "flex snap-x gap-2 overflow-x-auto pb-2" : "grid grid-cols-2 gap-2 xl:grid-cols-4"}>
              {comparison.map((s, i) => {
                const occDelta = s.occ != null && comparisonBenchmark.occ != null ? s.occ - comparisonBenchmark.occ : null;
                const adrDelta = s.adr != null && comparisonBenchmark.adr != null ? s.adr - comparisonBenchmark.adr : null;
                return (
                  <div key={s.hotel_id} className={`rounded-xl border p-3 ${isMobile ? "min-w-[245px] snap-start" : ""} ${s.hotel_id === hotelId ? "border-primary bg-primary/[0.03]" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorFor(s.hotel_id, i) }} />
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold">{s.hotel_name}</p>
                      {s.hotel_id === hotelId && <Badge variant="secondary" className="h-5 px-1.5 text-[9px]">This hotel</Badge>}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-[9px] uppercase text-muted-foreground">Occ</p>
                        <p className="text-lg font-semibold tabular-nums">{s.occ == null ? "—" : `${s.occ}%`}</p>
                        {occDelta != null && <p className="text-[9px] text-muted-foreground">{occDelta >= 0 ? "+" : ""}{occDelta} pts vs portfolio</p>}
                      </div>
                      <div>
                        <p className="text-[9px] uppercase text-muted-foreground">ADR</p>
                        <p className="text-lg font-semibold tabular-nums">{eurMoney(s.adr)}</p>
                        {adrDelta != null && <p className="text-[9px] text-muted-foreground">{adrDelta >= 0 ? "+" : "−"}€{Math.abs(adrDelta)} vs portfolio</p>}
                      </div>
                      <div>
                        <p className="text-[9px] uppercase text-muted-foreground">RevPAR</p>
                        <p className="text-lg font-semibold tabular-nums">{eurMoney(s.revpar)}</p>
                      </div>
                    </div>
                    {s.nights === 0 ? (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        {portfolio.isFetching ? "Loading figures…" : portfolio.isError ? "Figures unavailable. Retry above." : "No figures available for these nights."}
                      </p>
                    ) : <p className="mt-2 text-[10px] text-muted-foreground">{s.nights} nights with data</p>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="rounded-xl border bg-card p-2 sm:p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1"><div><p className="text-sm font-semibold">Pickup & demand</p><p className="text-[10px] text-muted-foreground">Bookings and cancellations with one clear demand signal.</p></div><div className="flex items-center gap-3 text-[10px]"><LegendChip color={PICKUP_COLOR} label="Booked" shape="bar" /><LegendChip color={CANCEL_COLOR} label="Cancelled" shape="bar" /><LegendChip color={demandMetricColor} label={demandMetricLabel} /></div></div>
          <div className="h-[19rem]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} syncId="market-intelligence-v2" margin={{ top: 10, right: 6, left: -8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" /><XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(data.length / (isMobile ? 5 : 9)))} /><YAxis yAxisId="pickup" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={34} allowDecimals={false} domain={[(min: number) => Math.min(0, min) - 1, (max: number) => Math.max(2, max) + 1]} />{primaryMetric === "adr" ? <YAxis yAxisId="metric" orientation="right" width={48} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${currencySymbol()}${Math.round(v)}`} domain={adrDomain ?? ["auto", "auto"]} /> : <YAxis yAxisId="metric" orientation="right" width={42} domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />}{showEvents && <EventLines data={data} yAxisId="pickup" />}<ReferenceLine yAxisId="pickup" y={0} stroke="hsl(var(--muted-foreground) / 0.45)" /><RTooltip content={<DemandTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.35)" }} /><Bar yAxisId="pickup" dataKey="gained" name="Booked" stackId="pickup" radius={[2, 2, 0, 0]} maxBarSize={20} minPointSize={2} isAnimationActive={false}>{data.map((d) => <Cell key={d.date} fill={barColor(d.gained)} />)}</Bar><Bar yAxisId="pickup" dataKey="lost" name="Cancelled" stackId="pickup" fill={CANCEL_COLOR} radius={[0, 0, 2, 2]} maxBarSize={20} minPointSize={2} isAnimationActive={false} />{primaryMetric === "occ" && <Line yAxisId="metric" type="monotone" dataKey="occ" name="Occupancy" stroke={OCC_COLOR} strokeWidth={2.5} dot={false} isAnimationActive={false} />}{primaryMetric === "adr" && <Line yAxisId="metric" type="monotone" dataKey="adr" name="ADR" stroke={ADR_COLOR} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />}{primaryMetric === "demand" && <><Line yAxisId="metric" type="monotone" dataKey="demand" name="City demand" stroke={DEMAND_COLOR} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} /><Line yAxisId="metric" type="monotone" dataKey="demandForecast" name="Demand forecast" stroke={DEMAND_COLOR} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls opacity={0.55} isAnimationActive={false} /></>}</ComposedChart></ResponsiveContainer></div>
        </section>

        <section className="rounded-xl border bg-card p-2 sm:p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1"><div><p className="text-sm font-semibold">Rate position</p><p className="text-[10px] text-muted-foreground">Your selling rate against the market. No occupancy scale is mixed into this chart.</p></div><div className="flex flex-wrap items-center gap-2">{activeRateLegend.map((item) => <LegendChip key={item.label} color={item.color} label={item.label} dashed={item.dashed} />)}</div></div>
          <div className={isMobile ? "h-[16rem]" : "h-[17rem]"}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} syncId="market-intelligence-v2" margin={{ top: 10, right: 4, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" /><XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(data.length / (isMobile ? 5 : 9)))} /><YAxis yAxisId="rate" orientation="right" width={52} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${currencySymbol()}${Math.round(v)}`} domain={rateDomain ?? ["auto", "auto"]} />{showEvents && <EventLines data={data} yAxisId="rate" />}<RTooltip content={<RateTooltip />} cursor={{ stroke: "hsl(var(--foreground) / 0.22)", strokeWidth: 1 }} />{prefs.band && <><Area yAxisId="rate" dataKey="bandLow" stackId="market-band" stroke="none" fill="transparent" isAnimationActive={false} /><Area yAxisId="rate" dataKey="bandSpan" stackId="market-band" stroke="none" fill="hsl(var(--foreground) / 0.08)" isAnimationActive={false} /></>}{prefs.marketAvg && <Line yAxisId="rate" type="monotone" dataKey="marketAvg" name="Market average" stroke={MARKET_COLOR} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} isAnimationActive={false} />}{prefs.marketMedian && <Line yAxisId="rate" type="monotone" dataKey="marketMedian" name="Market median" stroke={MARKET_MEDIAN_COLOR} strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls={false} isAnimationActive={false} />}{prefs.ourRate && <Line yAxisId="rate" type="monotone" dataKey="ourRate" name={`${baselineLabel} rate`} stroke={OUR_RATE_COLOR} strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />}{visibleCompetitors.map((c, i) => <Line key={c.id} yAxisId="rate" type="monotone" dataKey={`c_${c.id}`} name={c.name} stroke={competitorColor(i)} strokeWidth={1.75} dot={false} connectNulls={false} opacity={0.9} isAnimationActive={false} />)}</ComposedChart></ResponsiveContainer></div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground"><span>{marketData.loading ? "Refreshing competitive rates…" : marketData.coverageEnd ? `${marketData.ratesByCompetitor.size} of ${marketData.competitors.length} watched hotels reported · prices reach ${shortDate(marketData.coverageEnd)}` : "No market rates available in this horizon."}</span>{isMobile && shownCompetitors.length > 2 && <span>Only 2 competitors are shown at once on mobile.</span>}</div>
        </section>
      </CardContent>
    </Card>
  );
}

function LegendChip({ color, label, shape = "line", dashed = false }: { color: string; label: string; shape?: "line" | "bar"; dashed?: boolean }) {
  return <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className={shape === "bar" ? "h-2.5 w-2.5 rounded-[2px]" : "h-0.5 w-4"} style={{ background: shape === "bar" || !dashed ? color : `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 8px)` }} />{label}</span>;
}

function SeriesTick({ label, checked, onChange, color, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; color?: string; hint?: string }) {
  return <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"><Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />{color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />}<span className="min-w-0 flex-1 truncate text-xs">{label}</span>{hint && <span className="shrink-0 text-[10px] text-muted-foreground">{hint}</span>}</label>;
}
