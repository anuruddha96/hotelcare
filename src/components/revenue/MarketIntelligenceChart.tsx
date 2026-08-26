import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Label, LabelList, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Activity, Download, SlidersHorizontal } from "lucide-react";
import type { DayMetrics } from "@/lib/revenueAnalytics";
import { budapestToday, daysBetween, pickupWindowLabel, PICKUP_WINDOW_48H } from "@/lib/revenueAnalytics";
import { money, currencySymbol } from "@/lib/revenueCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useMarketRates } from "@/hooks/useMarketRates";


const RANGES = [
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 60, label: "60d" },
  { value: 90, label: "90d" },
  { value: 180, label: "6m" },
];

/** How far back the "pickup" measurement window reaches. */
type PeriodKey = "auto48" | "today" | "yesterday" | "week" | "month" | "custom";

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "auto48", label: "Last 48 hours (automation)" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday + today" },
  { key: "week", label: "This week (Mon–Sun)" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom…" },
];

/** Days to look back for a period key (1 = bookings created today). */
function windowForPeriod(key: PeriodKey, customDays: number): number {
  const today = budapestToday();
  const d = new Date(`${today}T00:00:00Z`);
  switch (key) {
    case "auto48": return PICKUP_WINDOW_48H;
    case "today": return 1;
    case "yesterday": return 2;
    case "week": {
      const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
      return dow + 1;
    }
    case "month": {
      const first = `${today.slice(0, 7)}-01`;
      return daysBetween(first, today) + 1;
    }
    default: return Math.max(1, customDays);
  }
}

/**
 * Which preset the shared window currently matches. The dropdown used to keep
 * its own state, so it read "Today" while the chart plotted the 48-hour
 * automation window — label and data now come from the same number.
 */
function periodForWindow(windowDays: number, customDays: number): PeriodKey {
  for (const p of PERIODS) {
    if (p.key === "custom") continue;
    if (windowForPeriod(p.key, customDays) === windowDays) return p.key;
  }
  return "custom";
}

/** Legend swatch for pickup — matches the typical positive-pickup bar. */
const PICKUP_LEGEND_COLOR = "hsl(28 96% 60%)";
const ADR_COLOR = "hsl(160 84% 39%)";
const DEMAND_COLOR = "hsl(271 76% 53%)";

/** Owner-chosen colours, carried over from the portfolio comparison panel. */
const HOTEL_COLORS: Record<string, string> = {
  "mika-downtown": "#111111",
  "memories-budapest": "#B5835A",
  ottofiori: "#2E7D32",
  "gozsdu-court": "#CD7F32",
};
const FALLBACK = ["#3B82F6", "#9333EA", "#DC2626", "#0891B2"];
const colorFor = (id: string, i: number) => HOTEL_COLORS[id] ?? FALLBACK[i % FALLBACK.length];

function barColor(pickup: number): string {
  if (pickup < 0) return "hsl(199 89% 60%)";
  if (pickup === 0) return "hsl(var(--muted-foreground) / 0.25)";
  if (pickup === 1) return "hsl(33 100% 75%)";
  if (pickup === 2) return "hsl(28 96% 60%)";
  if (pickup === 3) return "hsl(0 84% 60%)";
  return "hsl(0 72% 45%)";
}

interface HotelRef { hotel_id: string; hotel_name: string }

interface SnapshotRow {
  hotel_id: string;
  stay_date: string;
  rooms_sold: number | null;
  occupancy_pct: number | null;
  adr_eur: number | null;
  revenue_eur: number | null;
  rooms_available: number | null;
}

interface Props {
  metrics: DayMetrics[];
  /** Current pickup measurement window (days back). */
  pickupWindowDays?: number;
  onPickupWindowChange?: (days: number) => void;
  /** Properties the reader may compare against; also feeds the demand index. */
  hotels?: HotelRef[];
  /** The property this chart belongs to (highlighted in comparison mode). */
  hotelId?: string | null;
  /** Calendar month shared with the headline performance card. */
  selectedMonth: string;
  eventsByDate?: Map<string, { title: string; impact: string }[]>;
  /** Our own selling rate per stay date, plotted against the competitive set. */
  ourRateByDate?: Map<string, number>;
}

/** Colours for the watched competitors, in list order. */
const COMP_COLORS = [
  "hsl(217 91% 60%)", "hsl(160 60% 45%)", "hsl(30 84% 55%)",
  "hsl(280 65% 60%)", "hsl(340 75% 55%)", "hsl(190 80% 42%)",
  "hsl(45 90% 45%)", "hsl(0 72% 55%)",
];
const MARKET_COLOR = "hsl(var(--foreground) / 0.75)";
const OUR_RATE_COLOR = "hsl(var(--primary))";

/** Which of the competitive-set series the reader keeps ticked on. */
interface MarketPrefs {
  ourRate: boolean;
  marketAvg: boolean;
  marketMedian: boolean;
  band: boolean;
  competitors: string[];
}
const DEFAULT_PREFS: MarketPrefs = {
  ourRate: true, marketAvg: true, marketMedian: false, band: true, competitors: [],
};
const prefsKey = (hotelId?: string | null) => `market-intel-series:${hotelId ?? "default"}`;
function loadPrefs(hotelId?: string | null): MarketPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(prefsKey(hotelId));
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<MarketPrefs>) } : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
}

/**
 * Market intelligence horizon.
 *
 * Bars are net pickup. On top of them the reader can layer occupancy, ADR, an
 * in-house city demand index, one occupancy line per sister property, and the
 * whole competitive set: our selling rate, the market average and median, the
 * cheapest-to-dearest band and any individual competitor ticked on.
 */
