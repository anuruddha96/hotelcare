import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, BedDouble, Coins, Gauge, DoorOpen, TrendingUp, TrendingDown, Info } from "lucide-react";
import { formatMonth, type DayMetrics } from "@/lib/revenueAnalytics";
import { money, eurEquivalent, setRevenueCurrency, setDisplayCurrency, currencySymbol, useRevenueCurrency, isForeignCurrency } from "@/lib/revenueCurrency";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const PICKUP_WINDOWS = [
  { value: 1, label: "Today only" },
  { value: 2, label: "Yesterday + today" },
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
];

function windowLabel(days: number) {
  return PICKUP_WINDOWS.find((p) => p.value === days)?.label ?? `Last ${days} days`;
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

function Tile({ label, value, sub, icon, tone, surface, explain }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; tone?: string;
  surface?: string;
  explain?: { title: string; body: string };
}) {
  return (
    <div className={`snap-start shrink-0 w-[76%] xs:w-[60%] sm:w-auto sm:flex-1 rounded-lg border border-l-4 p-3 min-w-0 sm:min-w-[128px] ${surface ?? "border-l-border"}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}<span className="truncate">{label}</span>
        {explain && <Explain {...explain} />}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums truncate ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
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
  selectedMonth, onSelectedMonthChange,
}: {
  today: string;
  metrics: DayMetrics[];
  pickupWindowDays: number;
  onPickupWindowChange: (days: number) => void;
  hotelId?: string | null;
  canEdit?: boolean;
  roomsAvailable?: number;
  selectedMonth?: string;
  onSelectedMonthChange?: (month: string) => void;
}) {
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
    const sold = rows.reduce((s, m) => s + m.roomsSold, 0);
    const capacity = rows.reduce((s, m) => s + m.roomsAvailable, 0);
    const revenue = rows.reduce((s, m) => s + m.revenueEur, 0);
    const left = rows.reduce((s, m) => s + m.roomsLeft, 0);
    const pickup = rows.reduce((s, m) => s + (m.netPickup ?? 0), 0);
    // Movement behind the net figure: reservations that came in and rooms lost
    // inside the selected booking window.
    const gained = rows.reduce((s, m) => s + (m.newBookings ?? 0), 0);
    const lost = rows.reduce((s, m) => s + (m.roomsLost ?? 0), 0);
    const datesUp = rows.filter((m) => (m.netPickup ?? 0) > 0).length;
    const datesDown = rows.filter((m) => (m.netPickup ?? 0) < 0).length;
    return {
      days: rows.length,
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

  /** Six-month outlook strip: occupancy, ADR and RevPAR month by month. */
  const outlook = useMemo(() => {
    const start = monthKey(today);
    return Array.from({ length: 6 }, (_, i) => {
      const key = shiftMonth(start, i);
      return { key, ...aggregate(key) };
    });
  }, [metrics, today]);

  const canPrev = months.length > 0 && month > months[0];
  const canNext = months.length > 0 && month < months[months.length - 1];

  const monthLabel = formatMonth(`${month}-01`);

  /**
   * The KPI strip is a plain, finger-friendly carousel: native momentum
   * scrolling with snap points, plus a dot row so it is obvious there is more
   * to the right. Nothing writes to scrollLeft automatically, so a vertical
   * gesture beginning over this first-screen strip remains browser-native.
   */
  const tileScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeTile, setActiveTile] = useState(0);

  useEffect(() => {
    const el = tileScrollRef.current;
    if (!el) return;
    el.scrollTo({ left: 0, behavior: "auto" });
    setActiveTile(0);
  }, [month]);

  // Which card is in view — read on scroll end, never written back.
  useEffect(() => {
    const el = tileScrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const node = tileScrollRef.current;
        if (!node) return;
        const card = node.firstElementChild as HTMLElement | null;
        const step = card ? card.offsetWidth + 8 : node.clientWidth;
        setActiveTile(step > 0 ? Math.round(node.scrollLeft / step) : 0);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); if (raf) window.cancelAnimationFrame(raf); };
  }, []);

  const scrollToTile = (i: number) => {
    const node = tileScrollRef.current;
    if (!node) return;
    const card = node.firstElementChild as HTMLElement | null;
    const step = card ? card.offsetWidth + 8 : node.clientWidth;
    node.scrollTo({ left: i * step, behavior: "smooth" });
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
                  <SelectItem key={m} value={m}>{formatMonth(`${m}-01`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={!canNext}
              onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1" />
          <Select value={String(pickupWindowDays)} onValueChange={(v) => onPickupWindowChange(Number(v))}>
            <SelectTrigger className="h-8 w-[175px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PICKUP_WINDOWS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>Booked in: {p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isForeignCurrency() && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-[11px]">
            <span className="font-medium">Show prices in</span>
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
              PMS publishes {currency.code}
              {currency.displayCode === "EUR" ? " · converted at the rate below" : ""}
            </span>
            {canEdit ? (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">1 € =</span>
                <Input
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  onBlur={saveRate}
                  inputMode="decimal"
                  placeholder="rate"
                  className="h-6 w-20 text-[11px]"
                  aria-label={`Exchange rate, ${currency.code} per euro`}
                />
                <span className="text-muted-foreground">{currency.code}</span>
              </span>
            ) : currency.eurRate ? (
              <span className="text-muted-foreground">1 € = {currency.eurRate} {currency.code}</span>
            ) : (
              <span className="text-muted-foreground">no euro rate set — ask an admin</span>
            )}
          </div>
        )}

        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            How {monthLabel} is performing
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {roomsAvailable ? `inventory: ${roomsAvailable} rooms · ` : ""}on the books today · scroll for more
          </span>
        </div>


        <div
          ref={tileScrollRef}
          className="-mx-1 flex touch-pan-x gap-2 overflow-x-auto overscroll-x-contain px-1 snap-x snap-mandatory scrollbar-hide [-webkit-overflow-scrolling:touch]"
        >

          <Tile
            label="Occupancy"
            value={agg.capacity ? `${Math.round(agg.occupancyPct)}%` : "—"}
            sub={`${agg.sold} of ${agg.capacity} room-nights · ${monthLabel}`}
            icon={<BedDouble className="h-3.5 w-3.5" />}
            surface={agg.occupancyPct >= 75 ? "border-l-emerald-500 bg-emerald-500/5" : agg.occupancyPct >= 45 ? "border-l-amber-500 bg-amber-500/5" : "border-l-sky-500 bg-sky-500/5"}
            explain={{ title: `Occupancy — ${monthLabel}`, body: "Room-nights sold in this month ÷ sellable room-nights in this month (units × days). Source: Previo reservations." }}
          />
          <Tile
            label="ADR — average price per sold night"
            value={money(agg.adr)}
            sub={eurEquivalent(agg.adr) || `${monthLabel} · revenue ÷ nights sold`}
            icon={<Coins className="h-3.5 w-3.5" />}
            surface="border-l-violet-500 bg-violet-500/5"
            explain={{ title: "ADR = Average Daily Rate", body: `Room revenue ÷ room-nights sold for ${monthLabel}. Shown in ${currency.code}.` }}
          />
          <Tile
            label="RevPAR — earned per available unit"
            value={money(agg.revpar)}
            sub={eurEquivalent(agg.revpar) || `${monthLabel} · ADR × occupancy`}
            icon={<Gauge className="h-3.5 w-3.5" />}
            surface="border-l-cyan-500 bg-cyan-500/5"
            explain={{ title: "RevPAR = ADR × Occupancy", body: `Room revenue ÷ all sellable room-nights in ${monthLabel}. What every unit earns on average, sold or not.` }}
          />
          <Tile
            label="Revenue on the books"
            value={money(agg.revenue)}
            sub={eurEquivalent(agg.revenue) || `${monthLabel} · ${agg.days} day${agg.days === 1 ? "" : "s"}`}
            icon={<Coins className="h-3.5 w-3.5" />}
            surface="border-l-emerald-500 bg-emerald-500/5"
            explain={{
              title: `Revenue on the books — ${monthLabel}`,
              body: `Sum of every confirmed room-night with a stay date in ${monthLabel} (${agg.days} day${agg.days === 1 ? "" : "s"} in view), priced at the rate on the booking. Cancellations and no-shows are excluded. It is booked-to-date, not forecast.`,
            }}
          />
          <Tile
            label="Rooms left to sell"
            value={agg.capacity ? String(agg.left) : "—"}
            sub={`${monthLabel} · whole month`}
            icon={<DoorOpen className="h-3.5 w-3.5" />}
            surface="border-l-amber-500 bg-amber-500/5"
            explain={{ title: `Rooms left to sell — ${monthLabel}`, body: `Sellable room-nights still open across every date in ${monthLabel}: capacity (${agg.capacity}) − sold (${agg.sold}). It counts nights, not units.` }}
          />
          <Tile
            label="Pickup in window"
            value={`${agg.pickup > 0 ? "+" : ""}${agg.pickup}`}
            sub={`booked in: ${windowLabel(pickupWindowDays).toLowerCase()}`}
            icon={agg.pickup >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            surface={agg.pickup < 0 ? "border-l-destructive bg-destructive/5" : "border-l-emerald-500 bg-emerald-500/5"}
            tone={agg.pickup < 0 ? "text-destructive" : agg.pickup > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}
            explain={{
              title: "Pickup in window",
              body: `Net room-nights gained or lost for stay dates in ${monthLabel}, counting only bookings created (or cancelled) during the selected window — currently "${windowLabel(pickupWindowDays)}". Change the window with the selector above.`,
            }}
          />
        </div>

        {/* Dots: which KPI card you are on (phones only) */}
        <div className="flex justify-center gap-1.5 sm:hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show card ${i + 1}`}
              onClick={() => scrollToTile(i)}
              className={`h-1.5 rounded-full transition-all ${i === activeTile ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"}`}
            />
          ))}
        </div>




        {/* Six-month outlook, current month highlighted */}
        <div className="-mx-1 overflow-x-auto">
          <div className="flex gap-2 px-1 min-w-0">
            {outlook.map((o, i) => {
              const active = o.key === month;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setMonth(o.key)}
                  className={`shrink-0 w-[124px] rounded-lg border p-2 text-left transition-colors ${
                    active ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                    {formatMonth(`${o.key}-01`)}{i === 0 ? " · now" : ""}
                  </div>
                  <div className="text-base font-semibold tabular-nums">
                    {o.capacity ? `${Math.round(o.occupancyPct)}%` : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums truncate">
                    ADR {money(o.adr)}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums truncate">
                    RevPAR {money(o.revpar)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
