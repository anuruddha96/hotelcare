import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/revenueCurrency";
import { useMonthReconciliationDays } from "@/hooks/useMonthReconciliationDays";
import { buildMonthBreakdown, wholeMonthOf } from "@/lib/kpiReconciliation";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";

interface Props { hotelId: string | null; selectedMonth: string; }
export interface ChannelNight {
  stay_date: string;
  res_id: string | null;
  obk_id?: string | null;
  source_name: string | null;
  status_id: number | null;
  stay_from?: string | null;
  stay_to?: string | null;
  nightly_price_eur: number | string | null;
  created_at_pms: string | null;
}
export interface ChannelResult {
  name: string;
  sold: number;
  priced: number;
  reservations: number;
  revenue: number;
  recent: number;
}
function booked(n: ChannelNight): boolean {
  if (n.status_id == null || n.status_id === 7 || n.status_id === 8) return false;
  if (n.stay_from && n.stay_to && n.stay_to <= n.stay_from) return false;
  // Long source-less Previo blocks reserve inventory; they are not sales.
  const duration = n.stay_from && n.stay_to
    ? Math.round((new Date(n.stay_to).getTime() - new Date(n.stay_from).getTime()) / 86_400_000) : 0;
  return !(!n.source_name?.trim() && duration > 366);
}
export function aggregateChannels(nights: ChannelNight[], selectedMonth: string, since: number): ChannelResult[] {
  const out = new Map<string, ChannelResult & { reservationIds: Set<string> }>();
  for (const n of nights) {
    if (!n.stay_date?.startsWith(selectedMonth) || !booked(n)) continue;
    // Missing source is not necessarily a direct booking.
    const channel = n.source_name?.trim() || "Unspecified source";
    let row = out.get(channel);
    if (!row) {
      row = { name: channel, sold: 0, priced: 0, reservations: 0, revenue: 0, recent: 0, reservationIds: new Set() };
      out.set(channel, row);
    }
    row.sold += 1;
    const price = Number(n.nightly_price_eur ?? 0);
    if (price !== 0 && Number.isFinite(price)) {
      row.revenue += price;
      row.priced += 1;
    }
    if (n.res_id) row.reservationIds.add(n.res_id);
    const created = n.created_at_pms ? Date.parse(n.created_at_pms) : NaN;
    if (Number.isFinite(created) && created >= since) row.recent += 1;
  }
  return [...out.values()].map(({ reservationIds, ...row }) => ({ ...row, reservations: reservationIds.size }))
    .sort((a,b) => b.sold - a.sold || a.name.localeCompare(b.name));
}

