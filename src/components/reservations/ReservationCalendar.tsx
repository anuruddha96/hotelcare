import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Radio } from 'lucide-react';
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
  showUnassigned?: boolean;
}

const SPAN_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-amber-950/35 dark:border-amber-800 dark:text-amber-200',
  confirmed: 'bg-emerald-600 border-emerald-700 text-white dark:bg-emerald-700 dark:border-emerald-600',
  checked_in: 'bg-sky-600 border-sky-700 text-white dark:bg-sky-700 dark:border-sky-600',
  checked_out: 'bg-zinc-400 border-zinc-500 text-white dark:bg-zinc-700 dark:border-zinc-600',
};

const ROOM_DOT: Record<string, string> = {
  clean: 'bg-emerald-500',
  dirty: 'bg-amber-500',
  occupied: 'bg-sky-500',
};

const COL_W = 50;
const LABEL_W = 184;
const ROW_H = 42;

type WindowDays = 14 | 21 | 31;

function sourceCode(source?: string | null): string {
  const s = String(source || '').toLowerCase();
  if (s.includes('booking')) return 'B';
  if (s.includes('expedia')) return 'E';
  if (s.includes('previo')) return 'P';
  if (s.includes('walk')) return 'W';
  if (s.includes('direct')) return 'D';
  return 'R';
}

/**
 * Previo-inspired physical-room planner. It keeps the HotelCare visual language,
 * but follows the proven PMS interaction pattern: rooms on the left, dates on
 * top, reservation spans in the grid and a wide month-aware working horizon.
 */
