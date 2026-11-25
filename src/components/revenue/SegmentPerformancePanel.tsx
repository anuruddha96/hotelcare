import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/revenueCurrency";
import { useMonthReconciliationDays } from "@/hooks/useMonthReconciliationDays";
import { buildMonthBreakdown, wholeMonthOf } from "@/lib/kpiReconciliation";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

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
/** Previo sometimes prefixes source labels with numeric IDs and line breaks.
 * Format them for people without changing the underlying sale classification. */
export function normaliseRevenueSource(source: string | null): string {
  if (!source?.trim()) return "Unspecified source";
  const cleaned = source.replace(/\\n/g, " ").replace(/^\s*\d{1,6}\s+/, "").replace(/\s+/g, " ").trim()
    .replace(/(?:V2XML|XML)$/i, "").trim();
  return cleaned || "Unspecified source";
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
    const channel = normaliseRevenueSource(n.source_name);
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


export type ChannelMetric = "sold" | "revenue" | "adr" | "reservations";
type ChartView = "compare" | "mix" | "trend" | "cards" | "table";
type ChannelSort = "sold" | "revenue" | "adr" | "share" | "growth";

export function monthShift(key: string, offset: number): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return key;
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
}
function formatMonth(key: string, short = false) {
  return new Date(key + "-01T12:00:00Z").toLocaleDateString("en-US",
    { month: short ? "short" : "long", year: short ? undefined : "numeric", timeZone: "UTC" });
}
export function channelTotals(rows: ChannelResult[]) {
  return rows.reduce((sum, row) => ({
    sold: sum.sold + row.sold,
    priced: sum.priced + row.priced,
    revenue: sum.revenue + row.revenue,
    reservations: sum.reservations + row.reservations,
    recent: sum.recent + row.recent,
  }), { sold: 0, priced: 0, revenue: 0, reservations: 0, recent: 0 });
}
export function channelValue(row: Pick<ChannelResult, "sold" | "revenue" | "priced" | "reservations"> | null, metric: ChannelMetric): number | null {
  if (!row) return metric === "adr" ? null : 0;
  if (metric === "adr") return row.priced > 0 ? row.revenue / row.priced : null;
  return row[metric];
}
export function momDelta(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  return { absolute: current - previous, percent: previous === 0 ? null : (current - previous) / Math.abs(previous) * 100 };
}
export function bookingValue(value: number | null, metric: ChannelMetric): string {
  if (value == null) return "—";
  if (metric === "adr" || metric === "revenue") return money(value);
  return Math.round(value).toLocaleString("en-US");
}
function compactAxis(value: number, metric: ChannelMetric): string {
  const n = Math.abs(value);
  const short = n >= 1000 ? (value / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(Math.round(value));
  return metric === "revenue" || metric === "adr" ? "€" + short : short;
}
function changeText(now: number | null, previous: number | null) {
  if (previous === null) return "No previous data";
  const diff = momDelta(now, previous);
  if (!diff) return "Not comparable";
  const pct = diff.percent === null ? "—" : (diff.percent > 0 ? "+" : "") + diff.percent.toFixed(1) + "%";
  return (diff.absolute >= 0 ? "+" : "") + Math.round(diff.absolute).toLocaleString("en-US") + " · " + pct;
}
const PALETTE = ["#0ea5e9", "#14b8a6", "#8b5cf6", "#f59e0b", "#f97316", "#64748b", "#e879f9", "#a3e635"];
function lastDay(month: string) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}
function reconciledMonth(data: ReturnType<typeof useMonthReconciliationDays>["data"], month: string) {
  if (!data || new Set(data.filter((r) => r.stay_date.startsWith(month + "-")).map((r) => r.stay_date)).size !== lastDay(month)) return null;
  return wholeMonthOf(buildMonthBreakdown(data));
}

