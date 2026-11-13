import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, differenceInDays, format, isSameDay, parseISO, startOfDay } from 'date-fns';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Radio, Search, Siren } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ReservationHoverDetails } from '@/components/reservations/ReservationHoverDetails';
import { todayBudapest } from '@/lib/budapestTime';
import { needsAction, nightlyOccupancy, reservationAttention, topSeverity, type AttentionFlag } from '@/lib/receptionAttention';
import { useTranslation } from '@/hooks/useTranslation';
import { reservationChannel, reservationGuestLabel } from '@/lib/reservations';
import { getRoomLaneCount, layoutRoomStays } from '@/lib/receptionPlanner';

interface PlannerRoom {
  id: string;
  room_number: string;
  room_type?: string | null;
  status?: string | null;
}

interface ReservationCalendarProps {
  rooms: PlannerRoom[];
  reservations: any[];
  basePath: string;
  showUnassigned?: boolean;
}

type WindowDays = 7 | 14 | 21 | 31;
const COLUMN_WIDTH = 88;
const ROOM_WIDTH = 194;
const ROW_HEIGHT = 44;
const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'checked_in', 'checked_out']);

const RESERVATION_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 border-amber-400 text-amber-950 dark:bg-amber-950 dark:text-amber-100',
  confirmed: 'bg-emerald-600 border-emerald-700 text-white',
  checked_in: 'bg-sky-600 border-sky-700 text-white',
  checked_out: 'bg-slate-400 border-slate-500 text-white',
};
const ROOM_COLORS: Record<string, string> = {
  clean: 'bg-emerald-500', dirty: 'bg-amber-500', occupied: 'bg-sky-500',
};

function startNearToday() {
  // Two preceding days are enough to explain turnarounds without burying arrivals.
  return addDays(startOfDay(new Date()), -2);
}

const ATTENTION_DOT: Record<string, string> = {
  high: 'bg-red-600 ring-white',
  medium: 'bg-amber-400 ring-white',
};

