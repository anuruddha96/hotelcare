import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, BarChart3, ChevronDown, ChevronUp, Info, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

import {
  bookingChangePct, fmtPct, observedCohortIncidence, scheduledLosCoverage, validNumber, formatBookingMoney as formatMoney,
  type BookingInsights, type BookingInsightSummary, type InsightChannel,
} from "@/lib/bookingInsights";

type SectionKey = "overview" | "cancellations" | "stays" | "channels";
const sections: { key: SectionKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "cancellations", label: "Cancellations" },
  { key: "stays", label: "LOS & lead time" },
  { key: "channels", label: "Channels & rooms" },
];
const n = validNumber;
const dayLabel = (iso: string) => iso ? iso.slice(5) : "";
const emptySummary: BookingInsightSummary = {
  bookings: 0, cancellations: 0, booked_room_items: 0, known_los_items: 0,
  booked_nights: 0, cancelled_nights: 0, booked_value: 0, cancelled_value: 0,
  avg_los: null, avg_booking_lead: null, avg_cancel_lead: null,
  cancellations_after_arrival: 0, bookings_after_arrival: 0, unknown_channels: 0,
};


function Stat({ label, value, detail, change, explanation, accent = "" }: {
  label: string; value: string; detail?: string; change?: number | null;
  explanation?: string; accent?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 sm:p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium leading-4 text-muted-foreground">{label}</p>
        {explanation && <span title={explanation} aria-label={explanation}><Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></span>}
      </div>
      <div className={"mt-1 text-xl font-bold tracking-tight tabular-nums sm:text-2xl " + accent}>{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {typeof change === "number" && Number.isFinite(change) && (
          <span className={(label === "Cancellation events" ? change <= 0 : change >= 0) ? "font-medium text-emerald-700 dark:text-emerald-400" : "font-medium text-orange-700 dark:text-orange-300"}>
            {(change > 0 ? "+" : "") + change + "%"}
          </span>
        )}
        <span>{detail}</span>
      </div>
    </div>
  );
}
function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
    <h4 className="text-sm font-semibold">{title}</h4>
    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
    <div className="mt-3">{children}</div>
  </section>;
}
const xyStyle = { fontSize: 10 };
function CategoricalChart({ rows, valueKey, labelKey = "bucket", format = "integer", color = "#438dc9", currencyCode }: {
  rows: object[]; valueKey: string; labelKey?: string; format?: "integer" | "money"; color?: string; currencyCode?: string | null;
}) {
  return rows.length ? <div className="h-[218px] w-full min-w-0" role="img" aria-label="Distribution chart">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 6, bottom: 7, left: -13 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey={labelKey} tick={xyStyle} interval={rows.length > 14 ? "preserveStartEnd" : 0}
          minTickGap={10} angle={rows.length > 5 && rows.length <= 14 ? -23 : 0}
          textAnchor={rows.length > 5 && rows.length <= 14 ? "end" : "middle"}
          height={rows.length > 5 && rows.length <= 14 ? 46 : 30} />
        <YAxis tick={xyStyle} width={45} tickFormatter={(value: number) => format === "money" ? String(Math.round(value / 1000)) + "k" : String(value)} allowDecimals={false} />
        <Tooltip formatter={(value: unknown) => format === "money" ? formatMoney(n(value), currencyCode) : n(value)} />
        <Bar dataKey={valueKey} fill={color} maxBarSize={36} radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  </div> : <p className="py-9 text-center text-xs text-muted-foreground">No verified records in this period.</p>;
}
function RankList({ rows, heading, subtitle, currencyCode }: { rows: InsightChannel[]; heading: string; subtitle: string; currencyCode: string | null }) {
  const max = Math.max(1, ...rows.map((r) => n(r.value_eur)));
  return <Panel title={heading} description={subtitle}>
    {rows.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No data recorded for this period.</p>
      : <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.name} className="min-w-0">
            <div className="flex items-start justify-between gap-3 text-xs">
              <span className="min-w-0 break-words font-medium">{row.name}</span>
              <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{formatMoney(row.value_eur, currencyCode)}</span>
            </div>
            <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{width: String(Math.max(0,Math.min(100,(n(row.value_eur)/max)*100))) + "%"}} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {row.bookings} bookings · {row.room_stays} room-stays · {row.room_nights} observed room-nights
              {" · "}ADR {row.adr === null ? "—" : formatMoney(row.adr, currencyCode)}
            </p>
          </div>
        ))}
      </div>}
  </Panel>;
}

