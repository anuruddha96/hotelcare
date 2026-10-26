import { useCallback, useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { hu as huLocale } from 'date-fns/locale';
import { CalendarDays, Check, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Absence = { work_date: string; absence_kind: 'day_off' | 'annual_leave' | 'sick_leave' };
const dateOf = (date: string) => new Date(date + 'T12:00:00');

/** Staff only read their own Team B exceptions under the existing RLS policy.
 * The absence-free days are VIRTUAL working days, not invented published shifts.
 * Physical check-in and live app activity remain independent.
 */
export function SlntTeamBMySchedule() {
  const { user } = useAuth();
  const { language } = useTranslation();
  const hu = language === 'hu';
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const from = todayBudapest();
  const to = format(addDays(dateOf(from), 13), 'yyyy-MM-dd');
  const refresh = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error: failure } = await supabase
      .from('slnt_team_b_days_off' as any)
      .select('work_date,absence_kind')
      .eq('user_id', user.id)
      .gte('work_date', from)
      .lte('work_date', to);
    if (failure) setError(failure.message);
    else { setAbsences((data || []) as Absence[]); setError(''); }
    setLoading(false);
  }, [user?.id, from, to]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('hotelcare:slnt-team-b-availability-changed', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('hotelcare:slnt-team-b-availability-changed', onFocus);
    };
  }, [refresh]);

  const days = Array.from({ length: 14 }, (_, i) => format(addDays(dateOf(from), i), 'yyyy-MM-dd'));
  const absent = new Map(absences.map(d => [d.work_date, d.absence_kind]));
  const label = (kind?: Absence['absence_kind']) => {
    if (kind === 'annual_leave') return hu ? 'Szabadság' : 'Annual leave';
    if (kind === 'sick_leave') return hu ? 'Betegszabadság' : 'Sick leave';
    if (kind === 'day_off') return hu ? 'Szabadnap' : 'Day off';
    return hu ? 'Dolgozik' : 'Working';
  };
  return <Card data-training="slnt-team-b-my-schedule" className="w-full">
    <CardHeader className="px-3 pb-1 pt-3 sm:px-4">
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4" />
          {hu ? 'Munkaidő-beosztásom' : 'My work schedule'}
        </CardTitle>
        <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />{hu ? 'Frissítés' : 'Refresh'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {hu ? 'B csapat · következő 14 nap · a vezető által jelölt szabadnapok' :
          'Team B · next 14 days · manager-set days off'}
      </p>
    </CardHeader>
    <CardContent className="space-y-1.5 px-3 pb-3 sm:px-4">
      {error && <p role="alert" className="text-xs text-destructive">
        {hu ? 'A beosztás nem tölthető be: ' : 'Cannot verify schedule: '}{error}
      </p>}
      {loading && <p role="status" className="text-xs text-muted-foreground">
        {hu ? 'Beosztás ellenőrzése…' : 'Checking schedule…'}
      </p>}
      {!loading && !error && days.slice(0, expanded ? 14 : 3).map(day => {
        const kind = absent.get(day);
        return <div key={day} className={'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ' +
          (!kind ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20' : 'bg-muted/40')}>
          <span className="text-sm font-medium">{format(dateOf(day), hu ? 'MMM d., EEEE' : 'EEE, MMM d',
            hu ? { locale: huLocale } : {})}{day === from ? (hu ? ' · Ma' : ' · Today') : ''}</span>
          <Badge variant={kind ? 'secondary' : 'outline'} className={kind ? '' : 'border-emerald-300 text-emerald-800 dark:text-emerald-200'}>
            {!kind && <Check className="mr-1 h-3 w-3" />}{label(kind)}
          </Badge>
        </div>;
      })}
      {!loading && !error && <Button type="button" size="sm" variant="ghost" className="w-full"
        onClick={() => setExpanded(v => !v)}>
        {expanded ? (hu ? 'Kevesebb nap' : 'Show fewer') : (hu ? 'Mind a 14 nap' : 'Show all 14 days')}
      </Button>}
      <p className="text-[11px] text-muted-foreground">
        {hu ? 'Ha nem jelöltek szabadnapot, dolgozó napként jelenik meg. A bejelentkezés külön történik.' :
          'Working is the default when no leave is recorded. Check-in is separate.'}
      </p>
    </CardContent>
  </Card>;
}
