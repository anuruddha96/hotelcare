import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { invalidateStaffScheduleLive } from '@/hooks/useAccessPolicy';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type State = { live: boolean; changedAt: string | null } | null;

/**
 * Housekeepers and maintenance staff do not see the work schedule until it is
 * put live here (after the manager trainings). HR, top management and
 * administrators only; the database refuses anyone else.
 */
export function StaffScheduleGoLiveCard() {
  const { profile } = useAuth();
  const org = profile?.organization_slug ?? '';
  const [state, setState] = useState<State>(null);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!org) return;
    void db.from('workforce_settings').select('staff_schedule_live,staff_schedule_live_changed_at').eq('organization_slug', org).maybeSingle()
      .then(({ data, error }: { data: { staff_schedule_live?: boolean; staff_schedule_live_changed_at?: string | null } | null; error: { message?: string } | null }) => {
        if (error) { setMissing(true); setState({ live: false, changedAt: null }); return; }
        setState({ live: data?.staff_schedule_live === true, changedAt: data?.staff_schedule_live_changed_at ?? null });
      });
  }, [org]);

  const toggle = async (live: boolean) => {
    setSaving(true);
    const { error } = await db.rpc('set_workforce_staff_schedule_live', { _live: live });
    setSaving(false);
    if (error) { toast.error(error.message || 'Could not change the setting'); return; }
    invalidateStaffScheduleLive();
    setState({ live, changedAt: new Date().toISOString() });
    toast.success(live ? 'Housekeepers and maintenance staff can now see their schedule' : 'The schedule is hidden from housekeepers and maintenance staff again');
  };

  return (
    <Card className="xl:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {state?.live ? <Eye className="h-4 w-4 text-emerald-600" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
          Schedule for housekeepers and maintenance
        </CardTitle>
        <CardDescription>
          While this is off, housekeepers and maintenance staff do not see the work schedule at all — not in the app and
          not through Mira. Switch it on once the manager trainings are done and the schedule is ready to share.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {state === null ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
          <>
            <Switch id="staff-schedule-live" checked={state.live} disabled={saving || missing} onCheckedChange={(v) => void toggle(v)} />
            <Label htmlFor="staff-schedule-live" className="text-sm">
              {state.live ? 'Live — staff see their own published shifts' : 'Not live — hidden from staff'}
            </Label>
            {state.changedAt && <span className="text-xs text-muted-foreground">Changed {new Date(state.changedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
            {missing && <span className="text-xs text-amber-700">The database update for this switch is not installed yet.</span>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