/**
 * All hotels, including SLNT, use the same server-verified tenant-scoped RPC.
 * This panel does not call Previo on demand and cannot change PMS reservations.
 */
export default function BookingMovementAnalytics({ hotelId, lastSyncAt }: {
  hotelId: string | null; lastSyncAt?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [section, setSection] = useState<SectionKey>("overview");
  const [data, setData] = useState<BookingInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseCurrency, setBaseCurrency] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let current = true;
    setBaseCurrency(null);
    if (hotelId) void (async () => {
      const { data: setting, error: settingError } = await supabase
        .from("hotel_revenue_settings").select("base_currency").eq("hotel_id",hotelId).maybeSingle();
      if (current) setBaseCurrency(!settingError && setting?.base_currency ? String(setting.base_currency).toUpperCase() : null);
    })();
    return () => { current = false; };
  }, [hotelId]);
  useEffect(() => {
    setData(null);
    setError(null);
  }, [hotelId]);
  useEffect(() => {
    if (!hotelId || !expanded) return;
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const result = await (supabase.rpc as any)("revenue_booking_insights_v2", {
        p_hotel_id: hotelId, p_days: days,
      });
      if (!active) return;
      if (result.error || !result.data || !Array.isArray(result.data.daily)) {
        setError("Could not load the Previo analytics. Your bookings and pricing were not changed.");
        setData(null);
      } else setData(result.data as BookingInsights);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [hotelId, days, expanded, lastSyncAt, refresh]);

  const moneyCode = baseCurrency ?? data?.currency_code ?? null;
  const currency = (v: number | null | undefined) => formatMoney(v, moneyCode);
  const s = data?.summary ?? emptySummary;
  const prior = data?.previous;
  const booked = n(s.booked_value);
  const lost = n(s.cancelled_value);
  const net = booked - lost;
  const observedIncidence = data ? observedCohortIncidence(data.cohort) : null;
  const losCoverage = data ? scheduledLosCoverage(s) : null;
  const firstCancellation = data?.first_cancellation_recorded_at?.slice(0,10) ?? null;
  const windowStart = data?.daily[0]?.day ?? null;
  const missingCancellationHistory = Boolean(firstCancellation && windowStart && firstCancellation > windowStart);
  const daily = useMemo(() => (data?.daily ?? []).map((row) => ({
    ...row, day_label: dayLabel(row.day),
    booked_value: n(row.booked_value), cancelled_value: n(row.cancelled_value),
    bookings: n(row.bookings), cancellations: n(row.cancellations),
  })), [data]);
  const totalRoomNights = n(s.booked_nights);

  return (
    <section className="overflow-hidden rounded-xl border bg-background">
      <Button type="button" variant="ghost" className="h-auto min-h-12 w-full justify-between gap-2 rounded-none px-3 py-3 text-left sm:px-4"
        onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 shrink-0 text-primary" />
          Booking intelligence <span className="hidden font-normal text-muted-foreground sm:inline">· Previo history</span>
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </Button>
      {expanded && <div className="space-y-4 border-t p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="text-[10px] font-normal">Budapest time</Badge>
            <span>Recorded booking and cancellation activity</span>
            {lastSyncAt && <span title="Most recent revenue sync">· PMS sync {new Date(lastSyncAt).toLocaleString("en-GB",{timeZone:"Europe/Budapest",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={String(days)} onValueChange={(value) => setDays(Number(value) as 7 | 30 | 90)}>
              <SelectTrigger className="h-8 w-[132px] text-xs" aria-label="Analytics range"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Refresh booking intelligence"
              onClick={() => setRefresh((v) => v + 1)}><RefreshCw className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        {loading && <p role="status" className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking recorded Previo activity…
        </p>}
        {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-xs text-destructive">{error}</p>}
        {data && !loading && !error && <>
          {lastSyncAt && Date.now() - Date.parse(lastSyncAt) > 90 * 60 * 1000 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 p-2.5 text-xs text-muted-foreground" role="status">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
              Latest published PMS revenue sync is more than 90 minutes old. Recent bookings or cancellations may not yet be included.
            </div>
          )}
          {missingCancellationHistory && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-muted-foreground" role="status">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              Cancellation events are only available from {firstCancellation}. Earlier days in this range are incomplete;
              avoid using them to evaluate cancellation trends.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Reservations booked" value={String(s.bookings)}
              detail="Created in selected period"
              change={prior ? bookingChangePct(n(s.bookings),n(prior.bookings)) : null}
              explanation="Distinct Previo reservation IDs and booking timestamps. Multi-room bookings count once." />
            <Stat label="Cancellation events" value={String(s.cancellations)}
              detail="Recorded in selected period"
              change={prior ? bookingChangePct(n(s.cancellations),n(prior.cancellations)) : null}
              explanation="Distinct reservation/timestamp cancellation events, including partial room-night cancellations. Not the reservation cancellation rate."
              accent="text-orange-700 dark:text-orange-300" />
            <Stat label={"Gross bookings (" + (moneyCode ?? "currency pending") + ")"} value={currency(booked)}
              detail="Value booked during period"
              change={prior ? bookingChangePct(booked,n(prior.booked_value)) : null} />
            <Stat label="Cancelled room value" value={currency(lost)}
              detail="Value of nights removed" accent="text-orange-700 dark:text-orange-300"
              explanation="Value removed from the room-night ledger by cancellation events; not necessarily refunded or collected revenue." />
            <Stat label="Net booking movement" value={currency(net)}
              detail="Gross booked minus cancelled" accent={net < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}
              explanation="Booking-value movements by event date; not realized revenue, RevPAR, or recognized sales." />
            <Stat label="Booked ADR" value={totalRoomNights > 0 ? currency(booked/totalRoomNights) : "—"}
              detail={String(totalRoomNights) + " booked room-nights"}
              explanation="Gross recorded accommodation value divided by archived booked room-nights. Only recorded nights count." />
            <Stat label="Observed cancellation incidence" value={fmtPct(observedIncidence,1)}
              detail="Of bookings made in selected period"
              explanation="Share of reservations created in the period with any later cancellation event already observed. This is NOT the eventual cancellation rate: recent reservations are not yet mature, and partial cancellations count." />
            <Stat label="Average scheduled LOS" value={s.avg_los === null ? "—" : Number(s.avg_los).toFixed(1) + " nights"}
              detail={fmtPct(losCoverage) + " with verified stay dates"}
              explanation="Room-stay weighted scheduled checkout minus arrival, from Previo's original stay-date fields where available. Incomplete records are excluded." />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>{s.booked_nights} booked room-nights</span>
            <span>{s.cancelled_nights} cancelled room-nights</span>
            <span>{data.cohort.ever_had_cancelled_nights} of {data.cohort.booked_reservations} booking-cohort reservations have a recorded cancellation so far</span>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-b pb-2" aria-label="Booking intelligence views">
            {sections.map((item) => (
              <Button key={item.key} variant={section === item.key ? "secondary" : "ghost"} size="sm"
                className="h-8 shrink-0 px-2.5 text-xs" onClick={() => setSection(item.key)}
                aria-current={section === item.key ? "page" : undefined}>{item.label}</Button>
            ))}
          </nav>
          {section === "overview" && <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="Booking value movement" description="Each day shows newly booked and cancelled room value in the property base currency. These are events, not stay-date revenue.">
              {daily.length ? <div className="h-[248px] min-w-0" role="img" aria-label="Daily booking value and cancelled room value">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily} margin={{top:8,right:4,left:-11,bottom:4}}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="day_label" tick={xyStyle} minTickGap={15} />
                    <YAxis tick={xyStyle} tickFormatter={(value:number) => String(Math.round(value/1000)) + "k"} width={47} />
                    <Tooltip formatter={(v: unknown, key: unknown) => [currency(n(v)), key === "booked_value" ? "Newly booked" : "Cancelled value"]} />
                    <Bar dataKey="booked_value" name="booked_value" fill="#10b981" radius={[2,2,0,0]} maxBarSize={18} />
                    <Bar dataKey="cancelled_value" name="cancelled_value" fill="#ef9a35" radius={[2,2,0,0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div> : <p className="py-12 text-xs text-muted-foreground">No events recorded in the selected window.</p>}
              <p className="mt-1 text-[11px] text-muted-foreground"><span className="font-semibold text-emerald-600">■</span> Booked{"  "}
                <span className="font-semibold text-orange-500">■</span> Cancelled</p>
            </Panel>
            <Panel title="Average bookings by weekday" description="Average reservation events per occurrence of each weekday within the selected period (Budapest time).">
              <CategoricalChart labelKey="label" valueKey="bookings" rows={["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((label,i) => ({
                label,bookings: (() => {
                  const dates = daily.filter((r) => ((new Date(r.day + "T00:00:00Z").getUTCDay()+6)%7) === i).length;
                  const booked = n(data.weekdays.find((row) => n(row.weekday)===i+1)?.bookings);
                  return dates ? Math.round((booked / dates) * 10) / 10 : 0;
                })(),
              }))} />
            </Panel>
            <Panel title="Period comparison" description="Previous equal-length period immediately before the selected one; booking creation and cancellation activity are counted separately.">
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ["New bookings",s.bookings,prior?.bookings],
                  ["Cancellation events",s.cancellations,prior?.cancellations],
                  ["Gross booked value",currency(booked),currency(prior?.booked_value)],
                  ["Cancelled room value",currency(lost),currency(prior?.cancelled_value)],
                ].map(([title,current,previous]) => (
                  <div className="rounded-lg bg-muted/40 p-3" key={String(title)}>
                    <p className="text-[11px] text-muted-foreground">{title}</p>
                    <p className="mt-1 font-semibold tabular-nums">{current}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Previous: {previous ?? "—"}</p>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="What these numbers mean" description="A short reading guide for hotel managers.">
              <p className="text-xs leading-5 text-muted-foreground">Gross booked value measures demand generated. Cancelled value measures the affected room-night value. Their difference is booking movement, not actual income.
                To assess realized hotel performance, compare these trends with occupancy, stay-date ADR, and RevPAR elsewhere in Revenue Management.</p>
            </Panel>
          </div>}
          {section === "cancellations" && <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="Cancellation volume" description="Daily cancellation events. A multi-room reservation can create one cancellation event; partial cancellations are included.">
              {daily.length ? <div className="h-[235px] min-w-0" role="img" aria-label="Cancellation events by day">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={daily} margin={{top:8,right:8,left:-22,bottom:3}}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="day_label" tick={xyStyle} minTickGap={18}/>
                    <YAxis allowDecimals={false} tick={xyStyle}/>
                    <Tooltip formatter={(value:unknown) => n(value)} />
                    <Line type="monotone" dataKey="cancellations" name="Cancellation events" stroke="#e6922e" strokeWidth={2.5} dot={false}/>
                  </LineChart>
                </ResponsiveContainer>
              </div> : <p className="py-8 text-xs text-muted-foreground">No cancellation records in this range.</p>}
            </Panel>
            <Panel title="When were stays cancelled?" description="Days between the cancellation event and original scheduled check-in. After arrival is shown separately.">
              <CategoricalChart rows={data.cancellation_lead} valueKey="count" color="#e6922e"/>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Average before-arrival notice: {s.avg_cancel_lead === null ? "—" : Number(s.avg_cancel_lead).toFixed(1) + " days"}
                {" · "}{s.cancellations_after_arrival} cancelled room items after arrival.
              </p>
            </Panel>
            <Panel title="Cancelled room-nights" description="Number of charged nights lost per cancellation event date (not a cancellation rate).">
              <CategoricalChart rows={daily.map((row) => ({bucket:dayLabel(row.day),count:n(row.cancelled_nights)}))}
                valueKey="count" color="#e6922e" />
            </Panel>
            <Panel title="Understanding cancellation rates" description="Avoid dividing this month's cancellations by this month's new bookings. They are different cohorts.">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-semibold">Observed booking-cohort cancellation incidence to date: {fmtPct(observedIncidence,1)}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Of {data.cohort.booked_reservations} distinct reservations originally created in this period,
                  { " "}{data.cohort.ever_had_cancelled_nights} subsequently have at least one recorded cancelled night.
                  This includes partial cancellations and excludes future cancellations that have not happened yet.
                  It is not the ultimate cancellation rate of a fully matured booking cohort.
                </p>
                {firstCancellation && <p className="mt-2 text-[11px] text-muted-foreground">Earliest retained cancellation event: {firstCancellation}.</p>}
              </div>
            </Panel>
          </div>}
          {section === "stays" && <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="Length of stay (LOS)" description="Verified scheduled nights per room-stay, from Previo check-in and exclusive checkout dates.">
              <CategoricalChart rows={data.los} valueKey="count"/>
              <p className="mt-1 text-[11px] text-muted-foreground">Average: {s.avg_los === null ? "—" : Number(s.avg_los).toFixed(1) + " nights"}
                {" · "}Verified scheduled dates for {s.known_los_items} of {s.booked_room_items} booked room-stays ({fmtPct(losCoverage)}).
              </p>
            </Panel>
            <Panel title="Booking lead time" description="Days between booking creation and scheduled check-in. Includes a distinct after-arrival category.">
              <CategoricalChart rows={data.booking_lead} valueKey="count" color="#17a7a3"/>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Average advance booking: {s.avg_booking_lead === null ? "—" : Number(s.avg_booking_lead).toFixed(1) + " days"}
                {" · "}{s.bookings_after_arrival} room items created after arrival.
              </p>
            </Panel>
            <Panel title="Arrival months of bookings made" description="When the guests who booked in this selected period are scheduled to arrive. This is not the full occupancy forecast.">
              <CategoricalChart rows={data.arrival_months.map((r) => ({label:r.month,amount:n(r.booked_value)}))}
                labelKey="label" valueKey="amount" format="money" currencyCode={moneyCode} />
            </Panel>
            <Panel title="Booking window vs. pricing" description="Useful when deciding whether to protect rates or offer last-minute discounts.">
              <p className="text-xs leading-5 text-muted-foreground">
                Compare lead-time distribution with scheduled LOS and the hotel's existing occupancy forecasts.
                A long booking window can support stronger early rates; a concentration of 0–3 day bookings shows last-minute demand.
                These charts describe observed demand and do not automatically change prices.
              </p>
            </Panel>
          </div>}
          {section === "channels" && <div className="grid gap-3 xl:grid-cols-2">
            <RankList rows={data.channels} currencyCode={moneyCode} heading="Top booking sources"
              subtitle="Previo's original source names; sorted by recorded booked value. Group reservations may contain multiple room-stays." />
            <RankList rows={data.room_types} currencyCode={moneyCode} heading="Room-type demand and ADR"
              subtitle="Booked accommodation value, distinct booking events, room-stays and observed room-nights by mapped room type." />
          </div>}
          <div className="flex items-start gap-2 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              Historical events are saved from Previo; stay dates for LOS and lead time are preserved separately.
              Earlier deleted PMS records cannot be recovered and full scheduled terms may be unavailable for some historical events.
              Guest identities are not included. Financial amounts use the property base currency ({moneyCode ?? "pending"}); for SLNT, figures cover the SLNT Group dataset.
              {data.first_archive_capture_at && <span> Archive capture started {data.first_archive_capture_at.slice(0,10)}.</span>}
            </div>
          </div>
        </>}
      </div>}
    </section>
  );
}
