import { useCallback, useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { CalendarDays, Clock, MapPin, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
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
  const { venuesEnabled, orgSlug } = useTenantFeatures();
  const [shifts, setShifts] = useState<Shift[]>([]);
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
  }, [venuesEnabled, user?.id, profile?.organization_slug, profile?.assigned_hotel, slnt, from, to]);

  useEffect(() => { let active = true; void refresh(() => active); return () => { active = false; }; }, [refresh]);
  if (!venuesEnabled) return null;

  // Preserve the existing compact card for all tenants other than SLNT.
  if (!slnt) return <Card className="w-full max-w-md mx-auto"><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4" />Upcoming schedule</CardTitle></CardHeader><CardContent className="space-y-2">
    {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No published shifts in the next two weeks.</p> : shifts.slice(0, 5).map((shift) => <div key={shift.id} className="rounded-md border p-2.5"><div className="flex items-center justify-between gap-2"><strong className="text-sm">{format(dateOf(shift.work_date), 'EEE, MMM d')}</strong><Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />{shift.shift_start.slice(0,5)}–{shift.shift_end.slice(0,5)}</Badge></div><div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /><span>{shift.staff_schedule_venues?.map((v) => v.venues?.name).filter(Boolean).join(', ') || 'Venue to be confirmed'}</span></div>{shift.notes && <p className="mt-1 text-xs">{shift.notes}</p>}</div>)}
  </CardContent></Card>;

  const shiftByDay = new Map(shifts.map((shift) => [shift.work_date, shift]));
  const days = Array.from({ length: 14 }, (_, i) => format(addDays(dateOf(from), i), 'yyyy-MM-dd'));
  return <Card className="w-full"><CardHeader className="pb-2"><div className="flex items-center justify-between gap-2"><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4" />My work schedule</CardTitle><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button></div><p className="text-xs text-muted-foreground">Only your own published shifts · Budapest local time · next 14 days</p></CardHeader>
    <CardContent className="space-y-2">
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {loading ? <p role="status" className="text-sm text-muted-foreground">Loading your schedule…</p>
        : days.slice(0, expanded ? days.length : 3).map((day) => {
          const shift = shiftByDay.get(day);
          return <div key={day} className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 ${day === from ? 'border-primary/40 bg-primary/5' : ''}`}>
            <div className="min-w-28"><div className="text-sm font-semibold">{format(dateOf(day), 'EEE, MMM d')}{day === from ? ' · Today' : ''}</div>
              {shift ? <div className="mt-1 text-xs text-muted-foreground flex items-start gap-1"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /><span>{shift.staff_schedule_venues?.map((link) => link.venues?.name).filter(Boolean).join(', ') || 'Venue to be confirmed'}</span></div> : <span className="text-xs text-muted-foreground">No published shift</span>}
              {shift?.notes && <p className="mt-1 text-xs">{shift.notes}</p>}
            </div>{shift && <Badge className="gap-1"><Clock className="h-3 w-3" />{shift.shift_start.slice(0, 5)}–{shift.shift_end.slice(0, 5)}</Badge>}
          </div>;
        })}
      {!loading && <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => setExpanded(old => !old)}>{expanded ? 'Show next 3 days' : 'Show all 14 days'}</Button>}
      <p className="text-xs text-muted-foreground">If a day is blank, your manager has not published a shift for that day. Room assignments appear separately in Housekeeping.</p>
    </CardContent>
  </Card>;
}