export function ReservationCalendar({
  rooms,
  reservations,
  basePath,
  showUnassigned = true,
}: ReservationCalendarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(() => addDays(startOfDay(new Date()), -2));
  const [days, setDays] = useState<WindowDays>(21);

  const dateRange = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(startDate, i)),
    [startDate, days],
  );
  const rangeEnd = useMemo(() => addDays(startDate, days), [startDate, days]);

  const monthGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; count: number }> = [];
    for (const date of dateRange) {
      const key = format(date, 'yyyy-MM');
      const last = groups[groups.length - 1];
      if (last?.key === key) last.count += 1;
      else groups.push({ key, label: format(date, 'MMMM yyyy'), count: 1 });
    }
    return groups;
  }, [dateRange]);

  const active = useMemo(
    () => reservations.filter((r) => {
      if (!['pending', 'confirmed', 'checked_in', 'checked_out'].includes(r.status)) return false;
      if (!r.check_in_date || !r.check_out_date) return false;
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
  const openReservation = (r: any) => {
    if (r.snapshotOnly) return;
    navigate(`${basePath}/reservations/${r.id}`);
  };

  return (
    <Card data-training="res-planner" className="overflow-hidden">
      <CardHeader className="p-2.5 border-b border-border bg-card">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold">{t('pms.planner.title')}</span>
            <Badge variant="secondary" className="text-[10px]">{sortedRooms.length} {t('pms.res.room')}</Badge>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex border border-border rounded-md overflow-hidden">
              {([14, 21, 31] as WindowDays[]).map((count) => (
                <Button
                  key={count}
                  type="button"
                  variant={days === count ? 'default' : 'ghost'}
                  size="sm"
                  className="rounded-none h-8 px-2.5 text-xs"
                  onClick={() => setDays(count)}
                >
                  {count}d
                </Button>
              ))}
            </div>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setStartDate(addDays(startOfDay(new Date()), -2))}>
              {t('pms.planner.today')}
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {showUnassigned && unassigned.length > 0 && (
          <div className="px-3 py-2 flex items-center gap-2 flex-wrap border-b border-border bg-amber-50/50 dark:bg-amber-950/10">
            <span className="text-xs font-medium text-amber-800 dark:text-amber-300">{t('pms.planner.unassignedSection')}:</span>
            {unassigned.map((r) => (
              <button type="button" key={r.id} onClick={() => openReservation(r)} disabled={r.snapshotOnly}>
                <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-accent gap-1">
                  {r.snapshotOnly && <Radio className="h-3 w-3" />}
                  {reservationGuestLabel(r)} · {r.check_in_date.slice(5)}→{r.check_out_date.slice(5)}
                </Badge>
              </button>
            ))}
          </div>
        )}

        <div className="overflow-x-auto overscroll-x-contain">
          <div style={{ minWidth: LABEL_W + gridWidth }}>
            <div className="flex border-b border-border bg-muted/25 sticky top-0 z-30">
              <div
                className="shrink-0 sticky left-0 z-40 bg-card border-r border-border flex items-center px-3 text-xs font-semibold"
                style={{ width: LABEL_W }}
              >
                {t('pms.res.room')}
              </div>
              <div className="flex" style={{ width: gridWidth }}>
                {monthGroups.map((group) => (
                  <div
                    key={group.key}
                    className="h-7 flex items-center justify-center border-r border-border text-[11px] font-semibold text-muted-foreground bg-muted/30"
                    style={{ width: group.count * COL_W }}
                  >
                    {group.label}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex border-b border-border sticky top-7 bg-card z-30">
              <div
                className="shrink-0 sticky left-0 z-40 bg-card border-r border-border px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                style={{ width: LABEL_W }}
              >
                {sortedRooms.length} rooms
              </div>
              <div className="flex">
                {dateRange.map((date) => {
                  const todayCell = isSameDay(date, new Date());
                  const weekend = [0, 6].includes(date.getDay());
                  return (
                    <div
                      key={date.toISOString()}
                      className={`text-center border-r border-border py-1 ${todayCell ? 'bg-amber-100 dark:bg-amber-950/35' : weekend ? 'bg-muted/35' : ''}`}
                      style={{ width: COL_W }}
                    >
                      <div className="text-[9px] uppercase text-muted-foreground">{format(date, 'EEE')}</div>
                      <div className={`text-xs font-bold ${todayCell ? 'text-amber-700 dark:text-amber-300' : ''}`}>{format(date, 'd')}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {sortedRooms.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">{t('pms.planner.noRooms')}</div>
            ) : sortedRooms.map((room, roomIndex) => {
              const spans = (byRoom.get(room.id) ?? []).map((r) => {
                const checkIn = parseISO(r.check_in_date);
                const checkOut = parseISO(r.check_out_date);
                const startCol = Math.max(0, differenceInDays(checkIn, startDate));
                const endCol = Math.min(days, differenceInDays(checkOut, startDate));
                return { r, startCol, endCol };
              }).filter((s) => s.endCol > s.startCol);

              return (
                <div key={room.id} className={`flex border-b border-border ${roomIndex % 2 ? 'bg-muted/[0.10]' : 'bg-card'} hover:bg-accent/10 transition-colors`}>
                  <div
                    className="shrink-0 sticky left-0 z-20 bg-inherit border-r border-border px-2.5 flex items-center gap-2"
                    style={{ width: LABEL_W, height: ROW_H }}
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${ROOM_DOT[room.status ?? ''] ?? 'bg-muted-foreground/40'}`} />
                    <div className="min-w-0 leading-tight">
                      <div className="text-xs font-bold truncate">{room.room_number}</div>
                      {room.room_type && <div className="text-[9px] text-muted-foreground truncate mt-0.5">{room.room_type}</div>}
                    </div>
                  </div>

                  <div className="relative" style={{ width: gridWidth, height: ROW_H }}>
                    <div className="absolute inset-0 flex">
                      {dateRange.map((date) => {
                        const todayCell = isSameDay(date, new Date());
                        const weekend = [0, 6].includes(date.getDay());
                        return (
                          <div
                            key={date.toISOString()}
                            className={`border-r border-border h-full ${todayCell ? 'bg-amber-50/70 dark:bg-amber-950/15' : weekend ? 'bg-muted/20' : ''}`}
                            style={{ width: COL_W }}
                          />
                        );
                      })}
                    </div>

                    {spans.map(({ r, startCol, endCol }, idx) => {
                      const narrow = endCol - startCol <= 1;
                      const snapshot = r.snapshotOnly === true;
                      const special = Boolean(r.special_requests);
                      return (
                        <button
                          type="button"
                          key={r.id}
                          onClick={() => openReservation(r)}
                          disabled={snapshot}
                          className={`absolute rounded-sm border text-[10px] font-semibold truncate px-1.5 flex items-center gap-1 shadow-sm ${SPAN_COLORS[r.status] ?? 'bg-muted border-border'} ${snapshot ? 'opacity-80 cursor-default' : 'hover:brightness-95 cursor-pointer'} ${special ? 'border-b-2 border-b-red-500' : ''}`}
                          style={{
                            left: startCol * COL_W + 1,
                            width: Math.max(12, (endCol - startCol) * COL_W - 2),
                            top: 4 + (idx % 2 === 1 && spans.length > 1 ? 2 : 0),
                            height: 34 - (idx % 2 === 1 && spans.length > 1 ? 4 : 0),
                          }}
                          title={`${reservationGuestLabel(r)} · ${r.check_in_date} → ${r.check_out_date}${snapshot ? ' · PMS snapshot' : ''}`}
                        >
                          <span className="inline-flex h-4 min-w-4 px-0.5 items-center justify-center rounded-[2px] bg-black/15 text-[9px] shrink-0">
                            {sourceCode(r.source)}
                          </span>
                          {!narrow && <span className="truncate">{reservationGuestLabel(r)}</span>}
                          {snapshot && <Radio className="h-3 w-3 shrink-0 ml-auto" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="flex items-center gap-3 px-3 py-2.5 flex-wrap bg-muted/15">
              {(['confirmed', 'checked_in', 'pending', 'checked_out'] as const).map((status) => (
                <div key={status} className="flex items-center gap-1.5">
                  <div className={`h-3 w-6 rounded-sm border ${SPAN_COLORS[status]}`} />
                  <span className="text-[10px] text-muted-foreground">{t(`pms.planner.legend_${status}`)}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5 ml-auto">
                <Radio className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Previo live snapshot (read-only)</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
