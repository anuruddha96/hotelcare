import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { buildMonthBreakdown, wholeMonthOf } from "@/lib/kpiReconciliation";
import { fetchMonthReconciliationDays, monthReconciliationKey } from "@/hooks/useMonthReconciliationDays";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertCircle, Info, RefreshCw, Sparkles, Trophy } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { rankHotelsByPerformance } from "@/lib/hotelPerformanceRanking";
import { budapestDayOf } from "@/lib/revenueAnalytics";
import { validateHotelComparisonData, type ComparisonAvailabilityRow, type ComparisonSyncState } from "@/lib/revenue/hotelComparisonIntegrity";

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
  const today = budapestDayOf(new Date().toISOString());
  const daysInMonth = new Date(Date.UTC(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = selectedMonth + "-" + String(daysInMonth).padStart(2, "0");
  const hasFutureNights = monthEnd >= today;
  const firstFutureDate = selectedMonth + "-01" > today ? selectedMonth + "-01" : today;

  // A calendar RPC row does NOT prove PMS bookings were imported for that day.
  // Cross-check a completed sync and independent Previo availability before
  // publishing stayed + booked monthly performance.
  const syncQueries = useQueries({
    queries: hotels.map((hotel) => ({
      queryKey: ["hotel-comparison-sync", hotel.hotel_id],
      enabled: hasFutureNights,
      staleTime: 0,
      retry: false,
      refetchInterval: 30_000,
      refetchOnMount: "always" as const,
      refetchOnWindowFocus: "always" as const,
      queryFn: async (): Promise<ComparisonSyncState | null> => {
        const { data, error } = await supabase.rpc("revenue_sync_wait_state", { _hotel_id: hotel.hotel_id });
        if (error) throw error;
        return (data?.[0] ?? null) as ComparisonSyncState | null;
      },
    })),
  });

  const availabilityQuery = useQuery({
    queryKey: ["hotel-comparison-future-inventory", hotelIds, selectedMonth, today],
    enabled: hasFutureNights && hotelIds.length > 0,
    staleTime: 0,
    retry: false,
    refetchInterval: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryFn: async (): Promise<ComparisonAvailabilityRow[]> => {
      const all: ComparisonAvailabilityRow[] = [];
      // Page explicitly: partial API results must not be mistaken for stock.
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("revenue_room_type_availability")
          .select("hotel_id,stay_date,availability,captured_at")
          .in("hotel_id", hotelIds)
          .gte("stay_date", firstFutureDate)
          .lte("stay_date", monthEnd)
          .order("hotel_id").order("stay_date")
          .range(offset, offset + 499);
        if (error) throw error;
        const page = (data ?? []) as ComparisonAvailabilityRow[];
        all.push(...page);
        if (page.length < 500) return all;
      }
    },
  });
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
      staleTime: 0,
      retry: false,
      refetchInterval: 30_000,
      refetchOnMount: "always" as const,
      refetchOnWindowFocus: "always" as const,
      queryFn: () => fetchMonthReconciliationDays(hotel.hotel_id, selectedMonth),
    })),
  });
  const comparisonLoading = monthlyQueries.some((q) => q.isFetching)
    || (hasFutureNights && (syncQueries.some((q) => q.isFetching) || availabilityQuery.isFetching));
  const comparisonError = monthlyQueries.some((q) => q.isError)
    || (hasFutureNights && (syncQueries.some((q) => q.isError) || availabilityQuery.isError));
  const comparison = useMemo(() => {
    const snapshots = hotels.map((hotel, index) => {
      const query = monthlyQueries[index];
      const syncQuery = syncQueries[index];
      const rows = query?.data ?? [];
      // Keep already reconciled numbers visible during background refreshes.
      // A fetch spinner is only appropriate before we have any data.
      const checking = !query?.data && (Boolean(query?.isFetching)
        || (hasFutureNights && (Boolean(syncQuery?.isFetching) || availabilityQuery.isFetching)));
      const integrity = validateHotelComparisonData({
        rows, month: selectedMonth, today,
        availability: (availabilityQuery.data ?? []).filter((row) => row.hotel_id === hotel.hotel_id),
        sync: syncQuery?.data,
        reconciliationFetchedAt: query?.dataUpdatedAt ?? 0,
        availabilityFetchedAt: availabilityQuery.dataUpdatedAt,
        syncFetchedAt: syncQuery?.dataUpdatedAt ?? 0,
      });
      const verified = !checking && !query?.isError
        && (!hasFutureNights || (!syncQuery?.isError && !availabilityQuery.isError))
        && integrity.bookingsVerified;
      const month = verified ? wholeMonthOf(buildMonthBreakdown(rows)) : null;
      const fx = eurRateByHotel.get(hotel.hotel_id);
      const occ = month?.occupancyPct == null ? null : Math.round(month.occupancyPct);
      // These are the actual reported priced-night ADR and recorded gross
      // RevPAR. Missing price allocations are disclosed via a tap-to-open icon,
      // not by hiding the values that the source provides.
      const adr = month?.adrGross == null || !fx
        ? null : Math.round(month.adrGross / fx);
      const revpar = month?.revparGross == null || !fx
        ? null : Math.round(month.revparGross / fx);
      const sourceError = Boolean(query?.isError)
        || (hasFutureNights && (Boolean(syncQuery?.isError) || availabilityQuery.isError));
      const unavailable = checking ? "Checking latest PMS records…"
        : sourceError ? "PMS verification unavailable — retry"
        : integrity.issue ?? integrity.priceIssue
          ?? (!fx ? "EUR conversion unavailable" : null);
      return {
        ...hotel, nights: verified ? daysInMonth : 0,
        occ, adr, revpar, unavailable,
        priceNote: verified ? integrity.priceIssue : null,
        inventoryNote: verified ? integrity.issue : null,
        bookedNights: month?.sold ?? null,
        availableNights: month?.capacity ?? null,
        grossRevenue: month?.revenueGross ?? null,
        priceNights: month?.priced ?? null,
        verifiedAt: hasFutureNights ? syncQuery?.data?.last_success_at ?? null : null,
      };
    });
    // Rank hotels that have real available numbers. Incomplete PMS sources
    // remain unranked, but never suppress valid numbers from other hotels.
    return rankHotelsByPerformance(snapshots);
  }, [hotels, monthlyQueries, syncQueries, availabilityQuery.data, availabilityQuery.dataUpdatedAt,
    availabilityQuery.isFetching, availabilityQuery.isError, selectedMonth, today, hasFutureNights,
    daysInMonth, eurRateByHotel]);


  if (!hotels.length || !/^[0-9]{4}-[0-9]{2}$/.test(selectedMonth)) return null;
  return (
    <section aria-label="Hotel comparison" aria-busy={comparisonLoading}
      className="rounded-xl border bg-muted/10 p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          Hotel comparison <span className="ml-1 font-normal text-muted-foreground">{selectedMonth}</span>
        </h3>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"
          aria-label="Ask AI about hotel comparison" title="Ask AI"
          onClick={() => window.dispatchEvent(new CustomEvent("hotelcare:ask-ai", { detail: { prompt:
            "Review the recorded whole-month stayed and booked occupancy, gross ADR and RevPAR for " + selectedMonth +
            ". Check data-quality flags and price coverage before recommending actions." } }))}>
          <Sparkles className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0"
          aria-label={comparisonError ? "Retry comparison" : "Refresh comparison"}
          title={comparisonError ? "Retry comparison" : "Refresh comparison"}
          disabled={comparisonLoading}
          onClick={() => void (async () => {
            if (hasFutureNights) await Promise.all(syncQueries.map((q) => q.refetch()));
            await Promise.all([
              ...monthlyQueries.map((q) => q.refetch()),
              ...(hasFutureNights ? [availabilityQuery.refetch()] : []),
            ]);
          })()}>
          <RefreshCw className={"h-4 w-4" + (comparisonLoading ? " animate-spin" : "")} />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {comparison.map((hotel, index) => {
          const isCurrent = hotel.hotel_id === hotelId;
          const hasCaution = Boolean(hotel.unavailable || hotel.priceNote || hotel.inventoryNote);
          return (
            <article key={hotel.hotel_id} data-testid={"hotel-rank-" + hotel.hotel_id}
              aria-current={isCurrent ? "true" : undefined}
              aria-label={hotel.hotel_name + ", " + (hotel.rank != null ? "rank " + hotel.rank : "unranked") +
                (isCurrent ? ", currently viewing" : "")}
              className={"min-w-0 rounded-xl border p-2.5 sm:p-3 " +
                (isCurrent ? "border-sky-400/70 bg-sky-500/[0.045] dark:bg-sky-400/[0.06]"
                  : "border-border/70 bg-card")}>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={"flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums " +
                  (hotel.rank === 1 ? "bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200"
                    : isCurrent ? "bg-sky-500/10 text-sky-800 dark:text-sky-300" : "bg-muted")}>
                  {hotel.rank ?? "–"}
                </span>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(hotel.hotel_id, index) }} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={hotel.hotel_name}>
                  {hotel.hotel_name}
                </span>
                {hotel.rank === 1 && <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="Top performer" />}
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label={"Data details for " + hotel.hotel_name}
                      title="Data details"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {hasCaution
                        ? <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        : <Info className="h-3.5 w-3.5" />}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="bottom" className="w-64 max-w-[calc(100vw-2rem)] space-y-2 text-xs leading-relaxed">
                    <p className="font-semibold">{hotel.hotel_name} · {selectedMonth}</p>
                    <p className="text-muted-foreground">Full month: stayed + booked nights. Gross rates include breakfast and extras. Converted to EUR.</p>
                    {hotel.bookedNights != null && hotel.availableNights != null &&
                      <p>{hotel.bookedNights} sold / {hotel.availableNights} available room-nights.</p>}
                    {hotel.grossRevenue != null && <p>Recorded gross booking value: {eurMoney(hotel.grossRevenue)}.</p>}
                    {hotel.priceNote && <p className="text-amber-700 dark:text-amber-300">{hotel.priceNote}.</p>}
                    {hotel.inventoryNote && <p className="text-amber-700 dark:text-amber-300">{hotel.inventoryNote}.</p>}
                    {hotel.unavailable && !hotel.bookedNights &&
                      <p className="text-amber-700 dark:text-amber-300">{hotel.unavailable}.</p>}
                    {hotel.verifiedAt &&
                      <p className="text-muted-foreground">Last successful PMS sync: {new Date(hotel.verifiedAt).toLocaleString()}.</p>}
                    {hotel.priceNote && <p className="text-muted-foreground">The ranking uses recorded KPIs and may change once missing prices are reconciled.</p>}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1">
                <div className="min-w-0">
                  <p className="text-[9px] uppercase text-muted-foreground">Occ</p>
                  <p className="truncate text-base font-bold tabular-nums sm:text-lg">
                    {hotel.occ == null ? "—" : hotel.occ + "%"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] uppercase text-muted-foreground">ADR</p>
                  <p className="truncate text-base font-bold tabular-nums sm:text-lg">{eurMoney(hotel.adr)}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] uppercase text-muted-foreground">RevPAR</p>
                  <p className="truncate text-base font-bold tabular-nums sm:text-lg">{eurMoney(hotel.revpar)}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
