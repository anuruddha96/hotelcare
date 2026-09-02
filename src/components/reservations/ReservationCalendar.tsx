import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDays, differenceInCalendarDays, format, isSameDay, parseISO, startOfDay } from 'date-fns';
import {
  BedDouble,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Loader2,
  LogIn,
  LogOut,
  Moon,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const DAYS = 14;
const DAY_WIDTH = 92;
const ROOM_WIDTH = 220;

// Phase 1 uses the standard operational stay window when the reservation only
// contains dates. A later PMS settings phase will make these property-specific.
const DEFAULT_CHECK_IN_HOUR = 15;
const DEFAULT_CHECK_OUT_HOUR = 10;

type BoardRoom = {
  id: string;
  room_number: string;
  room_name: string | null;
  room_type: string | null;
  room_category: string | null;
  floor_number: number | null;
  status: string | null;
  is_dnd: boolean | null;
  is_checkout_room: boolean | null;
  checkout_time: string | null;
};

type BoardReservation = {
  id: string;
  room_id: string | null;
  reservation_number: string;
  check_in_date: string;
  check_out_date: string;
  actual_check_in: string | null;
  actual_check_out: string | null;
  status: string;
  source: string | null;
  guests: { first_name: string | null; last_name: string | null } | null;
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 border-amber-300 text-amber-950',
  confirmed: 'bg-blue-100 border-blue-300 text-blue-950',
  checked_in: 'bg-emerald-100 border-emerald-300 text-emerald-950',
  checked_out: 'bg-slate-100 border-slate-300 text-slate-700',
  no_show: 'bg-rose-100 border-rose-300 text-rose-950',
};

function guestName(reservation: BoardReservation) {
  const name = `${reservation.guests?.first_name || ''} ${reservation.guests?.last_name || ''}`.trim();
  return name || reservation.reservation_number || 'Guest';
}

function naturalRoomSort(a: BoardRoom, b: BoardRoom) {
  return a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: 'base' });
}

function hourFraction(iso: string | null, fallbackHour: number) {
  if (!iso) return fallbackHour / 24;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return fallbackHour / 24;
  return (value.getHours() + value.getMinutes() / 60) / 24;
}

