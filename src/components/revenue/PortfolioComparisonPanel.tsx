import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Side-by-side portfolio view: one line per property so an owner can see at a
 * glance which hotel is ahead on occupancy, ADR or RevPAR over the next
 * 90 days. Colours are fixed per property so the eye learns them.
 */

interface Props {
  hotels: Array<{ hotel_id: string; hotel_name: string }>;
  /** Currency label shown on the axis; portfolio numbers are kept in EUR. */
  currency?: string;
}

type Metric = "occupancy" | "adr" | "revpar" | "rooms";

const METRICS: Array<{ key: Metric; label: string; suffix: string }> = [
  { key: "occupancy", label: "Occupancy", suffix: "%" },
  { key: "adr", label: "ADR", suffix: "" },
  { key: "revpar", label: "RevPAR", suffix: "" },
  { key: "rooms", label: "Rooms sold", suffix: "" },
];

/** Owner-chosen colours. Anything unlisted falls back to a neutral slate. */
const HOTEL_COLORS: Record<string, string> = {
  "mika-downtown": "#111111",
  "memories-budapest": "#B5835A",
  ottofiori: "#2E7D32",
  "gozsdu-court": "#CD7F32",
};
const FALLBACK = ["#3B82F6", "#9333EA", "#DC2626", "#0891B2"];

interface Row {
  hotel_id: string;
  stay_date: string;
  captured_date: string;
  occupancy_pct: number | null;
  adr_eur: number | null;
  revenue_eur: number | null;
  rooms_sold: number | null;
  rooms_available: number | null;
}

export default function PortfolioComparisonPanel({ hotels, currency = "EUR" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<Metric>("occupancy");

  const hotelIds = useMemo(() => hotels.map((h) => h.hotel_id), [hotels]);
  const idsKey = hotelIds.join(",");

  useEffect(() => {
    if (hotelIds.length === 0) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      const out: Row[] = [];
      for (let offset = 0; offset < 12000; offset += 1000) {
        const { data, error } = await supabase
          .from("revenue_daily_snapshots")
          .select("hotel_id, stay_date, captured_date, occupancy_pct, adr_eur, revenue_eur, rooms_sold, rooms_available")
          .in("hotel_id", hotelIds)
          .gte("stay_date", today)
          .lte("stay_date", end)
          .order("captured_date", { ascending: false })
          .range(offset, offset + 999);
        if (error) break;
        const page = (data ?? []) as Row[];
        out.push(...page);
        if (page.length < 1000) break;
      }
      if (!cancelled) { setRows(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Newest capture wins for each hotel + stay date.
  const latest = useMemo(() => {
    const map = new Map<string, Row>();
    for (const r of rows) {
      const key = `${r.hotel_id}|${r.stay_date}`;
      if (!map.has(key)) map.set(key, r);
    }
    return Array.from(map.values());
  }, [rows]);

  const value = (r: Row): number | null => {
    const rooms = Number(r.rooms_available) || 0;
    switch (metric) {
      case "occupancy": return r.occupancy_pct == null ? null : Math.round(Number(r.occupancy_pct));
      case "adr": return r.adr_eur == null ? null : Math.round(Number(r.adr_eur));
      case "revpar": return rooms > 0 ? Math.round(Number(r.revenue_eur ?? 0) / rooms) : null;
      case "rooms": return r.rooms_sold == null ? null : Number(r.rooms_sold);
    }
  };

  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const r of latest) {
      const point = byDate.get(r.stay_date) ?? { stay_date: r.stay_date };
      point[r.hotel_id] = value(r);
      byDate.set(r.stay_date, point);
    }
    return Array.from(byDate.values()).sort((a, b) =>
      String(a.stay_date).localeCompare(String(b.stay_date)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, metric]);

  // Next-30-day averages, the number owners actually quote to each other.
  const summary = useMemo(() => {
    const cutoff = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return hotels.map((h) => {
      const mine = latest.filter((r) => r.hotel_id === h.hotel_id && r.stay_date <= cutoff);
      const occ = mine.map((r) => Number(r.occupancy_pct ?? 0)).filter((n) => n > 0);
      const adr = mine.map((r) => Number(r.adr_eur ?? 0)).filter((n) => n > 0);
      const revenue = mine.reduce((s, r) => s + Number(r.revenue_eur ?? 0), 0);
      const roomNights = mine.reduce((s, r) => s + (Number(r.rooms_available) || 0), 0);
      return {
        ...h,
        occ: occ.length ? Math.round(occ.reduce((a, b) => a + b, 0) / occ.length) : 0,
        adr: adr.length ? Math.round(adr.reduce((a, b) => a + b, 0) / adr.length) : 0,
        revpar: roomNights > 0 ? Math.round(revenue / roomNights) : 0,
        revenue: Math.round(revenue),
      };
    });
  }, [latest, hotels]);

  const colorFor = (id: string, i: number) => HOTEL_COLORS[id] ?? FALLBACK[i % FALLBACK.length];
  const suffix = METRICS.find((m) => m.key === metric)?.suffix ?? "";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" /> Portfolio comparison · next 90 days
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {METRICS.map((m) => (
              <Button
                key={m.key}
                size="sm"
                variant={metric === m.key ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {summary.map((s, i) => (
            <div key={s.hotel_id} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorFor(s.hotel_id, i) }} />
                <p className="truncate text-sm font-medium">{s.hotel_name}</p>
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{s.occ}%</p>
              <p className="text-xs text-muted-foreground">
                next 30 days · ADR {s.adr} · RevPAR {s.revpar} {currency}
              </p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : chartData.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No live data yet for these properties. Run a Previo sync to fill the comparison.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="stay_date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d: string) =>
                    new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  minTickGap={28}
                />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}${suffix}`} />
                <RTooltip
                  formatter={(v: any, name: any) => [
                    `${v}${suffix}`,
                    hotels.find((h) => h.hotel_id === name)?.hotel_name ?? name,
                  ]}
                  labelFormatter={(d: any) => new Date(d).toLocaleDateString()}
                />
                <Legend
                  formatter={(name: any) => hotels.find((h) => h.hotel_id === name)?.hotel_name ?? name}
                  wrapperStyle={{ fontSize: 12 }}
                />
                {hotels.map((h, i) => (
                  <Line
                    key={h.hotel_id}
                    type="monotone"
                    dataKey={h.hotel_id}
                    stroke={colorFor(h.hotel_id, i)}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
