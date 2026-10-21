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
    const { data, error: failure } = await (supabase as any).rpc('slnt_team_b_calendar_v4', {
      p_start: dates[0], p_end: dates[dates.length - 1],
    });
    if (failure) { setError(failure.message); setDays([]); }
    else { setDays((data || []) as SlntWorkingDay[]); setError(null); }
    setLoading(false);
  }, [dates[0], dates[dates.length - 1]]);
  useEffect(() => { void refresh(); }, [refresh]);

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

  return (
    <Card data-training="slnt-availability-calendar">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />{hu ? 'B csapat — ki dolgozik?' : 'Team B — who is working?'}
          </CardTitle>
          <Badge variant="secondary">{compact
            ? `${working}/${total} ${hu ? 'dolgozik' : 'working'}`
            : hu ? 'Alapértelmezés: dolgozik' : 'Default: working'}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{hu
          ? 'Nem kell műszakot létrehozni vagy közzétenni. Csak a szabadnapot és szabadságot jelöld. A meglévő munkát előbb át kell adni.'
          : 'No shifts to create or publish. Mark only absences or leave. Release existing room work before marking someone off.'}
        </p>
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
      <CardContent className="space-y-2">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!error && !loading && people.length === 0 && <p className="text-sm text-muted-foreground">
          {hu ? 'A B csapathoz még nincs aktív dolgozó hozzárendelve.' : 'No active members mapped to Team B.'}
        </p>}
        <div className="overflow-x-auto" data-training="slnt-working-defaults">
          <table className="w-full min-w-[420px] border-separate border-spacing-1 text-sm">
            <thead><tr><th className="sticky left-0 bg-background min-w-28 text-left p-2">{hu ? 'Takarító' : 'Cleaner'}</th>
              {dates.map(date => <th key={date} className="min-w-28 p-2 text-center">{format(local(date),'EEE d')}</th>)}
            </tr></thead>
            <tbody>{people.map(([id,name]) => <tr key={id}>
              <th className="sticky left-0 bg-background text-left p-2 font-medium">{name}</th>
              {dates.map(date => {
                const item=byDay.get(id+':'+date);
                if (!item) return <td key={date} className="p-1 text-muted-foreground">—</td>;
                const current=item.absence_kind || 'working';
                return <td key={date} className="p-1 align-top">
                  <Select value={current} disabled={!!busy || date<todayBudapest()}
                    onValueChange={v => void setAvailability(item,v)}>
                    <SelectTrigger className="w-full min-w-28 h-11 text-xs" aria-label={`${name} ${date}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="working"><span className="inline-flex items-center gap-1"><Check className="h-3 w-3"/>{hu ? 'Dolgozik' : 'Working'}</span></SelectItem>
                      <SelectItem value="day_off">{hu ? 'Szabadnap' : 'Day off'}</SelectItem>
                      <SelectItem value="annual_leave">{hu ? 'Szabadság' : 'Annual leave'}</SelectItem>
                      <SelectItem value="sick_leave">{hu ? 'Betegszabadság' : 'Sick leave'}</SelectItem>
                    </SelectContent>
                  </Select>
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        {!compact && <p className="text-xs text-muted-foreground">
          {hu ? 'A táblázat automatikusan mutatja a csapattagokat. Csak az eltérések mentődnek. A jelenlétet külön kezeljük.'
            : 'Team membership pre-fills this calendar automatically. Only exceptions are stored. Physical attendance is separate.'}
        </p>}
      </CardContent>
    </Card>
  );
}
