import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Scale, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import {
  eur, addDays, budapestToday, pickupWindowLabel, pickupWindowStartMs,
  type DayMetrics, type BookingNight, type CancelledNight, type RoomTypeRate,
} from "@/lib/revenueAnalytics";
import { buildReservationMovementRows, sumReservationMovementRows } from "@/lib/pickupMovementAccuracy";
import QuickRateAdjustDialog, { type QuickAdjustTarget } from "./QuickRateAdjustDialog";
import { usePickupSeenSince, useIsNewSince } from "@/lib/pickupSeen";
import { supabase } from "@/integrations/supabase/client";
import BookingMovementAnalytics from "./BookingMovementAnalytics";

type StatusFilter = "all" | "booked" | "cancelled" | "below" | "above" | "direct" | "ota";
type SortKey = "created" | "arrival" | "value" | "adr_asc" | "adr_desc";

const OTA_CHANNELS = ["booking", "expedia", "agoda", "airbnb", "hotelbeds", "hrs", "trivago", "ota", "hostelworld", "despegar", "tripadvisor"];
const isDirect = (source: string) => !OTA_CHANNELS.some((token) => source.toLowerCase().includes(token));
const roomNights = (row: { rooms: { nights: number }[] }) => row.rooms.reduce((s, room) => s + room.nights, 0);
const rowAdr = (row: { rooms: { nights: number }[]; value: number }) =>
  roomNights(row) && row.value > 0 ? row.value / roomNights(row) : null;

// Stay dates are date-only values. Formatting in UTC avoids moving them one
// calendar day backwards for managers in a different device time zone.
function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  });
}

function fmtStamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    timeZone: "Europe/Budapest", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** Previo puts some group booking totals on one room and other rooms at zero. */
function Value({ amount, grouped }: { amount: number; grouped?: boolean }) {
  if (amount > 0) return <>{eur(amount)}</>;
  return (
    <span className="text-muted-foreground">
      {eur(0)}
      <span className="ml-1 text-[10px] font-normal">
        {grouped ? "· priced on the group booking" : "· no rate"}
      </span>
    </span>
  );
}

