import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Scale, SlidersHorizontal } from "lucide-react";
import { eur, addDays, budapestDayOf, budapestToday, type DayMetrics, type BookingNight, type CancelledNight, type RoomTypeRate } from "@/lib/revenueAnalytics";
import QuickRateAdjustDialog, { type QuickAdjustTarget } from "./QuickRateAdjustDialog";

type Filter = "all" | "gained" | "lost";

function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  });
}

function fmtStamp(iso: string | null) {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    timeZone: "Europe/Budapest", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

interface DetailLine {
  key: string;
  kind: "booked" | "cancelled";
  at: string | null;
  guests: number | null;
  nights: number;
  span: string;
  from: string;
  to: string;
  roomType: string | null;
  value: number;
}

/**
 * "What moved in this pickup window?" — how many room-nights each stay date
 * gained and lost, what it is worth, and the actual bookings behind it.
 * Eligible users can re-price the affected range straight from a row.
 */
export default function PickupMovementBoard({
  metrics, windowDays, nights = [], cancellations = [],
  hotelId = null, organizationSlug = null, rates = [], canEdit = false, onRatesUpdated,
}: {
  metrics: DayMetrics[];
  windowDays: number;
  nights?: BookingNight[];
  cancellations?: CancelledNight[];
  hotelId?: string | null;
  organizationSlug?: string | null;
  rates?: RoomTypeRate[];
  canEdit?: boolean;
  onRatesUpdated?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<QuickAdjustTarget | null>(null);


  const rows = useMemo(
    () => metrics.filter((m) => (m.netPickup ?? 0) !== 0 || m.roomsLost > 0 || m.newBookings > 0),
    [metrics],
  );

  const totals = useMemo(() => {
    let gainedRooms = 0, lostRooms = 0, gainedEur = 0, lostEur = 0;
    for (const m of rows) {
      gainedRooms += m.newBookings;
      lostRooms += m.roomsLost;
      gainedEur += m.newRevenueEur;
      lostEur += m.lostRevenueEur;
    }
    return {
      gainedRooms, lostRooms, gainedEur, lostEur,
      netRooms: gainedRooms - lostRooms,
      netEur: Math.round((gainedEur - lostEur) * 100) / 100,
    };
  }, [rows]);

  const visible = useMemo(() => rows
    .filter((m) => (filter === "gained" ? m.newBookings > 0 : filter === "lost" ? m.roomsLost > 0 : true))
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date)), [rows, filter]);

  // Reservation shape: how many nights each booking covers and over what span.
  const resSpan = useMemo(() => {
    const map = new Map<string, { count: number; from: string; to: string }>();
    for (const n of nights) {
      const cur = map.get(n.res_id);
      if (!cur) map.set(n.res_id, { count: 1, from: n.stay_date, to: n.stay_date });
      else {
        cur.count += 1;
        if (n.stay_date < cur.from) cur.from = n.stay_date;
        if (n.stay_date > cur.to) cur.to = n.stay_date;
      }
    }
    return map;
  }, [nights]);

  // The window is counted in Budapest calendar days, so "last 1 day" means
  // "today in Budapest", not the last 24 hours of UTC.
  const windowFirstDay = useMemo(
    () => addDays(budapestToday(), -Math.max(0, windowDays - 1)),
    [windowDays],
  );

  const inWindow = (iso: string | null) => !!iso && budapestDayOf(iso) >= windowFirstDay;

  const detailsFor = (stayDate: string): DetailLine[] => {
    const lines: DetailLine[] = [];
    for (const n of nights) {
      if (n.stay_date !== stayDate || !inWindow(n.created_at_pms)) continue;
      const span = resSpan.get(n.res_id);
      lines.push({
        key: `b-${n.res_id}-${n.stay_date}`,
        kind: "booked",
        at: n.created_at_pms,
        guests: n.guests,
        nights: span?.count ?? 1,
        span: span && span.from !== span.to ? `${fmtDay(span.from)} – ${fmtDay(span.to)}` : fmtDay(n.stay_date),
        from: span?.from ?? n.stay_date,
        to: span?.to ?? n.stay_date,
        roomType: n.room_type_name,
        value: n.nightly_price_eur ?? 0,
      });
    }
    for (const c of cancellations) {
      if (c.stay_date !== stayDate || !inWindow(c.cancelled_at)) continue;
      lines.push({
        key: `c-${c.res_id}-${c.stay_date}`,
        kind: "cancelled",
        at: c.cancelled_at,
        guests: null,
        nights: 1,
        span: fmtDay(c.stay_date),
        from: c.stay_date,
        to: c.stay_date,
        roomType: null,
        value: 0,
      });
    }
    return lines.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  };


  const noBaseline = rows.length > 0 && rows.every((m) => !m.baselineAvailable);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          What moved in the last {windowDays} day{windowDays === 1 ? "" : "s"}
          <Badge variant="outline" className="font-normal">Budapest time</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Summary
            label="Gained" rooms={totals.gainedRooms} money={totals.gainedEur}
            tone="text-emerald-600 dark:text-emerald-400"
            icon={<ArrowUpRight className="h-3.5 w-3.5" />}
            active={filter === "gained"} onClick={() => setFilter(filter === "gained" ? "all" : "gained")}
          />
          <Summary
            label="Lost" rooms={-totals.lostRooms} money={-totals.lostEur}
            tone="text-sky-600 dark:text-sky-400"
            icon={<ArrowDownRight className="h-3.5 w-3.5" />}
            active={filter === "lost"} onClick={() => setFilter(filter === "lost" ? "all" : "lost")}
          />
          <Summary
            label="Net" rooms={totals.netRooms} money={totals.netEur}
            tone={totals.netRooms < 0 ? "text-destructive" : "text-foreground"}
            icon={<Scale className="h-3.5 w-3.5" />}
            active={filter === "all"} onClick={() => setFilter("all")}
          />
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing was booked or cancelled for these stay dates in the selected window.
          </p>
        ) : (
          <div className="rounded border overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1 bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Stay date</span><span className="text-right">Gained</span>
              <span className="text-right">Lost</span><span className="text-right w-20">Net value</span>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y">
              {visible.map((m) => {
                const net = m.newBookings - m.roomsLost;
                const netEur = Math.round((m.newRevenueEur - m.lostRevenueEur) * 100) / 100;
                const isOpen = open === m.stay_date;
                const details = isOpen ? detailsFor(m.stay_date) : [];
                return (
                  <div key={m.stay_date} className="animate-fade-in">
                    <div className="flex items-center hover:bg-muted/40">
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : m.stay_date)}
                        className="grid flex-1 min-w-0 grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 text-sm items-center text-left"
                      >
                        <span className="flex min-w-0 items-center gap-1 truncate">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                          {fmtDay(m.stay_date)}
                        </span>
                        <span className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {m.newBookings ? `+${m.newBookings}` : "—"}
                        </span>
                        <span className="text-right tabular-nums text-sky-600 dark:text-sky-400">
                          {m.roomsLost ? `−${m.roomsLost}` : "—"}
                        </span>
                        <span className={`text-right tabular-nums w-20 font-medium ${net < 0 ? "text-destructive" : ""}`}>
                          {netEur === 0 ? "—" : `${netEur > 0 ? "+" : "−"}${eur(Math.abs(netEur))}`}
                        </span>
                      </button>
                      {canEdit && (
                        <Button
                          size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                          onClick={() => setAdjust({ from: m.stay_date, to: m.stay_date, label: fmtDay(m.stay_date) })}
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          Re-price
                        </Button>
                      )}
                    </div>

                    {isOpen && (
                      <div className="bg-muted/30 px-3 py-2 space-y-1 text-[11px]">
                        {details.length === 0 ? (
                          <p className="text-muted-foreground">No booking detail available for this date.</p>
                        ) : details.map((d) => (
                          <div key={d.key} className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className={d.kind === "booked"
                              ? "font-medium text-emerald-600 dark:text-emerald-400"
                              : "font-medium text-sky-600 dark:text-sky-400"}>
                              {d.kind === "booked" ? "Booked" : "Cancelled"}
                            </span>
                            <span className="tabular-nums">{fmtStamp(d.at)}</span>
                            {d.guests != null && <span className="text-muted-foreground">· {d.guests} guest{d.guests === 1 ? "" : "s"}</span>}
                            <span className="text-muted-foreground">· {d.nights} night{d.nights === 1 ? "" : "s"} ({d.span})</span>
                            {d.roomType && <span className="text-muted-foreground">· {d.roomType}</span>}
                            {d.kind === "booked" && d.value > 0 && (
                              <span className="tabular-nums font-medium">· {eur(d.value)}/night</span>
                            )}
                            {canEdit && d.kind === "booked" && (
                              <button
                                type="button"
                                className="text-primary underline underline-offset-2"
                                onClick={() => setAdjust({
                                  from: d.from, to: d.to, roomTypeName: d.roomType,
                                  label: d.span,
                                })}
                              >
                                Re-price {d.nights === 1 ? "this date" : "this range"}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );

              })}
            </div>
          </div>
        )}

        {noBaseline && (
          <p className="text-[11px] text-muted-foreground">
            Losses are counted from cancellations the PMS reported. Once a few more daily
            snapshots build up, rooms that quietly disappear will also be caught.
          </p>
        )}

        <QuickRateAdjustDialog
          target={adjust}
          hotelId={hotelId}
          organizationSlug={organizationSlug}
          rates={rates}
          onClose={() => setAdjust(null)}
          onApplied={() => onRatesUpdated?.()}
        />
      </CardContent>

    </Card>
  );
}

function Summary({
  label, rooms, money, tone, icon, active, onClick,
}: {
  label: string; rooms: number; money: number; tone: string;
  icon: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "secondary" : "outline"}
      onClick={onClick}
      className="h-auto flex-col items-start gap-0.5 p-2.5 transition-transform hover:scale-[1.02]"
    >
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">{icon}{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${tone}`}>
        {rooms > 0 ? "+" : rooms < 0 ? "−" : ""}{Math.abs(rooms)}
      </span>
      <span className="text-[11px] text-muted-foreground">{money === 0 ? "—" : eur(Math.abs(money))}</span>
    </Button>
  );
}