export default function SegmentPerformancePanel({ hotelId, selectedMonth }: Props) {
  const [focusMonth, setFocusMonth] = useState(selectedMonth);
  const [windowDays, setWindowDays] = useState<1 | 7 | 30>(7);
  const [metric, setMetric] = useState<ChannelMetric>("sold");
  const [view, setView] = useState<ChartView>("compare");
  const [sortBy, setSortBy] = useState<ChannelSort>("sold");
  const [showAll, setShowAll] = useState(false);
  const [nights, setNights] = useState<ChannelNight[]>([]);
  const [loadedRange, setLoadedRange] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setFocusMonth(selectedMonth); }, [selectedMonth]);

  const previousMonth = monthShift(focusMonth, -1);
  const startMonth = view === "trend" ? monthShift(focusMonth, -5) : previousMonth;
  const rangeKey = [hotelId, startMonth, focusMonth].join("|");
  const currentReconciliation = useMonthReconciliationDays(hotelId, focusMonth);
  const previousReconciliation = useMonthReconciliationDays(hotelId, previousMonth);
  const wholeCurrent = useMemo(() => reconciledMonth(currentReconciliation.data, focusMonth), [currentReconciliation.data, focusMonth]);
  const wholePrevious = useMemo(() => reconciledMonth(previousReconciliation.data, previousMonth), [previousReconciliation.data, previousMonth]);

  useEffect(() => {
    if (!hotelId || !/^\d{4}-\d{2}$/.test(focusMonth)) {
      setNights([]); setLoadedRange(""); setLoading(false); return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const all: ChannelNight[] = [];
        // The stay-night table is RLS protected. Fetch full months, not just
        // the live future window, and order by unique ID for stable paging.
        for (let offset = 0; offset <= 21000; offset += 700) {
          const { data, error: fetchError } = await supabase.from("revenue_booking_nights")
            .select("id,stay_date,res_id,obk_id,source_name,status_id,stay_from,stay_to,nightly_price_eur,created_at_pms")
            .eq("hotel_id", hotelId)
            .gte("stay_date", startMonth + "-01")
            .lte("stay_date", focusMonth + "-" + String(lastDay(focusMonth)).padStart(2, "0"))
            .order("stay_date").order("id")
            .range(offset, offset + 699);
          if (fetchError) throw fetchError;
          const page = (data ?? []) as ChannelNight[];
          all.push(...page);
          if (page.length < 700) break;
          if (offset === 21000) throw new Error("Channel history exceeds reporting capacity; cannot safely compare a partial month.");
        }
        if (active) { setNights(all); setLoadedRange(rangeKey); }
      } catch (reason) {
        if (active) { setLoadedRange(""); setError(reason instanceof Error ? reason.message : "Channel report unavailable"); }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [hotelId, focusMonth, startMonth, rangeKey]);

  // Do not display another property's or another month's stale data during a fetch.
  const activeNights = loadedRange === rangeKey ? nights : [];
  const since = useMemo(() => Date.now() - windowDays * 86_400_000, [windowDays]);
  const current = useMemo(() => aggregateChannels(activeNights, focusMonth, since), [activeNights, focusMonth, since]);
  const previous = useMemo(() => aggregateChannels(activeNights, previousMonth, since), [activeNights, previousMonth, since]);
  const currentTotals = useMemo(() => channelTotals(current), [current]);
  const previousTotals = useMemo(() => channelTotals(previous), [previous]);
  const currentAvailable = current.length > 0;
  const previousAvailable = previous.length > 0;
  const byPrevious = useMemo(() => new Map(previous.map((r) => [r.name, r])), [previous]);
  const byCurrent = useMemo(() => new Map(current.map((r) => [r.name, r])), [current]);

  const combined = useMemo(() => {
    const channels = new Set([...current.map((r) => r.name), ...previous.map((r) => r.name)]);
    const rows = [...channels].map((name) => {
      const now = byCurrent.get(name) ?? null;
      const before = byPrevious.get(name) ?? null;
      const nowMetric = channelValue(now, metric), beforeMetric = previousAvailable ? channelValue(before, metric) : null;
      const nowShare = currentTotals.sold ? (now?.sold ?? 0) / currentTotals.sold * 100 : 0;
      const beforeShare = previousTotals.sold ? (before?.sold ?? 0) / previousTotals.sold * 100 : null;
      return { name, now, before, nowMetric, beforeMetric, nowShare, beforeShare,
        change: momDelta(nowMetric, beforeMetric), shareDelta: beforeShare === null ? null : nowShare - beforeShare };
    });
    const sortValue = (r: typeof rows[number]) => {
      if (sortBy === "share") return r.nowShare;
      if (sortBy === "growth") return r.change?.percent ?? -Infinity;
      return channelValue(r.now, sortBy === "adr" ? "adr" : sortBy) ?? -Infinity;
    };
    rows.sort((a, b) => sortValue(b) - sortValue(a) || a.name.localeCompare(b.name));
    return rows;
  }, [current, previous, byCurrent, byPrevious, metric, sortBy, previousAvailable, currentTotals.sold, previousTotals.sold]);
  const visible = showAll ? combined : combined.slice(0, 6);
  const comparison = visible.map((r) => ({
    name: r.name.length > 16 ? r.name.slice(0, 14) + "…" : r.name,
    fullName: r.name,
    current: r.nowMetric,
    previous: r.beforeMetric,
  }));
  const fullRangeMonths = useMemo(() => Array.from({ length: 6 }, (_, i) => monthShift(focusMonth, i - 5)), [focusMonth]);
  const trend = fullRangeMonths.map((month) => {
    const items = aggregateChannels(activeNights, month, since);
    const t = channelTotals(items);
    return { month: formatMonth(month, true), value: items.length ? channelValue(t, metric) : null, label: month };
  });
  const previousMismatch = wholePrevious && previousAvailable && (
    wholePrevious.sold !== previousTotals.sold || Math.abs(wholePrevious.revenueGross - previousTotals.revenue) > 1
  );
  const currentMismatch = wholeCurrent && currentAvailable && (
    wholeCurrent.sold !== currentTotals.sold || Math.abs(wholeCurrent.revenueGross - currentTotals.revenue) > 1
  );
  const mismatch = currentMismatch || previousMismatch;
  const valueFor = (totals: ReturnType<typeof channelTotals>, m: ChannelMetric) => channelValue(totals, m);
  const metrics: { id: ChannelMetric; label: string }[] = [
    { id: "sold", label: "Room-nights" }, { id: "revenue", label: "Revenue" },
    { id: "adr", label: "ADR" }, { id: "reservations", label: "Reservations" },
  ];
  const viewOptions: { id: ChartView; label: string }[] = [
    { id: "compare", label: "MoM bars" }, { id: "mix", label: "Channel mix" },
    { id: "trend", label: "6-month trend" }, { id: "cards", label: "Channel cards" },
    { id: "table", label: "Data table" },
  ];

  return <div className="min-w-0 space-y-4 pb-3">
    <div className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{formatMonth(focusMonth)} · channel performance</h3>
          <p className="text-[11px] text-muted-foreground">All stay dates · compared with {formatMonth(previousMonth)}</p>
        </div>
        <div className="flex items-center gap-1" aria-label="Channel report month navigation">
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Previous report month" onClick={() => setFocusMonth(monthShift(focusMonth, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setFocusMonth(selectedMonth)}>Reset</Button>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Next report month" onClick={() => setFocusMonth(monthShift(focusMonth, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Month-over-month values compare the selected stay month with the preceding stay month. An in-progress month includes stayed and future booked nights; a closed previous month reflects completed stays. This is <strong>not</strong> a booking-pace or year-on-year comparison.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Month over month channel totals">
        {metrics.map((m) => {
          const now = currentAvailable ? valueFor(currentTotals, m.id) : null;
          const prev = previousAvailable ? valueFor(previousTotals, m.id) : null;
          return <div key={m.id} className="min-w-0 rounded-lg border bg-muted/15 p-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">{m.label}</p>
            <p className="mt-1 break-words text-lg font-bold tabular-nums">{bookingValue(now, m.id)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Prev: {bookingValue(prev, m.id)}</p>
            <p className="mt-0.5 text-[11px] font-semibold tabular-nums">{previousAvailable && currentAvailable ? changeText(now, prev) : "MoM unavailable"}</p>
          </div>;
        })}
      </div>
      {mismatch && <p role="alert" className="mt-3 flex gap-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" /> Channel totals do not match the monthly reconciliation for {currentMismatch && previousMismatch ? "both months" : currentMismatch ? focusMonth : previousMonth}; treat the comparisons as provisional until the source gap is resolved.</p>}
      {!mismatch && currentAvailable && previousAvailable && wholeCurrent && wholePrevious && <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">Both months' room-nights and booking values agree with the reconciled revenue totals.</p>}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-medium">How the MoM figures are calculated</summary>
        <p className="mt-1 text-muted-foreground">Commercially sold stay nights come from all synced Previo bookings in each month; cancelled/no-show and long inventory holds are excluded. Revenue is the sum of nightly booking prices, including breakfast/extras. Gross ADR = revenue ÷ priced nights. Reservations are distinct IDs <em>within each channel</em> (their monthly total is the sum across channels). MoM percent = (current − previous) ÷ |previous| × 100. No percent is displayed if the baseline is zero or missing. Share movement is measured in percentage points, not percent growth. New reservations use creation dates and exclude later cancellations; they are not net pickup.</p>
      </details>
    </div>

    <div className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Explore channel data</h3>
        <Select value={view} onValueChange={(value: ChartView) => setView(value)}>
          <SelectTrigger className="h-9 w-[156px] max-w-full text-xs" aria-label="Channel chart view"><SelectValue /></SelectTrigger>
          <SelectContent>{viewOptions.filter((o) => metric !== "adr" || o.id !== "mix").map((o) =>
            <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div role="group" aria-label="Channel chart metric" className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {metrics.map((m) => <Button key={m.id} type="button" size="sm" className="h-8 text-xs" variant={metric === m.id ? "default" : "outline"}
          onClick={() => { setMetric(m.id); if (m.id === "adr" && view === "mix") setView("compare"); }}>{m.label}</Button>)}
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">More chart options</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-medium">Sort channels</span>
          <Select value={sortBy} onValueChange={(value: ChannelSort) => setSortBy(value)}>
            <SelectTrigger className="h-8 w-[132px] text-xs" aria-label="Sort channels"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sold">Room-nights</SelectItem><SelectItem value="revenue">Revenue</SelectItem>
              <SelectItem value="adr">ADR</SelectItem><SelectItem value="share">Market share</SelectItem>
              <SelectItem value="growth">MoM growth</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" type="button" variant="outline" className="h-8 text-xs" onClick={() => setShowAll((v) => !v)}>{showAll ? "Top 6" : "Show all channels"}</Button>
        </div>
      </details>
      {(loading || loadedRange !== rangeKey) && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading verified stay dates for this view…</p>}
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      {!loading && !error && loadedRange === rangeKey && !currentAvailable && <p className="mt-3 text-sm text-muted-foreground">No synced commercial booking nights for {formatMonth(focusMonth)}. Missing data is not treated as zero revenue.</p>}
      {!loading && !error && loadedRange === rangeKey && currentAvailable && (
        <>
          {view === "compare" && <div role="img" aria-label="Current month versus previous month channel comparison" className="mt-3 h-[290px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparison} layout="vertical" margin={{ top: 8, bottom: 4, left: 0, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => compactAxis(v, metric)} />
                <YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number, name: string) => [bookingValue(v, metric), name]} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="previous" name={formatMonth(previousMonth, true)} fill="#94a3b8" maxBarSize={12} radius={[0, 3, 3, 0]} />
                <Bar dataKey="current" name={formatMonth(focusMonth, true)} fill="#0ea5e9" maxBarSize={12} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>}
          {view === "mix" && <div className="mt-3 min-w-0">
            <p className="text-[11px] text-muted-foreground">Current-month distribution by {metrics.find((m) => m.id === metric)?.label.toLowerCase()}. ADR cannot be displayed as a share.</p>
            <div role="img" aria-label="Channel share donut chart" className="h-[265px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={visible.filter((r) => (r.nowMetric ?? 0) > 0).map((r) => ({ name: r.name, value: r.nowMetric }))} nameKey="name" dataKey="value" cx="50%" cy="50%" innerRadius="46%" outerRadius="76%" paddingAngle={2}>
                    {visible.filter((r) => (r.nowMetric ?? 0) > 0).map((r, i) => <Cell key={r.name} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => bookingValue(v, metric)} />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>}
          {view === "trend" && <div className="mt-3">
            <p className="text-[11px] text-muted-foreground">Previous six stay months · blank months mean no synced data, not zero sales.</p>
            <div role="img" aria-label="Six-month channel metric trend" className="mt-1 h-[250px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 12, right: 12, bottom: 6, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(n: number) => compactAxis(n, metric)} width={50} />
                  <Tooltip labelFormatter={(_label: string, payload: any) => payload?.[0]?.payload?.label ?? _label}
                    formatter={(v: number) => bookingValue(v, metric)} />
                  <Line type="monotone" dataKey="value" name={metrics.find((m) => m.id === metric)?.label} stroke="#0ea5e9" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>}
          {view === "table" && <div className="mt-3 overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[460px] text-xs">
              <caption className="px-2 py-2 text-left text-muted-foreground">Metric: {metrics.find((m) => m.id === metric)?.label}, selected vs prior month</caption>
              <thead><tr className="border-b bg-muted/30 text-left"><th className="p-2">Channel</th><th className="p-2 text-right">Current</th><th className="p-2 text-right">Previous</th><th className="p-2 text-right">MoM</th><th className="p-2 text-right">Share</th></tr></thead>
              <tbody>{visible.map((r) => <tr key={r.name} className="border-b last:border-0">
                <td className="p-2 font-medium">{r.name}</td>
                <td className="p-2 text-right tabular-nums">{bookingValue(r.nowMetric, metric)}</td>
                <td className="p-2 text-right tabular-nums">{bookingValue(r.beforeMetric, metric)}</td>
                <td className="p-2 text-right tabular-nums">{r.change?.percent == null ? "—" : (r.change.percent >= 0 ? "+" : "") + r.change.percent.toFixed(1) + "%"}</td>
                <td className="p-2 text-right tabular-nums">{r.nowShare.toFixed(1)}%</td>
              </tr>)}</tbody>
            </table>
          </div>}
          {view === "cards" && <p className="mt-3 text-xs text-muted-foreground">Expanded channel cards with current versus previous month, share changes, and recent booking nights.</p>}
        </>
      )}
    </div>

    {!loading && !error && loadedRange === rangeKey && currentAvailable && (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Channel breakdown</h3>
          <div className="flex items-center gap-1" aria-label="Newly booked nights period">
            <span className="mr-1 text-[11px] text-muted-foreground">Booked in</span>
            {([1,7,30] as const).map((days) => <Button key={days} type="button" size="sm" className="h-7 px-2 text-xs" variant={windowDays === days ? "default" : "outline"} onClick={() => setWindowDays(days)}>{days}d</Button>)}
          </div>
        </div>
        {visible.map((r) => <section key={r.name} className="rounded-lg border p-3" aria-label={r.name + " channel"}>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <strong className="min-w-0 break-words text-sm">{r.name}</strong>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{r.nowShare.toFixed(0)}% of nights</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: Math.min(100, r.nowShare) + "%" }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><p className="text-[10px] text-muted-foreground">Sold nights</p><strong className="text-base tabular-nums">{r.now?.sold ?? 0}</strong></div>
            <div><p className="text-[10px] text-muted-foreground">Gross value</p><strong className="text-base tabular-nums">{money(r.now?.revenue ?? 0)}</strong></div>
            <div><p className="text-[10px] text-muted-foreground">Gross ADR</p><strong className="text-base tabular-nums">{bookingValue(channelValue(r.now, "adr"), "adr")}</strong></div>
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-1 text-[11px] text-muted-foreground">
            <span>{r.now?.reservations ?? 0} reservations · +{r.now?.recent ?? 0} booked in {windowDays}d</span>
            <span>Vs {formatMonth(previousMonth, true)}: {r.beforeShare == null ? "unavailable" : (r.shareDelta! >= 0 ? "+" : "") + r.shareDelta!.toFixed(1) + " pp share"}</span>
          </div>
          {view === "cards" && <p className="mt-1 text-[11px] text-muted-foreground">Previous month: {r.before?.sold ?? (previousAvailable ? 0 : "—")} room-nights, {r.before ? money(r.before.revenue) : previousAvailable ? money(0) : "—"} gross value; MoM {r.change?.percent == null ? "unavailable" : (r.change.percent >= 0 ? "+" : "") + r.change.percent.toFixed(1) + "%"}</p>}
        </section>)}
        {combined.length > 6 && <Button type="button" size="sm" variant="outline" className="w-full text-xs" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer channels" : "Show " + (combined.length - 6) + " more channels"}</Button>}
      </div>
    )}
  </div>;
}
