import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Calculator, CheckCircle2, CircleDot, Download, Info,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { money } from "@/lib/revenueCurrency";
import {
  byBooking, byChannel, byDay, certaintyOf, channelLabel, channelShortLabel, commissionShare, grossAdr, monthBounds, monthlySeries,
  netAdr, revenueBridge, shiftMonth, totalsOf, type BridgeStep, type Certainty, type EconomicsRow,
  type MonthlyEconomicsRow,
} from "@/lib/channelEconomics";
import { buildEconomicsSheets, downloadSheets } from "@/lib/channelEconomicsExport";
import { useChannelCopy, type ChannelCopy } from "./copy";
import { compactMoney, monthLabel, pct } from "./format";

type ChartView = "channel" | "day" | "trend";
interface ChartDatum { name: string; full: string; net: number; commission: number; gross: number; nights?: number }

const MAX_CHART_CHANNELS = 7;

function Delta({ current, previous, mode, goodWhenUp, t, locale, label }: {
  current: number | null; previous: number | null; mode: "pct" | "pp"; goodWhenUp: boolean;
  t: ChannelCopy; locale: string; label: string;
}) {
  if (current === null || previous === null || (mode === "pct" && previous === 0)) {
    return <p className="mt-1 text-[11px] text-muted-foreground">{t.kpi.noPrev}</p>;
  }
  const diff = mode === "pct" ? (current - previous) / Math.abs(previous) : (current - previous) * 100;
  const up = diff > 0;
  const flat = Math.abs(diff) < (mode === "pct" ? 0.0005 : 0.05);
  const good = flat ? null : up === goodWhenUp;
  const shown = flat ? 0 : diff;
  const sign = !flat && up ? "+" : "";
  const text = mode === "pct"
    ? `${sign}${pct(shown, locale)}`
    : `${sign}${shown.toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ${t.kpi.pp}`;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium",
      good === null ? "text-muted-foreground" : good ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
      {!flat && <Icon className="h-3 w-3" aria-hidden />}
      {text} <span className="font-normal text-muted-foreground">{t.kpi.vsPrev(label)}</span>
    </p>
  );
}

const CERTAINTY_ICON: Record<Certainty, { Icon: typeof CheckCircle2 | null; className: string }> = {
  exact: { Icon: CheckCircle2, className: "text-emerald-700 dark:text-emerald-400" },
  mixed: { Icon: CircleDot, className: "text-sky-700 dark:text-sky-400" },
  estimated: { Icon: Calculator, className: "text-muted-foreground" },
  unknown: { Icon: AlertTriangle, className: "text-amber-700 dark:text-amber-400" },
  none: { Icon: null, className: "text-muted-foreground" },
};

function CertaintyBadge({ certainty, t, title }: { certainty: Certainty; t: ChannelCopy; title?: string }) {
  const { Icon, className } = CERTAINTY_ICON[certainty];
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium", className)}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {t.certainty[certainty]}
    </span>
  );
}

function ChartTooltip({ active, payload, t, locale }: {
  active?: boolean; payload?: { payload: ChartDatum }[]; t: ChannelCopy; locale: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">{d.full}</p>
      <p className="flex justify-between gap-4"><span className="text-muted-foreground">{t.chart.gross}</span><span className="tabular-nums">{money(d.gross)}</span></p>
      <p className="flex justify-between gap-4"><span className="inline-flex items-center gap-1 text-muted-foreground"><i className="inline-block h-2 w-2 rounded-sm bg-[var(--econ-net)]" />{t.chart.net}</span><span className="tabular-nums">{money(d.net)}</span></p>
      <p className="flex justify-between gap-4"><span className="inline-flex items-center gap-1 text-muted-foreground"><i className="inline-block h-2 w-2 rounded-sm bg-[var(--econ-comm)]" />{t.chart.commission}</span><span className="tabular-nums">{money(d.commission)} · {pct(d.gross > 0 ? d.commission / d.gross : null, locale)}</span></p>
      {d.nights !== undefined && <p className="flex justify-between gap-4"><span className="text-muted-foreground">{t.table.roomNights}</span><span className="tabular-nums">{d.nights}</span></p>}
    </div>
  );
}

