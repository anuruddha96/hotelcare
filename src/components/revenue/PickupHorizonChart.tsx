import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bar, BarChart, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Activity } from "lucide-react";
import type { DayMetrics } from "@/lib/revenueAnalytics";

const RANGES = [
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 60, label: "60d" },
  { value: 90, label: "90d" },
  { value: 180, label: "6m" },
];

function barColor(pickup: number): string {
  if (pickup < 0) return "hsl(199 89% 60%)";
  if (pickup === 0) return "hsl(var(--muted-foreground) / 0.25)";
  if (pickup === 1) return "hsl(33 100% 75%)";
  if (pickup === 2) return "hsl(28 96% 60%)";
  if (pickup === 3) return "hsl(0 84% 60%)";
  return "hsl(0 72% 45%)";
}

/** Pickup + occupancy over an adjustable horizon, peaks in red. */
export default function PickupHorizonChart({ metrics }: { metrics: DayMetrics[] }) {
  const [days, setDays] = useState(30);

  const data = useMemo(() => metrics.slice(0, days).map((m) => ({
    date: m.stay_date,
    label: new Date(`${m.stay_date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" }),
    pickup: m.netPickup ?? m.newBookings,
    occ: Math.round(m.occupancyPct),
    adr: m.adrEur,
  })), [metrics, days]);

  const peak = useMemo(() => data.reduce((best, d) => (d.pickup > (best?.pickup ?? -99) ? d : best), data[0]), [data]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Pickup &amp; occupancy horizon
          </CardTitle>
          <div className="flex items-center gap-2">
            {peak && peak.pickup > 0 && (
              <Badge variant={peak.pickup >= 3 ? "destructive" : "secondary"}>
                Peak {peak.label}: +{peak.pickup}
              </Badge>
            )}
            <div className="flex rounded-md border overflow-hidden">
              {RANGES.map((r) => (
                <Button key={r.value} size="sm" variant={days === r.value ? "default" : "ghost"}
                  className="h-7 rounded-none px-2 text-xs" onClick={() => setDays(r.value)}>
                  {r.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 12))} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
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
