import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bar, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Activity } from "lucide-react";
import type { DayMetrics } from "@/lib/revenueAnalytics";
import { budapestToday, daysBetween } from "@/lib/revenueAnalytics";

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
  { key: "yesterday", label: "Yesterday" },
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
  const [days, setDays] = useState(30);
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [customDays, setCustomDays] = useState(7);

  const data = useMemo(() => metrics.slice(0, days).map((m) => ({
    date: m.stay_date,
    label: new Date(`${m.stay_date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" }),
    pickup: m.netPickup ?? 0,
    occ: Math.round(m.occupancyPct),
    adr: m.adrEur,
  })), [metrics, days]);

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
        </div>
      </CardHeader>
      <CardContent className="px-1 sm:px-4">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 8))} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
              <RTooltip
                contentStyle={{ fontSize: 11, padding: "4px 8px" }}
                formatter={(value: unknown, name: string) => {
                  if (name === "Occupancy") return [`${value}%`, name];
                  if (name === "ADR") return [`€${value}`, name];
                  return [value as number, name];
                }}
              />
              <Bar yAxisId="left" dataKey="pickup" name="Pickup" radius={[2, 2, 0, 0]} maxBarSize={18}>
                {data.map((d) => <Cell key={d.date} fill={barColor(d.pickup)} />)}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="occ" name="Occupancy" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
