import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, format, differenceInDays, isSameDay, parseISO, startOfDay } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';
import { reservationGuestLabel } from '@/lib/reservations';

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
}

const SPAN_COLORS: Record<string, string> = {
  pending: 'bg-muted border-muted-foreground/40 text-muted-foreground',
  confirmed: 'bg-primary/20 border-primary/50 text-primary',
  checked_in: 'bg-green-500/20 border-green-500/50 text-green-800 dark:text-green-300',
  checked_out: 'bg-secondary border-border text-muted-foreground',
};

const ROOM_DOT: Record<string, string> = {
  clean: 'bg-green-500',
  dirty: 'bg-amber-500',
  occupied: 'bg-blue-500',
};

const COL_W = 48;
const LABEL_W = 144;

/**
 * Room-based planner: one row per physical room, booked spans across a
 * 14/21-day window. Unassigned active reservations are listed above the grid.
 */
export function ReservationCalendar({ rooms, reservations, basePath }: ReservationCalendarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(() => addDays(startOfDay(new Date()), -1));
  const [days, setDays] = useState<14 | 21>(14);

  const dateRange = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(startDate, i)),
    [startDate, days],
  );
  const rangeEnd = useMemo(() => addDays(startDate, days), [startDate, days]);

  const active = useMemo(
    () => reservations.filter((r) => {
      if (!['pending', 'confirmed', 'checked_in', 'checked_out'].includes(r.status)) return false;
      const checkIn = parseISO(r.check_in_date);
      const checkOut = parseISO(r.check_out_date);
      return checkIn < rangeEnd && checkOut > startDate;
    }),
    [reservations, startDate, rangeEnd],
  );

  const byRoom = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of active) {
      if (!r.room_id) continue;
      const list = map.get(r.room_id) ?? [];
      list.push(r);
      map.set(r.room_id, list);
    }
    return map;
  }, [active]);

  const unassigned = useMemo(
    () => active.filter((r) => !r.room_id && r.status !== 'checked_out'),
    [active],
  );

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })),
    [rooms],
  );

  const gridWidth = days * COL_W;

  return (
    <Card data-training="res-planner">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">{t('pms.planner.title')}</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex border border-border rounded-md overflow-hidden">
              <Button variant={days === 14 ? 'default' : 'ghost'} size="sm" className="rounded-none h-8 text-xs" onClick={() => setDays(14)}>
                {t('pms.planner.days14')}
              </Button>
              <Button variant={days === 21 ? 'default' : 'ghost'} size="sm" className="rounded-none h-8 text-xs" onClick={() => setDays(21)}>
                {t('pms.planner.days21')}
              </Button>
            </div>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setStartDate(addDays(startOfDay(new Date()), -1))}>
              {t('pms.planner.today')}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {unassigned.length > 0 && (
          <div className="px-3 pb-2 flex items-center gap-2 flex-wrap border-b border-border pb-3">
            <span className="text-xs text-muted-foreground">{t('pms.planner.unassignedSection')}:</span>
            {unassigned.map((r) => (
              <button key={r.id} onClick={() => navigate(`${basePath}/reservations/${r.id}`)}>
                <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-accent">
                  {reservationGuestLabel(r)} · {r.check_in_date.slice(5)}→{r.check_out_date.slice(5)}
                </Badge>
              </button>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <div style={{ minWidth: LABEL_W + gridWidth }}>
            {/* Header */}
            <div className="flex border-b border-border sticky top-0 bg-card z-20">
              <div
                className="shrink-0 sticky left-0 z-30 bg-card border-r border-border p-2 text-xs font-medium text-muted-foreground"
                style={{ width: LABEL_W }}
              >
                {t('pms.res.room')}
              </div>
              <div className="flex">
                {dateRange.map((date) => {
                  const isToday = isSameDay(date, new Date());
                  return (
                    <div
                      key={date.toISOString()}
                      className={`text-center border-r border-border py-1 ${isToday ? 'bg-primary/10' : ''}`}
                      style={{ width: COL_W }}
                    >
                      <div className="text-[10px] text-muted-foreground">{format(date, 'EEE')}</div>
                      <div className={`text-xs font-medium ${isToday ? 'text-primary' : ''}`}>{format(date, 'd')}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rows */}
            {sortedRooms.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">{t('pms.planner.noRooms')}</div>
            ) : (
              sortedRooms.map((room) => {
                const spans = (byRoom.get(room.id) ?? []).map((r) => {
                  const checkIn = parseISO(r.check_in_date);
                  const checkOut = parseISO(r.check_out_date);
                  const startCol = Math.max(0, differenceInDays(checkIn, startDate));
                  const endCol = Math.min(days, differenceInDays(checkOut, startDate));
                  return { r, startCol, endCol };
                }).filter((s) => s.endCol > s.startCol);
                return (
                  <div key={room.id} className="flex border-b border-border hover:bg-accent/10 transition-colors">
                    <div
                      className="shrink-0 sticky left-0 z-10 bg-card border-r border-border px-2 py-1.5 flex items-center gap-1.5"
                      style={{ width: LABEL_W }}
                    >
                      <span className={`h-2 w-2 rounded-full shrink-0 ${ROOM_DOT[room.status ?? ''] ?? 'bg-muted-foreground/40'}`} />
                      <span className="text-xs font-semibold">{room.room_number}</span>
                      {room.room_type && (
                        <span className="text-[10px] text-muted-foreground truncate">{room.room_type}</span>
                      )}
                    </div>
                    <div className="relative h-10" style={{ width: gridWidth }}>
                      {/* background day cells */}
                      <div className="absolute inset-0 flex">
                        {dateRange.map((date) => (
                          <div
                            key={date.toISOString()}
                            className={`border-r border-border h-full ${isSameDay(date, new Date()) ? 'bg-primary/5' : ''}`}
                            style={{ width: COL_W }}
                          />
                        ))}
                      </div>
                      {/* reservation spans */}
                      {spans.map(({ r, startCol, endCol }, idx) => (
                        <button
                          key={r.id}
                          onClick={() => navigate(`${basePath}/reservations/${r.id}`)}
                          className={`absolute rounded-md border text-[10px] font-medium truncate px-1.5 flex items-center ${SPAN_COLORS[r.status] ?? 'bg-muted border-border'}`}
                          style={{
                            left: startCol * COL_W + 2,
                            width: (endCol - startCol) * COL_W - 4,
                            top: 4 + (idx % 2 === 1 && spans.length > 1 ? 2 : 0),
                            height: 32 - (idx % 2 === 1 && spans.length > 1 ? 4 : 0),
                          }}
                          title={`${reservationGuestLabel(r)} · ${r.check_in_date} → ${r.check_out_date}`}
                        >
                          {reservationGuestLabel(r)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}

            {/* Legend */}
            <div className="flex items-center gap-3 p-3 flex-wrap">
              {(['confirmed', 'checked_in', 'pending'] as const).map((status) => (
                <div key={status} className="flex items-center gap-1.5">
                  <div className={`h-3 w-6 rounded-sm border ${SPAN_COLORS[status]}`} />
                  <span className="text-xs text-muted-foreground">
                    {t(`pms.planner.legend_${status}`)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
