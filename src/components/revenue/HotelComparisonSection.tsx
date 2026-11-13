import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { buildMonthBreakdown, wholeMonthOf } from "@/lib/kpiReconciliation";
import { fetchMonthReconciliationDays, monthReconciliationKey } from "@/hooks/useMonthReconciliationDays";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ComparisonHotel = { hotel_id: string; hotel_name: string };
type Props = { hotels: ComparisonHotel[]; hotelId: string | null; selectedMonth: string };


const HOTEL_COLORS: Record<string, string> = {
  "mika-downtown": "#111111",
  "memories-budapest": "#A16207",
  ottofiori: "#0F766E",
  "gozsdu-court": "#B91C1C",
};
const FALLBACK = ["#6D28D9", "#B45309", "#065F46", "#9D174D"];
const colorFor = (id: string, i: number) => HOTEL_COLORS[id] ?? FALLBACK[i % FALLBACK.length];
function eurMoney(value: number | null): string {
  return value == null ? "—" : `€${Math.round(value).toLocaleString()}`;
}

/** Full-stay-month comparisons belong with the headline monthly KPIs, not market intelligence. */
export default function HotelComparisonSection({ hotels, hotelId, selectedMonth }: Props) {
  const [eurRateByHotel, setEurRateByHotel] = useState<Map<string, number | null>>(new Map());
  const hotelIds = useMemo(() => hotels.map((h) => h.hotel_id), [hotels]);
  const idsKey = hotelIds.join(",");
  useEffect(() => {
    if (hotelIds.length === 0) { setEurRateByHotel(new Map()); return; }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from("hotel_revenue_settings")
        .select("hotel_id, base_currency, eur_conversion_rate").in("hotel_id", hotelIds);
      if (cancelled || error || !data) return;
      const map = new Map<string, number>();
      for (const row of data as Array<{ hotel_id: string; base_currency: string | null; eur_conversion_rate: number | null }>) {
        const code = (row.base_currency ?? "EUR").toUpperCase();
        const rate = Number(row.eur_conversion_rate);
        map.set(row.hotel_id, code === "EUR" ? 1 : rate > 0 ? rate : null);
      }
      setEurRateByHotel(map);
    })();
    return () => { cancelled = true; };
  }, [idsKey]);

  // Monthly comparisons use the identical stayed + booked reconciliation RPC as
  // the KPI header, never the future-only pricing-grid data.
  const monthlyQueries = useQueries({
    queries: hotels.map((hotel) => ({
      queryKey: monthReconciliationKey(hotel.hotel_id, selectedMonth),
      enabled: hotels.length > 0 && /^\d{4}-\d{2}$/.test(selectedMonth),
      staleTime: 60_000,
      retry: false,
      queryFn: () => fetchMonthReconciliationDays(hotel.hotel_id, selectedMonth),
    })),
  });
  const comparisonLoading = monthlyQueries.some((q) => q.isFetching);
  const comparisonError = monthlyQueries.some((q) => q.isError);
  const comparison = useMemo(() => {
    const daysInMonth = new Date(Date.UTC(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0)).getUTCDate();
    return hotels.map((hotel, index) => {
      const query = monthlyQueries[index];
      const rows = query?.data ?? [];
      const complete = new Set(rows.filter((d) => d.stay_date.startsWith(selectedMonth + "-")).map((d) => d.stay_date)).size === daysInMonth;
      const month = complete ? wholeMonthOf(buildMonthBreakdown(rows)) : null;
      const fx = eurRateByHotel.get(hotel.hotel_id);
      const occ = month?.occupancyPct == null ? null : Math.round(month.occupancyPct);
      // Use gross booking ADR consistently, converting actual property currency
      // to EUR only when a valid exchange rate exists.
      const adr = month?.adrGross == null || !fx ? null : Math.round(month.adrGross / fx);
      const revpar = month?.revparGross == null || !fx ? null : Math.round(month.revparGross / fx);
      return { ...hotel, nights: month ? daysInMonth : 0, occ, adr, revpar,
        unavailable: query?.isError ? "Could not load month" : !month ? "Full-month data unavailable" : !fx ? "EUR conversion unavailable" : null };
    }).sort((x,y) => x.hotel_id === hotelId ? -1 : y.hotel_id === hotelId ? 1 : (y.revpar ?? -1) - (x.revpar ?? -1));
  }, [hotels, monthlyQueries, selectedMonth, hotelId, eurRateByHotel]);

  const comparisonBenchmark = useMemo(() => {
    const valid = comparison.filter((x) => x.occ != null && x.adr != null);
    if (valid.length < 2) return { occ: null as number | null, adr: null as number | null };
    return {
      occ: Math.round(valid.reduce((sum, hotel) => sum + (hotel.occ ?? 0), 0) / valid.length),
      adr: Math.round(valid.reduce((sum, hotel) => sum + (hotel.adr ?? 0), 0) / valid.length),
    };
  }, [comparison]);


  if (!hotels.length || !/^\d{4}-\d{2}$/.test(selectedMonth)) return null;
  return (
    <section aria-label="Hotel comparison" aria-busy={comparisonLoading} className="rounded-xl border bg-muted/10 p-3 sm:p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold">Hotel comparison</p>
                    <p className="text-[10px] text-muted-foreground">Whole month {selectedMonth} · stayed + booked · ADR and RevPAR include breakfast & extras · EUR converted.</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 text-xs"
                    onClick={() => window.dispatchEvent(new CustomEvent("hotelcare:ask-ai", { detail: { prompt:
                      `Review the hotel portfolio comparison for ${selectedMonth}. Use full-month stayed plus booked, gross booking ADR including breakfast and extras, and show meaningful differences in occupancy and RevPAR. Identify missing reconciliation dates, missing FX data, or actionable revenue opportunities. Never compare a future-only ADR to a whole-month ADR.` } }))}>
                    Ask AI
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" disabled={comparisonLoading} onClick={() => void Promise.all(monthlyQueries.map((q) => q.refetch()))}>
                    {comparisonLoading ? "Loading comparison…" : comparisonError ? "Retry comparison" : "Refresh comparison"}
                  </Button>
                </div>
                {comparisonError && <p role="alert" className="mb-2 text-xs text-destructive">Some hotels could not be reconciled. Unavailable figures are not estimated.</p>}
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                  {comparison.map((s, i) => {
                    const occDelta = s.occ != null && comparisonBenchmark.occ != null ? s.occ - comparisonBenchmark.occ : null;
                    const adrDelta = s.adr != null && comparisonBenchmark.adr != null ? s.adr - comparisonBenchmark.adr : null;
                    return (
                      <div key={s.hotel_id} className={`min-w-0 rounded-xl border p-2 sm:p-3 ${s.hotel_id === hotelId ? "border-primary bg-primary/[0.03]" : ""}`}>
                        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5" style={{ background: colorFor(s.hotel_id, i) }} />
                          <p className="min-w-0 flex-1 truncate text-[10px] font-semibold sm:text-xs">{s.hotel_name}</p>
                          {s.hotel_id === hotelId && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[8px] sm:h-5 sm:px-1.5 sm:text-[9px]">This hotel</Badge>}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-1 sm:mt-3 sm:gap-2">
                          <div className="min-w-0">
                            <p className="text-[8px] uppercase text-muted-foreground sm:text-[9px]">Occ</p>
                            <p className="truncate text-sm font-semibold tabular-nums sm:text-lg">{s.occ == null ? "—" : `${s.occ}%`}</p>
                            {occDelta != null && <p className="hidden text-[9px] text-muted-foreground sm:block">{occDelta >= 0 ? "+" : ""}{occDelta} pts vs portfolio</p>}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[8px] uppercase text-muted-foreground sm:text-[9px]">ADR</p>
                            <p className="truncate text-sm font-semibold tabular-nums sm:text-lg">{eurMoney(s.adr)}</p>
                            {adrDelta != null && <p className="hidden text-[9px] text-muted-foreground sm:block">{adrDelta >= 0 ? "+" : "−"}€{Math.abs(adrDelta)} vs portfolio</p>}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[8px] uppercase text-muted-foreground sm:text-[9px]">RevPAR</p>
                            <p className="truncate text-sm font-semibold tabular-nums sm:text-lg">{eurMoney(s.revpar)}</p>
                          </div>
                        </div>
                        {(occDelta != null || adrDelta != null) && (
                          <p className="mt-1.5 truncate text-[8px] text-muted-foreground sm:hidden">
                            vs portfolio:{occDelta != null ? ` OCC ${occDelta >= 0 ? "+" : ""}${occDelta}pt` : ""}{adrDelta != null ? ` · ADR ${adrDelta >= 0 ? "+" : "−"}€${Math.abs(adrDelta)}` : ""}
                          </p>
                        )}
                        <p className="mt-2 text-[9px] text-muted-foreground sm:text-[10px]">
                          {s.unavailable ?? (s.nights ? `${s.nights} full-month dates checked` : "Full-month data unavailable")}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
  );
}
