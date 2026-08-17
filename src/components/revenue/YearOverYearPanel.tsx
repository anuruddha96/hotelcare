// Year-over-year overview: this year next to the same months last year.
//
// Reads the daily snapshots the Previo sync already stores. Where last year has
// no snapshot the cell says "no data" instead of pretending the hotel sold
// nothing.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/revenueCurrency";
import { Loader2 } from "lucide-react";

interface Props {
  hotelId: string | null;
}

interface Snap {
  stay_date: string;
  rooms_sold: number | null;
  rooms_available: number | null;
  revenue_eur: number | null;
}

interface MonthAgg {
  key: string;
  sold: number;
  available: number;
  revenue: number;
  days: number;
}

function aggregate(rows: Snap[]): Map<string, MonthAgg> {
  const map = new Map<string, MonthAgg>();
  for (const r of rows) {
    const key = r.stay_date.slice(0, 7);
    const cur = map.get(key) ?? { key, sold: 0, available: 0, revenue: 0, days: 0 };
    cur.sold += Number(r.rooms_sold ?? 0);
    cur.available += Number(r.rooms_available ?? 0);
    cur.revenue += Number(r.revenue_eur ?? 0);
    cur.days += 1;
    map.set(key, cur);
  }
  return map;
}

function pct(now: number, prev: number): string {
  if (!prev) return "—";
  const v = ((now - prev) / prev) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
}

function tone(now: number, prev: number): string {
  if (!prev || !now) return "text-muted-foreground";
  return now >= prev ? "text-emerald-600" : "text-red-600";
}

export default function YearOverYearPanel({ hotelId }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Snap[]>([]);

  useEffect(() => {
    if (!hotelId) return;
    let alive = true;
    setLoading(true);
    const from = `${new Date().getUTCFullYear() - 1}-01-01`;
    void (async () => {
      const { data } = await supabase
        .from("revenue_daily_snapshots")
        .select("stay_date, rooms_sold, rooms_available, revenue_eur")
        .eq("hotel_id", hotelId)
        .gte("stay_date", from)
        .order("stay_date", { ascending: true })
        .limit(5000);
      if (!alive) return;
      setRows((data ?? []) as Snap[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [hotelId]);

  const months = useMemo(() => {
    const agg = aggregate(rows);
    const year = new Date().getUTCFullYear();
    return Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, "0");
      const now = agg.get(`${year}-${mm}`);
      const prev = agg.get(`${year - 1}-${mm}`);
      const calc = (a?: MonthAgg) =>
        a
          ? {
              occ: a.available ? (a.sold / a.available) * 100 : 0,
              adr: a.sold ? a.revenue / a.sold : 0,
              revpar: a.available ? a.revenue / a.available : 0,
              revenue: a.revenue,
            }
          : null;
      return {
        label: new Date(Date.UTC(year, i, 1)).toLocaleString("en-US", { month: "short" }),
        now: calc(now),
        prev: calc(prev),
      };
    });
  }, [rows]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
      </div>
    );
  }

  const anyLastYear = months.some((m) => m.prev);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        This year against the same month last year. {anyLastYear ? "" : "No data has been synced for last year yet, so only this year is shown."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1.5 text-left font-medium">Month</th>
              <th className="py-1.5 text-right font-medium">Occ.</th>
              <th className="py-1.5 text-right font-medium">ADR</th>
              <th className="py-1.5 text-right font-medium">RevPAR</th>
              <th className="py-1.5 text-right font-medium">Revenue</th>
              <th className="py-1.5 text-right font-medium">vs LY</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.label} className="border-b border-border/50">
                <td className="py-1.5">{m.label}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {m.now ? `${m.now.occ.toFixed(0)}%` : "—"}
                </td>
                <td className="py-1.5 text-right tabular-nums">{m.now ? money(m.now.adr) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{m.now ? money(m.now.revpar) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{m.now ? money(m.now.revenue) : "—"}</td>
                <td className={`py-1.5 text-right tabular-nums ${m.now && m.prev ? tone(m.now.revenue, m.prev.revenue) : "text-muted-foreground"}`}>
                  {m.now && m.prev ? pct(m.now.revenue, m.prev.revenue) : "no data"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
