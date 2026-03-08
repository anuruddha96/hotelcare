import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, format, startOfWeek, differenceInDays, isSameDay, isWithinInterval, parseISO } from 'date-fns';

interface ReservationCalendarProps {
  reservations: any[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-muted border-muted-foreground/30',
  confirmed: 'bg-primary/20 border-primary/40',
  checked_in: 'bg-green-500/20 border-green-500/40',
  checked_out: 'bg-secondary border-border',
  cancelled: 'bg-destructive/10 border-destructive/30',
  no_show: 'bg-destructive/10 border-destructive/30',
};

export function ReservationCalendar({ reservations }: ReservationCalendarProps) {
  const [startDate, setStartDate] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const days = 14; // Show 2 weeks

  const dateRange = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(startDate, i)),
    [startDate]
  );

  // Group reservations that overlap with date range
  const visibleReservations = useMemo(() => {
    const rangeEnd = addDays(startDate, days);
    return reservations.filter((r) => {
      const checkIn = parseISO(r.check_in_date);
      const checkOut = parseISO(r.check_out_date);
      return checkIn < rangeEnd && checkOut > startDate;
    });
  }, [reservations, startDate]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Availability Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setStartDate(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Date header */}
          <div className="grid border-b border-border sticky top-0 bg-card z-10" style={{ gridTemplateColumns: `180px repeat(${days}, 1fr)` }}>
            <div className="p-2 text-xs font-medium text-muted-foreground border-r border-border">Guest</div>
            {dateRange.map((date) => {
              const isToday = isSameDay(date, new Date());
              return (
                <div
                  key={date.toISOString()}
                  className={`p-1.5 text-center border-r border-border last:border-r-0 ${isToday ? 'bg-primary/5' : ''}`}
                >
                  <div className="text-[10px] text-muted-foreground">{format(date, 'EEE')}</div>
                  <div className={`text-xs font-medium ${isToday ? 'text-primary' : ''}`}>{format(date, 'd')}</div>
                </div>
              );
            })}
          </div>

          {/* Reservation rows */}
          {visibleReservations.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No reservations in this period
            </div>
          ) : (
            visibleReservations.map((r) => {
              const checkIn = parseISO(r.check_in_date);
              const checkOut = parseISO(r.check_out_date);
              const startCol = Math.max(0, differenceInDays(checkIn, startDate));
              const endCol = Math.min(days, differenceInDays(checkOut, startDate));
              const span = endCol - startCol;

              return (
                <div
                  key={r.id}
                  className="grid border-b border-border hover:bg-accent/20 transition-colors"
                  style={{ gridTemplateColumns: `180px repeat(${days}, 1fr)` }}
                >
                  <div className="p-2 text-xs truncate border-r border-border flex items-center">
                    <span className="font-medium truncate">
                      {r.guests?.first_name} {r.guests?.last_name}
                    </span>
                  </div>
                  {dateRange.map((date, i) => {
                    const isInRange = i >= startCol && i < endCol;
                    const isStart = i === startCol;
                    const isEnd = i === endCol - 1;
                    return (
                      <div key={date.toISOString()} className="relative border-r border-border last:border-r-0 h-8">
                        {isInRange && (
                          <div
                            className={`absolute inset-y-1 ${isStart ? 'left-1 rounded-l-md' : 'left-0'} ${isEnd ? 'right-1 rounded-r-md' : 'right-0'} border ${STATUS_COLORS[r.status] || 'bg-muted border-border'} flex items-center justify-center`}
                          >
                            {isStart && span >= 2 && (
                              <span className="text-[10px] font-medium truncate px-1">
                                {r.reservation_number?.split('-').pop()}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 p-3 border-t border-border flex-wrap">
          {Object.entries({ confirmed: 'Confirmed', checked_in: 'Checked In', pending: 'Pending', cancelled: 'Cancelled' }).map(
            ([status, label]) => (
              <div key={status} className="flex items-center gap-1.5">
                <div className={`h-3 w-6 rounded-sm border ${STATUS_COLORS[status]}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}
