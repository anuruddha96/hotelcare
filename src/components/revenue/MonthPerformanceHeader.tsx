import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, BedDouble, Coins, Gauge, DoorOpen, TrendingUp, TrendingDown, Info, CalendarPlus } from "lucide-react";
import { budapestDayOf, countsTowardRevenueSalesPickup, formatMonth, pickupWindowLabel, pickupWindowStartMs, PICKUP_WINDOW_48H, type BookingNight, type CancelledNight, type DayMetrics } from "@/lib/revenueAnalytics";
import { money, eurEquivalent, setRevenueCurrency, setDisplayCurrency, currencySymbol, useRevenueCurrency, isForeignCurrency } from "@/lib/revenueCurrency";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { useQueryClient } from "@tanstack/react-query";
import { useMonthReconciliationDays } from "@/hooks/useMonthReconciliationDays";
import { breakfastPriceOf, buildMonthBreakdown, wholeMonthOf, type MonthBreakdownRow } from "@/lib/kpiReconciliation";
import MonthBreakdownPanel from "./MonthBreakdownPanel";
import { Bar, BarChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";

const PICKUP_WINDOW_HU: Record<number,string> = {
  1: 'Csak ma', 2: 'Tegnap és ma', 3: 'Elmúlt 3 nap', 7: 'Elmúlt 7 nap',
  14: 'Elmúlt 14 nap', 30: 'Elmúlt 30 nap', 60: 'Elmúlt 60 nap', 90: 'Elmúlt 90 nap',
};
const PICKUP_WINDOWS = [
  { value: 2, label: "Yesterday + today" },
  { value: 1, label: "Today only" },
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
  { value: PICKUP_WINDOW_48H, label: "Rolling 48h (automation)" },
];


function windowLabel(days: number) {
  return PICKUP_WINDOWS.find((p) => p.value === days)?.label ?? pickupWindowLabel(days);
}

function Explain({ title, body }: { title: string; body: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`What is ${title}?`} className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground">
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 text-xs leading-relaxed">
        <p className="font-semibold mb-1">{title}</p>
        <p className="text-muted-foreground whitespace-pre-line">{body}</p>
      </PopoverContent>
    </Popover>
  );
}

