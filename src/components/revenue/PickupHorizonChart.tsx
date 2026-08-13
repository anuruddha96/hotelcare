import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bar, CartesianGrid, Cell, ComposedChart, Label, LabelList, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Activity } from "lucide-react";
import type { DayMetrics } from "@/lib/revenueAnalytics";
import { budapestToday, daysBetween } from "@/lib/revenueAnalytics";
import { money, currencySymbol } from "@/lib/revenueCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";

const RANGES = [
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 60, label: "60d" },
  { value: 90, label: "90d" },
  { value: 180, label: "6m" },
];

/** How far back the "pickup" measurement window reaches, in days. */
type PeriodKey = "today" | "yesterday" | "week" | "month" | "custom";

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
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
}

/**
 * Demand & pickup horizon.
 *
 * Bars are net pickup. On top of them the reader can layer occupancy, ADR, an
 * in-house Budapest demand index, and one occupancy line per sister property.
 */
export default function PickupHorizonChart({ metrics, pickupWindowDays, onPickupWindowChange, hotels = [], hotelId }: Props) {
  const isMobile = useIsMobile();
  // Wide bars beat a long horizon on a phone: 30 days is still readable.
  const [days, setDays] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768 ? 30 : 60));
  /** Optional series the user can layer on top of pickup. */
  const [showOcc, setShowOcc] = useState(true);
  const [showAdr, setShowAdr] = useState(false);
  const [showDemand, setShowDemand] = useState(true);
  const [compare, setCompare] = useState(false);
  /** Properties the reader has switched off in comparison mode. */
  const [hiddenHotels, setHiddenHotels] = useState<Set<string>>(new Set());
  const toggleHotel = (id: string) => setHiddenHotels((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [period, setPeriod] = useState<PeriodKey>("today");
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
      const end = horizonEnd ?? today;
      const out: SnapshotRow[] = [];
      for (let offset = 0; offset < 16000; offset += 1000) {
        const { data, error } = await supabase
          .from("revenue_daily_snapshots")
          .select("hotel_id, stay_date, occupancy_pct, adr_eur, revenue_eur, rooms_available")
          .in("hotel_id", hotelIds)
          .gte("stay_date", today)
          .lte("stay_date", end)
          .order("captured_date", { ascending: false })
          .range(offset, offset + 999);
        if (error) break;
        const page = (data ?? []) as SnapshotRow[];
        out.push(...page);
        if (page.length < 1000) break;
      }
      if (!cancelled) setSnapshots(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, horizonEnd]);

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

  const data = useMemo(() => metrics.slice(0, days).map((m) => {
    const actual = demandByDate.actual.get(m.stay_date);
    const dow = new Date(`${m.stay_date}T00:00:00Z`).getUTCDay();
    const forecast = demandByDate.dowAvg.get(dow) ?? null;
    const point: Record<string, unknown> = {
      date: m.stay_date,
      label: new Date(`${m.stay_date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" }),
      pickup: m.netPickup ?? 0,
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
    return point as {
      date: string; label: string; pickup: number; occ: number; adr: number | null;
      demand: number | null; demandForecast: number | null; monthStart: boolean; month: string;
      [key: string]: unknown;
    };
  }), [metrics, days, demandByDate, compare, hotels, latestByHotelDate]);

  /** Next-30-day headline per property, the number owners quote each other. */
  const comparisonSummary = useMemo(() => {
    if (!compare) return [];
    const cutoff = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return hotels.map((h) => {
      const mine = Array.from(latestByHotelDate.values())
        .filter((r) => r.hotel_id === h.hotel_id && r.stay_date <= cutoff);
      const occ = mine.map((r) => Number(r.occupancy_pct ?? 0)).filter((n) => n > 0);
      const adr = mine.map((r) => Number(r.adr_eur ?? 0)).filter((n) => n > 0);
      const revenue = mine.reduce((s, r) => s + Number(r.revenue_eur ?? 0), 0);
      const roomNights = mine.reduce((s, r) => s + (Number(r.rooms_available) || 0), 0);
      return {
        ...h,
        occ: occ.length ? Math.round(occ.reduce((a, b) => a + b, 0) / occ.length) : 0,
        adr: adr.length ? Math.round(adr.reduce((a, b) => a + b, 0) / adr.length) : 0,
        revpar: roomNights > 0 ? Math.round(revenue / roomNights) : 0,
      };
    }).sort((a, b) => (a.hotel_id === hotelId ? -1 : b.hotel_id === hotelId ? 1 : 0));
  }, [compare, hotels, latestByHotelDate, hotelId]);

  /** Labels for the month dividers drawn across the plot. */
  const monthMarks = useMemo(() => data.filter((d) => d.monthStart), [data]);

  /** Numbers over each bar stay readable only while the bars are wide enough. */
  const showLabels = data.length <= 45 && !compare;

  /** A tight ADR band around the real values keeps the line meaningful. */
  const adrDomain = useMemo<[number, number]>(() => {
    const vals = data.map((d) => d.adr).filter((v): v is number => typeof v === "number" && v > 0);
    if (vals.length === 0) return [0, 100];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(10, (hi - lo) * 0.15);
    return [Math.max(0, Math.floor((lo - pad) / 10) * 10), Math.ceil((hi + pad) / 10) * 10];
  }, [data]);

  const totalPickup = useMemo(() => data.reduce((s, d) => s + (d.pickup || 0), 0), [data]);
  const peak = useMemo(() => data.reduce((best, d) => (d.pickup > (best?.pickup ?? -99) ? d : best), data[0]), [data]);

  /** Occupancy scale is on screen whenever anything uses it. */
  const usesPercentAxis = showOcc || showDemand || compare;
  const hasDemand = demandByDate.actual.size > 0;

  function applyPeriod(key: PeriodKey, custom = customDays) {
    setPeriod(key);
    onPickupWindowChange?.(windowForPeriod(key, custom));
  }

  return (
    <Card>
      <CardHeader className="pb-2 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Demand &amp; pickup horizon
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={totalPickup > 0 ? "secondary" : "outline"} className="font-normal">
              {totalPickup > 0 ? "+" : ""}{totalPickup} rooms in view
            </Badge>
            {peak && peak.pickup > 0 && (
              <Badge variant={peak.pickup >= 3 ? "destructive" : "secondary"}>
                Peak {peak.label}: +{peak.pickup}
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
                    value={customDays}
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
                measuring {pickupWindowDays ?? 1} day{(pickupWindowDays ?? 1) > 1 ? "s" : ""} of bookings
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
            {hotels.length > 1 && (
              <Button size="sm" variant={compare ? "default" : "ghost"} className="h-7 rounded-none px-2 text-xs"
                onClick={() => setCompare((v) => !v)}>Compare properties</Button>
            )}
          </div>
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
                  <p className="mt-1 text-[10px] text-muted-foreground">next 30 days · tap to {on ? "hide" : "show"}</p>
                </button>
              );
            })}
          </div>
        )}
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 8))} />
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
                formatter={(value: unknown, name: string) => {
                  if (name === "ADR") return [money(Number(value)), name];
                  if (name === "Pickup") {
                    const n = value as number;
                    return [`${n > 0 ? "+" : ""}${n} room${Math.abs(n) === 1 ? "" : "s"}`, name];
                  }
                  return [`${value}%`, name];
                }}
              />
              {/* Clicking a legend entry hides or shows that series, so the
                  reader can isolate pickup when the lines overlap. */}
              <Legend
                wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                onClick={(entry: { value?: string; id?: string }) => {
                  if (entry?.value === "Occupancy") setShowOcc((v) => !v);
                  if (entry?.value === "ADR") setShowAdr((v) => !v);
                  if (entry?.value === "City demand") setShowDemand((v) => !v);
                  const hotel = hotels.find((h) => h.hotel_name === entry?.value);
                  if (hotel) toggleHotel(hotel.hotel_id);
                }}
                payload={[
                  { value: "Pickup", type: "square", color: PICKUP_LEGEND_COLOR, id: "pickup" },
                  { value: "Occupancy", type: "line", color: showOcc ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.4)", id: "occ" },
                  { value: "ADR", type: "line", color: showAdr ? ADR_COLOR : "hsl(var(--muted-foreground) / 0.4)", id: "adr" },
                  ...(hasDemand ? [{ value: "City demand", type: "line" as const, color: showDemand ? DEMAND_COLOR : "hsl(var(--muted-foreground) / 0.4)", id: "demand" }] : []),
                  ...(compare ? hotels.map((h, i) => ({ value: h.hotel_name, type: "line" as const, color: hiddenHotels.has(h.hotel_id) ? "hsl(var(--muted-foreground) / 0.4)" : colorFor(h.hotel_id, i), id: h.hotel_id })) : []),
                ]}
              />
              <Bar yAxisId="pickup" dataKey="pickup" name="Pickup" radius={[2, 2, 0, 0]} maxBarSize={18} minPointSize={3}
                fill={PICKUP_LEGEND_COLOR} isAnimationActive animationDuration={550}>
                {data.map((d) => <Cell key={d.date} fill={barColor(d.pickup)} />)}
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
              {compare && hotels.map((h, i) => (
                <Line key={h.hotel_id} yAxisId="right" type="monotone" dataKey={`h_${h.hotel_id}`} name={h.hotel_name}
                  stroke={colorFor(h.hotel_id, i)} strokeWidth={h.hotel_id === hotelId ? 2.5 : 1.5}
                  dot={false} connectNulls opacity={0.85} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="px-3 pt-2 text-[11px] text-muted-foreground">
          Bars: net pickup per arrival date (new bookings minus cancellations) inside the measurement
          window — left axis, in rooms. Orange to red as pickup grows, blue when it turns negative.
          Lines read on the right axis: occupancy for this property, ADR on its own money scale, and
          <span className="font-medium"> city demand</span> — the average occupancy of every property you
          can see, an in-house Budapest estimate rather than a paid market benchmark; dashed sections are
          predicted from the day-of-week pattern where no property has data yet.
          {hotels.length > 1 ? " “Compare properties” adds one occupancy line per property." : ""}
          {isMobile ? " One of occupancy / ADR at a time on mobile." : " Tap a legend entry to hide or show a line."}
          {" "}Dashed vertical lines mark the start of each month. Source: Previo, refreshed at each sync.
        </p>

      </CardContent>

    </Card>
  );
}
