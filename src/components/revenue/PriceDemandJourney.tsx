import { useEffect, useMemo, useState } from "react";
import {
  Activity, CalendarDays, CalendarX, CheckCircle2, Clock3,
  ExternalLink, History, Hotel, Info, Loader2, RefreshCw, TicketCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { moneyBase } from "@/lib/revenueCurrency";
import type { RateAuditRow } from "@/lib/rateAudit";
import { groupCellChanges } from "@/lib/rateChangeGroups";
import type { AutomationAction } from "@/hooks/usePickupAutomationActions";
import type { BookingNight, CancelledNight, DayMetrics } from "@/lib/revenueAnalytics";
import {
  isFreshIndicativeQuote, movementInWindow, reservationJourneyEvents,
  safeEvidenceUrl, selectRoomStayMovements, sortedJourneyEvents,
  type JourneyEvent, type MarketObservation,
} from "@/lib/revenue/priceDemandJourney";
import RateCellHistory from "@/components/revenue/RateCellHistory";

type DemandEvidence = { score: number; band: string; drivers: string[] };
type EventEvidence = {
  title: string; impact: string; venue?: string | null; category?: string | null;
  url?: string | null; notes?: string | null; start?: string; end?: string;
};
type Competitor = {
  id: string; name: string; active: boolean;
  last_scan_at: string | null; last_scan_status: string | null;
};
type Quote = MarketObservation & {
  stay_date: string; room_type: string | null; board: string | null;
  refundable: boolean | null; source_page_url: string | null;
};

interface Props {
  hotelId: string | null;
  date: string;
  roomTypeName: string;
  obkId?: string | null;
  occupancy: number;
  ratePlanId?: string | null;
  roomsLeft?: number | null;
  roomCapacity?: number | null;
  nights: BookingNight[];
  cancellations: CancelledNight[];
  metric?: DayMetrics | null;
  demand?: DemandEvidence | null;
  events?: EventEvidence[];
  history: RateAuditRow[];
  automation: AutomationAction[];
  hold?: AutomationAction | null;
  names: Map<string, string>;
  draftPrice?: number | null;
  sendingPrice?: number | null;
  lastSyncAt?: string | null;
  revenueLoading?: boolean;
}

const formatMoment = (value: string | null | undefined) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "Europe/Budapest",
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
};

const countText = (n: number, singular: string, plural: string) =>
  String(n) + " " + (n === 1 ? singular : plural);

function SignalCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5">
      <p className="text-[11px] leading-tight text-muted-foreground">{title}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}

