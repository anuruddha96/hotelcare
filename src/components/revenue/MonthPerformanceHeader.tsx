import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronLeft, ChevronRight, BedDouble, Coins, Gauge, DoorOpen, TrendingUp, TrendingDown, Info, CalendarPlus, RefreshCw } from 'lucide-react';
import { budapestDayOf, formatMonth, pickupWindowLabel, pickupWindowStartMs, PICKUP_WINDOW_48H, type BookingNight, type CancelledNight, type DayMetrics } from '@/lib/revenueAnalytics';
import { money, eurEquivalent, setRevenueCurrency, setDisplayCurrency, currencySymbol, useRevenueCurrency, isForeignCurrency } from '@/lib/revenueCurrency';
import { supabase } from '@/integrations/supabase/client';
import { useMonthlyRevenueKpis } from '@/hooks/useMonthlyRevenueKpis';
import { toast } from 'sonner';

const PICKUP_WINDOWS = [
  { value: PICKUP_WINDOW_48H, label: 'Last 48 hours (automation)' },
  { value: 1, label: 'Today only' },
  { value: 2, label: 'Yesterday + today' },
  { value: 3, label: 'Last 3 days' },
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' },
];
const INITIAL_KPI_HOLD_MS = 10_000;
const KPI_AUTOSCROLL_INTERVAL_MS = 4_500;
const monthKey = (date: string) => date.slice(0, 7);
function shiftMonth(key: string, delta: number) {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}
function monthEnd(key: string) {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function windowLabel(days: number) {
  return PICKUP_WINDOWS.find((item) => item.value === days)?.label ?? pickupWindowLabel(days);
}
function Explain({ title, body }: { title: string; body: string }) {
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`What is ${title}?`} className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground"><Info className="h-3 w-3" /></button>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" className="w-72 text-xs leading-relaxed">
      <p className="mb-1 font-semibold">{title}</p><p className="whitespace-pre-line text-muted-foreground">{body}</p>
    </PopoverContent>
  </Popover>;
}
function Tile({ label, value, sub, icon, tone, surface, explain, loading }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; tone?: string;
  surface?: string; explain?: { title: string; body: string }; loading?: boolean;
}) {
  return <div className={`snap-start shrink-0 w-[76%] xs:w-[60%] sm:w-auto sm:flex-1 rounded-lg border border-l-4 p-3 min-w-0 sm:min-w-[128px] ${surface ?? 'border-l-border'}`}>
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon}<span className="truncate">{label}</span>{explain && !loading && <Explain {...explain} />}</div>
    {loading ? <div className="animate-pulse" aria-label={`${label} loading`}><div className="mt-2 h-5 w-2/3 rounded bg-muted-foreground/20" /><div className="mt-2 h-2.5 w-4/5 rounded bg-muted-foreground/10" /></div> : <>
      <div key={value} className={`mt-1 text-xl font-semibold tabular-nums truncate animate-fade-in ${tone ?? ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </>}
  </div>;
}

interface Aggregate {
  days: number; sold: number; capacity: number; revenue: number; left: number;
  pickup: number; gained: number; lost: number; datesUp: number; datesDown: number;
  occupancyPct: number; adr: number | null; revpar: number | null;
}
function fromDailyMetrics(rows: DayMetrics[]): Aggregate {
  const sold = rows.reduce((total, row) => total + row.roomsSold, 0);
  const capacity = rows.reduce((total, row) => total + row.roomsAvailable, 0);
  const revenue = rows.reduce((total, row) => total + row.revenueEur, 0);
  return {
    days: rows.length, sold, capacity, revenue,
    left: rows.reduce((total, row) => total + row.roomsLeft, 0),
    pickup: rows.reduce((total, row) => total + (row.netPickup ?? 0), 0),
    gained: rows.reduce((total, row) => total + (row.newBookings ?? 0), 0),
    lost: rows.reduce((total, row) => total + (row.roomsLost ?? 0), 0),
    datesUp: rows.filter((row) => (row.netPickup ?? 0) > 0).length,
    datesDown: rows.filter((row) => (row.netPickup ?? 0) < 0).length,
    occupancyPct: capacity ? sold / capacity * 100 : 0,
    adr: sold ? revenue / sold : null,
    revpar: capacity ? revenue / capacity : null,
  };
}

/** Monthly KPI cards use a compact, authorized six-month publication summary;
 *  the interactive price calendar remains a separate, lazy thirty-day request.
 */
export default function MonthPerformanceHeader({
  today, metrics, pickupWindowDays, onPickupWindowChange, hotelId, canEdit, roomsAvailable,
  selectedMonth, onSelectedMonthChange, nights = [], cancellations = [], loading = false, loadedThrough,
  refreshing = false, lastSyncAt = null,
}: {
  today: string; metrics: DayMetrics[]; nights?: BookingNight[]; cancellations?: CancelledNight[];
  pickupWindowDays: number; onPickupWindowChange: (days: number) => void;
  hotelId?: string | null; canEdit?: boolean; roomsAvailable?: number;
  loadedThrough?: string; selectedMonth?: string; onSelectedMonthChange?: (month: string) => void;
  loading?: boolean; refreshing?: boolean; lastSyncAt?: string | null;
}) {
  const [internalMonth, setInternalMonth] = useState(() => monthKey(today));
  const month = selectedMonth ?? internalMonth;
  const setMonth = (value: string) => { setInternalMonth(value); onSelectedMonthChange?.(value); };
  const currency = useRevenueCurrency();
  const [rateInput, setRateInput] = useState(currency.eurRate ? String(currency.eurRate) : '');
  useEffect(() => { setRateInput(currency.eurRate ? String(currency.eurRate) : ''); }, [currency.eurRate]);

  const { rows: monthlyRows, error: monthlyError, retry: retryMonthly } = useMonthlyRevenueKpis(hotelId, lastSyncAt);
  const monthly = useMemo(() => new Map(monthlyRows.map((row) => [row.month_key, row])), [monthlyRows]);
  const months = useMemo(() => Array.from(new Set([
    ...metrics.map((row) => monthKey(row.stay_date)), ...monthlyRows.map((row) => row.month_key),
  ])).sort(), [metrics, monthlyRows]);
  const localMonths = useMemo(() => {
    const grouped = new Map<string, DayMetrics[]>();
    for (const row of metrics) {
      const key = monthKey(row.stay_date);
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
    return grouped;
  }, [metrics]);

  // A new publication must NEVER mix bookings from one sync with inventory
  // from another; an unverified summary cannot be mistaken for genuine zero.
  const summaryFor = (key: string) => {
    const row = monthly.get(key);
    const sameSync = row && (!lastSyncAt || Date.parse(row.sync_completed_at) === Date.parse(lastSyncAt));
    return sameSync && row.complete && roomsAvailable && roomsAvailable > 0 ? row : null;
  };
  const localReady = (key: string) => {
    const rows = localMonths.get(key) ?? [];
    return !loading && !!loadedThrough && loadedThrough >= monthEnd(key) && rows.some((row) => row.hasData);
  };
  const isMonthPending = (key: string) => !summaryFor(key) && !localReady(key);
  const aggregate = (key: string): Aggregate => {
    const compact = summaryFor(key);
    if (compact) {
      const capacity = compact.days * (roomsAvailable ?? 0);
      const local = localReady(key) ? fromDailyMetrics(localMonths.get(key) ?? []) : null;
      return {
        days: compact.days, sold: compact.rooms_sold, capacity, revenue: compact.revenue_eur,
        left: local ? local.left : Math.max(0, capacity - compact.rooms_sold),
        pickup: local?.pickup ?? 0, gained: local?.gained ?? 0, lost: local?.lost ?? 0,
        datesUp: local?.datesUp ?? 0, datesDown: local?.datesDown ?? 0,
        occupancyPct: capacity ? compact.rooms_sold / capacity * 100 : 0,
        adr: compact.rooms_sold ? compact.revenue_eur / compact.rooms_sold : null,
        revpar: capacity ? compact.revenue_eur / capacity : null,
      };
    }
    return fromDailyMetrics(localMonths.get(key) ?? []);
  };
  const agg = aggregate(month);
  const outlook = Array.from({ length: 6 }, (_, index) => {
    const key = shiftMonth(monthKey(today), index);
    return { key, ...aggregate(key) };
  });
  const pendingMonths = outlook.filter((item) => isMonthPending(item.key)).length;
  const monthPending = isMonthPending(month);
  const monthLabel = formatMonth(`${month}-01`);
  const canPrev = months.length > 0 && month > months[0];
  const canNext = months.length > 0 && month < months[months.length - 1];

  const booked = useMemo(() => {
    const startMs = pickupWindowStartMs(pickupWindowDays);
    const reservations = new Set<string>();
    const todayRes = new Set<string>();
    const todayCancelledRes = new Set<string>();
    let roomNights = 0, revenue = 0, todayRoomNights = 0, todayRevenue = 0;
    let todayUnpricedNights = 0, cancelledNights = 0, todayCancelledNights = 0;
    const cancelledRes = new Set<string>();
    for (const night of nights) {
      if (!night.created_at_pms) continue;
      if (budapestDayOf(night.created_at_pms) === today) {
        todayRoomNights++;
        todayRevenue += night.nightly_price_eur ?? 0;
        if (!(night.nightly_price_eur ?? 0)) todayUnpricedNights++;
        todayRes.add(night.res_id);
      }
      if (Date.parse(night.created_at_pms) >= startMs) {
        reservations.add(night.res_id);
        roomNights++;
        revenue += night.nightly_price_eur ?? 0;
      }
    }
    for (const night of cancellations) {
      if (night.cancelled_at && budapestDayOf(night.cancelled_at) === today) {
        todayCancelledNights++;
        todayCancelledRes.add(night.res_id);
      }
      if (night.cancelled_at && Date.parse(night.cancelled_at) >= startMs) {
        cancelledRes.add(night.res_id);
        cancelledNights++;
      }
    }
    return { reservations: reservations.size, roomNights, revenue,
      cancelledRes: cancelledRes.size, cancelledNights, todayRoomNights,
      todayReservations: todayRes.size, todayRevenue, todayUnpricedNights,
      todayCancelledNights, todayCancelledRes: todayCancelledRes.size };
  }, [nights, cancellations, today, pickupWindowDays]);

  const tileScrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollPausedUntilRef = useRef(0);
  const [activeTile, setActiveTile] = useState(0);
  useEffect(() => {
    const element = tileScrollRef.current;
    if (!element) return;
    element.scrollTo({ left: 0, behavior: 'auto' });
    setActiveTile(0);
  }, [month]);
  useEffect(() => {
    const element = tileScrollRef.current;
    if (!element) return;
    let animationFrame = 0;
    const onScroll = () => {
      if (animationFrame) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        const card = element.firstElementChild as HTMLElement | null;
        const step = card ? card.offsetWidth + 8 : element.clientWidth;
        setActiveTile(step > 0 ? Math.round(element.scrollLeft / step) : 0);
      });
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => { element.removeEventListener('scroll', onScroll); if (animationFrame) cancelAnimationFrame(animationFrame); };
  }, []);
  useEffect(() => {
    const element = tileScrollRef.current;
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pause = () => { autoScrollPausedUntilRef.current = Date.now() + 6000; };
    const advance = () => {
      if (document.hidden || Date.now() < autoScrollPausedUntilRef.current || element.scrollWidth <= element.clientWidth + 4) return;
      const cards = Array.from(element.children) as HTMLElement[];
      if (cards.length < 2) return;
      const step = cards[0].offsetWidth + 8;
      if (step <= 0) return;
      const max = Math.max(0, element.scrollWidth - element.clientWidth);
      const current = Math.max(0, Math.round(element.scrollLeft / step));
      element.scrollTo({ left: element.scrollLeft >= max - 4 || current >= cards.length - 1 ? 0 : Math.min((current + 1) * step, max), behavior: 'smooth' });
    };
    let interval: number | undefined;
    const initial = window.setTimeout(() => { advance(); interval = window.setInterval(advance, KPI_AUTOSCROLL_INTERVAL_MS); }, INITIAL_KPI_HOLD_MS);
    element.addEventListener('pointerdown', pause, { passive: true });
    element.addEventListener('wheel', pause, { passive: true });
    element.addEventListener('focusin', pause);
    return () => {
      clearTimeout(initial);
      if (interval !== undefined) clearInterval(interval);
      element.removeEventListener('pointerdown', pause);
      element.removeEventListener('wheel', pause);
      element.removeEventListener('focusin', pause);
    };
  }, [month]);
  const scrollToTile = (index: number) => {
    const element = tileScrollRef.current;
    if (!element) return;
    autoScrollPausedUntilRef.current = Date.now() + 6000;
    const card = element.firstElementChild as HTMLElement | null;
    element.scrollTo({ left: index * (card ? card.offsetWidth + 8 : element.clientWidth), behavior: 'smooth' });
  };
  const saveRate = async () => {
    const value = Number(rateInput);
    if (!hotelId || !Number.isFinite(value) || value <= 0) return;
    const { error } = await (supabase as any).from('hotel_revenue_settings')
      .update({ eur_conversion_rate: value, eur_rate_source: 'manual', eur_rate_updated_at: new Date().toISOString() })
      .eq('hotel_id', hotelId);
    if (error) { toast.error('Could not save the exchange rate'); return; }
    setRevenueCurrency({ code: currency.code, eurRate: value, eurRateSource: 'manual' });
    toast.success(`1 € = ${value} ${currency.code}`);
  };

  return <Card><CardContent className="p-3 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={!canPrev} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
        <Select value={month} onValueChange={setMonth}><SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger><SelectContent>{months.map((item) => <SelectItem key={item} value={item}>{formatMonth(`${item}-01`)}</SelectItem>)}</SelectContent></Select>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={!canNext} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
      </div><div className="flex-1" />
    </div>
    {isForeignCurrency() && <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-[11px]">
      <span className="font-medium">Show prices in</span><div className="flex rounded-md border overflow-hidden">
        {[currency.code, 'EUR'].map((code) => {
          const disabled = code === 'EUR' && !(currency.eurRate && currency.eurRate > 0);
          return <button key={code} type="button" disabled={disabled} onClick={() => setDisplayCurrency(code, hotelId)} className={`px-2 py-0.5 text-[11px] ${currency.displayCode === code ? 'bg-primary text-primary-foreground' : disabled ? 'opacity-40' : 'hover:bg-muted'}`}>{code === 'EUR' ? '€ EUR' : `${currencySymbol(code)} ${code}`}</button>;
        })}
      </div><span className="text-muted-foreground">PMS publishes {currency.code}{currency.displayCode === 'EUR' ? ' · converted at the rate below' : ''}</span>
      {canEdit ? <span className="flex items-center gap-1"><span className="text-muted-foreground">1 € =</span><Input value={rateInput} onChange={(event) => setRateInput(event.target.value)} onBlur={saveRate} inputMode="decimal" placeholder="rate" className="h-6 w-20 text-[11px]" aria-label={`Exchange rate, ${currency.code} per euro`} /><span className="text-muted-foreground">{currency.code}</span></span>
        : currency.eurRate ? <span className="text-muted-foreground">1 € = {currency.eurRate} {currency.code}</span>
        : <span className="text-muted-foreground">no euro rate set — ask an admin</span>}
    </div>}
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold"><span className="sm:hidden">{monthLabel} performance</span><span className="hidden sm:inline">How {monthLabel} is performing</span></h2>
      <span className="text-[11px] text-muted-foreground">{roomsAvailable ? `${roomsAvailable} rooms` : ''}<span className="hidden sm:inline">{roomsAvailable ? ' · ' : ''}on the books today</span></span>
    </div>
    <div ref={tileScrollRef} className="-mx-1 flex touch-pan-x gap-2 overflow-x-auto overscroll-x-contain px-1 snap-x snap-mandatory scrollbar-hide [-webkit-overflow-scrolling:touch]">
      <Tile loading={loading} label="Bookings created today" value={`${booked.todayRoomNights} room-night${booked.todayRoomNights === 1 ? '' : 's'}`} sub={`${booked.todayReservations} reservation${booked.todayReservations === 1 ? '' : 's'}${booked.todayCancelledNights ? ` · ${booked.todayCancelledNights} cancelled` : ''}`} icon={<CalendarPlus className="h-3.5 w-3.5" />} surface={booked.todayRoomNights > 0 ? 'border-l-primary bg-primary/5' : 'border-l-border'} tone={booked.todayRoomNights > 0 ? 'text-primary' : ''}
        explain={{ title: 'Bookings created today', body: `Reservations entered in Previo today (Budapest time), whatever their stay date:\n\n• ${booked.todayReservations} reservations created\n• ${booked.todayRoomNights} room-nights booked\n• ${money(booked.todayRevenue)} of room revenue\n• ${booked.todayCancelledNights} room-nights cancelled (${booked.todayCancelledRes} reservations)${booked.todayUnpricedNights ? `\n• ${booked.todayUnpricedNights} room-nights carried €0 in a group booking.` : ''}\n\nThe calendar pickup uses ${windowLabel(pickupWindowDays).toLowerCase()}.` }} />
      <Tile loading={monthPending} label="Occupancy" value={agg.capacity ? `${Math.round(agg.occupancyPct)}%` : '—'} sub={`${agg.sold} of ${agg.capacity} room-nights · ${monthLabel}`} icon={<BedDouble className="h-3.5 w-3.5" />} surface={agg.occupancyPct >= 75 ? 'border-l-emerald-500 bg-emerald-500/5' : agg.occupancyPct >= 45 ? 'border-l-amber-500 bg-amber-500/5' : 'border-l-sky-500 bg-sky-500/5'} explain={{ title: `Occupancy — ${monthLabel}`, body: 'Room-nights sold ÷ sellable room-nights. Source: the same completed Previo booking publication as the calendar.' }} />
      <Tile loading={monthPending} label="ADR" value={money(agg.adr)} sub={eurEquivalent(agg.adr) || `${monthLabel} · revenue ÷ nights sold`} icon={<Coins className="h-3.5 w-3.5" />} surface="border-l-violet-500 bg-violet-500/5" explain={{ title: 'ADR = Average Daily Rate', body: `Room revenue ÷ room-nights sold for ${monthLabel}, in ${currency.code}. Zero-priced group companion rooms remain part of sold inventory.` }} />
      <Tile loading={monthPending} label="RevPAR" value={money(agg.revpar)} sub={eurEquivalent(agg.revpar) || `${monthLabel} · revenue ÷ capacity`} icon={<Gauge className="h-3.5 w-3.5" />} surface="border-l-cyan-500 bg-cyan-500/5" explain={{ title: 'RevPAR = Revenue per Available Room', body: `Room revenue ÷ all sellable room-nights for ${monthLabel}. The current month runs from today, matching the price calendar.` }} />
      <Tile loading={monthPending} label="Revenue" value={money(agg.revenue)} sub={eurEquivalent(agg.revenue) || `${monthLabel} · ${agg.days} days`} icon={<Coins className="h-3.5 w-3.5" />} surface="border-l-emerald-500 bg-emerald-500/5" explain={{ title: `Revenue on the books — ${monthLabel}`, body: `Total booked room-night revenue, ${agg.days} visible stay days. Cancellations/no-shows are excluded. This is booked-to-date, not forecast.` }} />
      <Tile loading={monthPending} label="Rooms left" value={agg.capacity ? String(agg.left) : '—'} sub={`${monthLabel} · sellable room-nights`} icon={<DoorOpen className="h-3.5 w-3.5" />} surface="border-l-amber-500 bg-amber-500/5" explain={{ title: `Rooms left to sell — ${monthLabel}`, body: `Remaining sellable room-nights across ${agg.days} dates, using verified property inventory and confirmed reservations.` }} />
      <Tile loading={!localReady(month)} label="Net pickup" value={`${agg.pickup > 0 ? '+' : ''}${agg.pickup}`} sub={`${agg.gained} in · ${agg.lost} out · ${windowLabel(pickupWindowDays).toLowerCase()}`} icon={agg.pickup >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />} surface={agg.pickup < 0 ? 'border-l-destructive bg-destructive/5' : 'border-l-emerald-500 bg-emerald-500/5'} tone={agg.pickup < 0 ? 'text-destructive' : agg.pickup > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''} explain={{ title: 'Pickup in window', body: `For stay dates in ${monthLabel}, during ${windowLabel(pickupWindowDays)}:\n• ${agg.gained} gained\n• ${agg.lost} lost\n• Net ${agg.pickup > 0 ? '+' : ''}${agg.pickup}\n• ${agg.datesUp} dates up · ${agg.datesDown} down.` }} />
    </div>
    <div className="flex justify-center gap-1.5 sm:hidden">{Array.from({ length: 7 }, (_, index) => <button key={index} type="button" aria-label={`Show card ${index + 1}`} onClick={() => scrollToTile(index)} className={`h-1.5 rounded-full transition-all ${index === activeTile ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`} />)}</div>
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5"><span className="text-[11px] font-medium">Pickup window</span>
      <Select value={String(pickupWindowDays)} onValueChange={(value) => onPickupWindowChange(Number(value))}><SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger><SelectContent>{PICKUP_WINDOWS.map((item) => <SelectItem key={item.value} value={String(item.value)}>{item.label}</SelectItem>)}</SelectContent></Select>
      <span className="text-[11px] text-muted-foreground"><span className="sm:hidden">Pickup & demand</span><span className="hidden sm:inline">Controls pickup, calendar PU and demand. “Bookings created today” always stays on today.</span></span>
    </div>
    <div className="-mx-1 overflow-x-auto"><div className="flex gap-2 px-1 min-w-0">{outlook.map((item, index) => <button key={item.key} type="button" onClick={() => setMonth(item.key)} className={`shrink-0 w-[118px] rounded-lg border p-2 text-left transition-colors ${item.key === month ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{formatMonth(`${item.key}-01`)}{index === 0 ? ' · now' : ''}</div>
      {isMonthPending(item.key) ? <div className="animate-pulse space-y-1.5 mt-1" aria-label={`${item.key} loading`}><div className="h-4 w-12 rounded bg-muted-foreground/20" /><div className="h-2 w-16 rounded bg-muted-foreground/10" /><div className="h-2 w-14 rounded bg-muted-foreground/10" /><div className="text-[9px] text-muted-foreground">loading…</div></div>
      : <><div className="text-base font-semibold tabular-nums">{item.capacity ? `${Math.round(item.occupancyPct)}%` : '—'}</div><div className="text-[10px] text-muted-foreground tabular-nums truncate">ADR {money(item.adr)}</div><div className="text-[10px] text-muted-foreground tabular-nums truncate">RevPAR {money(item.revpar)}</div></>}
    </button>)}</div></div>
    {monthlyError && pendingMonths > 0 ? <div role="alert" className="flex items-center justify-between gap-2 px-1 text-[11px] text-destructive"><span>Monthly figures unavailable: {monthlyError}</span><Button size="sm" variant="outline" className="h-7 shrink-0" onClick={retryMonthly}><RefreshCw className="mr-1 h-3 w-3" />Retry</Button></div>
      : pendingMonths > 0 ? <p className="px-1 text-[11px] text-muted-foreground">Loading later months…</p> : null}
  </CardContent></Card>;
}
