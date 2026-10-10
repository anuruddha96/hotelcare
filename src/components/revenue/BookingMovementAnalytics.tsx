import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronUp, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { eur } from "@/lib/revenueAnalytics";

interface Daily {
  day: string; bookings: number; cancellations: number; gained_nights: number; lost_nights: number;
  booked_value: number; cancelled_value: number; ota_value: number;
}
interface Channel { channel: string; bookings: number; room_nights: number; value_eur: number; }
interface Result { daily: Daily[]; channels: Channel[]; archive_started_at: string | null; }
const EMPTY: Result = { daily: [], channels: [], archive_started_at: null };
const numeric = (value: unknown) => Number(value) || 0;

/** Archive-backed aggregation avoids the PostgREST 1000-row pagination cap. */
export default function BookingMovementAnalytics({ hotelId, lastSyncAt }: {
  hotelId: string | null; lastSyncAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [result, setResult] = useState<Result>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open || !hotelId) return;
    let active = true;
    setBusy(true);
    setError(null);
    void (async () => {
      const { data, error: queryError } = await (supabase.rpc as any)(
        "revenue_booking_activity_analytics", { p_hotel_id: hotelId, p_days: days },
      );
      if (!active) return;
      if (queryError) {
        setError("Booking history could not be loaded. The current movement feed is unaffected.");
      } else {
        const raw = (data ?? {}) as Partial<Result>;
        setResult({
          daily: Array.isArray(raw.daily) ? raw.daily : [],
          channels: Array.isArray(raw.channels) ? raw.channels : [],
          archive_started_at: raw.archive_started_at ?? null,
        });
      }
      setBusy(false);
    })();
    return () => { active = false; };
  }, [hotelId, open, days, revision, lastSyncAt]);
  const totals = useMemo(() => {
    const rows = result.daily;
    const sum = (key: keyof Daily) => rows.reduce((s, r) => s + numeric(r[key]), 0);
    const roomNights = sum("gained_nights");
    const bookedValue = sum("booked_value");
    return {
      bookings: sum("bookings"), cancellations: sum("cancellations"),
      roomNights, lostNights: sum("lost_nights"),
      bookedValue, lostValue: sum("cancelled_value"),
      otaValue: sum("ota_value"),
      adr: roomNights ? bookedValue / roomNights : null,
    };
  }, [result]);
  return (
    <div className="rounded-lg border">
      <Button type="button" variant="ghost" className="h-auto w-full justify-between gap-2 px-3 py-3 text-left"
        onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" /> Booking history & analytics
        </span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </Button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Booked and cancelled by event date · Budapest time</span>
            <div className="flex items-center gap-1.5">
              <Select value={String(days)} onValueChange={(d) => setDays(Number(d) as 7 | 30 | 90)}>
                <SelectTrigger aria-label="Analytics period" className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
              <Button size="icon" className="h-8 w-8" variant="outline" onClick={() => setRevision((v) => v + 1)}
                aria-label="Refresh booking analytics"><RefreshCw className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading booking history…
          </p>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {!busy && !error && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { title: "Reservations booked", value: String(totals.bookings) },
                  { title: "Cancellation events", value: String(totals.cancellations) },
                  { title: "Gross booked value", value: eur(totals.bookedValue) },
                  { title: "Cancelled value", value: eur(totals.lostValue) },
                  { title: "Net movement value", value: eur(totals.bookedValue - totals.lostValue) },
                  { title: "Booked ADR", value: totals.adr === null ? "—" : eur(totals.adr) },
                ].map((metric) => (
                  <div key={metric.title} className="min-w-0 rounded-md border bg-muted/20 p-2">
                    <div className="text-[10px] text-muted-foreground">{metric.title}</div>
                    <div className="truncate text-sm font-semibold tabular-nums">{metric.value}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                {totals.roomNights} booked room-nights · {totals.lostNights} cancelled room-nights
                {" · "}{totals.bookedValue > 0
                  ? Math.round((totals.otaValue / totals.bookedValue) * 100) + "% of booked value from OTAs"
                  : "No paid bookings yet"}
              </div>
              {totals.bookings + totals.cancellations > 0 ? (
                <div className="h-[190px] w-full" role="img" aria-label="Daily booked and cancelled room value">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={result.daily} margin={{ top: 8, right: 5, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
                      <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10 }} minTickGap={15} />
                      <YAxis tick={{ fontSize: 10 }} width={42} />
                      <Tooltip formatter={(v: number, name: string) => [eur(numeric(v)), name === "booked_value" ? "Booked" : "Cancelled"]} />
                      <Bar name="booked_value" dataKey="booked_value" fill="#10b981" maxBarSize={14} radius={[2,2,0,0]} />
                      <Bar name="cancelled_value" dataKey="cancelled_value" fill="#f59e0b" maxBarSize={14} radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-xs text-muted-foreground">No recorded booking activity for this period.</p>}
              {result.channels.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold">Top booking channels</h4>
                  {result.channels.map((ch) => (
                    <div key={ch.channel} className="flex items-center justify-between gap-2 border-b pb-1 text-xs last:border-b-0">
                      <span className="min-w-0 truncate" title={ch.channel}>{ch.channel}</span>
                      <span className="shrink-0 tabular-nums">{ch.bookings} bookings · {eur(numeric(ch.value_eur))}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Archived from Previo room-night facts by event timestamp. Bookings and cancellations are separate
                events, not a cohort cancellation rate. ADR = gross booked value ÷ booked room-nights. Values are EUR.
                Previously uncaptured past reservations may be missing; future syncs retain history even after
                stay dates leave the live revenue calendar.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
