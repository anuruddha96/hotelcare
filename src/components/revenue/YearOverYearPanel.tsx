import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/revenueCurrency";
import { buildMonthBreakdown, wholeMonthOf, type ReconciliationDay } from "@/lib/kpiReconciliation";
import { Loader2, AlertTriangle } from "lucide-react";

interface Props { hotelId: string | null; }
type SnapshotDate = { stay_date: string };
type MonthData = {
  yearMonth: string;
  coverage: number;
  days: number;
  sold: number;
  available: number;
  revenue: number;
  adr: number | null;
  occupancy: number | null;
  revpar: number | null;
};
type Comparison = { label: string; year: number; now: MonthData | null; lastYear: MonthData | null };

export function monthLength(yearMonth: string): number {
  return new Date(Date.UTC(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)), 0)).getUTCDate();
}

/** Reconciliation is the same source/formula as the main whole-month KPI header.
 * Snapshot dates prove when a hotel actually started keeping history. The SQL
 * reconciliation emits empty calendar dates even for years with NO PMS data;
 * never mistake those empty days for genuine zero-occupancy history.
 */
export function buildYearComparison(days: ReconciliationDay[], snapshots: SnapshotDate[], year: number): Comparison[] {
  const covered = new Map<string, Set<string>>();
  snapshots.forEach((row) => {
    const key = String(row.stay_date).slice(0, 7);
    const dates = covered.get(key) ?? new Set<string>();
    dates.add(String(row.stay_date).slice(0, 10));
    covered.set(key, dates);
  });
  const groups = new Map<string, ReconciliationDay[]>();
  for (const d of days) {
    const key = d.stay_date.slice(0, 7);
    const group = groups.get(key) ?? [];
    group.push(d);
    groups.set(key, group);
  }
  const take = (key: string): MonthData | null => {
    const list = groups.get(key) ?? [];
    const evidence = covered.get(key)?.size ?? 0;
    if (evidence === 0 || new Set(list.map((d) => d.stay_date)).size !== monthLength(key)) return null;
    const month = wholeMonthOf(buildMonthBreakdown(list));
    if (!month || month.capacity <= 0) return null;
    return {
      yearMonth: key,
      coverage: evidence,
      days: monthLength(key),
      sold: month.sold,
      available: month.capacity,
      revenue: month.revenueGross,
      adr: month.adrGross,
      occupancy: month.occupancyPct,
      revpar: month.revparGross,
    };
  };
  return Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    return {
      year,
      label: new Date(Date.UTC(year, i, 1)).toLocaleString("en-US", { month: "short" }),
      now: take(`${year}-${mm}`),
      lastYear: take(`${year - 1}-${mm}`),
    };
  });
}

function change(now: number, before: number): string {
  if (before <= 0) return "—";
  const value = ((now - before) / before) * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)}%`;
}

export default function YearOverYearPanel({ hotelId }: Props) {
  const [year] = useState(() => new Date().getFullYear());
  const [rows, setRows] = useState<ReconciliationDay[]>([]);
  const [evidence, setEvidence] = useState<SnapshotDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    if (!hotelId) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    const from = `${year - 1}-01-01`;
    const to = `${year}-12-31`;
    void (async () => {
      try {
        // Each RPC returns one night per date, NOT every historical capture.
        // A two-year window is at most 731 rows, under the PostgREST result cap.
        const [recon, coverage] = await Promise.all([
          (supabase as any).rpc("revenue_kpi_reconciliation_days", {
            p_hotel_id: hotelId, p_from: from, p_to: `${year}-12-01`,
          }).range(0, 800),
          supabase.rpc("revenue_portfolio_latest_snapshots", {
            _hotel_ids: [hotelId], _from: from, _to: to,
          }).range(0, 800),
        ]);
        if (recon.error) throw recon.error;
        if (coverage.error) throw coverage.error;
        if (!alive) return;
        setRows((recon.data ?? []) as ReconciliationDay[]);
        setEvidence((coverage.data ?? []) as SnapshotDate[]);
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : "History unavailable");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [hotelId, year]);

  const months = useMemo(() => buildYearComparison(rows, evidence, year), [rows, evidence, year]);
  const visible = showEmpty ? months : months.filter((m) => m.now || m.lastYear);
  const withBoth = months.filter((m) => m.now && m.lastYear).length;

  if (loading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reconciling stay-date history…</p>;
  if (error) return <p role="alert" className="text-sm text-destructive">Couldn't reconcile historical figures: {error}</p>;

  return (
    <div className="min-w-0 space-y-3">
      <div className="rounded-lg border p-3 text-sm">
        <p className="font-semibold">{year} vs {year - 1}</p>
        <p className="mt-1 text-xs text-muted-foreground">{withBoth} months have data in both years. Prior-year differences are not calculated without a verified baseline.</p>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-medium">How these figures are calculated</summary>
          <p className="mt-2 text-muted-foreground">One current reconciled record per stay date, including completed stays and bookings on the books. Occupancy = commercial sold room-nights ÷ commercial capacity. ADR = gross booking value (breakfast/extras included) ÷ priced sold room-nights. RevPAR = gross booking value ÷ available room-nights. The historic snapshot archive confirms whether dates were actually collected; a missing year is never interpreted as zero revenue.</p>
        </details>
      </div>
      {months.some((m) => m.now && m.now.coverage < m.now.days) && (
        <p className="flex gap-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" /> Some early months have incomplete archived snapshots. They are clearly labelled and should not be used for a definitive year-on-year comparison.</p>
      )}
      {visible.length ? (
        <div className="space-y-2">
          {visible.map((m) => {
            const current = m.now, previous = m.lastYear;
            const partial = current && current.coverage < current.days;
            return <section key={m.label} className="rounded-xl border p-3" aria-label={`${m.label} ${year} comparison`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm">{m.label} {year}</strong>
                <span className="text-[11px] text-muted-foreground">{current ? `${current.coverage}/${current.days} archived dates` : "No synced month"}</span>
              </div>
              {current ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div><p className="text-[10px] text-muted-foreground">Occupancy</p><p className="text-lg font-semibold tabular-nums">{current.occupancy == null ? "—" : `${Math.round(current.occupancy)}%`}</p></div>
                    <div><p className="text-[10px] text-muted-foreground">ADR · gross</p><p className="text-lg font-semibold tabular-nums">{current.adr == null ? "—" : money(current.adr)}</p></div>
                    <div><p className="text-[10px] text-muted-foreground">RevPAR</p><p className="text-lg font-semibold tabular-nums">{current.revpar == null ? "—" : money(current.revpar)}</p></div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t pt-2 text-xs">
                    <span>Revenue <strong className="tabular-nums">{money(current.revenue)}</strong></span>
                    <span className="text-muted-foreground">vs {year-1}: {previous && !partial && previous.coverage === previous.days ? change(current.revenue, previous.revenue) : "No comparable baseline"}</span>
                  </div>
                  {partial && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Historical collection partial — verify this month before treating the figures as final.</p>}
                </>
              ) : <p className="text-xs text-muted-foreground">No archived stay-date observations. No occupancy or revenue figure has been assumed.</p>}
            </section>;
          })}
        </div>
      ) : <p className="text-sm text-muted-foreground">No verified stay-date archive available for this property.</p>}
      <button type="button" className="text-xs font-medium text-primary underline" onClick={() => setShowEmpty((v) => !v)}>
        {showEmpty ? "Hide unavailable months" : "Show all twelve months"}
      </button>
    </div>
  );
}