/** Read-only snapshot bookings are displayed separately from editable HotelCare records. */
export function ReservationCalendar({ rooms, reservations, basePath, showUnassigned = true }: ReservationCalendarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [days, setDays] = useState<WindowDays>(14);
  const [startDate, setStartDate] = useState(startNearToday);
  const [roomSearch, setRoomSearch] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  // Dim every booking that does not need a person to act.
  const [focusAttention, setFocusAttention] = useState(false);
  const today = todayBudapest();

  const endDate = useMemo(() => addDays(startDate, days), [startDate, days]);
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(startDate, i)), [startDate, days]);
  const currentStart = format(startDate, 'yyyy-MM-dd');
  const currentEnd = format(endDate, 'yyyy-MM-dd');
  const active = useMemo(() => reservations.filter((reservation) =>
    ACTIVE_STATUSES.has(reservation.status)
    && typeof reservation.check_in_date === 'string'
    && typeof reservation.check_out_date === 'string'
    && reservation.check_out_date > currentStart
    && reservation.check_in_date < currentEnd
    && reservation.check_out_date > reservation.check_in_date,
  ), [reservations, currentStart, currentEnd]);

  const roomBookings = useMemo(() => {
    const bookings = new Map<string, any[]>();
    for (const reservation of active) {
      if (!reservation.room_id) continue;
      const group = bookings.get(reservation.room_id) ?? [];
      group.push(reservation);
      bookings.set(reservation.room_id, group);
    }
    return bookings;
  }, [active]);

  const visibleRooms = useMemo(() => {
    const term = roomSearch.trim().toLocaleLowerCase();
    return rooms
      .filter((room) => (!term || `${room.room_number} ${room.room_type ?? ''}`.toLocaleLowerCase().includes(term))
        && (!onlyAvailable || !(roomBookings.get(room.id)?.length)))
      .slice()
      .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }, [rooms, roomBookings, roomSearch, onlyAvailable]);

  const unassigned = useMemo(() => active.filter((r) => !r.room_id && r.status !== 'checked_out'), [active]);

  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const attentionById = useMemo(() => {
    const flags = new Map<string, AttentionFlag[]>();
    for (const reservation of active) {
      const room = reservation.room_id ? roomById.get(reservation.room_id) : undefined;
      flags.set(reservation.id, reservationAttention(reservation, today, room?.status));
    }
    return flags;
  }, [active, roomById, today]);
  const actionCount = useMemo(
    () => [...attentionById.values()].filter((flags) => needsAction(flags)).length,
    [attentionById],
  );
  const occupancy = useMemo(
    () => nightlyOccupancy(reservations, dates.map((date) => format(date, 'yyyy-MM-dd')), rooms.length),
    [reservations, dates, rooms.length],
  );
  const conflictRooms = useMemo(() => {
    let count = 0;
    for (const room of rooms) {
      if (layoutRoomStays(roomBookings.get(room.id) ?? []).some((stay) => stay.overlaps)) count += 1;
    }
    return count;
  }, [rooms, roomBookings]);

  const openReservation = (reservation: any) => {
    if (reservation.snapshotOnly) return;
    navigate(`${basePath}/reservations/${reservation.id}`);
  };

  const setAnchor = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const date = parseISO(value);
    if (Number.isNaN(date.getTime())) return;
    setStartDate(addDays(date, -2));
  };

  const gridWidth = days * COLUMN_WIDTH;
  const monthGroups = useMemo(() => {
    const groups: { key: string; label: string; count: number }[] = [];
    for (const date of dates) {
      const key = format(date, 'yyyy-MM');
      const latest = groups[groups.length - 1];
      if (latest?.key === key) latest.count += 1;
      else groups.push({ key, label: format(date, 'MMMM yyyy'), count: 1 });
    }
    return groups;
  }, [dates]);

  return (
    <Card data-training="res-planner" className="min-w-0 overflow-hidden">
      <CardHeader className="p-3 border-b border-border space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{t('pms.planner.title')}</h2>
            <Badge variant="secondary" className="text-[11px]">{visibleRooms.length}/{rooms.length} {t('pms.res.room')}</Badge>
            {conflictRooms > 0 && <Badge variant="destructive" role="alert" className="gap-1 text-[11px]">⚠️ {conflictRooms} room conflicts</Badge>}
            <Button
              type="button"
              size="sm"
              variant={focusAttention ? 'default' : 'outline'}
              className="h-7 gap-1 px-2 text-[11px]"
              aria-pressed={focusAttention}
              title={t('pms.planner.needsActionHint')}
              onClick={() => setFocusAttention((value) => !value)}
            >
              <Siren className="h-3.5 w-3.5" />
              {t('pms.planner.needsAction')}
              <span className={`rounded-full px-1.5 text-[10px] font-semibold ${actionCount > 0 ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground'}`}>{actionCount}</span>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setStartDate((current) => addDays(current, -7))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
            <Input type="date" aria-label="Planner focus date" className="h-8 w-[143px] text-xs" value={format(addDays(startDate, 2), 'yyyy-MM-dd')} onChange={(event) => setAnchor(event.target.value)} />
            <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={() => setStartDate(startNearToday())}>{t('pms.planner.today')}</Button>
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setStartDate((current) => addDays(current, 7))} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
            <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Planner date range">
              {([7, 14, 21, 31] as WindowDays[]).map((count) => <Button key={count} type="button" size="sm" variant={count === days ? 'default' : 'ghost'} className="rounded-none h-8 px-2 text-xs" aria-pressed={count === days} onClick={() => setDays(count)}>{count}d</Button>)}
            </div>
          </div>
        </div>
        <div className="flex items-center flex-wrap gap-2 justify-between">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} placeholder="Filter room or room type" aria-label="Filter rooms" className="h-8 pl-8 text-xs" />
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} className="accent-primary" />
            Show only rooms without bookings in this window
          </label>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 items-center text-[11px] text-muted-foreground" aria-label="Planner legend">
          {(['confirmed', 'checked_in', 'pending', 'checked_out'] as const).map((status) => (
            <span key={status} className="inline-flex items-center gap-1"><span className={`inline-block w-4 h-2.5 rounded-sm border ${RESERVATION_COLORS[status]}`} /> {t(`pms.planner.legend_${status}`)}</span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" /> {t('pms.planner.legendUrgent')}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> {t('pms.planner.legendCheck')}</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {showUnassigned && unassigned.length > 0 && (
          <div className="border-b border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2 flex flex-wrap items-center gap-2" role="status">
            <Badge variant="outline" className="text-xs">{t('pms.planner.unassignedSection')}: {unassigned.length}</Badge>
            {unassigned.map((reservation) => <Button key={reservation.id} type="button" size="sm" variant="ghost" className="h-auto min-h-7 py-1 text-xs" disabled={reservation.snapshotOnly} title={reservation.snapshotOnly ? 'Imported snapshot: open the booking in Previo' : undefined} onClick={() => openReservation(reservation)}>{reservationGuestLabel(reservation)} · {reservation.check_in_date}</Button>)}
          </div>
        )}
        {/* No fixed vertical scroll area: a normal mouse wheel must scroll the page, not trap reception staff inside the planner. */}
        <div className="w-full overflow-x-auto" data-training="res-planner-scroll" tabIndex={0} role="region" aria-label="Reservation calendar; scroll horizontally for more dates">
          <div style={{ minWidth: ROOM_WIDTH + gridWidth }}>
            <div className="flex border-b border-border bg-muted/30">
              <div className="sticky left-0 z-20 bg-card border-r border-border shrink-0 px-3 flex items-center text-xs font-semibold" style={{ width: ROOM_WIDTH }}>Rooms / dates</div>
              <div className="flex" style={{ width: gridWidth }}>
                {monthGroups.map((group) => <div key={group.key} className="h-7 border-r border-border text-[11px] font-semibold flex justify-center items-center" style={{ width: group.count * COLUMN_WIDTH }}>{group.label}</div>)}
              </div>
            </div>
            <div className="flex border-b border-border bg-card">
              <div className="sticky left-0 z-20 shrink-0 bg-card border-r border-border px-3 flex items-center text-[10px] text-muted-foreground" style={{ width: ROOM_WIDTH }}>{visibleRooms.length} rooms</div>
              <div className="flex" style={{ width: gridWidth }}>
                {dates.map((date) => <div key={format(date, 'yyyy-MM-dd')} className={`shrink-0 text-center border-r border-border py-1 ${isSameDay(date, new Date()) ? 'bg-amber-100 dark:bg-amber-950/40' : [0, 6].includes(date.getDay()) ? 'bg-muted/50' : ''}`} style={{ width: COLUMN_WIDTH }}><div className="text-[10px] text-muted-foreground uppercase">{format(date, 'EEE')}</div><div className="text-sm font-semibold">{format(date, 'd')}</div></div>)}
              </div>
            </div>
            <div className="flex border-b border-border bg-muted/20" aria-label={t('pms.planner.occupancy')}>
              <div className="sticky left-0 z-20 shrink-0 bg-card border-r border-border px-3 flex items-center text-[10px] text-muted-foreground" style={{ width: ROOM_WIDTH }}>{t('pms.planner.occupancy')}</div>
              <div className="flex" style={{ width: gridWidth }}>
                {occupancy.map((night) => (
                  <div key={night.date} className="shrink-0 border-r border-border px-1 py-1" style={{ width: COLUMN_WIDTH }} title={`${night.occupied}/${rooms.length}`}>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold">{night.percent == null ? '—' : `${night.percent}%`}</span>
                      <span className="text-muted-foreground">{night.occupied}/{rooms.length}</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${night.percent != null && night.percent >= 90 ? 'bg-red-500' : night.percent != null && night.percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${night.percent ?? 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {visibleRooms.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No rooms match the current filters.</div> : visibleRooms.map((room, roomIndex) => {
              const positioned = layoutRoomStays(roomBookings.get(room.id) ?? []);
              const roomHeight = Math.max(ROW_HEIGHT, getRoomLaneCount(positioned) * 37 + 7);
              const conflict = positioned.some((stay) => stay.overlaps);
              return <div key={room.id} className={`flex border-b border-border ${roomIndex % 2 ? 'bg-muted/10' : 'bg-card'}`}>
                <div className="sticky left-0 z-20 shrink-0 bg-card border-r border-border px-2.5 flex items-center gap-2" style={{ width: ROOM_WIDTH, minHeight: roomHeight }}>
                  <span className={`h-2 w-2 rounded-full shrink-0 ${ROOM_COLORS[room.status ?? ''] ?? 'bg-muted-foreground/40'}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1"><div className="flex gap-1 items-center text-xs font-semibold"><span className="truncate">{room.room_number}</span>{conflict && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Reservation conflict" />}</div><div className="text-[10px] text-muted-foreground truncate">{room.room_type || '—'}</div></div>
                </div>
                <div className="relative shrink-0" style={{ width: gridWidth, height: roomHeight }}>
                  <div className="absolute inset-0 flex" aria-hidden="true">{dates.map((date) => <div key={format(date, 'yyyy-MM-dd')} className={`shrink-0 border-r border-border ${isSameDay(date, new Date()) ? 'bg-amber-50/60 dark:bg-amber-950/20' : [0, 6].includes(date.getDay()) ? 'bg-muted/20' : ''}`} style={{ width: COLUMN_WIDTH }} />)}</div>
                  {positioned.map(({ reservation, lane, overlaps }) => {
                    const start = Math.max(0, differenceInDays(parseISO(reservation.check_in_date), startDate));
                    const end = Math.min(days, differenceInDays(parseISO(reservation.check_out_date), startDate));
                    if (end <= start) return null;
                    const snapshot = reservation.snapshotOnly === true;
                    const label = reservationGuestLabel(reservation);
                    const flags = attentionById.get(reservation.id) ?? [];
                    const severity = topSeverity(flags);
                    const actionable = needsAction(flags);
                    const dimmed = focusAttention && !actionable && !overlaps;
                    const reasons = flags.map((flag) => t(`pms.attention.${flag.kind}`)).join(', ');
                    return <HoverCard key={reservation.id} openDelay={250} closeDelay={80}>
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          disabled={snapshot}
                          onClick={() => openReservation(reservation)}
                          aria-label={`${label}, ${reservation.check_in_date} to ${reservation.check_out_date}${snapshot ? ', read-only snapshot' : ''}${overlaps ? ', room conflict' : ''}${reasons ? `, ${reasons}` : ''}`}
                          className={`absolute flex items-center gap-1 rounded border text-[11px] font-semibold text-left px-1.5 overflow-hidden transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${RESERVATION_COLORS[reservation.status] || 'bg-muted border-border'} ${snapshot ? 'border-dashed opacity-75 cursor-not-allowed' : 'hover:brightness-95 cursor-pointer'} ${overlaps ? 'ring-2 ring-destructive ring-inset' : ''} ${dimmed ? 'opacity-25' : ''}`}
                          style={{ left: start * COLUMN_WIDTH + 2, top: lane * 37 + 4, width: Math.max(20, (end - start) * COLUMN_WIDTH - 4), height: 32 }}
                        >
                          <span className="shrink-0 text-[9px] rounded bg-black/15 px-1">{reservationChannel(reservation).letter}</span>
                          <span className="truncate">{label}</span>
                          {snapshot && <Radio className="h-3 w-3 shrink-0 ml-auto" />}
                          {actionable && severity && ATTENTION_DOT[severity] && (
                            <span className={`ml-auto h-2.5 w-2.5 shrink-0 rounded-full ring-2 ${ATTENTION_DOT[severity]}`} aria-hidden="true" />
                          )}
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent side="top" align="start" className="w-72 p-3">
                        <ReservationHoverDetails reservation={reservation} roomLabel={room.room_number} flags={flags} />
                      </HoverCardContent>
                    </HoverCard>;
                  })}
                </div>
              </div>;
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