export function ReservationCalendar() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const basePath = `/${organizationSlug || profile?.organization_slug || 'rdhotels'}`;

  const [startDate, setStartDate] = useState(() => startOfDay(new Date()));
  const [rooms, setRooms] = useState<BoardRoom[]>([]);
  const [reservations, setReservations] = useState<BoardReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dateRange = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => addDays(startDate, i)),
    [startDate]
  );

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let hotelName = profile?.assigned_hotel || null;

      if (profile?.assigned_hotel) {
        const { data: config } = await supabase
          .from('hotel_configurations')
          .select('hotel_name')
          .eq('hotel_id', profile.assigned_hotel)
          .limit(1)
          .maybeSingle();
        hotelName = config?.hotel_name || profile.assigned_hotel;
      }

      const roomColumns = 'id, room_number, room_name, room_type, room_category, floor_number, status, is_dnd, is_checkout_room, checkout_time';
      let roomQuery = supabase.from('rooms').select(roomColumns).order('room_number');
      if (hotelName) roomQuery = roomQuery.eq('hotel', hotelName);

      let { data: roomData, error: roomError } = await roomQuery;

      // Older tenants may still store the hotel slug/id in rooms.hotel rather
      // than the display name. Fall back without making the UI depend on that
      // legacy representation.
      if (!roomError && (!roomData || roomData.length === 0) && profile?.assigned_hotel && hotelName !== profile.assigned_hotel) {
        const fallback = await supabase
          .from('rooms')
          .select(roomColumns)
          .eq('hotel', profile.assigned_hotel)
          .order('room_number');
        roomData = fallback.data;
        roomError = fallback.error;
      }

      if (roomError) throw roomError;

      const boardRooms = ((roomData || []) as unknown as BoardRoom[]).sort(naturalRoomSort);
      setRooms(boardRooms);

      if (boardRooms.length === 0) {
        setReservations([]);
        return;
      }

      const rangeStart = format(startDate, 'yyyy-MM-dd');
      const rangeEnd = format(addDays(startDate, DAYS), 'yyyy-MM-dd');
      const roomIds = boardRooms.map((room) => room.id);

      const { data: reservationData, error: reservationError } = await supabase
        .from('reservations')
        .select('id, room_id, reservation_number, check_in_date, check_out_date, actual_check_in, actual_check_out, status, source, guests(first_name, last_name)')
        .in('room_id', roomIds)
        .lt('check_in_date', rangeEnd)
        .gt('check_out_date', rangeStart)
        .neq('status', 'cancelled')
        .order('check_in_date', { ascending: true });

      if (reservationError) throw reservationError;
      setReservations((reservationData || []) as unknown as BoardReservation[]);
    } catch (err: any) {
      console.error('Failed to load reservation board', err);
      setError(err?.message || 'Unable to load the reservation board.');
    } finally {
      setLoading(false);
    }
  }, [profile?.assigned_hotel, startDate]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const reservationsByRoom = useMemo(() => {
    const grouped = new Map<string, BoardReservation[]>();
    reservations.forEach((reservation) => {
      if (!reservation.room_id) return;
      const current = grouped.get(reservation.room_id) || [];
      current.push(reservation);
      grouped.set(reservation.room_id, current);
    });
    return grouped;
  }, [reservations]);

  const today = startOfDay(new Date());
  const todayKey = format(today, 'yyyy-MM-dd');
  const timelineWidth = DAYS * DAY_WIDTH;

  const stayGeometry = (reservation: BoardReservation) => {
    const checkIn = parseISO(reservation.check_in_date);
    const checkOut = parseISO(reservation.check_out_date);
    const startDay = differenceInCalendarDays(checkIn, startDate);
    const endDay = differenceInCalendarDays(checkOut, startDate);

    const startFraction = hourFraction(reservation.actual_check_in, DEFAULT_CHECK_IN_HOUR);
    const endFraction = hourFraction(reservation.actual_check_out, DEFAULT_CHECK_OUT_HOUR);

    const rawStart = startDay + startFraction;
    const rawEnd = endDay + endFraction;
    const clippedStart = Math.max(0, rawStart);
    const clippedEnd = Math.min(DAYS, rawEnd);

    return {
      left: clippedStart * DAY_WIDTH,
      width: Math.max(20, (clippedEnd - clippedStart) * DAY_WIDTH),
    };
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="py-3 px-3 sm:px-4 border-b bg-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BedDouble className="h-4 w-4" /> Reservation Board
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Rooms × dates · click a stay to open the reservation
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, -7))} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setStartDate(startOfDay(new Date()))}>
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, 7))} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadBoard} disabled={loading} aria-label="Refresh board">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {error ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-destructive">Could not load the reservation board</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={loadBoard}>Try again</Button>
          </div>
        ) : loading && rooms.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading rooms and stays…
          </div>
        ) : rooms.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No rooms are configured for the selected hotel.
          </div>
        ) : (
          <div className="overflow-auto max-h-[68vh]">
            <div style={{ minWidth: ROOM_WIDTH + timelineWidth }}>
              <div className="flex sticky top-0 z-30 bg-card border-b shadow-sm">
                <div
                  className="sticky left-0 z-40 bg-card border-r px-3 py-2 text-xs font-semibold text-muted-foreground flex items-center"
                  style={{ width: ROOM_WIDTH, minWidth: ROOM_WIDTH }}
                >
                  ROOM / STATUS
                </div>
                <div className="flex" style={{ width: timelineWidth }}>
                  {dateRange.map((date) => {
                    const isToday = isSameDay(date, today);
                    return (
                      <div
                        key={date.toISOString()}
                        className={`shrink-0 border-r px-1 py-1.5 text-center ${isToday ? 'bg-primary/8' : ''}`}
                        style={{ width: DAY_WIDTH }}
                      >
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{format(date, 'EEE')}</div>
                        <div className={`text-sm font-semibold ${isToday ? 'text-primary' : ''}`}>{format(date, 'd MMM')}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {rooms.map((room) => {
                const roomReservations = reservationsByRoom.get(room.id) || [];
                return (
                  <div key={room.id} className="flex min-h-[58px] border-b hover:bg-accent/20 transition-colors">
                    <div
                      className="sticky left-0 z-20 bg-card/95 backdrop-blur border-r px-3 py-2 flex flex-col justify-center"
                      style={{ width: ROOM_WIDTH, minWidth: ROOM_WIDTH }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm truncate">{room.room_number}</span>
                        {room.is_dnd && (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-violet-300 text-violet-700 gap-1">
                            <Moon className="h-3 w-3" /> DND
                          </Badge>
                        )}
                        {room.is_checkout_room && (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-orange-300 text-orange-700 gap-1">
                            <LogOut className="h-3 w-3" /> DEP
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {room.room_type || room.room_category || room.room_name || room.status || 'Room'}
                        {room.floor_number != null ? ` · Floor ${room.floor_number}` : ''}
                      </div>
                    </div>

                    <div
                      className="relative shrink-0"
                      style={{ width: timelineWidth, minWidth: timelineWidth }}
                    >
                      <div className="absolute inset-0 flex pointer-events-none">
                        {dateRange.map((date) => (
                          <div
                            key={date.toISOString()}
                            className={`h-full shrink-0 border-r ${isSameDay(date, today) ? 'bg-primary/[0.035]' : ''}`}
                            style={{ width: DAY_WIDTH }}
                          />
                        ))}
                      </div>

                      {roomReservations.map((reservation) => {
                        const geometry = stayGeometry(reservation);
                        const isArrival = reservation.check_in_date === todayKey;
                        const isDeparture = reservation.check_out_date === todayKey;
                        const isInHouse = reservation.status === 'checked_in' || (!!reservation.actual_check_in && !reservation.actual_check_out);
                        const style = STATUS_STYLES[reservation.status] || STATUS_STYLES.confirmed;

                        return (
                          <button
                            key={reservation.id}
                            type="button"
                            onClick={() => navigate(`${basePath}/reservations/${reservation.id}`)}
                            className={`absolute top-2 h-[42px] rounded-md border shadow-sm px-2 text-left overflow-hidden hover:brightness-[0.98] hover:shadow transition ${style}`}
                            style={{ left: geometry.left, width: geometry.width }}
                            title={`${guestName(reservation)} · ${reservation.check_in_date} → ${reservation.check_out_date} · ${reservation.status.replace('_', ' ')}`}
                          >
                            <div className="flex items-center gap-1 min-w-0">
                              {isArrival && !isInHouse && <LogIn className="h-3 w-3 shrink-0" />}
                              {isInHouse && <DoorOpen className="h-3 w-3 shrink-0" />}
                              {isDeparture && <LogOut className="h-3 w-3 shrink-0" />}
                              <span className="text-[11px] font-semibold truncate">{guestName(reservation)}</span>
                            </div>
                            <div className="text-[9px] opacity-75 truncate">
                              {isInHouse ? 'Checked in' : isArrival ? 'Arrival today' : isDeparture ? 'Departure today' : reservation.status.replace('_', ' ')}
                              {reservation.source ? ` · ${reservation.source.replace('_', ' ')}` : ''}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="border-t px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 bg-muted/20">
          <div className="text-[11px] text-muted-foreground mr-1">Stay status:</div>
          {[
            ['confirmed', 'Confirmed'],
            ['checked_in', 'Checked in'],
            ['pending', 'Pending'],
            ['no_show', 'No show'],
          ].map(([status, label]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span className={`h-3 w-5 rounded-sm border ${STATUS_STYLES[status]}`} />
              <span className="text-[11px] text-muted-foreground">{label}</span>
            </div>
          ))}
          <div className="ml-auto text-[10px] text-muted-foreground">
            Date-only stays are positioned at 15:00 arrival / 10:00 departure until property times are configurable.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