export default function MarketIntelligenceChart({ metrics, pickupWindowDays, onPickupWindowChange, hotels = [], hotelId, selectedMonth, eventsByDate, ourRateByDate }: Props) {
  const isMobile = useIsMobile();
  // Wide bars beat a long horizon on a phone: 30 days is still readable.
  const [days, setDays] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768 ? 30 : 60));
  /** Optional series the user can layer on top of pickup. */
  const [showOcc, setShowOcc] = useState(true);
  const [showAdr, setShowAdr] = useState(false);
  const [showDemand, setShowDemand] = useState(true);
  const [compare, setCompare] = useState(false);
  /** Event shading can be switched off when it crowds the chart. */
  const [showEvents, setShowEvents] = useState(true);

  /** Competitive-set series, remembered per property. */
  const [prefs, setPrefs] = useState<MarketPrefs>(() => loadPrefs(hotelId));
  useEffect(() => { setPrefs(loadPrefs(hotelId)); }, [hotelId]);
  useEffect(() => {
    try { window.localStorage.setItem(prefsKey(hotelId), JSON.stringify(prefs)); } catch { /* private mode */ }
  }, [prefs, hotelId]);
  const setPref = <K extends keyof MarketPrefs>(key: K, value: MarketPrefs[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));
  const toggleCompetitor = (id: string) => setPrefs((p) => ({
    ...p,
    competitors: p.competitors.includes(id) ? p.competitors.filter((c) => c !== id) : [...p.competitors, id],
  }));

  /** Which property the market is judged against. */
  const [baseline, setBaseline] = useState<string>("__ours__");
  useEffect(() => { setBaseline("__ours__"); }, [hotelId]);

  const marketData = useMarketRates(hotelId ?? null);
  const shownCompetitors = useMemo(
    () => marketData.competitors.filter((c) => prefs.competitors.includes(c.id)),
    [marketData.competitors, prefs.competitors],
  );

  /** Properties the reader has switched off in comparison mode. */
  const [hiddenHotels, setHiddenHotels] = useState<Set<string>>(new Set());
  const toggleHotel = (id: string) => setHiddenHotels((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const activeWindow = pickupWindowDays ?? PICKUP_WINDOW_48H;
  const [customDays, setCustomDays] = useState(7);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);

  const hotelIds = useMemo(() => hotels.map((h) => h.hotel_id), [hotels]);
  const idsKey = hotelIds.join(",");
  const horizonEnd = metrics.length ? metrics[Math.min(metrics.length, 190) - 1].stay_date : null;

  /** Portfolio snapshots power both the demand index and the comparison lines. */
  useEffect(() => {
    if (hotelIds.length === 0) { setSnapshots([]); return; }
    let cancelled = false;
    void (async () => {
      const today = budapestToday();
      // The comparison tiles report the whole selected calendar month, so the
      // window starts at the month opening rather than today — otherwise the
      // sister properties showed 0% for a month already under way. The horizon
      // end falls back to a fixed window so the lines paint before the grid
      // metrics have finished loading.
      const monthStart = `${selectedMonth}-01`;
      const from = monthStart < today ? monthStart : today;
      const end = horizonEnd ?? new Date(Date.now() + 190 * 86400000).toISOString().slice(0, 10);
      // One server-side call collapses every property to its newest capture per
      // stay date. The old client-side paging pulled tens of thousands of raw
      // snapshot rows and left the sister properties reading 0% for seconds.
      const { data, error } = await supabase.rpc("revenue_portfolio_latest_snapshots", {
        _hotel_ids: hotelIds,
        _from: from,
        _to: end,
      });
      if (cancelled) return;
      // A failed refresh keeps the previously loaded comparison on screen.
      if (error) { console.error("portfolio snapshots failed", error); return; }
      setSnapshots((data ?? []) as SnapshotRow[]);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, horizonEnd, selectedMonth]);


  /** Newest capture wins per hotel + stay date. */
  const latestByHotelDate = useMemo(() => {
    const map = new Map<string, SnapshotRow>();
    for (const row of snapshots) {
      const key = `${row.hotel_id}|${row.stay_date}`;
      if (!map.has(key)) map.set(key, row);
    }
    return map;
  }, [snapshots]);

  /**
   * City demand index: the average occupancy of every property the reader can
   * see. Dates nobody has reported yet are filled from the day-of-week average
   * of the dates that do have data, and marked as a forecast.
   */
  const demandByDate = useMemo(() => {
    const perDate = new Map<string, number[]>();
    for (const row of latestByHotelDate.values()) {
      if (row.occupancy_pct == null) continue;
      const list = perDate.get(row.stay_date) ?? [];
      list.push(Number(row.occupancy_pct));
      perDate.set(row.stay_date, list);
    }
    const actual = new Map<string, number>();
    for (const [date, list] of perDate) {
      if (list.length === 0) continue;
      actual.set(date, Math.round(list.reduce((a, b) => a + b, 0) / list.length));
    }
    // Day-of-week profile from the known dates, used for the forecast tail.
    const dowBuckets = new Map<number, number[]>();
    for (const [date, value] of actual) {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const list = dowBuckets.get(dow) ?? [];
      list.push(value);
      dowBuckets.set(dow, list);
    }
    const dowAvg = new Map<number, number>();
    for (const [dow, list] of dowBuckets) {
      dowAvg.set(dow, Math.round(list.reduce((a, b) => a + b, 0) / list.length));
    }
    return { actual, dowAvg };
  }, [latestByHotelDate]);

  /**
   * The rate line the market is judged against: our own selling rate by
   * default, or a sister property's ADR when the reader switches baseline.
   */
  const baselineRate = useMemo(() => {
    if (baseline === "__ours__") return (date: string) => ourRateByDate?.get(date) ?? null;
    return (date: string) => {
      const row = latestByHotelDate.get(`${baseline}|${date}`);
      return row?.adr_eur == null ? null : Math.round(Number(row.adr_eur));
    };
  }, [baseline, ourRateByDate, latestByHotelDate]);

  const baselineLabel = baseline === "__ours__"
    ? "This property"
    : hotels.find((h) => h.hotel_id === baseline)?.hotel_name ?? "Selected property";

  const compColor = (id: string) =>
    COMP_COLORS[Math.max(0, marketData.competitors.findIndex((c) => c.id === id)) % COMP_COLORS.length];

  const data = useMemo(() => metrics.slice(0, days).map((m) => {
    const actual = demandByDate.actual.get(m.stay_date);
    const dow = new Date(`${m.stay_date}T00:00:00Z`).getUTCDay();
    const forecast = demandByDate.dowAvg.get(dow) ?? null;
    const point: Record<string, unknown> = {
      date: m.stay_date,
      label: new Date(`${m.stay_date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" }),
      pickup: m.netPickup ?? 0,
      // Gains and give-backs are drawn separately so a day that booked one room
      // and lost another is still visible instead of vanishing at net zero.
      gained: m.pickupGained || 0,
      lost: m.pickupLost ? -m.pickupLost : 0,
      occ: Math.round(m.occupancyPct),
      adr: m.adrEur ? Math.round(m.adrEur) : null,
      demand: actual ?? null,
      demandForecast: actual == null ? forecast : null,
      monthStart: m.stay_date.endsWith("-01"),
      month: new Date(`${m.stay_date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", year: "2-digit" }),
    };
    if (compare) {
      for (const h of hotels) {
        const row = latestByHotelDate.get(`${h.hotel_id}|${m.stay_date}`);
        point[`h_${h.hotel_id}`] = row?.occupancy_pct == null ? null : Math.round(Number(row.occupancy_pct));
      }
    }

    // ---- competitive set -------------------------------------------------
    const mk = marketData.marketByDate.get(m.stay_date);
    point.ourRate = prefs.ourRate ? baselineRate(m.stay_date) : null;
    point.marketAvg = prefs.marketAvg && mk?.trimmed_avg_rate != null ? Math.round(Number(mk.trimmed_avg_rate)) : null;
    point.marketMedian = prefs.marketMedian && mk?.median_rate != null ? Math.round(Number(mk.median_rate)) : null;
    point.bandLow = prefs.band && mk?.min_rate != null ? Math.round(Number(mk.min_rate)) : null;
    point.bandSpan = prefs.band && mk?.min_rate != null && mk?.max_rate != null
      ? Math.max(0, Math.round(Number(mk.max_rate) - Number(mk.min_rate))) : null;
    point.marketMin = mk?.min_rate == null ? null : Math.round(Number(mk.min_rate));
    point.marketMax = mk?.max_rate == null ? null : Math.round(Number(mk.max_rate));
    point.marketSample = mk?.sample_size ?? 0;
    point.marketStale = mk?.stale ?? false;
    for (const c of shownCompetitors) {
      point[`c_${c.id}`] = marketData.ratesByCompetitor.get(c.id)?.get(m.stay_date) ?? null;
    }

    return point as {
      date: string; label: string; pickup: number; gained: number; lost: number; occ: number; adr: number | null;
      demand: number | null; demandForecast: number | null; monthStart: boolean; month: string;
      [key: string]: unknown;
    };
  }), [metrics, days, demandByDate, compare, hotels, latestByHotelDate,
    marketData.marketByDate, marketData.ratesByCompetitor, shownCompetitors, prefs, baselineRate]);

  /** Where the baseline property sits against the market over the horizon. */
  const marketStanding = useMemo(() => {
    let ours = 0, mkt = 0, nights = 0, cheaper = 0, dearer = 0;
    for (const d of data) {
      const our = baselineRate(d.date);
      const avg = marketData.marketByDate.get(d.date)?.trimmed_avg_rate;
      if (our == null || avg == null) continue;
      ours += our; mkt += Number(avg); nights += 1;
      if (our < Number(avg) * 0.9) cheaper += 1;
      if (our > Number(avg) * 1.1) dearer += 1;
    }
    if (!nights || mkt === 0) return null;
    return { pct: Math.round(((ours - mkt) / mkt) * 100), nights, cheaper, dearer };
  }, [data, baselineRate, marketData.marketByDate]);

  /** Owner-friendly export of exactly what the chart is showing. */
  const exportCsv = () => {
    const headers = ["Date", "Pickup", "Occupancy %", "Baseline rate", "Market average", "Market median",
      "Cheapest", "Dearest", "Set size", ...shownCompetitors.map((c) => c.name)];
    const lines = [headers.join(",")];
    for (const d of data) {
      const mk = marketData.marketByDate.get(d.date);
      const cells = [
        d.date, d.pickup, d.occ, baselineRate(d.date) ?? "",
        mk?.trimmed_avg_rate ?? "", mk?.median_rate ?? "", mk?.min_rate ?? "", mk?.max_rate ?? "", mk?.sample_size ?? 0,
        ...shownCompetitors.map((c) => marketData.ratesByCompetitor.get(c.id)?.get(d.date) ?? ""),
      ];
      lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `market-intelligence-${hotelId ?? "hotel"}-${budapestToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };


  /** Same calendar-month KPIs and weighted formulas as the headline card. */
  const comparisonSummary = useMemo(() => {
    if (!compare) return [];
    const selectedRows = metrics.filter((m) => m.stay_date.slice(0, 7) === selectedMonth);
    return hotels.map((h) => {
      const isCurrent = h.hotel_id === hotelId;
      const mine = Array.from(latestByHotelDate.values()).filter(
        (r) => r.hotel_id === h.hotel_id && r.stay_date.slice(0, 7) === selectedMonth,
      );
      const sold = isCurrent
        ? selectedRows.reduce((s, r) => s + r.roomsSold, 0)
        : mine.reduce((s, r) => s + (Number(r.rooms_sold) || 0), 0);
      const capacity = isCurrent
        ? selectedRows.reduce((s, r) => s + r.roomsAvailable, 0)
        : mine.reduce((s, r) => s + (Number(r.rooms_available) || 0), 0);
      const revenue = isCurrent
        ? selectedRows.reduce((s, r) => s + r.revenueEur, 0)
        : mine.reduce((s, r) => s + Number(r.revenue_eur ?? 0), 0);
      return {
        ...h,
        occ: capacity > 0 ? Math.round((sold / capacity) * 100) : 0,
        adr: sold > 0 ? Math.round(revenue / sold) : 0,
        revpar: capacity > 0 ? Math.round(revenue / capacity) : 0,
      };
    }).sort((a, b) => (a.hotel_id === hotelId ? -1 : b.hotel_id === hotelId ? 1 : 0));
  }, [compare, hotels, latestByHotelDate, hotelId, metrics, selectedMonth]);

  // ------------------------------------------------------------- viewport
  /**
   * Zoom and pan window over the horizon. Pinch on touch, wheel on desktop,
   * drag to pan. Everything the chart draws reads the sliced window, so the
   * axes rescale to what is actually on screen.
   */
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ start: 0, count: 0 });
  useEffect(() => { setView({ start: 0, count: data.length }); }, [data.length, days]);

  const viewData = useMemo(() => {
    if (!view.count) return data;
    const count = Math.min(Math.max(4, view.count), data.length);
    const start = Math.min(Math.max(0, view.start), Math.max(0, data.length - count));
    return data.slice(start, start + count);
  }, [data, view]);

  const resetZoom = () => setView({ start: 0, count: data.length });

  /** Zoom around a horizontal position (0–1) inside the plot. */
  const zoomAt = useCallback((factor: number, anchor: number) => {
    setView((v) => {
      const total = data.length;
      if (total === 0) return v;
      const count = v.count || total;
      const next = Math.round(Math.min(total, Math.max(4, count * factor)));
      const focus = v.start + anchor * count;
      const start = Math.round(Math.min(Math.max(0, focus - anchor * next), Math.max(0, total - next)));
      return { start, count: next };
    });
  }, [data.length]);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const rect = el.getBoundingClientRect();
      const anchor = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
      zoomAt(Math.exp(dy * 0.0015), Math.min(1, Math.max(0, anchor)));
    };

    let pinchDist = 0;
    let pinchAnchor = 0.5;
    let panX = 0;
    let panCount = 0;

    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.touches.length === 2) {
        pinchDist = dist(e.touches);
        const mid = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        pinchAnchor = rect.width ? Math.min(1, Math.max(0, (mid - rect.left) / rect.width)) : 0.5;
      } else if (e.touches.length === 1) {
        panX = e.touches[0].clientX;
        panCount = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchDist > 0) {
        e.preventDefault();
        const d = dist(e.touches);
        if (d > 0) {
          zoomAt(pinchDist / d, pinchAnchor);
          pinchDist = d;
        }
        return;
      }
      if (e.touches.length === 1) {
        const rect = el.getBoundingClientRect();
        const dx = e.touches[0].clientX - panX;
        const count = panCount || view.count || data.length;
        const perPx = rect.width ? count / rect.width : 0;
        const steps = Math.round(-dx * perPx);
        if (steps !== 0) {
          e.preventDefault();
          panX = e.touches[0].clientX;
          setView((v) => {
            const c = v.count || data.length;
            return { count: c, start: Math.min(Math.max(0, v.start + steps), Math.max(0, data.length - c)) };
          });
        }
      }
    };

    const onTouchEnd = () => { pinchDist = 0; };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [zoomAt, data.length, view.count]);

  /** Labels for the month dividers drawn across the plot. */
  const monthMarks = useMemo(() => viewData.filter((d) => d.monthStart), [viewData]);

  /** Numbers over each bar stay readable only while the bars are wide enough. */
  const showLabels = viewData.length <= 45 && !compare;

  /** A tight ADR band around the real values keeps the line meaningful. */
  const adrDomain = useMemo<[number, number]>(() => {
    const vals = viewData.map((d) => d.adr).filter((v): v is number => typeof v === "number" && v > 0);
    if (vals.length === 0) return [0, 100];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(10, (hi - lo) * 0.15);
    return [Math.max(0, Math.floor((lo - pad) / 10) * 10), Math.ceil((hi + pad) / 10) * 10];
  }, [viewData]);

  const totalPickup = useMemo(() => viewData.reduce((s, d) => s + (d.pickup || 0), 0), [viewData]);
  const totalGained = useMemo(() => viewData.reduce((s, d) => s + (d.gained || 0), 0), [viewData]);
  const totalLost = useMemo(() => viewData.reduce((s, d) => s - (d.lost || 0), 0), [viewData]);
  const peak = useMemo(() => viewData.reduce((best, d) => (d.pickup > (best?.pickup ?? -99) ? d : best), viewData[0]), [viewData]);

  /** Occupancy scale is on screen whenever anything uses it. */
  const usesPercentAxis = showOcc || showDemand || compare;
  const hasDemand = demandByDate.actual.size > 0;

  /** Any money series (our rate, market, competitors) needs the money axis. */
  const usesRateAxis = shownCompetitors.length > 0 || prefs.marketAvg || prefs.marketMedian
    || prefs.band || prefs.ourRate;
  const rateDomain = useMemo<[number, number] | undefined>(() => {
    const vals: number[] = [];
    for (const d of viewData) {
      for (const key of ["ourRate", "marketAvg", "marketMedian", "marketMin", "marketMax"]) {
        const v = d[key] as number | null;
        if (typeof v === "number" && v > 0) vals.push(v);
      }
      for (const c of shownCompetitors) {
        const v = d[`c_${c.id}`] as number | null;
        if (typeof v === "number" && v > 0) vals.push(v);
      }
    }
    if (!vals.length) return undefined;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max(10, (hi - lo) * 0.12);
    return [Math.max(0, Math.floor((lo - pad) / 10) * 10), Math.ceil((hi + pad) / 10) * 10];
  }, [viewData, shownCompetitors]);

  /** Every drawable series, as a tickable legend entry. */
  const legendItems = useMemo(() => {
    const items: Array<{ id: string; label: string; color: string; shape: "bar" | "line"; active: boolean; toggle?: () => void }> = [
      { id: "gained", label: "Booked", color: PICKUP_LEGEND_COLOR, shape: "bar", active: true },
      { id: "lost", label: "Cancelled", color: "hsl(199 89% 60%)", shape: "bar", active: true },
      { id: "occ", label: "Occupancy", color: "hsl(var(--primary))", shape: "line", active: showOcc, toggle: () => setShowOcc((v) => !v) },
      { id: "adr", label: "ADR", color: ADR_COLOR, shape: "line", active: showAdr, toggle: () => setShowAdr((v) => !v) },
    ];
    if (hasDemand) items.push({ id: "demand", label: "City demand", color: DEMAND_COLOR, shape: "line", active: showDemand, toggle: () => setShowDemand((v) => !v) });
    if (compare) {
      hotels.forEach((h, i) => items.push({
        id: h.hotel_id, label: h.hotel_name, color: colorFor(h.hotel_id, i), shape: "line",
        active: !hiddenHotels.has(h.hotel_id), toggle: () => toggleHotel(h.hotel_id),
      }));
    }
    items.push({ id: "ourRate", label: `${baselineLabel} rate`, color: OUR_RATE_COLOR, shape: "line", active: prefs.ourRate, toggle: () => setPref("ourRate", !prefs.ourRate) });
    items.push({ id: "marketAvg", label: "Market average", color: MARKET_COLOR, shape: "line", active: prefs.marketAvg, toggle: () => setPref("marketAvg", !prefs.marketAvg) });
    items.push({ id: "marketMedian", label: "Market median", color: MARKET_COLOR, shape: "line", active: prefs.marketMedian, toggle: () => setPref("marketMedian", !prefs.marketMedian) });
    for (const c of marketData.competitors) {
      items.push({
        id: c.id, label: c.name, color: compColor(c.id), shape: "line",
        active: prefs.competitors.includes(c.id), toggle: () => toggleCompetitor(c.id),
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOcc, showAdr, showDemand, hasDemand, compare, hotels, hiddenHotels, prefs, baselineLabel, marketData.competitors]);


  /** The dropdown mirrors the shared window instead of holding its own state. */
  const period = periodForWindow(activeWindow, customDays);

  function applyPeriod(key: PeriodKey, custom = customDays) {
    onPickupWindowChange?.(windowForPeriod(key, custom));
  }

  return (
    <Card>
      <CardHeader className="pb-2 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Market intelligence horizon
            </CardTitle>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Pickup, demand and the competitive set, night by night
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={totalPickup > 0 ? "secondary" : "outline"} className="font-normal">
              {totalPickup > 0 ? "+" : ""}{totalPickup} net rooms
              {(totalGained > 0 || totalLost > 0) && (
                <span className="ml-1 text-muted-foreground">
                  ({totalGained > 0 ? `+${totalGained} booked` : "no bookings"}
                  {totalLost > 0 ? ` · −${totalLost} lost` : ""})
                </span>
              )}
            </Badge>
            {peak && peak.pickup > 0 && (
              <Badge variant={peak.pickup >= 3 ? "destructive" : "secondary"}>
                Peak {peak.label}: +{peak.pickup}
              </Badge>
            )}
            {marketStanding && (
              <Badge variant="outline" className="font-normal">
                {baselineLabel} is {marketStanding.pct === 0
                  ? "level with"
                  : `${Math.abs(marketStanding.pct)}% ${marketStanding.pct > 0 ? "above" : "below"}`} the market
                <span className="ml-1 text-muted-foreground">({marketStanding.nights} nights priced)</span>
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onPickupWindowChange && (
            <>
              <Select value={period} onValueChange={(v) => applyPeriod(v as PeriodKey)}>
                <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.key} value={p.key}>Pickup: {p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {period === "custom" && (
                <div className="flex items-center gap-1 text-xs">
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={activeWindow > 0 ? activeWindow : customDays}
                    className="h-8 w-16"
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(90, Number(e.target.value) || 1));
                      setCustomDays(n);
                      onPickupWindowChange(n);
                    }}
                  />
                  <span className="text-muted-foreground">days back</span>
                </div>
              )}
              <span className="text-[11px] text-muted-foreground">
                measuring {pickupWindowLabel(pickupWindowDays ?? PICKUP_WINDOW_48H).toLowerCase()} of bookings
              </span>
            </>
          )}
          <div className="flex rounded-md border overflow-hidden ml-auto">
            {RANGES.map((r) => (
              <Button key={r.value} size="sm" variant={days === r.value ? "default" : "ghost"}
                className="h-7 rounded-none px-2 text-xs" onClick={() => setDays(r.value)}>
                {r.label}
              </Button>
            ))}
          </div>
          <div className="flex rounded-md border overflow-hidden">
            <Button size="sm" variant={showOcc ? "default" : "ghost"} className="h-7 rounded-none px-2 text-xs"
              onClick={() => { setShowOcc((v) => (isMobile ? true : !v)); if (isMobile) setShowAdr(false); }}>Occupancy</Button>
            <Button size="sm" variant={showAdr ? "default" : "ghost"} className="h-7 rounded-none px-2 text-xs"
              onClick={() => { setShowAdr((v) => (isMobile ? true : !v)); if (isMobile) setShowOcc(false); }}>ADR</Button>
            {hasDemand && (
              <Button size="sm" variant={showDemand ? "default" : "ghost"} className="h-7 rounded-none px-2 text-xs"
                onClick={() => setShowDemand((v) => !v)}>City demand</Button>
            )}
            {(eventsByDate?.size ?? 0) > 0 && (
              <Button size="sm" variant={showEvents ? "default" : "ghost"} className="h-7 rounded-none px-2 text-xs"
                onClick={() => setShowEvents((v) => !v)}>Events</Button>
            )}

            {hotels.length > 1 && (
              <Button size="sm" variant={compare ? "default" : "ghost"} className="h-7 rounded-none px-2 text-xs"
                onClick={() => setCompare((v) => !v)}>Compare properties</Button>
            )}
          </div>

          {/* Everything that can be drawn, in one tick list. */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                Series
                {(shownCompetitors.length > 0 || prefs.marketAvg) && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px] font-normal">
                    {shownCompetitors.length + (prefs.marketAvg ? 1 : 0)}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="max-h-[60vh] overflow-y-auto p-3 space-y-3">
                <SeriesGroup title="Ours">
                  <Tick label="Occupancy" checked={showOcc} onChange={(v) => setShowOcc(v)} />
                  <Tick label="Our ADR (achieved)" checked={showAdr} onChange={(v) => setShowAdr(v)} />
                  <Tick label="Our selling rate" checked={prefs.ourRate} onChange={(v) => setPref("ourRate", v)} />
                </SeriesGroup>

                <SeriesGroup title="Market">
                  <Tick label="Market average rate" checked={prefs.marketAvg} onChange={(v) => setPref("marketAvg", v)} />
                  <Tick label="Market median" checked={prefs.marketMedian} onChange={(v) => setPref("marketMedian", v)} />
                  <Tick label="Cheapest–dearest band" checked={prefs.band} onChange={(v) => setPref("band", v)} />
                  {hasDemand && <Tick label="City demand index" checked={showDemand} onChange={(v) => setShowDemand(v)} />}
                  {(eventsByDate?.size ?? 0) > 0 && (
                    <Tick label="Event shading" checked={showEvents} onChange={(v) => setShowEvents(v)} />
                  )}
                </SeriesGroup>

                <SeriesGroup title={`Competitors (${marketData.competitors.length})`}>
                  {marketData.competitors.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      No hotels watched yet — add them in Competitor rates.
                    </p>
                  )}
                  {marketData.competitors.map((c) => {
                    const count = marketData.ratesByCompetitor.get(c.id)?.size ?? 0;
                    const reliability = marketData.reliabilityByCompetitor.get(c.id) ?? 0;
                    return (
                      <Tick
                        key={c.id}
                        label={c.name}
                        color={compColor(c.id)}
                        checked={prefs.competitors.includes(c.id)}
                        onChange={() => toggleCompetitor(c.id)}
                        hint={count === 0
                          ? (c.last_scan_status === "failed" ? "last check failed" : "no public price found")
                          : `${count} prices · ${Math.round(reliability * 100)}% reliable · ${c.last_scan_at ? new Date(c.last_scan_at).toLocaleDateString() : "never checked"}`}
                      />
                    );
                  })}
                </SeriesGroup>

                {hotels.length > 1 && (
                  <SeriesGroup title="Our other hotels">
                    <Tick label="Show occupancy lines" checked={compare} onChange={(v) => setCompare(v)} />
                    {compare && hotels.map((h, i) => (
                      <Tick
                        key={h.hotel_id}
                        label={h.hotel_name}
                        color={colorFor(h.hotel_id, i)}
                        checked={!hiddenHotels.has(h.hotel_id)}
                        onChange={() => toggleHotel(h.hotel_id)}
                      />
                    ))}
                  </SeriesGroup>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {hotels.length > 1 && (
            <Select value={baseline} onValueChange={setBaseline}>
              <SelectTrigger className="h-7 w-[190px] text-xs">
                <SelectValue placeholder="Compare against market" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ours__">Baseline: this property</SelectItem>
                {hotels.filter((h) => h.hotel_id !== hotelId).map((h) => (
                  <SelectItem key={h.hotel_id} value={h.hotel_id}>Baseline: {h.hotel_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={exportCsv}>
            <Download className="mr-1 h-3.5 w-3.5" />CSV
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-1 sm:px-4">
        {compare && comparisonSummary.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2 px-2 lg:grid-cols-4">
            {comparisonSummary.map((s) => {
              const on = !hiddenHotels.has(s.hotel_id);
              const color = colorFor(s.hotel_id, hotels.findIndex((h) => h.hotel_id === s.hotel_id));
              return (
                <button
                  key={s.hotel_id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleHotel(s.hotel_id)}
                  className={`rounded-lg border p-2 text-left transition ${s.hotel_id === hotelId ? "border-primary" : ""} ${on ? "" : "opacity-45"}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-[3px] border"
                      style={{ background: on ? color : "transparent", borderColor: color }}
                    />
                    <p className="truncate text-xs font-medium">{s.hotel_name}</p>
                    {s.hotel_id === hotelId && (
                      <Badge variant="secondary" className="ml-auto h-4 px-1 text-[9px] font-normal">This one</Badge>
                    )}
                  </div>
                  <div className="mt-1.5 grid grid-cols-3 gap-1 tabular-nums">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Occupancy</p>
                      <p className="text-base font-semibold leading-tight">{s.occ}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">ADR</p>
                      <p className="text-base font-semibold leading-tight">{money(s.adr)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">RevPAR</p>
                      <p className="text-base font-semibold leading-tight">{money(s.revpar)}</p>
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{selectedMonth} · tap to {on ? "hide" : "show"}</p>
                </button>
              );
            })}
          </div>
        )}
        <div ref={plotRef} className="h-[22rem] touch-none select-none sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={viewData} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(viewData.length / (isMobile ? 5 : 8)))} />
              {/* Pickup owns the left axis so single-room days stay visible
                  even when ADR runs in the hundreds. */}
              <YAxis yAxisId="pickup" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={30}
                allowDecimals={false} domain={[(min: number) => Math.min(0, min) - 1, (max: number) => Math.max(2, max) + 1]}>
                <Label value="Rooms" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              </YAxis>
              {/* The percentage scale stays on screen whenever any % series is
                  drawn, so no line is ever left without a readable axis. */}
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={42}
                tickFormatter={(v: number) => `${v}%`}
                hide={!usesPercentAxis}>
                <Label value="Occupancy / demand %" angle={90} position="insideRight" style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              </YAxis>
              {/* ADR keeps a real, labelled scale so the line can be read, not
                  just admired. It is only shown when ADR is the chosen metric. */}
              <YAxis yAxisId="adr" orientation="right" width={44} tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                hide={!showAdr || usesPercentAxis}
                tickFormatter={(v: number) => `${currencySymbol()}${Math.round(v)}`}
                domain={adrDomain} />
              {/* Money scale shared by our rate, the market and every competitor. */}
              <YAxis yAxisId="rate" orientation="right" width={46} tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                hide={!usesRateAxis || rateDomain == null}
                tickFormatter={(v: number) => `${currencySymbol()}${Math.round(v)}`}
                domain={rateDomain ?? ["auto", "auto"]} />

              {showEvents && viewData.filter(d => eventsByDate?.has(d.date)).map((d) => (
                <ReferenceLine
                  key={d.date}
                  yAxisId="pickup"
                  x={d.label}
                  stroke="hsl(271 76% 53% / 0.15)"
                  strokeWidth={8}
                />
              ))}

              {monthMarks.map((m) => (
                <ReferenceLine
                  key={m.date} yAxisId="pickup" x={m.label} stroke="hsl(var(--foreground) / 0.35)"
                  strokeDasharray="2 2"
                  label={{ value: m.month, position: "top", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
              ))}
              <ReferenceLine yAxisId="pickup" y={0} stroke="hsl(var(--muted-foreground) / 0.4)" />
              <RTooltip
                cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                contentStyle={{ fontSize: 11, padding: "4px 8px" }}
                labelFormatter={(label, payload) => {
                  const date = payload && payload[0]?.payload?.date;
                  const dayEvents = eventsByDate?.get(date);
                  return (
                    <span className="block font-medium mb-1">
                      {label}
                      {dayEvents && dayEvents.length > 0 && (
                        <span className="mt-1 block space-y-0.5 border-t pt-1">
                          {dayEvents.map((e, i) => (
                            <span key={i} className="text-[10px] text-purple-600 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                              {e.title} ({e.impact})
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  );
                }}

                formatter={(value: unknown, name: string, item: { dataKey?: string | number }) => {
                  const key = String(item?.dataKey ?? "");
                  if (key === "bandLow") return null as unknown as [string, string];
                  if (key === "bandSpan") return null as unknown as [string, string];
                  if (name === "ADR") return [money(Number(value)), name];
                  if (key.startsWith("c_") || key === "ourRate" || key === "marketAvg" || key === "marketMedian") {
                    return value == null ? (null as unknown as [string, string]) : [money(Number(value)), name];
                  }
                  if (name === "Pickup" || name === "Booked" || name === "Cancelled") {
                    const n = Math.abs(value as number);
                    if (!n) return null as unknown as [string, string];
                    const sign = name === "Cancelled" ? "−" : "+";
                    return [`${sign}${n} room${n === 1 ? "" : "s"}`, name];
                  }
                  return [`${value}%`, name];
                }}

              />
              {/* Legend lives outside the SVG so its hit areas are finger-sized. */}

              {/* Rooms booked and rooms given back are stacked around zero, so
                  a date that gained and lost the same number of rooms still
                  shows both movements instead of an empty column. */}
              <Bar yAxisId="pickup" dataKey="gained" name="Booked" stackId="pickup" radius={[2, 2, 0, 0]}
                maxBarSize={18} minPointSize={2} fill={PICKUP_LEGEND_COLOR} isAnimationActive animationDuration={550}>
                {viewData.map((d) => <Cell key={d.date} fill={barColor(d.gained)} />)}
                {showLabels && (
                  <LabelList
                    dataKey="pickup"
                    position="top"
                    fontSize={10}
                    fill="hsl(var(--foreground))"
                    formatter={(v: number) => (v === 0 ? "" : `${v > 0 ? "+" : ""}${v}`)}
                  />
                )}
              </Bar>
              <Bar yAxisId="pickup" dataKey="lost" name="Cancelled" stackId="pickup" radius={[0, 0, 2, 2]}
                maxBarSize={18} minPointSize={2} fill="hsl(199 89% 60%)" isAnimationActive animationDuration={550} />

              {showOcc && (
                <Line yAxisId="right" type="monotone" dataKey="occ" name="Occupancy" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} opacity={0.85} />
              )}
              {showDemand && hasDemand && (
                <>
                  <Line yAxisId="right" type="monotone" dataKey="demand" name="City demand" stroke={DEMAND_COLOR}
                    strokeWidth={2} dot={false} connectNulls={false} opacity={0.9} />
                  <Line yAxisId="right" type="monotone" dataKey="demandForecast" name="City demand (forecast)" stroke={DEMAND_COLOR}
                    strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls opacity={0.65} legendType="none" />
                </>
              )}
              {showAdr && (
                <Line yAxisId={usesPercentAxis ? "adr" : "adr"} type="monotone" dataKey="adr" name="ADR" stroke={ADR_COLOR} strokeWidth={2} dot={false} connectNulls={false} opacity={0.9} />
              )}
              {compare && hotels.filter((h) => !hiddenHotels.has(h.hotel_id)).map((h) => (
                <Line key={h.hotel_id} yAxisId="right" type="monotone" dataKey={`h_${h.hotel_id}`} name={h.hotel_name}
                  stroke={colorFor(h.hotel_id, hotels.findIndex((x) => x.hotel_id === h.hotel_id))}
                  strokeWidth={h.hotel_id === hotelId ? 2.5 : 1.5}
                  dot={false} connectNulls opacity={0.85} />
              ))}

              {/* ---- competitive set ------------------------------------- */}
              {prefs.band && (
                <>
                  <Area yAxisId="rate" dataKey="bandLow" stackId="band" stroke="none" fill="transparent"
                    legendType="none" name="Market floor" isAnimationActive={false} connectNulls />
                  <Area yAxisId="rate" dataKey="bandSpan" stackId="band" stroke="none"
                    fill="hsl(var(--foreground) / 0.08)" name="Cheapest–dearest" isAnimationActive={false} connectNulls />
                </>
              )}
              {prefs.marketAvg && (
                <Line yAxisId="rate" type="monotone" dataKey="marketAvg" name="Market average" stroke={MARKET_COLOR}
                  strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
              )}
              {prefs.marketMedian && (
                <Line yAxisId="rate" type="monotone" dataKey="marketMedian" name="Market median" stroke={MARKET_COLOR}
                  strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls opacity={0.8} />
              )}
              {prefs.ourRate && (
                <Line yAxisId="rate" type="monotone" dataKey="ourRate" name={`${baselineLabel} rate`} stroke={OUR_RATE_COLOR}
                  strokeWidth={2.5} dot={false} connectNulls />
              )}
              {shownCompetitors.map((c) => (
                <Line key={c.id} yAxisId="rate" type="monotone" dataKey={`c_${c.id}`} name={c.name}
                  stroke={compColor(c.id)} strokeWidth={1.5} dot={false} connectNulls opacity={0.9} />
              ))}

            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Legend: every entry is tickable, with touch-sized targets. */}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 px-2">
          {legendItems.map((it) => (
            <button
              key={it.id}
              type="button"
              aria-pressed={it.active}
              onClick={it.toggle}
              disabled={!it.toggle}
              className={`flex min-h-[28px] items-center gap-1.5 rounded px-1 text-[11px] transition ${
                it.active ? "" : "opacity-40 line-through"
              } ${it.toggle ? "hover:bg-muted/60" : "cursor-default"}`}
            >
              <span
                className={it.shape === "bar" ? "h-2.5 w-2.5 rounded-[2px]" : "h-0.5 w-4 rounded-full"}
                style={{ background: it.color }}
              />
              <span className="max-w-[150px] truncate">{it.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-1 flex items-center justify-between px-2 text-[10px] text-muted-foreground">
          <span>
            {isMobile ? "Pinch to zoom, drag to pan" : "Scroll to zoom, drag to pan"}
            {" · "}
            {viewData.length} of {data.length} nights
          </span>
          {(view.start > 0 || view.count < data.length) && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={resetZoom}>
              Reset zoom
            </Button>
          )}
        </div>

      </CardContent>

    </Card>
  );
}

/** A titled block of tick boxes inside the series popover. */
function SeriesGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** One tickable series, with an optional colour swatch and freshness hint. */
function Tick({ label, checked, onChange, color, hint }: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  color?: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/60">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
      {hint && <span className="shrink-0 text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
