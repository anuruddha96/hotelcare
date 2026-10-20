import { useCallback, useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { CalendarDays, Clock, MapPin, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSlntSimplifiedHousekeeping } from '@/hooks/useSlntSimplifiedHousekeeping';
import { useSlntTeamAEnabled } from '@/hooks/useSlntTeamAEnabled';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
import { useTranslation } from '@/hooks/useTranslation';
import { resolveCanonicalHotelId } from '@/lib/hotelKeys';
import { todayBudapest } from '@/lib/budapestTime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Shift = {
  id: string; work_date: string; shift_start: string; shift_end: string; status: string;
  notes: string | null; staff_schedule_venues?: { venues: { name: string } | null }[];
};
const isSlnt = (slug: string | null | undefined) => slug === 'slnt' || slug === 'slnt-group';
const dateOf = (date: string) => new Date(`${date}T12:00:00`);

/** Read-only self view; staff never query or receive colleagues' shifts or draft plans. */
export function UpcomingShiftCard() {
  const { user, profile } = useAuth();
  const simplifiedReady = useSlntSimplifiedHousekeeping() === true;
  const teamAReady = useSlntTeamAEnabled();
  const simplifiedEnabled = simplifiedReady && teamAReady;
  const { language } = useTranslation();
  const { venuesEnabled, orgSlug } = useTenantFeatures();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [slntAssignments, setSlntAssignments] = useState<Array<{ assignment_date: string; room_id: string; status: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const slnt = isSlnt(orgSlug ?? profile?.organization_slug);
  const from = slnt ? todayBudapest() : format(new Date(), 'yyyy-MM-dd');
  const to = format(addDays(dateOf(from), 13), 'yyyy-MM-dd');

  const refresh = useCallback(async (isActive: () => boolean = () => true) => {
    if (!venuesEnabled || !user?.id) { if (isActive()) setShifts([]); return; }
    setLoading(true);
    setError('');
    try {
      if (slnt && simplifiedEnabled) {
        const { data: tasks, error: tasksError } = await supabase.from('room_assignments')
          .select('assignment_date,room_id,status').eq('assigned_to', user.id)
          .in('organization_slug', ['slnt','slnt-group']).gte('assignment_date',from)
          .lte('assignment_date',to).neq('status','cancelled');
        if (tasksError) throw tasksError;
        if (isActive()) setSlntAssignments(tasks || []);
        return;
      }
      let query = (supabase as any).from('staff_schedules')
        .select('id,work_date,shift_start,shift_end,status,notes,staff_schedule_venues(venues(name))')
        .eq('user_id', user.id).eq('status', 'published')
        .gte('work_date', from).lte('work_date', to).order('work_date');
      if (slnt) {
        if (!profile?.organization_slug) throw new Error('Your organization is not configured.');
        query = query.eq('organization_slug', profile.organization_slug);
        if (profile.assigned_hotel) {
          const hotelId = await resolveCanonicalHotelId(profile.assigned_hotel);
          if (!isActive()) return;
          if (hotelId) query = query.eq('hotel_id', hotelId);
        }
      }
      const { data, error: queryError } = await query;
      if (queryError) throw new Error(queryError.message);
      if (isActive()) setShifts(data ?? []);
    } catch (cause) {
      if (isActive()) { setShifts([]); setError(cause instanceof Error ? cause.message : 'Could not load your shifts.'); }
    } finally { if (isActive()) setLoading(false); }
  }, [venuesEnabled, user?.id, profile?.organization_slug, profile?.assigned_hotel, slnt, from, to, simplifiedEnabled]);

  useEffect(() => { let active = true; void refresh(() => active); return () => { active = false; }; }, [refresh]);
  if (!venuesEnabled) return null;

  // Preserve the existing compact card for all tenants other than SLNT.
  if (!slnt) return <Card className="w-full max-w-md mx-auto"><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4" />Upcoming schedule</CardTitle></CardHeader><CardContent className="space-y-2">
    {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No published shifts in the next two weeks.</p> : shifts.slice(0, 5).map((shift) => <div key={shift.id} className="rounded-md border p-2.5"><div className="flex items-center justify-between gap-2"><strong className="text-sm">{format(dateOf(shift.work_date), 'EEE, MMM d')}</strong><Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />{shift.shift_start.slice(0,5)}–{shift.shift_end.slice(0,5)}</Badge></div><div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /><span>{shift.staff_schedule_venues?.map((v) => v.venues?.name).filter(Boolean).join(', ') || 'Venue to be confirmed'}</span></div>{shift.notes && <p className="mt-1 text-xs">{shift.notes}</p>}</div>)}
  </CardContent></Card>;

  // SLNT Team A: future dates are browsable; no published shift is required.
  // Until rollout is approved, preserve the exact existing SLNT schedule UI.
  if (slnt && !simplifiedEnabled) {
  const isHungarian = language === 'hu';
  const copy = isHungarian ? {
    title: 'Munkaidő-beosztásom',
    refresh: 'Frissítés',
    summary: 'Közzétett műszakok · budapesti idő · következő 14 nap',
    loading: 'Beosztás betöltése…',
    error: 'Nem sikerült betölteni a beosztást. Próbáld újra.',
    today: 'Ma',
    locationPending: 'Helyszín egyeztetés alatt',
    noShift: 'Nincs közzétett műszak',
    expand: 'Mind a 14 nap megtekintése',
    collapse: 'Csak a következő 3 nap',
    help: 'Itt csak a közzétett beosztásod látható. A szobafeladatokat a Takarítás menüben találod.',
  } : {
    title: 'My work schedule',
    refresh: 'Refresh',
    summary: 'Published shifts · Budapest time · next 14 days',
    loading: 'Loading your schedule…',
    error: 'Unable to load your schedule. Please try again.',
    today: 'Today',
    locationPending: 'Venue to be confirmed',
    noShift: 'No published shift',
    expand: 'Show all 14 days',
    collapse: 'Show next 3 days',
    help: 'Only published shifts appear here. Room assignments are available in Housekeeping.',
  };
  const shiftByDay = new Map(shifts.map((shift) => [shift.work_date, shift]));
  const days = Array.from({ length: 14 }, (_, i) => format(addDays(dateOf(from), i), 'yyyy-MM-dd'));
  return <Card className="w-full">
    <CardHeader className="pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4" />{copy.title}</CardTitle>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />{copy.refresh}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{copy.summary}</p>
    </CardHeader>
    <CardContent className="space-y-2">
      {error && <p className="text-sm text-destructive" role="alert">{copy.error}</p>}
      {loading ? <p role="status" className="text-sm text-muted-foreground">{copy.loading}</p>
        : days.slice(0, expanded ? days.length : 3).map((day) => {
          const shift = shiftByDay.get(day);
          return <div key={day} className={`rounded-lg border px-3 py-2.5 ${day === from ? 'border-sky-300 bg-sky-50/60 dark:bg-sky-950/20' : 'border-border'}`}>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="text-sm font-semibold capitalize">
                {isHungarian
                  ? format(dateOf(day), 'MMM d., EEEE', { locale: hu })
                  : format(dateOf(day), 'EEE, MMM d')}
                {day === from ? ` · ${copy.today}` : ''}
              </div>
              {shift && <Badge className="gap-1"><Clock className="h-3 w-3" />{shift.shift_start.slice(0, 5)}–{shift.shift_end.slice(0, 5)}</Badge>}
            </div>
            {shift ? <>
              <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 break-words">{shift.staff_schedule_venues?.map((link) => link.venues?.name).filter(Boolean).join(', ') || copy.locationPending}</span>
              </div>
              {shift.notes && <p className="mt-1 text-xs">{shift.notes}</p>}
            </> : <p className="mt-1 text-xs text-muted-foreground">{copy.noShift}</p>}
          </div>;
        })}
      {!loading && <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => setExpanded((old) => !old)}>
        {expanded ? copy.collapse : copy.expand}
      </Button>}
      <p className="text-xs leading-relaxed text-muted-foreground">{copy.help}</p>
    </CardContent>
  </Card>;
  }
  const isHungarian = language === 'hu';
  const days = Array.from({ length: 14 }, (_, i) => format(addDays(dateOf(from), i), 'yyyy-MM-dd'));
  const counts = new Map<string, number>();
  for (const task of slntAssignments) counts.set(task.assignment_date, (counts.get(task.assignment_date) || 0) + 1);
  return <Card className="w-full" data-training="slnt-staff-next-days">
    <CardHeader className="pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4" />{isHungarian ? 'Következő takarítási napjaim' : 'My upcoming cleaning days'}
        </CardTitle>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />{isHungarian ? 'Frissítés' : 'Refresh'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{isHungarian ? 'Kattints egy napra a feladatok megnyitásához. Nincs szükség közzétett műszakra.' : 'Select any day to open its tasks. Published shifts are not required.'}</p>
    </CardHeader>
    <CardContent className="space-y-2">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {days.slice(0, expanded ? 14 : 3).map(day => (
        <button type="button" key={day} data-training="slnt-staff-future-day"
          onClick={() => window.dispatchEvent(new CustomEvent('hotelcare:slnt-staff-date', { detail: { date: day } }))}
          className="flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left text-sm hover:bg-muted"
        >
          <span>{isHungarian ? format(dateOf(day), 'MMM d., EEEE', { locale: hu }) : format(dateOf(day), 'EEE, MMM d')}</span>
          <Badge variant="secondary">{counts.get(day) || 0} {isHungarian ? 'feladat' : 'tasks'}</Badge>
        </button>
      ))}
      <Button size="sm" variant="ghost" className="w-full" onClick={() => setExpanded(value => !value)}>
        {expanded ? (isHungarian ? 'Kevesebb nap' : 'Show fewer') : (isHungarian ? 'Mind a 14 nap' : 'Show all 14 days')}
      </Button>
    </CardContent>
  </Card>;
}
