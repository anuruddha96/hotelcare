import { useCallback, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { useSlntSimplifiedHousekeeping } from '@/hooks/useSlntSimplifiedHousekeeping';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Person = { user_id: string; staff_name: string; is_working: boolean };

/** Compact manager-only SLNT widget, embedded in the existing Team View.
 * All active Team B housekeepers are working unless a manager marks Day off.
 * Other manager room / PMS / approval sections remain exactly as before.
 */
export function SlntTeamBAvailability() {
  const { language } = useTranslation();
  const hu = language === 'hu';
  const active = useSlntSimplifiedHousekeeping() === true;
  const [staff, setStaff] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const date = todayBudapest();

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    const { data, error: failure } = await (supabase as any)
      .rpc('slnt_team_b_active_staff', { p_date: date });
    if (failure) setError(failure.message);
    else { setStaff((data || []) as Person[]); setError(null); }
    setLoading(false);
  }, [date, active]);
  useEffect(() => { void load(); }, [load]);

  const setDayOff = async (person: Person) => {
    if (busy) return;
    setBusy(person.user_id);
    const { error: failure } = await (supabase as any).rpc('slnt_team_b_set_day_off', {
      p_user_id: person.user_id, p_work_date: date, p_is_off: person.is_working,
    });
    if (failure) {
      toast.error(failure.message);
    } else {
      toast.success(hu ? 'A mai elérhetőség mentve.' : "Today's availability saved");
    }
    await load();
    setBusy(null);
  };

  if (!active) return null;
  return (
    <Card data-training="slnt-team-b-availability" className="border-border/80">
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" />
            {hu ? 'B csapat – ma dolgozók' : 'Team B — working today'}
          </div>
          <span className="text-xs text-muted-foreground">
            {hu ? 'Alapértelmezés: mindenki dolgozik · csak a hiányzókat jelöld.' :
              'Everyone works by default · mark absences only'}
          </span>
        </div>
        {error && <p role="alert" className="text-sm text-destructive mb-2">{error}</p>}
        <div className="flex flex-wrap gap-2" data-training="slnt-team-b-staff-status">
          {staff.map(person => (
            <div key={person.user_id} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5">
              <span className="text-sm">{person.staff_name}</span>
              <Button size="sm" variant={person.is_working ? 'outline' : 'secondary'}
                disabled={loading || !!busy} onClick={() => void setDayOff(person)}
                aria-pressed={!person.is_working}>
                {person.is_working ? (hu ? 'Dolgozik · szabadnap' : 'Working · mark off')
                  : (hu ? 'Szabadnap · visszaállítás' : 'Day off · restore')}
              </Button>
            </div>
          ))}
          {!loading && staff.length===0 && !error &&
            <p className="text-xs text-muted-foreground">{hu ? 'Nincs aktív B csapattag.' : 'No active Team B cleaners.'}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