export default function EconomicsOverview({
  rows, monthly, trendMonths, month, currency, hotelName, onOpenTerms,
}: {
  rows: EconomicsRow[];
  monthly: MonthlyEconomicsRow[];
  trendMonths: string[];
  month: string;
  currency: string;
  hotelName: string;
  onOpenTerms: () => void;
}) {
  const { t, hu, locale } = useChannelCopy();
  const [chartView, setChartView] = useState<ChartView>("channel");
  const [showTable, setShowTable] = useState(false);
  const [exporting, setExporting] = useState(false);

  const totals = useMemo(() => totalsOf(rows), [rows]);
  const channels = useMemo(() => byChannel(rows), [rows]);
  const { from, to } = monthBounds(month);
  const days = useMemo(() => byDay(rows, from, to), [rows, from, to]);
  const series = useMemo(() => monthlySeries(monthly, trendMonths, currency), [monthly, trendMonths, currency]);
  const bridge = useMemo(() => revenueBridge(totals), [totals]);

  const prevMonth = shiftMonth(month, -1);
  const prev = series.find((m) => m.month === prevMonth && m.grossRevenue > 0) ?? null;
  const prevLabel = monthLabel(prevMonth, locale, true);
  const label = monthLabel(month, locale);
  const thisMonth = new Date().toISOString().slice(0, 7);

  if (rows.length === 0) {
    return <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t.empty(label)}</p>;
  }

  const dataSource = rows.some((r) => r.data_source === "hotelcare") ? "hotelcare" : "previo";
  const commissionPctNow = commissionShare(totals);
  const exactPct = totals.commission > 0 ? totals.commissionExact / totals.commission : null;
  const estimatedPct = totals.commission > 0 ? totals.commissionEstimated / totals.commission : null;
  const unknownChannels = channels.filter((c) => c.unknownGross > 0);

  // Chart data: channels fold into "Other" past seven so no hue or row is generated.
  const channelData: ChartDatum[] = (() => {
    const sorted = channels.filter((c) => c.grossRevenue > 0);
    const head = sorted.slice(0, MAX_CHART_CHANNELS);
    const tail = sorted.slice(MAX_CHART_CHANNELS);
    const data = head.map((c) => ({
      name: channelShortLabel(c.key, hu), full: channelLabel(c.key, hu),
      net: c.netRevenue, commission: c.commission, gross: c.grossRevenue, nights: c.roomNights,
    }));
    if (tail.length) {
      const other = tail.reduce((s, c) => ({ net: s.net + c.netRevenue, commission: s.commission + c.commission, gross: s.gross + c.grossRevenue, nights: s.nights + c.roomNights }), { net: 0, commission: 0, gross: 0, nights: 0 });
      const name = hu ? "Egyéb" : "Other";
      data.push({ name, full: `${name}: ${tail.map((c) => channelLabel(c.key, hu)).join(", ")}`, ...other });
    }
    return data;
  })();
  const dayData: ChartDatum[] = days.map((d) => ({
    name: String(Number(d.date.slice(8))),
    full: new Date(`${d.date}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
    net: d.netRevenue, commission: d.commission, gross: d.grossRevenue, nights: d.roomNights,
  }));
  const trendData: ChartDatum[] = series.map((m) => ({
    name: monthLabel(m.month, locale, true),
    full: monthLabel(m.month, locale) + (m.month > thisMonth ? ` · ${hu ? "lefoglalt" : "on the books"}` : ""),
    net: m.netRevenue, commission: m.commission, gross: m.grossRevenue, nights: m.roomNights,
  }));
  const chartData = chartView === "channel" ? channelData : chartView === "day" ? dayData : trendData;

  const bridgeMax = Math.max(...bridge.map((s) => s.value), 1);
  const bridgeLabel = (s: BridgeStep) => t.bridge[s.key];

  async function exportExcel() {
    setExporting(true);
    try {
      const sheets = buildEconomicsSheets({
        hotelName, month, currency, hu, totals, channels, days, bookings: byBooking(rows), months: series,
        sourceLabel: (source) => t.sources[source],
      });
      const safeHotel = (hotelName || "hotel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      await downloadSheets(sheets, `channel-net-revenue-${safeHotel}-${month}.xlsx`);
      toast.success(t.exportDone);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{t.source[dataSource]}</p>

      {/* Headline figures */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="min-w-0 rounded-lg border p-3">
          <p className="text-[11px] font-medium text-muted-foreground">{t.kpi.gross}</p>
          <p className="mt-1 break-words text-xl font-semibold">{money(totals.grossRevenue)}</p>
          <p className="text-[11px] text-muted-foreground">{t.kpi.grossHint}</p>
          <Delta current={totals.grossRevenue} previous={prev?.grossRevenue ?? null} mode="pct" goodWhenUp t={t} locale={locale} label={prevLabel} />
        </div>
        <div className="min-w-0 rounded-lg border p-3">
          <p className="text-[11px] font-medium text-muted-foreground">{t.kpi.commission}</p>
          <p className="mt-1 break-words text-xl font-semibold">{money(totals.commission)}</p>
          <p className="text-[11px] text-muted-foreground">{t.kpi.commissionHint(pct(commissionPctNow, locale))}</p>
          <Delta current={commissionPctNow} previous={prev ? prev.commission / prev.grossRevenue : null} mode="pp" goodWhenUp={false} t={t} locale={locale} label={prevLabel} />
        </div>
        <div className="min-w-0 rounded-lg border p-3">
          <p className="text-[11px] font-medium text-muted-foreground">{t.kpi.net}</p>
          <p className="mt-1 break-words text-xl font-semibold">{money(totals.netRevenue)}</p>
          <p className="text-[11px] text-muted-foreground">{t.kpi.netHint}</p>
          <Delta current={totals.netRevenue} previous={prev?.netRevenue ?? null} mode="pct" goodWhenUp t={t} locale={locale} label={prevLabel} />
        </div>
        <div className="min-w-0 rounded-lg border p-3">
          <p className="text-[11px] font-medium text-muted-foreground">{t.kpi.netAdr}</p>
          <p className="mt-1 break-words text-xl font-semibold">{money(netAdr(totals))}</p>
          <p className="text-[11px] text-muted-foreground">{t.kpi.netAdrHint(money(grossAdr(totals)))}</p>
          <Delta current={netAdr(totals)} previous={prev && prev.pricedNights > 0 ? prev.netRevenue / prev.pricedNights : null} mode="pct" goodWhenUp t={t} locale={locale} label={prevLabel} />
        </div>
      </div>

      {/* Evidence behind the commission */}
      <div className="rounded-lg border bg-muted/20 p-3 text-xs">
        <p className="font-medium">{t.coverage.title}</p>
        {totals.commission > 0 && (
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {exactPct !== null && exactPct > 0 && <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden />{t.coverage.exact(pct(exactPct, locale, 0))}</li>}
            {estimatedPct !== null && estimatedPct > 0 && <li className="flex items-center gap-1.5"><Calculator className="h-3.5 w-3.5" aria-hidden />{t.coverage.estimated(pct(estimatedPct, locale, 0))}</li>}
          </ul>
        )}
        {unknownChannels.length > 0 && (
          <div className="mt-1.5 flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t.coverage.unknown(unknownChannels.map((c) => channelLabel(c.key, hu)).join(", "), money(totals.unknownGross))}</span>
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onOpenTerms}>{t.coverage.addTerms}</Button>
            </div>
          </div>
        )}
      </div>

      {/* Revenue bridge */}
      <div className="rounded-lg border p-3">
        <h4 className="text-sm font-semibold">{t.bridge.title}</h4>
        <ol className="mt-2 space-y-1.5">
          {bridge.map((s) => {
            const sign = s.kind === "minus" ? "−" : s.kind === "plus" ? "+" : "";
            const barClass = s.key === "city_tax" ? "bg-muted-foreground/40"
              : s.kind === "minus" || s.kind === "plus" ? "bg-[var(--econ-comm)]"
              : s.kind === "result" ? "bg-[var(--econ-net)]" : "bg-[var(--econ-net)] opacity-40";
            return (
              <li key={s.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_7rem]">
                <span className={cn("min-w-0", (s.kind === "total" || s.kind === "result") && "font-medium", s.kind === "result" && "text-foreground")}>{bridgeLabel(s)}</span>
                <span className="order-3 col-span-2 h-2 rounded-full bg-muted sm:order-none sm:col-span-1" aria-hidden>
                  <span className={cn("block h-2 rounded-full", barClass)} style={{ width: `${Math.max(0.5, (s.value / bridgeMax) * 100)}%` }} />
                </span>
                <span className={cn("text-right tabular-nums", s.kind === "result" ? "text-sm font-semibold" : "")}>{sign}{money(s.value)}</span>
              </li>
            );
          })}
        </ol>
        {totals.commissionWithheld > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{t.bridge.note}</p>}
      </div>

      {/* Chart */}
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{t.chart.title}</h4>
          <div role="group" aria-label={t.chart.title} className="inline-flex rounded-md border p-0.5">
            {([["channel", t.chart.byChannel], ["day", t.chart.byDay], ["trend", t.chart.trend]] as const).map(([id, text]) => (
              <button key={id} type="button" aria-pressed={chartView === id} onClick={() => setChartView(id)}
                className={cn("rounded px-2.5 py-1 text-xs", chartView === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {text}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground" aria-hidden>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--econ-net)]" />{t.chart.net}</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--econ-comm)]" />{t.chart.commission}</span>
          {chartView === "trend" && <span>{t.chart.onTheBooks}</span>}
        </div>
        <div
          role="img"
          aria-label={`${t.chart.title} — ${chartView === "channel" ? t.chart.byChannel : chartView === "day" ? t.chart.byDay : t.chart.trend}`}
          className="mt-2 min-w-0"
          style={{ height: chartView === "channel" ? Math.max(160, channelData.length * 34 + 40) : 260 }}
        >
          <ResponsiveContainer width="100%" height="100%">
            {chartView === "channel" ? (
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => compactMoney(v, locale)} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={<ChartTooltip t={t} locale={locale} />} />
                <Bar dataKey="net" stackId="s" fill="var(--econ-net)" stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={20} isAnimationActive={false} />
                <Bar dataKey="commission" stackId="s" fill="var(--econ-comm)" stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            ) : (
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={chartView === "day" ? "preserveStartEnd" : 0} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => compactMoney(v, locale)} width={56} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={<ChartTooltip t={t} locale={locale} />} />
                <Bar dataKey="net" stackId="s" fill="var(--econ-net)" stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
                <Bar dataKey="commission" stackId="s" fill="var(--econ-comm)" stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
        {chartView !== "channel" && (
          <>
            <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => setShowTable((v) => !v)}>
              {showTable ? t.chart.hideTable : t.chart.showTable}
            </Button>
            {showTable && (
              <div className="mt-1 max-h-72 overflow-auto rounded border">
                <table className="w-full min-w-[420px] text-xs">
                  <thead className="sticky top-0 bg-muted/60 text-left"><tr>
                    <th className="p-2">{chartView === "day" ? t.chart.date : t.chart.month}</th>
                    <th className="p-2 text-right">{t.table.roomNights}</th>
                    <th className="p-2 text-right">{t.table.gross}</th>
                    <th className="p-2 text-right">{t.table.commission}</th>
                    <th className="p-2 text-right">{t.table.net}</th>
                  </tr></thead>
                  <tbody>{chartData.map((d) => (
                    <tr key={d.full} className="border-t">
                      <td className="p-2">{d.full}</td>
                      <td className="p-2 text-right tabular-nums">{d.nights ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums">{money(d.gross)}</td>
                      <td className="p-2 text-right tabular-nums">{money(d.commission)}</td>
                      <td className="p-2 text-right tabular-nums">{money(d.net)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Channel economics table */}
      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <h4 className="text-sm font-semibold">{t.table.title} · {label}</h4>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={exporting} onClick={() => void exportExcel()}>
            <Download className="h-3.5 w-3.5" />{t.export}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2">{t.table.channel}</th>
                <th className="p-2 text-right">{t.table.roomNights}</th>
                <th className="p-2 text-right">{t.table.gross}</th>
                <th className="p-2 text-right">{t.table.commission}</th>
                <th className="p-2 text-right">{t.table.commissionPct}</th>
                <th className="p-2 text-right">{t.table.net}</th>
                <th className="p-2 text-right">{t.table.netAdr}</th>
                <th className="p-2 text-right">{t.table.shareOfNet}</th>
                <th className="p-2">{t.table.certainty}</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => {
                const certainty = certaintyOf(c, c.type);
                const unknown = c.unknownGross > 0 && c.commission === 0;
                return (
                  <tr key={c.key} className="border-t">
                    <td className="p-2">
                      <span className="font-medium">{channelLabel(c.key, hu)}</span>
                      {c.basis !== "gross" && <span className="ml-1.5 rounded border px-1 py-px text-[10px] text-muted-foreground" title={t.table.basisNet}>{c.basis === "net" ? "net" : "mix"}</span>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{c.roomNights.toLocaleString(locale)}</td>
                    <td className="p-2 text-right tabular-nums">{money(c.grossRevenue)}</td>
                    <td className="p-2 text-right tabular-nums">{unknown ? "?" : money(c.commission)}</td>
                    <td className="p-2 text-right tabular-nums">{unknown ? "?" : pct(commissionShare(c), locale)}</td>
                    <td className="p-2 text-right font-medium tabular-nums">{money(c.netRevenue)}</td>
                    <td className="p-2 text-right tabular-nums">{money(netAdr(c))}</td>
                    <td className="p-2 text-right tabular-nums">{pct(totals.netRevenue > 0 ? c.netRevenue / totals.netRevenue : null, locale)}</td>
                    <td className="p-2"><CertaintyBadge certainty={certainty} t={t} title={t.sources[c.mainSource]} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="p-2">{t.table.total}</td>
                <td className="p-2 text-right tabular-nums">{totals.roomNights.toLocaleString(locale)}</td>
                <td className="p-2 text-right tabular-nums">{money(totals.grossRevenue)}</td>
                <td className="p-2 text-right tabular-nums">{money(totals.commission)}</td>
                <td className="p-2 text-right tabular-nums">{pct(commissionPctNow, locale)}</td>
                <td className="p-2 text-right tabular-nums">{money(totals.netRevenue)}</td>
                <td className="p-2 text-right tabular-nums">{money(netAdr(totals))}</td>
                <td className="p-2 text-right tabular-nums">{pct(totals.netRevenue > 0 ? 1 : null, locale, 0)}</td>
                <td className="p-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <details className="rounded-lg border p-3 text-xs">
        <summary className="cursor-pointer font-medium">{t.method.title}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
          {t.method.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </details>
    </div>
  );
}
