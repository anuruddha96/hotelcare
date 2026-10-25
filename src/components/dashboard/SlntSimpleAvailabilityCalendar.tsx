import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import { CalendarDays, Check, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type SlntWorkingDay = {
  work_date: string; user_id: string; staff_name: string;
  is_working: boolean; absence_kind: string | null;
  activity_state?: 'off' | 'planned' | 'historical' | 'not_online' | 'inactive' | 'active';
  last_activity_at?: string | null;
};
const local = (date: string) => new Date(date + 'T12:00:00');
const dayPlus = (date: string, n: number) => format(addDays(local(date), n), 'yyyy-MM-dd');

export function SlntSimpleAvailabilityCalendar({ compact = false, onSaved }: {
  compact?: boolean; onSaved?: () => void;
}) {
  const { language } = useTranslation();
  const hu = language === 'hu';
  const [week, setWeek] = useState(() => format(startOfWeek(local(todayBudapest()), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [days, setDays] = useState<SlntWorkingDay[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dates = useMemo(() => Array.from({ length: compact ? 1 : 7 }, (_, i) => dayPlus(compact ? todayBudapest() : week, i)), [week,compact]);
  const refresh = useCallback(async () => {
    setLoading(true);
    const args = { p_start: dates[0], p_end: dates[dates.length - 1] };
    let result = await (supabase as any).rpc('slnt_team_b_calendar_v5', args);
    // Deploy-safe when frontend releases before the SLNT-only migration.
    if (result.error && ['42883', 'PGRST202'].includes(result.error.code || '')) {
      result = await (supabase as any).rpc('slnt_team_b_calendar_v4', args);
    }
    if (result.error) { setError(result.error.message); setDays([]); }
    else { setDays((result.data || []) as SlntWorkingDay[]); setError(null); }
    setLoading(false);
  }, [dates[0], dates[dates.length - 1]]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, compact ? 60_000 : 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, compact]);

  const setAvailability = async (person: SlntWorkingDay, value: string) => {
    if (busy || person.work_date < todayBudapest()) return;
    setBusy(person.user_id + person.work_date);
    const { error: failure } = await (supabase as any).rpc('slnt_team_b_set_availability_v4', {
      p_user_id: person.user_id, p_work_date: person.work_date,
      p_absence_kind: value === 'working' ? null : value,
    });
    if (failure) toast.error(failure.message);
    else {
      toast.success(hu ? 'Elérhetőség mentve' : 'Availability saved');
      onSaved?.();
      window.dispatchEvent(new CustomEvent('hotelcare:slnt-team-b-availability-changed'));
    }
    await refresh(); setBusy(null);
  };
  const people = useMemo(() => [...new Map(days.map(d => [d.user_id, d.staff_name])).entries()], [days]);
  const byDay = useMemo(() => new Map(days.map(d => [d.user_id + ':' + d.work_date, d])), [days]);
  const working = days.filter(d => d.is_working).length;
  const total = days.length;
  const online = days.filter(d => d.work_date === todayBudapest() && d.activity_state === 'active').length;
  const inactive = days.filter(d => d.work_date === todayBudapest() && d.activity_state === 'inactive').length;
  const activityLabel = (state: SlntWorkingDay['activity_state']) => {
    if (state === 'active') return hu ? 'Aktív az alkalmazásban' : 'Active in app';
    if (state === 'inactive') return hu ? '3 órája inaktív' : 'Inactive for 3+ hours';
    if (state === 'not_online') return hu ? 'Ma még nem jelentkezett be' : 'Not yet online today';
    return null;
  };

  const renderAvailabilitySelect = (item: SlntWorkingDay, date: string, name: string) => (
    <Select value={item.absence_kind || 'working'} disabled={!!busy || date < todayBudapest()}
      onValueChange={value => void setAvailability(item, value)}>
      <SelectTrigger className={compact ? 'h-11 w-full min-w-0 max-w-full text-sm' : 'h-11 w-full min-w-28 text-xs'}
        aria-label={name + ' ' + date}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="working"><span className="inline-flex items-center gap-1"><Check className="h-3 w-3"/>{hu ? 'Dolgozik' : 'Working'}</span></SelectItem>
        <SelectItem value="day_off">{hu ? 'Szabadnap' : 'Day off'}</SelectItem>
        <SelectItem value="annual_leave">{hu ? 'Szabadság' : 'Annual leave'}</SelectItem>
        <SelectItem value="sick_leave">{hu ? 'Betegszabadság' : 'Sick leave'}</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <Card data-training="slnt-availability-calendar" className="min-w-0 max-w-full overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="min-w-0 space-y-2 px-3 pb-3 pt-4 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <Users className="h-4 w-4" />{hu ? 'B csapat — ki dolgozik?' : 'Team B — who is working?'}
          </CardTitle>
          <Badge variant="secondary">{compact
            ? (hu ? 'Tervezett: ' : 'Scheduled: ') + working + '/' + total
            : hu ? 'Alapértelmezés: dolgozik' : 'Default: working'}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{hu
          ? 'A napi szobák közösek. A munkabeosztás alapértelmezésben aktív; a mai alkalmazáshasználat külön jelenik meg. A meglévő szobamunkát át kell adni a szabadnap előtt.'
          : 'Shared rooms need no daily allocation. Working days are planned by default; live app activity is shown separately. Release room work before marking leave.'}
        </p>
        {compact && <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{hu ? 'Aktív' : 'Active'}: {online}</Badge>
          {inactive > 0 && <Badge variant="secondary">{hu ? 'Inaktív' : 'Inactive 3h+'}: {inactive}</Badge>}
        </div>}
        <div className="flex items-center gap-2 justify-between">
          {!compact && <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => setWeek(dayPlus(week,-7))}><CalendarDays className="h-3.5 w-3.5 mr-1"/>{hu ? 'Előző' : 'Previous'}</Button>
            <Button size="sm" variant="outline" onClick={() => setWeek(dayPlus(week,7))}>{hu ? 'Következő' : 'Next'}</Button>
          </div>}
          <Button size="sm" variant="ghost" onClick={() => { if (!compact) setWeek(format(startOfWeek(local(todayBudapest()), { weekStartsOn: 1 }), 'yyyy-MM-dd')); void refresh(); }} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-1"/>{hu ? 'Frissítés' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3 px-3 pb-4 sm:px-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!error && !loading && people.length === 0 && <p className="text-sm text-muted-foreground">
          {hu ? 'A B csapathoz még nincs aktív dolgozó hozzárendelve.' : 'No active members mapped to Team B.'}
        </p>}
        {compact ? (
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" data-training="slnt-working-defaults">
            {people.map(([id, name]) => {
              const date = dates[0];
              const item = byDay.get(id + ':' + date);
              if (!item) return (
                <div key={id} data-training="slnt-availability-person" className="min-w-0 rounded-xl border bg-muted/30 p-3">
                  <p className="break-words text-sm font-semibold">{name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{hu ? 'Nincs beosztási adat' : 'Schedule unavailable'}</p>
                </div>
              );
              const activity = item.is_working ? activityLabel(item.activity_state) : null;
              return (
                <div key={id} data-training="slnt-availability-person"
                  className={'min-w-0 max-w-full rounded-xl border p-3 shadow-sm ' +
                    (item.is_working
                      ? 'border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-background dark:border-emerald-900/60 dark:from-emerald-950/30'
                      : 'border-slate-200 bg-gradient-to-br from-slate-100/80 to-background dark:border-slate-700 dark:from-slate-900/40')}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ' +
                      (item.is_working ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-200' :
                        'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200')}>
                      {name.trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold leading-tight">{name}</p>
                      <span className={'mt-1 inline-flex items-center gap-1 text-[11px] font-medium ' +
                        (item.is_working ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300')}>
                        <span aria-hidden="true" className={'h-1.5 w-1.5 rounded-full ' +
                          (item.is_working ? 'bg-emerald-500' : 'bg-slate-400')}/>
                        {item.is_working ? (hu ? 'Munkára beosztva' : 'Scheduled to work') : (hu ? 'Nem dolgozik' : 'Not working')}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 min-w-0 space-y-1.5">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      {hu ? 'Napi státusz' : 'Day status'} · {format(local(date), 'EEE d')}
                    </p>
                    {renderAvailabilitySelect(item, date, name)}
                  </div>
                  {activity && (
                    <div className={'mt-2 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ' +
                      (item.activity_state === 'active' ? 'bg-sky-100/80 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' :
                        item.activity_state === 'inactive' ? 'bg-amber-100/80 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' :
                        'bg-muted text-muted-foreground')}>
                      <span aria-hidden="true" className={'h-1.5 w-1.5 shrink-0 rounded-full ' +
                        (item.activity_state === 'active' ? 'bg-sky-500' :
                          item.activity_state === 'inactive' ? 'bg-amber-500' : 'bg-slate-400')}/>
                      <span className="min-w-0 break-words">{activity}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto" data-training="slnt-working-defaults">
            <table className="w-full min-w-[420px] border-separate border-spacing-1 text-sm">
              <thead><tr><th className="sticky left-0 min-w-28 bg-background p-2 text-left">{hu ? 'Takarító' : 'Cleaner'}</th>
                {dates.map(date => <th key={date} className="min-w-28 p-2 text-center">{format(local(date), 'EEE d')}</th>)}
              </tr></thead>
              <tbody>{people.map(([id, name]) => <tr key={id}>
                <th className="sticky left-0 bg-background p-2 text-left font-medium">{name}</th>
                {dates.map(date => {
                  const item = byDay.get(id + ':' + date);
                  if (!item) return <td key={date} className="p-1 text-muted-foreground">—</td>;
                  return <td key={date} className="p-1 align-top">
                    {renderAvailabilitySelect(item, date, name)}
                    {date === todayBudapest() && item.is_working && activityLabel(item.activity_state) && (
                      <p className={'mt-1 text-[11px] leading-snug ' +
                        (item.activity_state === 'active' ? 'text-emerald-600 dark:text-emerald-400' :
                        item.activity_state === 'inactive' ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground')}>
                        {activityLabel(item.activity_state)}
                      </p>
                    )}
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {!compact && <p className="text-xs text-muted-foreground">
          {hu ? 'A beosztás automatikusan töltődik. 3 óra alkalmazásaktivitás nélkül a takarító inaktívként jelenik meg, amíg vissza nem tér. A szabadság és a jelenlét nem változik.'
            : 'Team membership pre-fills the schedule. After 3 hours without app activity, a cleaner shows as inactive until they return. This never changes approved leave or physical attendance.'}
        </p>}
      </CardContent>
    </Card>
  );
}
