import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Scale, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { eur, addDays, budapestDayOf, budapestToday, type DayMetrics, type BookingNight, type CancelledNight, type RoomTypeRate } from "@/lib/revenueAnalytics";
import QuickRateAdjustDialog, { type QuickAdjustTarget } from "./QuickRateAdjustDialog";
import { usePickupSeenSince, useIsNewSince } from "@/lib/pickupSeen";

type StatusFilter = "all" | "booked" | "cancelled";
type SortKey = "created" | "arrival" | "value";

function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  });
}

function fmtStamp(iso: string | null) {
  if (!iso) return "Unknown time";
  return new Date(iso).toLocaleString(undefined, {
    timeZone: "Europe/Budapest", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

interface ReservationRoom {
  key: string;
  roomType: string;
  nights: number;
  value: number;
}

interface ReservationRow {
  key: string;
  resId: string;
  kind: "booked" | "cancelled";
  at: string | null;
  from: string;
  to: string;
  nights: number;
  rooms: ReservationRoom[];
  guests: number;
  value: number;
  channel: string;
}

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
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("created");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<QuickAdjustTarget | null>(null);

  const windowFirstDay = useMemo(
    () => addDays(budapestToday(), -Math.max(0, windowDays - 1)),
    [windowDays],
  );
  const inWindow = (iso: string | null | undefined) => !!iso && budapestDayOf(iso) >= windowFirstDay;

  const reservations = useMemo<ReservationRow[]>(() => {
    const build = (source: Array<BookingNight | CancelledNight>, kind: ReservationRow["kind"]) => {
      const byReservation = new Map<string, Array<BookingNight | CancelledNight>>();
      for (const row of source) {
        const eventAt = kind === "booked" ? row.created_at_pms : (row as CancelledNight).cancelled_at;
        if (!inWindow(eventAt)) continue;
        const bucket = byReservation.get(row.res_id);
        if (bucket) bucket.push(row); else byReservation.set(row.res_id, [row]);
      }

      return Array.from(byReservation.entries()).map(([resId, group]): ReservationRow => {
        const dates = group.map((row) => row.stay_date).sort();
        const from = group.find((row) => row.stay_from)?.stay_from ?? dates[0];
        const explicitTo = group.find((row) => row.stay_to)?.stay_to;
        const to = explicitTo ? addDays(explicitTo, -1) : dates[dates.length - 1];
        const roomBuckets = new Map<string, Array<BookingNight | CancelledNight>>();
        for (const row of group) {
          const roomKey = row.room_key ?? row.obk_id ?? row.room_type_name ?? "room";
          const bucket = roomBuckets.get(roomKey);
          if (bucket) bucket.push(row); else roomBuckets.set(roomKey, [row]);
        }
        const rooms = Array.from(roomBuckets.entries()).map(([key, roomRows]) => ({
          key,
          roomType: roomRows[0].room_type_name ?? "Room",
          nights: new Set(roomRows.map((row) => row.stay_date)).size,
          value: roomRows.reduce((sum, row) => sum + (Number(row.nightly_price_eur) || 0), 0),
        }));
        const first = group[0];
        return {
          key: `${kind}-${resId}`,
          resId,
          kind,
          at: kind === "booked" ? first.created_at_pms ?? null : (first as CancelledNight).cancelled_at,
          from,
          to,
          nights: Math.max(1, new Set(group.map((row) => row.stay_date)).size),
          rooms,
          guests: Math.max(1, ...group.map((row) => Number(row.guests) || 1)),
          value: group.reduce((sum, row) => sum + (Number(row.nightly_price_eur) || 0), 0),
          channel: first.source_name ?? "Direct / unknown",
        };
      });
    };
    return [...build(nights, "booked"), ...build(cancellations, "cancelled")];
  }, [nights, cancellations, windowFirstDay]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reservations
      .filter((row) => status === "all" || row.kind === status)
      .filter((row) => !query || row.resId.toLowerCase().includes(query)
        || row.channel.toLowerCase().includes(query)
        || row.rooms.some((room) => room.roomType.toLowerCase().includes(query)))
      .sort((a, b) => sort === "arrival"
        ? a.from.localeCompare(b.from)
        : sort === "value"
          ? b.value - a.value
          : (b.at ?? "").localeCompare(a.at ?? ""));
  }, [reservations, status, search, sort]);

  const totals = useMemo(() => {
    const moved = metrics.filter((m) => (m.netPickup ?? 0) !== 0 || m.roomsLost > 0 || m.newBookings > 0);
    const gained = moved.reduce((sum, row) => sum + row.newBookings, 0);
    const lost = moved.reduce((sum, row) => sum + row.roomsLost, 0);
    const gainedValue = moved.reduce((sum, row) => sum + row.newRevenueEur, 0);
    const lostValue = moved.reduce((sum, row) => sum + row.lostRevenueEur, 0);
    return { gained, lost, gainedValue, lostValue };
  }, [metrics]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-primary" />
          Reservations moved in the last {windowDays} day{windowDays === 1 ? "" : "s"}
          <Badge variant="outline" className="font-normal">Budapest time</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Summary label="Gained" rooms={totals.gained} money={totals.gainedValue} tone="text-emerald-600 dark:text-emerald-400" icon={<ArrowUpRight className="h-3.5 w-3.5" />} />
          <Summary label="Lost" rooms={-totals.lost} money={-totals.lostValue} tone="text-sky-600 dark:text-sky-400" icon={<ArrowDownRight className="h-3.5 w-3.5" />} />
          <Summary label="Net" rooms={totals.gained - totals.lost} money={totals.gainedValue - totals.lostValue} tone={totals.gained < totals.lost ? "text-destructive" : "text-foreground"} icon={<Scale className="h-3.5 w-3.5" />} />
        </div>

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
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
            <SelectTrigger className="w-[145px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created">Newest first</SelectItem>
              <SelectItem value="arrival">Arrival date</SelectItem>
              <SelectItem value="value">Highest value</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {visible.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No matching reservations moved in this window.</p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <div className="hidden grid-cols-[minmax(150px,1.2fr)_minmax(180px,1.4fr)_70px_70px_90px_100px_38px] gap-2 bg-muted px-3 py-2 text-[10px] uppercase text-muted-foreground md:grid">
              <span>Created</span><span>Stay</span><span>Nights</span><span>Rooms</span><span>Guests</span><span className="text-right">Value</span><span />
            </div>
            <div className="max-h-[440px] divide-y overflow-y-auto">
              {visible.map((row) => {
                const expanded = open === row.key;
                return (
                  <div key={row.key}>
                    <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2.5 md:grid-cols-[minmax(150px,1.2fr)_minmax(180px,1.4fr)_70px_70px_90px_100px_38px] md:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={row.kind === "booked" ? "default" : "secondary"} className="px-1.5 py-0 text-[10px]">
                            {row.kind === "booked" ? "Booked" : "Cancelled"}
                          </Badge>
                          <span className="truncate text-xs font-medium">{fmtStamp(row.at)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">#{row.resId} · {row.channel}</p>
                      </div>
                      <div className="min-w-0 text-xs md:block">
                        <span className="font-medium">{fmtDay(row.from)}</span>
                        <span className="text-muted-foreground"> – {fmtDay(row.to)}</span>
                      </div>
                      <span className="hidden text-xs tabular-nums md:block">{row.nights}</span>
                      <span className="hidden text-xs tabular-nums md:block">{row.rooms.length}</span>
                      <span className="hidden text-xs tabular-nums md:block">{row.guests}</span>
                      <span className="hidden text-right text-xs font-semibold tabular-nums md:block">{eur(row.value)}</span>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setOpen(expanded ? null : row.key)} aria-label={`${expanded ? "Hide" : "Show"} reservation details`}>
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <div className="col-span-2 flex gap-3 text-[11px] text-muted-foreground md:hidden">
                        <span>{row.nights} nights</span><span>{row.rooms.length} rooms</span><span>{row.guests} guests</span><span className="font-medium text-foreground">{eur(row.value)}</span>
                      </div>
                    </div>
                    {expanded && (
                      <div className="border-t bg-muted/30 px-3 py-2">
                        <div className="space-y-1">
                          {row.rooms.map((room) => (
                            <div key={room.key} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span>{room.roomType} · {room.nights} night{room.nights === 1 ? "" : "s"}</span>
                              <span className="font-medium tabular-nums">{eur(room.value)}</span>
                            </div>
                          ))}
                        </div>
                        {canEdit && row.kind === "booked" && (
                          <div className="mt-2 flex justify-end">
                            <Button size="sm" variant="outline" onClick={() => setAdjust({
                              from: row.from,
                              to: row.to,
                              roomTypeName: row.rooms.length === 1 ? row.rooms[0].roomType : null,
                              label: `${fmtDay(row.from)} – ${fmtDay(row.to)}`,
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