function Tile({ label, value, sub, icon, tone, surface, explain, loading }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; tone?: string;
  surface?: string;
  explain?: { title: string; body: string };
  /** While a new property's data lands, show a shimmer instead of stale numbers. */
  loading?: boolean;
}) {
  return (
    <div className={`w-full rounded-lg border border-l-4 p-2.5 sm:p-3 min-w-0 ${surface ?? "border-l-border"}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}<span className="truncate">{label}</span>
        {explain && !loading && <Explain {...explain} />}
      </div>
      {loading ? (
        <div className="animate-pulse">
          <div className="mt-2 h-5 w-2/3 rounded bg-muted-foreground/20" />
          <div className="mt-2 h-2.5 w-4/5 rounded bg-muted-foreground/10" />
        </div>
      ) : (
        <>
          {/* Keyed by the value so a figure updated by a finished sync fades in
              instead of snapping to a different number. */}
          <div key={value} className={`mt-1 text-xl font-semibold tabular-nums truncate animate-fade-in ${tone ?? ""}`}>{value}</div>
          {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
        </>
      )}
    </div>
  );
}


function monthKey(iso: string) { return iso.slice(0, 7); }
function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * The decision header of the Revenue page: pick a month, see how that month is
 * performing on the books, and choose the pickup window that every other
 * section on the page reads from.
 *
 * Amounts are printed in the hotel's own currency (Previo quotes forints for
 * SLNT), with a euro equivalent when an exchange rate is configured.
 */
export default function MonthPerformanceHeader({
  today, metrics, pickupWindowDays, onPickupWindowChange, hotelId, canEdit, roomsAvailable,
  selectedMonth, onSelectedMonthChange, nights = [], cancellations = [], loading = false, loadedThrough,
  excludedRoomTypeIds, inventoryMismatch = false, configuredRooms = 0,
  refreshing = false, lastSyncAt = null,
}: {
  today: string;
  metrics: DayMetrics[];
  /** Room-nights on the books — used for "booked today". */
  nights?: BookingNight[];
  excludedRoomTypeIds?: Set<string>;
  inventoryMismatch?: boolean;
  configuredRooms?: number;
  /** Cancelled room-nights — used for what today gave back. */
  cancellations?: CancelledNight[];
  pickupWindowDays: number;
  onPickupWindowChange: (days: number) => void;
  hotelId?: string | null;
  canEdit?: boolean;
  roomsAvailable?: number;
  /** Last stay date whose figures have arrived; months past it are still loading. */
  loadedThrough?: string;
  selectedMonth?: string;
  onSelectedMonthChange?: (month: string) => void;
  /** True while another property's figures are still loading. */
  loading?: boolean;
  /** True while a Previo refresh (or a later horizon slice) is on its way. */
  refreshing?: boolean;
  /** When the visible figures were last pulled from Previo. */
  lastSyncAt?: string | null;
}) {

  const { language } = useTranslation();
  const hu = language === 'hu';
  const localMonth = (date: string) => hu
    ? new Intl.DateTimeFormat('hu-HU',{year:'numeric',month:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))
    : formatMonth(date);
  const localWindow = (days: number) => hu
    ? (PICKUP_WINDOW_HU[days] || (days === PICKUP_WINDOW_48H ? 'Elmúlt 48 óra (automatizálás)' : windowLabel(days)))
    : windowLabel(days);
  const [internalMonth, setInternalMonth] = useState(() => monthKey(today));
  const month = selectedMonth ?? internalMonth;
  const setMonth = (value: string) => {
    setInternalMonth(value);
    onSelectedMonthChange?.(value);
  };
  const currency = useRevenueCurrency();
  const [rateInput, setRateInput] = useState(currency.eurRate ? String(currency.eurRate) : "");

  useEffect(() => {
    setRateInput(currency.eurRate ? String(currency.eurRate) : "");
  }, [currency.eurRate]);

  const months = useMemo(() => {
    const set = new Set(metrics.map((m) => monthKey(m.stay_date)));
    return Array.from(set).sort();
  }, [metrics]);

  const aggregate = (key: string) => {
    const rows = metrics.filter((m) => monthKey(m.stay_date) === key);
    const holds = rows.reduce((s, m) => s + (m.excludedInventoryHolds ?? 0), 0);
    const inactive = rows.reduce((s, m) => s + (m.excludedInactiveNights ?? 0), 0);
    const missingPrices = rows.reduce((s, m) => s + (m.missingPriceNights ?? 0), 0);
    const sold = rows.reduce((s, m) => s + m.roomsSold, 0);
    const capacity = rows.reduce((s, m) => s + m.roomsAvailable, 0);
    const revenue = rows.reduce((s, m) => s + m.revenueEur, 0);
    const left = rows.reduce((s, m) => s + m.roomsLeft, 0);
    const pickup = rows.reduce((s, m) => s + (m.netPickup ?? 0), 0);
    // Keep the breakdown on the exact same durable movement source as net
    // pickup. Mixing creation timestamps with sync-diff net movement made the
    // subtitle fail its own arithmetic (for example +39 beside 74 in / 36 out).
    const gained = rows.reduce((s, m) => s + (m.pickupGained ?? 0), 0);
    const lost = rows.reduce((s, m) => s + (m.pickupLost ?? 0), 0);
    const datesUp = rows.filter((m) => (m.netPickup ?? 0) > 0).length;
    const datesDown = rows.filter((m) => (m.netPickup ?? 0) < 0).length;
    const stayDates = rows.map((m) => m.stay_date).sort();
    return {
      days: rows.length,
      firstDay: stayDates[0] ?? null,
      lastDay: stayDates[stayDates.length - 1] ?? null,
      holds,
      inactive,
      missingPrices,
      sold,
      capacity,
      left,
      revenue,
      pickup,
      gained,
      lost,
      datesUp,
      datesDown,

      occupancyPct: capacity ? (sold / capacity) * 100 : 0,
      adr: sold ? revenue / sold : null,
      revpar: capacity ? revenue / capacity : null,
    };
  };

  const agg = useMemo(() => aggregate(month), [metrics, month]);
  const syncAgeMs = lastSyncAt ? Date.now() - Date.parse(lastSyncAt) : NaN;
  const staleSync = Number.isFinite(syncAgeMs) && syncAgeMs > 14 * 60 * 60 * 1000;
  const kpiIntegrityWarning = inventoryMismatch || agg.sold > agg.capacity || agg.holds > 0 || agg.inactive > 0 || agg.missingPrices > 0 || staleSync;

  /**
   * What the selected booking window actually produced: reservations created
   * inside it, the room-nights they carry, and what was cancelled in the same
   * stretch. The calendar-day figure is kept alongside so a quiet morning
   * after a busy 48 hours is obvious rather than contradictory.
   */
  const booked = useMemo(() => {
    const startMs = pickupWindowStartMs(pickupWindowDays);
    const inWindow = (iso?: string | null) => {
      if (!iso) return false;
      const t = Date.parse(iso);
      return Number.isFinite(t) ? t >= startMs : false;
    };
    const reservations = new Set<string>();
    let roomNights = 0;
    let revenue = 0;
    let todayRoomNights = 0;
    let todayRevenue = 0;
    // Zero-priced booking legs can be group revenue allocations or genuine
    // complimentary stays. We cannot infer their cause without Previo detail.
    let todayUnpricedNights = 0;
    const todayRes = new Set<string>();
    for (const n of nights) {
      if (n.obk_id && excludedRoomTypeIds?.has(n.obk_id)) continue;
      if (!n.created_at_pms || !countsTowardRevenueSalesPickup(n)) continue;
      if (budapestDayOf(n.created_at_pms) === today) {
        todayRoomNights += 1;
        todayRevenue += n.nightly_price_eur ?? 0;
        if (!(n.nightly_price_eur ?? 0)) todayUnpricedNights += 1;
        todayRes.add(n.res_id);
      }
      if (!inWindow(n.created_at_pms)) continue;
      reservations.add(n.res_id);
      roomNights += 1;
      revenue += n.nightly_price_eur ?? 0;
    }

    const cancelledRes = new Set<string>();
    let cancelledNights = 0;
    const todayCancelledRes = new Set<string>();
    let todayCancelledNights = 0;
    for (const c of cancellations) {
      if (c.obk_id && excludedRoomTypeIds?.has(c.obk_id)) continue;
      if (!countsTowardRevenueSalesPickup(c)) continue;
      if (c.cancelled_at && budapestDayOf(c.cancelled_at) === today) {
        todayCancelledNights += 1;
        todayCancelledRes.add(c.res_id);
      }
      if (!inWindow(c.cancelled_at)) continue;
      cancelledRes.add(c.res_id);
      cancelledNights += 1;
    }
    return {
      reservations: reservations.size,
      roomNights,
      revenue,
      cancelledRes: cancelledRes.size,
      cancelledNights,
      todayRoomNights,
      todayReservations: todayRes.size,
      todayRevenue,
      todayUnpricedNights,

      todayCancelledNights,
      todayCancelledRes: todayCancelledRes.size,
    };
  }, [nights, cancellations, today, pickupWindowDays]);



  /** Six-month outlook strip: occupancy, ADR and RevPAR month by month. */
  const outlook = useMemo(() => {
    const start = monthKey(today);
    return Array.from({ length: 6 }, (_, i) => {
      const key = shiftMonth(start, i);
      return { key, ...aggregate(key) };
    });
  }, [metrics, today]);

  /**
   * Months beyond the horizon that has actually landed must read as "still
   * loading", never as a real 0% — an empty month is a fetch that has not
   * finished, not an empty hotel.
   */
  const loadedMonth = loadedThrough ? loadedThrough.slice(0, 7) : null;
  const isMonthPending = (key: string) => {
    if (loading) return true;
    if (loadedMonth && key > loadedMonth) return true;
    // A 30-day rolling window can end partway through the next month.
    // Never present incomplete monthly totals as a completed month.
    const [year, month] = key.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (loadedThrough && loadedThrough < lastDay) return true;
    const rows = metrics.filter((m) => monthKey(m.stay_date) === key);
    if (rows.length === 0) return true;
    // No synced evidence for any date in the month: the fetch has not landed,
    // so shimmer instead of printing a misleading 0%.
    return !rows.some((m) => m.hasData);
  };

  const monthPending = isMonthPending(month);
  const pendingMonths = outlook.filter((o) => isMonthPending(o.key)).length;

  const canPrev = months.length > 0 && month > months[0];
  const canNext = months.length > 0 && month < months[months.length - 1];

  const monthLabel = localMonth(month+"-01");
  // The tiles only hold nights from today onwards, so for the current month
  // they cover the rest of the month, not all of it. Say so on every tile:
  // a whole-month figure (nights already stayed + on the books) lives in the
  // occupancy cross-check card below.
  const partialMonth = Boolean(agg.firstDay && agg.firstDay > `${month}-01`);
  const periodLabel = partialMonth && agg.firstDay && agg.lastDay
    ? `${Number(agg.firstDay.slice(8, 10))}–${Number(agg.lastDay.slice(8, 10))} ${monthLabel} · ${hu ? "mától, a könyvben lévő foglalások" : "from today, on the books"}`
    : monthLabel;
  // Whole-month figures (nights already stayed + nights on the books) from the
  // server, so the tiles no longer cover only "from today". Falls back to the
  // from-today figures, labelled as such, if the request fails.
  const queryClient = useQueryClient();
  const recon = useMonthReconciliationDays(hotelId, month);
  const breakdown = useMemo(() => buildMonthBreakdown(recon.data ?? []), [recon.data]);
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const monthComplete = new Set((recon.data ?? []).filter((d) => d.stay_date.startsWith(month + "-")).map((d) => d.stay_date)).size === daysInMonth;
  const whole = monthComplete ? wholeMonthOf(breakdown) : null;
  const breakfastPrice = useMemo(() => breakfastPriceOf(recon.data ?? []), [recon.data]);
  const currentMonthKey = monthKey(today);
  const reconNow = useMonthReconciliationDays(hotelId, currentMonthKey);
  const wholeNow = useMemo(() => {
    const n = new Date(Date.UTC(Number(currentMonthKey.slice(0, 4)), Number(currentMonthKey.slice(5, 7)), 0)).getUTCDate();
    return new Set((reconNow.data ?? []).filter((d) => d.stay_date.startsWith(currentMonthKey + "-")).map((d) => d.stay_date)).size === n
      ? wholeMonthOf(buildMonthBreakdown(reconNow.data ?? [])) : null;
  }, [reconNow.data, currentMonthKey]);
  const reconPending = Boolean(hotelId) && recon.isLoading;
  const tilesLoading = loading || monthPending || reconPending;
  const adrOf = (w: MonthBreakdownRow) => w.adrGross;
  const revparOf = (w: MonthBreakdownRow) => w.revparGross;
  const partLine = (r: MonthBreakdownRow) => {
    const name = r.key === "stayed" ? (hu ? "Már eltöltött" : "Already stayed") : r.key === "books" ? (hu ? "Könyvben" : "On the books") : (hu ? "Teljes hónap" : "Whole month");
    const days = r.firstDay === r.lastDay ? `${Number(r.firstDay.slice(8, 10))}` : `${Number(r.firstDay.slice(8, 10))}–${Number(r.lastDay.slice(8, 10))}`;
    const adr = r.adrRoomOnly !== null
      ? `ADR ${money(r.adrRoomOnly)} ${hu ? "szoba" : "room"} / ${money(r.adrGross ?? 0)} ${hu ? "reggelivel" : "incl. breakfast"}`
      : `ADR ${r.adrGross === null ? "—" : money(r.adrGross)} ${hu ? "reggelivel" : "incl. breakfast"}`;
    return `• ${name} (${days}): ${r.sold}/${r.capacity} ${hu ? "éj" : "nights"}, ${r.occupancyPct === null ? "—" : Math.round(r.occupancyPct) + "%"}, ${adr}`;
  };
  const breakdownText = breakdown.map(partLine).join("\n");
  const saveBreakfastPrice = async (value: number | null) => {
    if (!hotelId) return;
    // The column is newer than the generated Supabase types.
    const settings = (supabase as unknown as {
      from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => {
        select: (cols: string) => Promise<{ data: unknown[] | null; error: unknown }>;
      } } };
    }).from("hotel_revenue_settings");
    const { data, error } = await settings
      .update({ breakfast_price_per_guest: value })
      .eq("hotel_id", hotelId)
      .select("hotel_id");
    // Row-level security turns a refused update into "0 rows", not an error.
    if (error || !data?.length) { toast.error(hu ? "A reggeli értékét nem sikerült menteni" : "Could not save the breakfast value"); return; }
    toast.success(hu ? "Reggeli értéke mentve" : "Breakfast value saved");
    await queryClient.invalidateQueries({ queryKey: ["kpi-reconciliation-days", hotelId] });
  };

  const saveRate = async () => {
    const value = Number(rateInput);
    if (!hotelId || !Number.isFinite(value) || value <= 0) return;
    const { error } = await (supabase as any)
      .from("hotel_revenue_settings")
      .update({ eur_conversion_rate: value, eur_rate_source: "manual", eur_rate_updated_at: new Date().toISOString() })
      .eq("hotel_id", hotelId);
    if (error) { toast.error("Could not save the exchange rate"); return; }
    setRevenueCurrency({ code: currency.code, eurRate: value, eurRateSource: "manual" });
    toast.success(`1 € = ${value} ${currency.code}`);
  };

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={!canPrev}
              onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>{localMonth(m+"-01")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={!canNext}
              onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1" />
        </div>

        {isForeignCurrency() && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-[11px]">
            <span className="font-medium">{hu?"Árak megjelenítése":"Show prices in"}</span>
            <div className="flex rounded-md border overflow-hidden">
              {[currency.code, "EUR"].map((c) => {
                const disabled = c === "EUR" && !(currency.eurRate && currency.eurRate > 0);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={disabled}
                    onClick={() => setDisplayCurrency(c, hotelId)}
                    className={`px-2 py-0.5 text-[11px] ${currency.displayCode === c ? "bg-primary text-primary-foreground" : disabled ? "opacity-40" : "hover:bg-muted"}`}
                  >
                    {c === "EUR" ? "€ EUR" : `${currencySymbol(c)} ${c}`}
                  </button>
                );
              })}
            </div>
            <span className="text-muted-foreground">
              {hu?"A PMS pénzneme":"PMS publishes"} {currency.code}
              {currency.displayCode === "EUR" ? (hu?" · átváltás az alábbi árfolyamon":" · converted at the rate below") : ""}
            </span>
            {canEdit ? (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">1 € =</span>
                <Input
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  onBlur={saveRate}
                  inputMode="decimal"
                  placeholder={hu?"árfolyam":"rate"}
                  className="h-6 w-20 text-[11px]"
                  aria-label={`Exchange rate, ${currency.code} per euro`}
                />
                <span className="text-muted-foreground">{currency.code}</span>
              </span>
            ) : currency.eurRate ? (
              <span className="text-muted-foreground">1 € = {currency.eurRate} {currency.code}</span>
            ) : (
              <span className="text-muted-foreground">{hu?"Nincs euróárfolyam beállítva – kérj adminisztrátori segítséget":"no euro rate set — ask an admin"}</span>
            )}
          </div>
        )}

        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            <span className="sm:hidden">{monthLabel} {hu?"teljesítménye":"performance"}</span>
            <span className="hidden sm:inline">{hu?monthLabel+" teljesítménye":"How "+monthLabel+" is performing"}</span>
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {roomsAvailable ? `${roomsAvailable} ${hu?"szoba":"rooms"}` : ""}
            <span className="hidden sm:inline">{roomsAvailable ? " · " : ""}{hu?"a mai foglalások alapján":"on the books today"}</span>
          </span>
        </div>


        {kpiIntegrityWarning && !loading && (
          <details className="text-[11px] text-muted-foreground rounded-md border border-amber-300/60 px-2 py-1.5">
            <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-300">{hu?"Adatminőség ellenőrzése":"Check data quality"}</summary>
            <div className="mt-1">
            <strong className="text-foreground">{hu?"Bevételi adatok köre:":"Revenue data scope:"}</strong>
            {agg.holds > 0 ? ` ${agg.holds} ${hu?"többéves blokkolt éjszaka kizárva a kereskedelmi készletből.":"multi-year inventory-hold nights excluded from commercial sales and capacity."}` : ""}
            {agg.inactive > 0 ? ` ${agg.inactive} ${hu?"éjszaka kizárva inaktív szobatípusokban.":"nights in inactive room kinds excluded."}` : ""}
            {inventoryMismatch ? ` ${hu?"A beállított készlet":"Configured inventory"} (${configuredRooms}) ${hu?"eltér az aktív PMS-készlettől":"differs from active PMS room types"} (${roomsAvailable}); ${hu?"az aktív típusok használatban.":"using active types."}` : ""}
            {agg.missingPrices > 0 ? ` ${agg.missingPrices} ${hu?"eladott szobaéjszakához hiányzik az ár; a bevétel, ADR és RevPAR nem teljes.":"sold room-nights are missing prices; revenue, ADR and RevPAR are incomplete."}` : ""}
            {staleSync ? (hu?" Az utolsó Previo-szinkron több mint 14 órás; az adatok elavultak lehetnek.":" The latest Previo sync is more than 14 hours old; figures may be stale.") : ""}
            {agg.sold > agg.capacity ? (hu?" Az eladott éjszakák meghaladják a készletet; ellenőrizd a PMS-szobatérképezést.":" Sold room-nights exceed inventory; verify PMS room mapping.") : ""}
            </div>
          </details>
        )}
        <div data-testid="monthly-kpis" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            loading={tilesLoading}
            label={hu?"Kihasználtság":"Occupancy"}
            value={whole?.occupancyPct == null ? "—" : `${Math.round(whole.occupancyPct)}%`}
            sub={whole ? `${whole.sold} ${hu?"a(z)":"of"} ${whole.capacity} ${hu?"szobaéjszakából":"room-nights"} · ${hu?"teljes hónap":"whole month"}` : (hu?"Havi adat nem érhető el":"Monthly data unavailable")}
            icon={<BedDouble className="h-3.5 w-3.5" />}
            surface={agg.occupancyPct >= 75 ? "border-l-emerald-500 bg-emerald-500/5" : agg.occupancyPct >= 45 ? "border-l-amber-500 bg-amber-500/5" : "border-l-sky-500 bg-sky-500/5"}
            explain={whole ? {
              title: `${hu?"Kihasználtság":"Occupancy"} — ${monthLabel}`,
              body: `${hu?"Eladott kereskedelmi szobaéjszakák ÷ eladható szobaéjszakák, a teljes hónapra.":"Commercial room-nights sold ÷ sellable room-nights, for the whole month."}\n\n${breakdownText}\n\n${hu?"A több éves blokkok és az inaktív szobatípusok kimaradnak az eladásból és a kapacitásból is.":"Multi-year holds and inactive room types are left out of both sales and capacity."}`,
            } : { title: `Occupancy — ${periodLabel}`, body: `Commercial occupied room-nights ÷ commercial room-nights available${partialMonth ? ", from today to the end of the month only. Nights already stayed this month are not included here; the occupancy cross-check below shows stayed + on the books = whole month" : ""}. Source: Previo reservations and active room inventory; non-commercial multi-year holds are removed from both sales and capacity.` }}
          />
          <Tile
            loading={tilesLoading}
            label="ADR"
            value={whole && adrOf(whole) !== null ? money(adrOf(whole)) : "—"}
            sub={whole ? (hu ? "Teljes hónap · reggelivel" : "whole month · incl. breakfast & extras") : (hu ? "Havi adat nem érhető el" : "Monthly data unavailable")}
            icon={<Coins className="h-3.5 w-3.5" />}
            surface="border-l-violet-500 bg-violet-500/5"
            explain={whole ? {
              title: `ADR — ${monthLabel}`,
              body: `${hu?"Teljes foglalási érték (reggelivel és extrákkal) ÷ áras eladott szobaéjszakák, a teljes hónapra.":"Gross booking value (including breakfast and extras) ÷ priced commercial room-nights sold, for the full month."}\n\n${breakdownText}\n\n${whole.adrRoomOnly !== null
                ? (hu?`A szobaár a foglalási ár mínusz az árban lévő reggeli (${whole.breakfasts} reggeli × ${money(breakfastPrice ?? 0)}). Ez hasonlítható a Previo irányítópulthoz és a Booking.com-hoz.`:`Room price = booking price minus the breakfast included in it (${whole.breakfasts} breakfasts × ${money(breakfastPrice ?? 0)}). This is the figure to compare with Previo's dashboard and Booking.com.`)
                : (hu?"A foglalási ár reggelit és extrákat is tartalmaz, ezért magasabb, mint a Previo irányítópult vagy a Booking.com szobaára. Szobaár-ADR-hez add meg a reggeli értékét a táblázat alatt.":"The booking price includes breakfast and extras, so it reads higher than the room price on Previo's dashboard or Booking.com. Set the breakfast value under the table to see room-only ADR.")}`,
            } : { title: "ADR = Average Daily Rate", body: `Booking value ÷ commercially sold room-nights${partialMonth ? ", from today to the end of the month only (nights already stayed are not included)" : ""}. Booking value is the full reservation price from Previo, so it includes breakfast and extras: Previo's dashboard and Booking.com show the room price only, usually about €12–13 per guest per night lower. Group rooms with €0 allocated count as sold. Multi-year holds and inactive room types are excluded. Shown in ${currency.code}.` }}
          />
          <Tile
            loading={tilesLoading}
            label="RevPAR"
            value={whole && revparOf(whole) !== null ? money(revparOf(whole)) : "—"}
            sub={whole ? (hu ? "Teljes hónap · reggelivel" : "whole month · incl. breakfast & extras") : (hu ? "Havi adat nem érhető el" : "Monthly data unavailable")}
            icon={<Gauge className="h-3.5 w-3.5" />}
            surface="border-l-cyan-500 bg-cyan-500/5"
            explain={{ title: "RevPAR = ADR × Occupancy", body: `Gross booking value ÷ all sellable room-nights for the entire month of ${monthLabel}. What every unit earns on average, sold or not. Uses the same ADR, so it also includes breakfast and extras.` }}
          />
          <Tile
            loading={tilesLoading}
            label={hu?"Nettó foglalásváltozás":"Net pickup"}
            value={`${agg.pickup > 0 ? "+" : ""}${agg.pickup}`}
            sub={`${agg.gained} ${hu?"új":"in"} · ${agg.lost} ${hu?"törölt":"out"} · ${localWindow(pickupWindowDays).toLowerCase()}`}
            icon={agg.pickup >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            surface={agg.pickup < 0 ? "border-l-destructive bg-destructive/5" : "border-l-emerald-500 bg-emerald-500/5"}
            tone={agg.pickup < 0 ? "text-destructive" : agg.pickup > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}
            explain={{
              title: "Pickup in window",
              body: `For stay dates in ${monthLabel}, counting only movement during "${windowLabel(pickupWindowDays)}":\n\n• ${agg.gained} room-night${agg.gained === 1 ? "" : "s"} came in\n• ${agg.lost} room-night${agg.lost === 1 ? "" : "s"} were lost (cancellations or no-shows)\n• net ${agg.pickup > 0 ? "+" : ""}${agg.pickup}\n• ${agg.datesUp} date${agg.datesUp === 1 ? "" : "s"} up · ${agg.datesDown} down\n\nChange the window with the selector above.`,
            }}
          />
        </div>
        {!whole && !tilesLoading && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{hu ? "A teljes hónap adatai nem ellenőrizhetők; nem jelenítünk meg részleges havi ADR-t." : "Full-month figures are unavailable or incomplete. Partial ADR is not shown as monthly ADR."}</p>}
        <details className="rounded-lg border px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">{hu ? "További mutatók" : "More metrics"} · bookings, revenue, rooms left</summary>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile
            loading={loading}
            label={hu?"Ma létrehozott foglalások":"Bookings created today"}
            value={`${booked.todayRoomNights} ${hu?"szobaéjszaka":"room-night"+(booked.todayRoomNights===1?"":"s")}`}
            sub={`${booked.todayReservations} ${hu?"foglalás":"reservation"+(booked.todayReservations===1?"":"s")}${
              booked.todayCancelledNights ? ` · ${booked.todayCancelledNights} cancelled` : ""
            }`}
            icon={<CalendarPlus className="h-3.5 w-3.5" />}
            surface={booked.todayRoomNights > 0 ? "border-l-primary bg-primary/5" : "border-l-border"}
            tone={booked.todayRoomNights > 0 ? "text-primary" : ""}
            explain={{
              title: "Bookings created today",
              body: `Reservations entered in Previo today (Budapest time), whatever their stay date:\n\n• ${booked.todayReservations} reservation${booked.todayReservations === 1 ? "" : "s"} created\n• ${booked.todayRoomNights} room-night${booked.todayRoomNights === 1 ? "" : "s"} booked\n• ${money(booked.todayRevenue)} of room revenue\n• ${booked.todayCancelledNights} room-night${booked.todayCancelledNights === 1 ? "" : "s"} cancelled (${booked.todayCancelledRes} reservation${booked.todayCancelledRes === 1 ? "" : "s"})${booked.todayUnpricedNights ? `\n• ${booked.todayUnpricedNights} room-night${booked.todayUnpricedNights === 1 ? "" : "s"} have a €0 rate in Previo. These remain in sold room-night counts; confirm whether they are group-price allocations or complimentary stays.` : ""}\n\nThe pickup row in the calendar below uses the booking window you selected (${windowLabel(pickupWindowDays).toLowerCase()}), so it can show movement even on a quiet morning.`,
            }}
          />
          <Tile
            loading={tilesLoading}
            label={hu?"Bevétel":"Revenue"}
            value={whole ? money(whole.revenueGross) : "—"}
            sub={whole ? (hu ? "Foglalási érték · teljes hónap" : "Gross booking value · whole month") : (hu ? "Havi adat nem érhető el" : "Monthly data unavailable")}
            icon={<Coins className="h-3.5 w-3.5" />}
            surface="border-l-emerald-500 bg-emerald-500/5"
            explain={{
              title: `Revenue on the books — ${monthLabel}`,
              body: whole ? `${hu?"Minden megerősített szobaéjszaka foglalási értéke a hónapban: a már eltöltött éjszakák és a könyvben lévő jövőbeli éjszakák együtt. A lemondások és no-show-k kimaradnak. A foglalási érték reggelit és extrákat is tartalmazhat.":"Booking value of every confirmed room-night in the month: nights already stayed plus nights still on the books. Cancellations and no-shows are excluded. Booking value can include breakfast and extras."}${whole.revenueRoomOnly !== null ? `\n\n${hu?"Szobabevétel (reggeli nélkül)":"Room revenue (without breakfast)"}: ${money(whole.revenueRoomOnly)}` : ""}` : `Sum of every confirmed room-night with a stay date in ${monthLabel} (${agg.days} day${agg.days === 1 ? "" : "s"} in view), priced at the rate on the booking. Cancellations and no-shows are excluded. It is booked-to-date, not forecast.`,
            }}
          />
          <Tile
            loading={tilesLoading}
            label={hu?"Szabad szobaéjszakák":"Rooms left"}
            value={agg.capacity ? String(agg.left) : "—"}
            sub={`${monthLabel} · ${hu?"mától elérhető":"from today onward"}`}
            icon={<DoorOpen className="h-3.5 w-3.5" />}
            surface="border-l-amber-500 bg-amber-500/5"
            explain={{ title: `Rooms left to sell — ${monthLabel}`, body: `Sellable room-nights still open across every date in ${monthLabel}: capacity (${agg.capacity}) − sold (${agg.sold}). It counts nights, not units.` }}
          />
          </div>
        </details>

        {monthComplete && breakdown.length > 0 && !tilesLoading && (
          <details className="rounded-lg border px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium">{hu ? "ADR számítás és reggeli beállítások" : "ADR calculation & breakfast settings"}</summary>
            <div className="mt-2">
              <MonthBreakdownPanel
            rows={breakdown}
            monthLabel={monthLabel}
            breakfastPrice={breakfastPrice}
            hu={hu}
            canEdit={canEdit}
            onSaveBreakfastPrice={saveBreakfastPrice}
              />
            </div>
          </details>
        )}

        {/* One place to choose the pickup window, right next to the numbers it drives. */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
          <span className="text-[11px] font-medium">{hu?"Foglalásváltozás időszaka":"Pickup window"}</span>
          <Select value={String(pickupWindowDays)} onValueChange={(v) => onPickupWindowChange(Number(v))}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PICKUP_WINDOWS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>{hu?(PICKUP_WINDOW_HU[p.value]|| (p.value===PICKUP_WINDOW_48H?"Elmúlt 48 óra":p.label)):p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

        </div>




        <section className="rounded-lg border p-3" aria-label="Six-month occupancy outlook">
          <p className="mb-2 text-xs font-semibold">{hu ? "Hat hónapos kihasználtság" : "Occupancy · next 6 months"}</p>
          <div className="h-36 w-full"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={outlook.map((raw) => {
              const isCurrent = raw.key === currentMonthKey;
              const ready = !isMonthPending(raw.key) && (!isCurrent || !!wholeNow);
              return { month: localMonth(raw.key + "-01").slice(0, 3),
                occupancy: ready ? Math.round(isCurrent ? wholeNow!.occupancyPct ?? 0 : raw.occupancyPct) : null };
            })} margin={{ top: 4, right: 5, bottom: 0, left: -22 }}>
              <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0,100]} ticks={[0,50,100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(n: number) => n+"%"} />
              <ChartTooltip formatter={(n: number) => [n+"%", hu ? "Kihasználtság" : "Occupancy"]} />
              <Bar dataKey="occupancy" fill="hsl(var(--primary))" maxBarSize={38} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer></div>
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {outlook.map((o) => <button key={o.key} type="button" onClick={() => setMonth(o.key)}
              className={`shrink-0 rounded border px-2 py-1 text-[11px] ${o.key === month ? "border-primary bg-primary/10 font-semibold" : "text-muted-foreground"}`}>
              {localMonth(o.key+"-01").slice(0,3)}
            </button>)}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{hu ? "Az aktuális hónap korábbi és jövőbeli foglalásokat, a későbbi hónapok az eddigi foglalásokat mutatják." : "Current month includes stayed and booked nights; future months show bookings on the books, not a forecast."}</p>
        </section>
      </CardContent>
    </Card>
  );
}