export default function PickupMovementBoard({
  metrics: _metrics, windowDays, nights = [], cancellations = [],
  hotelId = null, organizationSlug = null, rates = [], canEdit = false, onRatesUpdated, lastSyncAt,
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
  lastSyncAt?: string | null;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("created");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<QuickAdjustTarget | null>(null);
  const [targetAdr, setTargetAdr] = useState<number | null>(null);
  useEffect(() => {
    if (!hotelId) { setTargetAdr(null); return; }
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.from("hotel_revenue_settings")
        .select("target_adr").eq("hotel_id", hotelId).maybeSingle();
      if (alive) setTargetAdr(!error && Number(data?.target_adr) > 0 ? Number(data.target_adr) : null);
    })();
    return () => { alive = false; };
  }, [hotelId, lastSyncAt]);
  const seenSince = usePickupSeenSince(hotelId);
  const isNew = useIsNewSince(seenSince);
  const windowStartMs = useMemo(() => pickupWindowStartMs(windowDays), [windowDays]);

  // The published revenue feed is future-focused. Do not turn a historical
  // room-night retained in the client's cache into an apparent future loss.
  // Keep original stay_from/stay_to in the records for audit context, while the
  // displayed movement range must come from the nights that actually changed.
  const reservations = useMemo(() => {
    const today = budapestToday();
    return buildReservationMovementRows(
      nights.filter((night) => night.stay_date >= today),
      cancellations.filter((night) => night.stay_date >= today),
      windowStartMs,
    );
  }, [nights, cancellations, windowStartMs]);

  const totals = useMemo(() => sumReservationMovementRows(reservations), [reservations]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reservations
      .filter((row) => {
        if (status === "all") return true;
        if (status === "booked" || status === "cancelled") return row.kind === status;
        if (row.kind !== "booked") return false;
        if (status === "direct") return isDirect(row.channel);
        if (status === "ota") return !isDirect(row.channel);
        const adr = rowAdr(row);
        if (targetAdr === null || adr === null) return false;
        return status === "below" ? adr < targetAdr : adr >= targetAdr;
      })
      .filter((row) => !query || row.resId.toLowerCase().includes(query)
        || row.channel.toLowerCase().includes(query)
        || row.rooms.some((room) => room.roomType.toLowerCase().includes(query)))
      .sort((a, b) => sort === "arrival" ? a.from.localeCompare(b.from)
        : sort === "value" ? b.value - a.value
        : sort === "adr_asc" ? (rowAdr(a) ?? Infinity) - (rowAdr(b) ?? Infinity)
        : sort === "adr_desc" ? (rowAdr(b) ?? -Infinity) - (rowAdr(a) ?? -Infinity)
        : b.at.localeCompare(a.at));
  }, [reservations, status, search, sort, targetAdr]);

  const newCount = useMemo(() => visible.filter((row) => isNew(row.at)).length, [visible, isNew]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-primary" />
          Reservations moved in {pickupWindowLabel(windowDays).toLowerCase()}
          {newCount > 0 && (
            <Badge className="gap-1 px-1.5 py-0 text-[10px]">
              <Sparkles className="h-3 w-3" />{newCount} new since your last visit
            </Badge>
          )}
          <Badge variant="outline" className="font-normal">Budapest time</Badge>
        </CardTitle>
        <p className="text-[11px] font-normal text-muted-foreground">
          New bookings and cancellations over the selected movement window · Budapest time.
          The total is based on loaded future stay dates; checkout is not a charged night.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Summary label="Gained room-nights" rooms={totals.gained} money={totals.gainedValue} tone="text-emerald-600 dark:text-emerald-400" icon={<ArrowUpRight className="h-3.5 w-3.5" />} />
          <Summary label="Lost room-nights" rooms={-totals.lost} money={-totals.lostValue} tone="text-sky-600 dark:text-sky-400" icon={<ArrowDownRight className="h-3.5 w-3.5" />} />
          <Summary label="Net room-nights" rooms={totals.gained - totals.lost} money={totals.gainedValue - totals.lostValue} tone={totals.gained < totals.lost ? "text-destructive" : "text-foreground"} icon={<Scale className="h-3.5 w-3.5" />} />
        </div>

        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">{reservations.filter((row) => row.kind === "booked").length}</strong> booking events
          {" · "}<strong className="text-foreground">{reservations.filter((row) => row.kind === "cancelled").length}</strong> cancellation events
          {" · "}Goal ADR: <strong className="text-foreground">{targetAdr === null ? "Not set" : eur(targetAdr)}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[190px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" placeholder="Search reservation, room or channel" />
          </div>
          <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
            <SelectTrigger className="w-[145px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All movement</SelectItem>
              <SelectItem value="booked">Bookings</SelectItem>
              <SelectItem value="cancelled">Cancellations</SelectItem>
              <SelectItem value="direct">Direct bookings</SelectItem>
              <SelectItem value="ota">OTA bookings</SelectItem>
              {targetAdr !== null && <SelectItem value="below">Below ADR goal</SelectItem>}
              {targetAdr !== null && <SelectItem value="above">At / above ADR goal</SelectItem>}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
            <SelectTrigger className="w-[145px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created">Newest first</SelectItem>
              <SelectItem value="arrival">Arrival date</SelectItem>
              <SelectItem value="value">Highest value</SelectItem>
              <SelectItem value="adr_desc">Highest ADR</SelectItem>
              <SelectItem value="adr_asc">Lowest ADR</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {visible.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No matching future room-nights moved in this window.</p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <div className="hidden grid-cols-[minmax(150px,1.2fr)_minmax(180px,1.4fr)_70px_70px_90px_100px_38px] gap-2 bg-muted px-3 py-2 text-[10px] uppercase text-muted-foreground md:grid">
              <span>Movement time</span><span>Affected dates → checkout</span><span>Nights</span><span>Rooms</span><span>Guests</span><span className="text-right">Value</span><span />
            </div>
            <div className="max-h-[440px] divide-y overflow-y-auto">
              {visible.map((row) => {
                const expanded = open === row.key;
                const fresh = isNew(row.at);
                const changedOriginal = row.from !== row.originalFrom || row.checkout !== row.originalCheckout;
                return (
                  <div key={row.key} className={fresh ? "bg-primary/5" : undefined}>
                    <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2.5 md:grid-cols-[minmax(150px,1.2fr)_minmax(180px,1.4fr)_70px_70px_90px_100px_38px] md:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={row.kind === "booked" ? "default" : "secondary"} className="px-1.5 py-0 text-[10px]">
                            {row.kind === "booked" ? "Booked" : "Cancelled"}
                          </Badge>
                          {fresh && (
                            <Badge variant="outline" className="border-primary px-1.5 py-0 text-[10px] font-semibold text-primary">New</Badge>
                          )}
                          <span className="text-xs font-medium">{fmtStamp(row.at)}</span>
                        </div>
                        <p className="mt-0.5 break-words text-[10px] text-muted-foreground">#{row.resId} · {row.channel}</p>
                      </div>
                      <div className="min-w-0 text-xs md:block" title="Affected stay nights; end date is the exclusive checkout">
                        <span className="font-medium">{fmtDay(row.from)}</span>
                        <span className="text-muted-foreground"> – {fmtDay(row.checkout)}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground">checkout</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.rooms.slice(0, 2).map((room) => (
                            <Badge key={room.key} variant="secondary" className="h-auto max-w-full whitespace-normal break-words text-[10px] font-normal">
                              {room.roomType}
                            </Badge>
                          ))}
                          {row.rooms.length > 2 && <Badge variant="outline" className="text-[10px]">+{row.rooms.length - 2} rooms</Badge>}
                        </div>
                      </div>
                      <span className="hidden text-xs tabular-nums md:block">{row.nights}</span>
                      <span className="hidden text-xs tabular-nums md:block">{row.rooms.length}</span>
                      <span className="hidden text-xs tabular-nums md:block">{row.guests}</span>
                      <span className="hidden text-right text-xs font-semibold tabular-nums md:block"><Value amount={row.value} grouped={row.rooms.length > 1} /></span>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setOpen(expanded ? null : row.key)} aria-label={`${expanded ? "Hide" : "Show"} reservation details`}>
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <div className="col-span-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground md:hidden">
                        <span>{roomNights(row)} room-nights</span><span>{row.rooms.length} rooms</span><span>{row.guests} guests</span>
                        <span className="font-medium text-foreground"><Value amount={row.value} grouped={row.rooms.length > 1} /></span>
                      </div>
                      <div className="col-span-2 flex flex-wrap items-center gap-1 md:col-span-7">
                        <Badge variant="outline" className="text-[10px] font-normal">{isDirect(row.channel) ? "Direct" : "OTA"}</Badge>
                        {row.kind === "booked" && rowAdr(row) !== null && (
                          <Badge variant="secondary" className="text-[10px] font-semibold">{eur(rowAdr(row)!)} ADR</Badge>
                        )}
                        {row.kind === "booked" && targetAdr !== null && rowAdr(row) !== null && (
                          <Badge variant={rowAdr(row)! < targetAdr ? "destructive" : "secondary"} className="text-[10px] font-normal">
                            {rowAdr(row)! < targetAdr
                              ? eur(targetAdr - rowAdr(row)!) + " below goal"
                              : "At or above goal"}
                          </Badge>
                        )}
                        {row.kind === "cancelled" && <span className="text-[10px] text-muted-foreground">Value removed from the books</span>}
                      </div>
                    </div>
                    {expanded && (
                      <div className="border-t bg-muted/30 px-3 py-2">
                        {row.kind === "cancelled" && changedOriginal && (
                          <p className="mb-2 text-xs text-muted-foreground">
                            Original reservation: {fmtDay(row.originalFrom)} – {fmtDay(row.originalCheckout)} (checkout).
                            Only the affected nights above are counted as lost.
                          </p>
                        )}
                        <div className="space-y-1">
                          {row.rooms.map((room) => (
                            <div key={room.key} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span>{room.roomType} · {room.nights} night{room.nights === 1 ? "" : "s"}</span>
                              <span className="font-medium tabular-nums"><Value amount={room.value} grouped={row.rooms.length > 1 || row.value > 0} /></span>
                            </div>
                          ))}
                        </div>
                        {canEdit && row.kind === "booked" && (
                          <div className="mt-2 flex justify-end">
                            <Button size="sm" variant="outline" onClick={() => setAdjust({
                              from: row.from,
                              // Quick rate edit expects the last occupied night, not checkout.
                              to: addDays(row.checkout, -1),
                              roomTypeName: row.rooms.length === 1 ? row.rooms[0].roomType : null,
                              label: `${fmtDay(row.from)} – ${fmtDay(row.checkout)} (checkout)`,
                            })}>
                              <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />Adjust stay prices
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <BookingMovementAnalytics hotelId={hotelId} lastSyncAt={lastSyncAt} />
        <QuickRateAdjustDialog
          target={adjust}
          hotelId={hotelId}
          organizationSlug={organizationSlug}
          rates={rates}
          canPush={canEdit}
          onClose={() => setAdjust(null)}
          onApplied={() => onRatesUpdated?.()}
        />
      </CardContent>
    </Card>
  );
}

function Summary({ label, rooms, money, tone, icon }: {
  label: string; rooms: number; money: number; tone: string; icon: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-2.5">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">{icon}{label}</span>
      <span className={`block text-xl font-semibold tabular-nums ${tone}`}>
        {rooms > 0 ? "+" : rooms < 0 ? "−" : ""}{Math.abs(rooms)}
      </span>
      <span className="text-[11px] text-muted-foreground">{money === 0 ? "—" : eur(Math.abs(money))}</span>
    </div>
  );
}
