import { useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { CalendarDays, Clock, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Shift = { id: string; work_date: string; shift_start: string; shift_end: string; status: string; notes: string | null; staff_schedule_venues?: { venues: { name: string } | null }[] };

export function UpcomingShiftCard() {
  const { user } = useAuth();
  const { venuesEnabled } = useTenantFeatures();
  const [shifts, setShifts] = useState<Shift[]>([]);
  useEffect(() => {
    if (!venuesEnabled || !user?.id) return;
    const from = format(new Date(), 'yyyy-MM-dd');
    const to = format(addDays(new Date(), 14), 'yyyy-MM-dd');
    (supabase as any).from('staff_schedules')
      .select('id,work_date,shift_start,shift_end,status,notes,staff_schedule_venues(venues(name))')
      .eq('user_id', user.id).eq('status', 'published').gte('work_date', from).lte('work_date', to).order('work_date').then(({ data }: any) => setShifts(data ?? []));
  }, [venuesEnabled, user?.id]);
  if (!venuesEnabled) return null;
  return <Card className="w-full max-w-md mx-auto"><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4" />Upcoming schedule</CardTitle></CardHeader><CardContent className="space-y-2">
    {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No published shifts in the next two weeks.</p> : shifts.slice(0, 5).map((shift) => <div key={shift.id} className="rounded-md border p-2.5"><div className="flex items-center justify-between gap-2"><strong className="text-sm">{format(new Date(`${shift.work_date}T12:00:00`), 'EEE, MMM d')}</strong><Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />{shift.shift_start.slice(0,5)}–{shift.shift_end.slice(0,5)}</Badge></div><div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /><span>{shift.staff_schedule_venues?.map((v) => v.venues?.name).filter(Boolean).join(', ') || 'Venue to be confirmed'}</span></div>{shift.notes && <p className="mt-1 text-xs">{shift.notes}</p>}</div>)}
  </CardContent></Card>;
}