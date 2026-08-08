import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ListChecks, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { addDays, budapestDayOf, daysBetween, eur } from "@/lib/revenueAnalytics";

interface Props {
  hotelId: string | null;
  /** Budapest "today" from the revenue data hook. */
  today: string;
}

interface NightRow {
  res_id: string;
  stay_date: string;
  room_type_name: string | null;
  guests: number | null;
  nightly_price_eur: number | null;
  total_price_eur: number | null;
  stay_from: string | null;
  stay_to: string | null;
  source_name: string | null;
  created_at_pms: string | null;
  status_id?: number | null;
  cancelled_at?: string | null;
  room_key?: string | null;
}

interface Booking {
  key: string;
  res_id: string;
  created: string | null;
  from: string;
  to: string;
  nights: number;
  rooms: number;
  roomType: string;
  guests: number;
  total: number | null;
  source: string | null;
  status: "confirmed" | "option" | "cancelled" | "no_show";
}

type RangeKey = "today" | "yesterday" | "last7" | "custom";

const SORTS = [
  { value: "created", label: "Newest first" },
  { value: "arrival", label: "Arrival date" },
  { value: "price", label: "Highest value" },
  { value: "nights", label: "Longest stay" },
] as const;

const STATUS_LABEL: Record<Booking["status"], string> = {
  confirmed: "Confirmed",
  option: "Option",
  cancelled: "Cancelled",
  no_show: "No-show",
};

function statusOf(statusId: number | null | undefined, cancelled: boolean): Booking["status"] {
  if (statusId === 8) return "no_show";
  if (cancelled || statusId === 7) return "cancelled";
  if (statusId === 1) return "option";
  return "confirmed";
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    timeZone: "Europe/Budapest",
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Live feed of reservations created in a chosen period, so revenue users can
 * see how today's booking flow is shaping up (value, length of stay, pax,
 * status). Dates are bucketed in Budapest time so "today" matches Previo.
 */
