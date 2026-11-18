import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRevenueCurrency } from "@/lib/revenueCurrency";
import { useChannelEconomics } from "@/hooks/useChannelEconomics";
import { shiftMonth, splitByCurrency } from "@/lib/channelEconomics";
import { useChannelCopy } from "./copy";
import { monthLabel } from "./format";
import EconomicsOverview from "./EconomicsOverview";
import RatePlanMix from "./RatePlanMix";
import StatementCheck from "./StatementCheck";
import CommissionTerms from "./CommissionTerms";

type View = "overview" | "rates" | "statements" | "terms";

/**
 * Channels & net revenue: gross revenue, OTA commission and net revenue per
 * channel for a stay month, with the evidence behind every number (Booking.com
 * notes, imported statements, contract terms).
 */
export default function ChannelEconomicsPanel({
  hotelId,
  hotelName,
  selectedMonth,
  canEdit,
}: {
  hotelId: string | null;
  hotelName?: string | null;
  selectedMonth: string;
  canEdit: boolean;
}) {
  const { t, locale } = useChannelCopy();
  const currency = useRevenueCurrency();
  const [month, setMonth] = useState(selectedMonth);
  const [view, setView] = useState<View>("overview");
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => { setMonth(selectedMonth); }, [selectedMonth]);

  const { data, loading, error, stale } = useChannelEconomics(hotelId, month, reloadToken);
  const reload = () => setReloadToken((n) => n + 1);

  // Sum only rows in the hotel's stored currency; anything else is listed, never mixed in.
  const split = useMemo(() => splitByCurrency(data?.rows ?? [], currency.code), [data?.rows, currency.code]);
  const noAccess = !!error && /not authori[sz]ed|42501|permission/i.test(error);
  const label = monthLabel(month, locale);
  const thisMonth = new Date().toISOString().slice(0, 7);

  const views: { id: View; label: string }[] = [
    { id: "overview", label: t.views.overview },
    { id: "rates", label: t.views.rates },
    { id: "statements", label: t.views.statements },
    { id: "terms", label: t.views.terms },
  ];

  return (
    <div className="min-w-0 space-y-3 [--econ-comm:#eb6834] [--econ-net:#2a78d6] dark:[--econ-comm:#d95926] dark:[--econ-net:#3987e5]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{t.title}</h3>
          <p className="text-xs text-muted-foreground">{t.subtitle(label)}</p>
        </div>
        <div className="flex items-center gap-1" aria-label={t.title}>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={t.prevMonth} onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium tabular-nums">{label}</span>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={t.nextMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {month !== thisMonth && (
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setMonth(thisMonth)}>{t.thisMonth}</Button>
          )}
        </div>
      </div>

      <div role="group" aria-label={t.title} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:inline-grid sm:grid-cols-4">
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === v.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {(view === "overview" || view === "rates") && (
        <>
          {noAccess && <p className="rounded-lg border p-3 text-sm text-muted-foreground">{t.noAccess}</p>}
          {error && !noAccess && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm">
              <span className="text-destructive">{t.error} <span className="text-xs text-muted-foreground">({error})</span></span>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={reload}><RefreshCw className="h-3.5 w-3.5" />{t.retry}</Button>
            </div>
          )}
          {!data && loading && (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</p>
          )}
          {data && !noAccess && (
            <div className={cn("relative min-w-0 space-y-3 transition-opacity", (loading || stale) && "opacity-60")} aria-busy={loading}>
              {(loading || stale) && (
                <span role="status" className="absolute right-0 top-0 inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />{t.refreshing}
                </span>
              )}
              {split.otherRows > 0 && <p className="text-[11px] text-muted-foreground">{t.otherCurrency(split.otherRows, split.otherCurrencies.join(", "))}</p>}
              {view === "overview" ? (
                <EconomicsOverview
                  rows={split.rows}
                  monthly={data.monthly}
                  trendMonths={data.trendMonths}
                  month={month}
                  currency={currency.code}
                  hotelName={hotelName ?? hotelId ?? ""}
                  onOpenTerms={() => setView("terms")}
                />
              ) : (
                <RatePlanMix rows={split.rows} month={month} />
              )}
            </div>
          )}
        </>
      )}
      {view === "statements" && <StatementCheck hotelId={hotelId} month={month} canEdit={canEdit} onImported={reload} />}
      {view === "terms" && <CommissionTerms hotelId={hotelId} canEdit={canEdit} onChanged={reload} />}
    </div>
  );
}