export default function SegmentPerformancePanel({ hotelId, selectedMonth }: Props) {
  const [windowDays, setWindowDays] = useState<1 | 7 | 30>(7);
  const [nights, setNights] = useState<ChannelNight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: reconciled } = useMonthReconciliationDays(hotelId, selectedMonth);
  const whole = useMemo(() => wholeMonthOf(buildMonthBreakdown(reconciled ?? [])), [reconciled]);

  useEffect(() => {
    if (!hotelId || !/^\d{4}-\d{2}$/.test(selectedMonth)) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setError(null);
    const [year, month] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    void (async () => {
      try {
        const all: ChannelNight[] = [];
        // Read the FULL stay month, including completed nights. The live revenue
        // hook starts at today and was previously dropping the first 12 days.
        for (let offset = 0; ; offset += 700) {
          const { data, error: fetchError } = await supabase.from("revenue_booking_nights")
            .select("stay_date,res_id,obk_id,source_name,status_id,stay_from,stay_to,nightly_price_eur,created_at_pms")
            .eq("hotel_id", hotelId)
            .gte("stay_date", `${selectedMonth}-01`)
            .lte("stay_date", `${selectedMonth}-${String(lastDay).padStart(2,"0")}`)
            .order("stay_date")
            .range(offset, offset + 699);
          if (fetchError) throw fetchError;
          const page = (data ?? []) as ChannelNight[];
          all.push(...page);
          if (page.length < 700) break;
          if (offset > 20000) throw new Error("Too many rows to verify; please narrow the month.");
        }
        if (active) setNights(all);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not read booking channels");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [hotelId, selectedMonth]);

  const rows = useMemo(() => aggregateChannels(nights, selectedMonth, Date.now() - windowDays * 86_400_000), [nights, selectedMonth, windowDays]);
  const totals = useMemo(() => rows.reduce((a,r) => ({
    sold: a.sold + r.sold, priced: a.priced + r.priced, reservations: a.reservations + r.reservations,
    revenue: a.revenue + r.revenue, recent: a.recent + r.recent,
  }), { sold:0, priced:0, reservations:0, revenue:0, recent:0 }), [rows]);
  const mismatch = whole && (whole.sold !== totals.sold || Math.abs(whole.revenueGross - totals.revenue) > 1);

  if (loading) return <p className="flex gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Verifying booking channels for {selectedMonth}…</p>;
  if (error) return <p role="alert" className="text-sm text-destructive">Channel report unavailable: {error}</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No synced, commercially sold booking nights for {selectedMonth}.</p>;

  return <div className="min-w-0 space-y-3">
    <div className="rounded-lg border p-3">
      <p className="text-sm font-semibold">{selectedMonth} · all stay dates</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div><p className="text-[10px] text-muted-foreground">Sold nights</p><strong className="text-lg tabular-nums">{totals.sold}</strong></div>
        <div><p className="text-[10px] text-muted-foreground">Booking value</p><strong className="text-lg tabular-nums">{money(totals.revenue)}</strong></div>
        <div><p className="text-[10px] text-muted-foreground">ADR · gross</p><strong className="text-lg tabular-nums">{totals.priced ? money(totals.revenue / totals.priced) : "—"}</strong></div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{totals.reservations} reservation IDs across these channels. {totals.sold - totals.priced} unpriced nights excluded from ADR denominator.</p>
      {mismatch && <p role="alert" className="mt-2 flex gap-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" /> Channel totals differ from reconciled monthly KPIs ({whole.sold} nights, {money(whole.revenueGross)}). Source coverage may be incomplete; do not treat this as a fully verified channel mix.</p>}
      {!mismatch && whole && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Channel sold nights and booking value agree with this month's reconciled totals.</p>}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer font-medium">How this report is calculated</summary>
        <p className="mt-2 text-muted-foreground">All synced Previo booking nights for the selected stay month, including completed stays. Cancelled/no-show and multi-year inventory holds are excluded. Each stay night belongs to its recorded source, with unknown sources shown separately—not assumed to be direct. ADR is gross booking value divided by positively priced nights, including breakfast and extras. Share is sold room-night share. Recent bookings counts surviving sold nights created within the selected rolling period, NOT net pickup after cancellations.</p>
      </details>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-medium">Newly booked nights in last</p>
      <div className="flex gap-1">{([1,7,30] as const).map((v) => <Button key={v} size="sm" variant={windowDays===v?"default":"outline"} onClick={() => setWindowDays(v)} className="h-8 text-xs">{v}d</Button>)}</div>
    </div>
    <div className="space-y-2">
      {rows.map((r) => {
        const share = totals.sold ? (r.sold / totals.sold) * 100 : 0;
        return <section key={r.name} className="rounded-xl border p-3" aria-label={`${r.name} channel`}>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <strong className="min-w-0 break-words text-sm">{r.name}</strong>
            <span className="shrink-0 font-semibold tabular-nums">{share.toFixed(0)}%</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:`${Math.min(100,share)}%`}} /></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><p className="text-[10px] text-muted-foreground">Sold nights</p><strong className="text-base tabular-nums">{r.sold}</strong></div>
            <div><p className="text-[10px] text-muted-foreground">Gross value</p><strong className="text-base tabular-nums">{money(r.revenue)}</strong></div>
            <div><p className="text-[10px] text-muted-foreground">ADR</p><strong className="text-base tabular-nums">{r.priced ? money(r.revenue/r.priced) : "—"}</strong></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{r.reservations} reservations · +{r.recent} recently booked room-nights</p>
        </section>;
      })}
    </div>
  </div>;
}