export default function TodaysBookingsPanel({ hotelId, today }: Props) {
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("created");
  const [showCancelled, setShowCancelled] = useState(true);
  const [rows, setRows] = useState<NightRow[]>([]);
  const [cancelledRows, setCancelledRows] = useState<NightRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [from, to] = useMemo<[string, string]>(() => {
    switch (range) {
      case "yesterday": return [addDays(today, -1), addDays(today, -1)];
      case "last7": return [addDays(today, -6), today];
      case "custom": return [customFrom, customTo];
      default: return [today, today];
    }
  }, [range, today, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    setLoading(true);
    // Query one day either side in UTC, then narrow by Budapest calendar day —
    // a booking made at 00:20 Budapest is still the previous day in UTC.
    const wideFrom = `${addDays(from, -1)}T00:00:00Z`;
    const wideTo = `${addDays(to, 1)}T23:59:59Z`;
    const [live, cancelled] = await Promise.all([
      supabase
        .from("revenue_booking_nights")
        .select("res_id, room_key, stay_date, room_type_name, guests, nightly_price_eur, total_price_eur, stay_from, stay_to, source_name, created_at_pms, status_id")
        .eq("hotel_id", hotelId)
        .gte("created_at_pms", wideFrom)
        .lte("created_at_pms", wideTo)
        .order("created_at_pms", { ascending: false })
        .limit(2000),
      supabase
        .from("revenue_cancelled_nights")
        .select("res_id, room_key, stay_date, room_type_name, guests, nightly_price_eur, total_price_eur, stay_from, stay_to, source_name, created_at_pms, status_id, cancelled_at")
        .eq("hotel_id", hotelId)
        .gte("cancelled_at", wideFrom)
        .lte("cancelled_at", wideTo)
        .order("cancelled_at", { ascending: false })
        .limit(2000),
    ]);
    setRows((live.data ?? []) as NightRow[]);
    setCancelledRows((cancelled.data ?? []) as NightRow[]);
    setLoading(false);
  }, [hotelId, from, to]);

  useEffect(() => { void load(); }, [load]);

  /** One row per reservation-room, rebuilt from its stored room-nights. */
  const bookings = useMemo<Booking[]>(() => {
    const inWindow = (iso: string | null | undefined) => {
      if (!iso) return false;
      const d = budapestDayOf(iso);
      return d >= from && d <= to;
    };

    const build = (list: NightRow[], isCancelledFeed: boolean): Booking[] => {
      const byRes = new Map<string, NightRow[]>();
      for (const r of list) {
        const stamp = isCancelledFeed ? r.cancelled_at : r.created_at_pms;
        if (!inWindow(stamp)) continue;
        const k = `${r.res_id}|${r.room_key ?? ""}`;
        const bucket = byRes.get(k);
        if (bucket) bucket.push(r); else byRes.set(k, [r]);
      }
      const out: Booking[] = [];
      for (const [key, group] of byRes) {
        const first = group[0];
        const dates = group.map((n) => n.stay_date).sort();
        const stayFrom = first.stay_from ?? dates[0];
        const stayTo = first.stay_to ?? addDays(dates[dates.length - 1], 1);
        const nights = Math.max(1, daysBetween(stayFrom, stayTo));
        const total = first.total_price_eur !== null && first.total_price_eur !== undefined
          ? Number(first.total_price_eur)
          : group.reduce((s, n) => s + (Number(n.nightly_price_eur) || 0), 0) || null;
        out.push({
          key,
          res_id: first.res_id,
          created: first.created_at_pms ?? (isCancelledFeed ? first.cancelled_at ?? null : null),
          from: stayFrom,
          to: stayTo,
          nights,
          rooms: 1,
          roomType: first.room_type_name ?? "—",
          guests: first.guests ?? 1,
          total,
          source: first.source_name,
          status: statusOf(first.status_id, isCancelledFeed),
        });
      }
      return out;
    };

    const all = [...build(rows, false), ...(showCancelled ? build(cancelledRows, true) : [])];
    all.sort((a, b) => {
      if (sort === "arrival") return a.from.localeCompare(b.from);
      if (sort === "price") return (b.total ?? 0) - (a.total ?? 0);
      if (sort === "nights") return b.nights - a.nights;
      return (b.created ?? "").localeCompare(a.created ?? "");
    });
    return all;
  }, [rows, cancelledRows, sort, from, to, showCancelled]);

  const totals = useMemo(() => {
    const active = bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show");
    const roomNights = active.reduce((s, b) => s + b.nights, 0);
    const revenue = active.reduce((s, b) => s + (b.total ?? 0), 0);
    return {
      count: active.length,
      cancelled: bookings.length - active.length,
      roomNights,
      revenue,
      los: active.length ? roomNights / active.length : 0,
      adr: roomNights ? revenue / roomNights : 0,
    };
  }, [bookings]);




  const kpis = [
    { label: "Bookings", value: String(totals.count), hint: "Reservations (one line per room) created in this period." },
    { label: "Room-nights", value: String(totals.roomNights), hint: "Total nights those bookings added to the calendar." },
    { label: "Value", value: eur(Math.round(totals.revenue)), hint: "Total value of the new bookings." },
    { label: "Avg stay", value: `${totals.los.toFixed(1)} n`, hint: "Average length of stay of the new bookings." },
    { label: "Avg / night", value: eur(Math.round(totals.adr)), hint: "Value ÷ room-nights: the rate today's demand is paying." },
  ];

  return (
    <Card>
      <CardHeader className="pb-3 gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              Booking flow — reservations created
            </CardTitle>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground max-w-2xl">
              This is your <strong>sales pace</strong>: everything Previo recorded in the selected period
              (Budapest time), not the guests staying tonight. Watch it to see whether demand is coming in,
              at what rate and for which dates — and react with a price change before the dates get close.
              Cancellations appear on the day they were cancelled.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="last7">Last 7 days</SelectItem>
                <SelectItem value="custom">Custom range…</SelectItem>
              </SelectContent>
            </Select>
            {range === "custom" && (
              <div className="flex items-center gap-1">
                <Input type="date" value={customFrom} className="h-8 w-[140px] text-xs"
                  onChange={(e) => setCustomFrom(e.target.value)} />
                <span className="text-xs text-muted-foreground">→</span>
                <Input type="date" value={customTo} className="h-8 w-[140px] text-xs"
                  onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            )}
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant={showCancelled ? "secondary" : "outline"} className="h-8 px-2 text-xs"
              onClick={() => setShowCancelled((v) => !v)}>
              {showCancelled ? "Hide cancelled" : "Show cancelled"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => void load()} aria-label="Refresh list">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Summary of the period, read left to right: volume → value → quality */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} title={k.hint} className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className="text-base font-semibold tabular-nums leading-tight">{k.value}</p>
            </div>
          ))}
        </div>
        {totals.cancelled > 0 && (
          <Badge variant="destructive" className="w-fit font-normal">
            {totals.cancelled} cancelled / no-show in this period
          </Badge>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading bookings…
          </div>
        ) : bookings.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No reservations were created in this period. Nothing sold — worth checking your rates and availability.
          </div>
        ) : (
          <div className="divide-y">
            {bookings.map((b) => {
              const dead = b.status === "cancelled" || b.status === "no_show";
              const lead = daysBetween(today, b.from);
              const perNight = b.total !== null && b.nights ? Math.round(b.total / b.nights) : null;
              return (
                <div
                  key={`${b.key}-${b.status}`}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 sm:px-4 ${dead ? "bg-muted/30 text-muted-foreground" : "hover:bg-muted/30"}`}
                >
                  {/* Stay window — the most important thing on the line */}
                  <div className="min-w-[190px] flex-1">
                    <p className={`text-sm font-medium ${dead ? "line-through" : ""}`}>
                      {b.from} → {b.to}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {b.nights} night{b.nights === 1 ? "" : "s"} · {b.guests} pax
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {b.roomType}
                      {b.source ? ` · ${b.source}` : ""}
                      {" · booked "}{fmtTime(b.created)}
                      {lead > 0 ? ` · ${lead} days out` : lead === 0 ? " · arrives today" : ""}
                    </p>
                  </div>

                  {/* Money */}
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{eur(b.total)}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {perNight === null ? "—" : `${eur(perNight)} / night`}
                    </p>
                  </div>

                  <Badge
                    variant={dead ? "destructive" : b.status === "option" ? "outline" : "secondary"}
                    className="font-normal shrink-0"
                  >
                    {STATUS_LABEL[b.status]}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

