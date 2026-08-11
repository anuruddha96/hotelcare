import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Activity } from "lucide-react";
import type { DayMetrics } from "@/lib/revenueAnalytics";
import { budapestToday, daysBetween } from "@/lib/revenueAnalytics";
import { money, currencySymbol } from "@/lib/revenueCurrency";
import { useIsMobile } from "@/hooks/use-mobile";

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

function barColor(pickup: number): string {
  if (pickup < 0) return "hsl(199 89% 60%)";
  if (pickup === 0) return "hsl(var(--muted-foreground) / 0.25)";
  if (pickup === 1) return "hsl(33 100% 75%)";
  if (pickup === 2) return "hsl(28 96% 60%)";
  if (pickup === 3) return "hsl(0 84% 60%)";
  return "hsl(0 72% 45%)";
}

interface Props {
  metrics: DayMetrics[];
  /** Current pickup measurement window (days back). */
  pickupWindowDays?: number;
  onPickupWindowChange?: (days: number) => void;
}

/** Pickup + occupancy over an adjustable horizon, peaks in red. */
export default function PickupHorizonChart({ metrics, pickupWindowDays, onPickupWindowChange }: Props) {
  const isMobile = useIsMobile();
  // Wide bars beat a long horizon on a phone: 30 days is still readable.
  const [days, setDays] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768 ? 30 : 60));
  /** Optional series the user can layer on top of pickup. */
  const [showOcc, setShowOcc] = useState(true);
  const [showAdr, setShowAdr] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [customDays, setCustomDays] = useState(7);

  const data = useMemo(() => metrics.slice(0, days).map((m) => ({
    date: m.stay_date,
    label: new Date(`${m.stay_date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" }),
    pickup: m.netPickup ?? 0,
    occ: Math.round(m.occupancyPct),
    adr: m.adrEur ? Math.round(m.adrEur) : null,
    monthStart: m.stay_date.endsWith("-01"),
    month: new Date(`${m.stay_date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", year: "2-digit" }),
  })), [metrics, days]);

  /** Labels for the month dividers drawn across the plot. */
  const monthMarks = useMemo(() => data.filter((d) => d.monthStart), [data]);

  /** Numbers over each bar stay readable only while the bars are wide enough. */
  const showLabels = data.length <= 45;


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
            Pickup &amp; occupancy horizon
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
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-1 sm:px-4">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 8))} />
              {/* Pickup owns the left axis so single-room days stay visible
                  even when ADR runs in the hundreds. */}
              <YAxis yAxisId="pickup" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={24}
                allowDecimals={false} domain={[(min: number) => Math.min(0, min) - 1, (max: number) => Math.max(2, max) + 1]} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={30}
                tickFormatter={(v: number) => `${v}%`}
                hide={!showOcc} />
              {/* ADR keeps a real, labelled scale so the line can be read, not
                  just admired. It is only shown when ADR is the chosen metric. */}
              <YAxis yAxisId="adr" orientation="right" width={44} tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                hide={!showAdr || showOcc}
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
                  if (name === "Occupancy") return [`${value}%`, name];
                  if (name === "ADR") return [money(Number(value)), name];
                  const n = value as number;
                  return [`${n > 0 ? "+" : ""}${n} room${Math.abs(n) === 1 ? "" : "s"}`, name];
                }}
              />
              {/* Clicking a legend entry hides or shows that series, so the
                  reader can isolate pickup when the three overlap. */}
              <Legend
                wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                onClick={(entry: { value?: string }) => {
                  if (entry?.value === "Occupancy") setShowOcc((v) => !v);
                  if (entry?.value === "ADR") setShowAdr((v) => !v);
                }}
                payload={[
                  { value: "Pickup", type: "square", color: PICKUP_LEGEND_COLOR, id: "pickup" },
                  { value: "Occupancy", type: "line", color: showOcc ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.4)", id: "occ" },
                  { value: "ADR", type: "line", color: showAdr ? ADR_COLOR : "hsl(var(--muted-foreground) / 0.4)", id: "adr" },
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
              {showAdr && (
                <Line yAxisId="adr" type="monotone" dataKey="adr" name="ADR" stroke={ADR_COLOR} strokeWidth={2} dot={false} connectNulls={false} opacity={0.9} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="px-3 pt-2 text-[11px] text-muted-foreground">
          Bars: net pickup per arrival date (new bookings minus cancellations) inside the measurement
          window — left axis, in rooms. Orange to red as pickup grows, blue when it turns negative.
          The line shows {showAdr && !showOcc ? "ADR for that date on the right axis" : "occupancy for that date on the right axis, in %"}
          {isMobile ? " — one line at a time on mobile, use the Occupancy / ADR buttons to swap." : ". Tap a legend entry to hide or show a line."}
          {" "}Dates with no ADR yet are left blank rather than joined up. Dashed vertical lines mark the
          start of each month. Source: Previo reservations, refreshed at each sync.
        </p>

      </CardContent>

    </Card>
  );
}