export default function PriceDemandJourney({
  hotelId, date, roomTypeName, obkId, occupancy, ratePlanId,
  roomsLeft, roomCapacity, nights, cancellations, metric, demand, events = [],
  history, automation, hold, names, draftPrice, sendingPrice,
  lastSyncAt, revenueLoading = false,
}: Props) {
  const [market, setMarket] = useState<{
    loading: boolean; error: string | null; competitors: Competitor[]; quotes: Quote[];
  }>({ loading: true, error: null, competitors: [], quotes: [] });
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [showFullRateLog, setShowFullRateLog] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);

  // A read-only, exact-night query. No paid scans, AI calls, pricing writes,
  // guest-profile reads or PMS refreshes are triggered by opening the sheet.
  useEffect(() => {
    if (!hotelId) {
      setMarket({ loading: false, error: "Hotel unavailable", competitors: [], quotes: [] });
      return;
    }
    let cancelled = false;
    setMarket({ loading: true, error: null, competitors: [], quotes: [] });
    void (async () => {
      const [propertiesResult, quotesResult] = await Promise.all([
        supabase.from("competitor_properties")
          .select("id,name,active,last_scan_at,last_scan_status")
          .eq("hotel_id", hotelId),
        supabase.from("competitor_rates")
          .select("competitor_id,stay_date,rate,currency,room_type,board,refundable,source_page_url,confidence,captured_at")
          .eq("hotel_id", hotelId).eq("stay_date", date).order("captured_at", { ascending: false }).limit(150),
      ]);
      if (cancelled) return;
      if (propertiesResult.error || quotesResult.error) {
        setMarket({
          loading: false, error: "Competitor records could not be loaded",
          competitors: [], quotes: [],
        });
        return;
      }
      setMarket({
        loading: false, error: null,
        competitors: (propertiesResult.data ?? []) as Competitor[],
        quotes: (quotesResult.data ?? []) as Quote[],
      });
    })();
    return () => { cancelled = true; };
  }, [hotelId, date]);

  const room = useMemo(
    () => selectRoomStayMovements(nights, cancellations, date, roomTypeName, obkId),
    [nights, cancellations, date, roomTypeName, obkId],
  );
  const last24h = movementInWindow(room, 1, Date.now());
  const last7d = movementInWindow(room, 7, Date.now());

  const changes = useMemo(
    () => groupCellChanges(
      history.filter((row) => row.source !== "automation_min_stay" && row.payload?.change_type !== "minimum_stay"),
      automation, names,
    ),
    [history, automation, names],
  );

  const timeline = useMemo(() => {
    const reservationEvents = reservationJourneyEvents(room);
    const priceEvents: JourneyEvent[] = changes.map((entry) => ({
      id: "price-" + entry.id,
      kind: "price",
      at: entry.at,
      title: "Price " + (entry.phase === "confirmed" ? "changed" : entry.phase === "failed" ? "not applied" : "proposed"),
      detail: [entry.who, entry.statusLabel, entry.detail].filter(Boolean).join(" · "),
      price: entry.next,
      source: entry.old == null ? "Previous rate unknown" : "From " + moneyBase(entry.old),
    }));
    return sortedJourneyEvents([...reservationEvents, ...priceEvents]);
  }, [room, changes]);

  const currentQuotes = useMemo(() => {
    const active = new Set(market.competitors.filter((c) => c.active).map((c) => c.id));
    const latest = new Map<string, Quote>();
    for (const quote of market.quotes) {
      if (!active.has(quote.competitor_id) || latest.has(quote.competitor_id)) continue;
      latest.set(quote.competitor_id, quote);
    }
    return [...latest.values()].sort((a, b) => Number(a.rate ?? Infinity) - Number(b.rate ?? Infinity));
  }, [market]);

  const activeNames = useMemo(
    () => new Map(market.competitors.map((c) => [c.id, c.name])),
    [market.competitors],
  );
  const fresh = currentQuotes.filter((q) => isFreshIndicativeQuote(q, Date.now()));
  const lastMarketAt = market.quotes
    .map((r) => r.captured_at).filter((r): r is string => !!r)
    .sort().reverse()[0] ?? null;
  const safeEvents = events.filter((event) => safeEvidenceUrl(event.url));
  const uniqueEvents = safeEvents.filter((event, index) =>
    safeEvents.findIndex((other) =>
      other.title.trim().toLowerCase() === event.title.trim().toLowerCase()
      && other.venue === event.venue
    ) === index
  );

  const displayRows = showAllTimeline ? timeline : timeline.slice(0, 10);
  const snapshotReady = !revenueLoading && !!lastSyncAt;
  const available = !snapshotReady || roomsLeft == null ? "—" : String(roomsLeft);
  const formattedSync = lastSyncAt ? formatMoment(lastSyncAt) : "Last completed sync not available";

  return (
    <div className="space-y-5 pb-3" data-testid="price-demand-journey">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Hotel className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">Selected price cell</h3>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3 text-xs">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div><p className="text-muted-foreground">Stay date</p><strong>{date}</strong></div>
            <div><p className="text-muted-foreground">Price for</p><strong>{occupancy} guests</strong></div>
            <div><p className="text-muted-foreground">PMS room type</p><strong className="break-words">{roomTypeName}</strong></div>
            <div><p className="text-muted-foreground">Rate plan ID</p><strong className="break-all">{ratePlanId || "Not identified"}</strong></div>
          </div>
          <p className="mt-2 flex items-start gap-1 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Bookings and cancellations include all rate plans for this room type and stay night.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Reservations & availability</h3>
          <span className="text-[10px] text-muted-foreground">PMS snapshot · {formattedSync}</span>
        </div>
        {revenueLoading && <p className="text-[11px] text-amber-700">Revenue data is still loading; counts may be incomplete.</p>}
        <div className="grid grid-cols-2 gap-2">
          <SignalCard title="Active reservations" value={snapshotReady ? String(room.active.length) : "—"}
            note="Booking references covering this night" />
          <SignalCard title="Recorded cancellations" value={snapshotReady ? String(room.cancelled.length) : "—"}
            note="Cancelled bookings that covered this night" />
          <SignalCard title="Rooms available" value={available}
            note={roomCapacity == null ? "This room type · Previo inventory" : "Of " + roomCapacity + " configured rooms"} />
          <SignalCard title="7-day net bookings" value={snapshotReady ? (last7d.net > 0 ? "+" : "") + last7d.net : "—"}
            note={snapshotReady ? String(last7d.bookings) + " booked · " + String(last7d.cancellations) + " cancelled" : "PMS snapshot not confirmed"} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {snapshotReady ? (
            <>Last 24h for this room type: {countText(last24h.bookings, "new booking", "new bookings")}
            {" · "}{countText(last24h.cancellations, "cancellation", "cancellations")}.</>
          ) : "Reservation totals will appear after the published PMS snapshot has completed."}
          Counts use recorded PMS timestamps, not inferred reservations.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-primary" />Demand signals</h3>
        <div className="rounded-xl border p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Hotel occupancy</span>
            <span className="font-semibold tabular-nums">{metric ? metric.occupancyPct.toFixed(1) + "%" : "Unavailable"}</span>
            {demand && <span className="rounded-full border px-2 py-0.5 text-[10px] capitalize">{demand.band} demand grade</span>}
          </div>
          <p className="mt-1 text-muted-foreground">
            Hotel-wide {metric?.netPickup == null ? "net pickup not available" :
              "net pickup " + (metric.netPickup > 0 ? "+" : "") + metric.netPickup}
            {metric ? " · " + String(metric.roomsLeft) + " hotel rooms left" : ""}.
          </p>
          {!!demand?.drivers.length && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
              {demand.drivers.slice(0, 4).map((driver, i) => <li key={i}>{driver}</li>)}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Demand grade and hotel occupancy cover the property; reservation counters above cover this exact room type.
            A signal is not a verified reason to change the rate.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" />Events affecting {date}</h3>
        {uniqueEvents.length ? (
          <div className="space-y-2">
            {(showAllEvents ? uniqueEvents : uniqueEvents.slice(0, 4)).map((event, index) => (
              <div key={event.title + "-" + index} className="rounded-lg border px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <strong className="leading-snug">{event.title}</strong>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize">{event.impact} potential impact</span>
                </div>
                {event.venue && <p className="mt-1 text-muted-foreground">{event.venue}</p>}
                <a href={safeEvidenceUrl(event.url) || undefined} target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-primary underline underline-offset-2">
                  Event source <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
            {!showAllEvents && uniqueEvents.length > 4 && (
              <button type="button" className="text-xs text-primary underline" onClick={() => setShowAllEvents(true)}>
                Show {uniqueEvents.length - 4} more events
              </button>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
            No approved, source-linked event is recorded for this date. This does not prove that no event exists.
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">Event listings are indicators, not proof of hotel demand or event-related price compression.</p>
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><RefreshCw className="h-4 w-4 text-primary" />Competitor pricing</h3>
        {market.loading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading observed rates…</p>
          : market.error ? <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{market.error}. No market conclusion can be drawn.</p>
          : (
            <div className="space-y-2">
              <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                <strong>{fresh.length} recent EUR {fresh.length === 1 ? "quote" : "quotes"}</strong>
                <p className="mt-1 text-muted-foreground">
                  {fresh.length < 3
                    ? "Insufficient fresh competitor coverage for a reliable market benchmark."
                    : "Indicative observed public offers; conditions and room types may differ."}
                  {lastMarketAt ? " Last recorded: " + formatMoment(lastMarketAt) + "." : ""}
                </p>
              </div>
              {currentQuotes.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
                  No competitor prices recorded for this stay date. No scan was started.
                </p>
              ) : currentQuotes.map((quote) => {
                const usable = isFreshIndicativeQuote(quote, Date.now());
                const url = safeEvidenceUrl(quote.source_page_url);
                return (
                  <div key={quote.competitor_id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold">{activeNames.get(quote.competitor_id) || "Competitor"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {[quote.room_type, quote.board, quote.refundable == null ? null :
                          quote.refundable ? "Refundable" : "Non-refundable"].filter(Boolean).join(" · ") || "Room terms unknown"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {usable ? "Recent observation" : "Stale, incompatible or low-confidence"}
                        {" · "}{formatMoment(quote.captured_at)}
                        {quote.confidence != null ? " · Confidence " + Math.round(Number(quote.confidence) * 100) + "%" : ""}
                      </p>
                      {url && <a href={url} target="_blank" rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-primary underline underline-offset-2">
                        Source <ExternalLink className="h-3 w-3" />
                      </a>}
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {quote.rate == null ? "—" : String(quote.currency || "") + " " + Number(quote.rate).toFixed(0)}
                    </span>
                  </div>
                );
              })}
              <p className="text-[10px] text-muted-foreground">
                Quotes are not directly comparable without matching occupancy, board, cancellation terms,
                taxes and distribution channel. No competitor data was fabricated or refreshed at a paid provider.
              </p>
            </div>
          )}
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-primary" />Reservation & price journey</h3>
        <p className="text-[11px] text-muted-foreground">
          Newest first · reservations created or cancelled at these moments for the selected stay night;
          price changes are for this exact {occupancy}-guest rate cell.
        </p>
        {timeline.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            No timestamped reservation or price events found in the published data for this cell.
          </p>
        ) : (
          <div className="space-y-0">
            {displayRows.map((entry) => {
              const Icon = entry.kind === "booking" ? TicketCheck :
                entry.kind === "cancellation" ? CalendarX :
                  entry.title === "Price changed" ? CheckCircle2 : Clock3;
              const color = entry.kind === "booking" ? "text-emerald-600" :
                entry.kind === "cancellation" ? "text-rose-600" : "text-sky-600";
              return (
                <div key={entry.id} className="relative border-l-2 border-border pb-4 pl-4 last:pb-1">
                  <Icon className={"absolute -left-[10px] top-0 h-[18px] w-[18px] rounded-full bg-background p-0.5 " + color} aria-hidden />
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold">{entry.title}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{formatMoment(entry.at)}</span>
                  </div>
                  {entry.detail && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{entry.detail}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {entry.source && <span>{entry.source}</span>}
                    {entry.price != null && <span className="font-medium text-foreground">
                      {entry.source ? " · " : ""}{entry.kind === "price" ? "New price " : "Nightly price "}{moneyBase(entry.price)}
                    </span>}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        {!showAllTimeline && timeline.length > 10 && (
          <button type="button" className="text-xs font-medium text-primary underline underline-offset-2" onClick={() => setShowAllTimeline(true)}>
            Show {timeline.length - 10} more timeline events
          </button>
        )}
        {showAllTimeline && timeline.length > 10 && (
          <button type="button" className="text-xs font-medium text-primary underline underline-offset-2" onClick={() => setShowAllTimeline(false)}>Show less</button>
        )}
      </section>

      <section className="space-y-2 border-t pt-4">
        <button type="button" className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-semibold"
          onClick={() => setShowFullRateLog((prev) => !prev)} aria-expanded={showFullRateLog}>
          Full price audit & automation notes
          <span className="text-primary">{showFullRateLog ? "Hide" : "View"}</span>
        </button>
        {showFullRateLog && (
          <RateCellHistory history={history} automation={automation} hold={hold} names={names}
            draftPrice={draftPrice} sendingPrice={sendingPrice} />
        )}
        <p className="text-[10px] text-muted-foreground">
          Read-only evidence. This panel never changes prices, refreshes Previo, runs an AI model or starts a market scan.
        </p>
      </section>
    </div>
  );
}
