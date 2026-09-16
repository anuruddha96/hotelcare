import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { HousekeepingTabEnhanced } from './HousekeepingTabEnhanced';
import { GozsduLaundrynerTasks } from './GozsduLaundrynerTasks';
import { Button } from '@/components/ui/button';

type Props = ComponentProps<typeof HousekeepingTabEnhanced>;

/** Normal housekeeping is unchanged outside Gozsdu and on non-laundry days.
 * During a code-before-database rollout, the original tasks remain usable;
 * other database failures still fail closed to protect assigned work. */
export function HousekeepingTab(props: Props = {}) {
  const { user, profile } = useAuth();
  const [workDate, setWorkDate] = useState(todayBudapest);
  const [activeDuty, setActiveDuty] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const scoped = !!user?.id && !!profile?.organization_slug
    && isGozsduCourtHotel(profile.assigned_hotel)
    && (profile.role === 'housekeeping' || profile.acts_as_housekeeper === true);

  const refresh = useCallback(async () => {
    if (!scoped || !user?.id || !profile?.organization_slug) return;
    const { data, error } = await (supabase as any).from('gozsdu_laundry_duties')
      .select('user_id').eq('organization_slug', profile.organization_slug)
      .eq('hotel_id', 'gozsdu-court').eq('work_date', workDate)
      .eq('user_id', user.id).maybeSingle();
    if (error) {
      const missingTable = (error.code === '42P01' || error.code === 'PGRST205')
        && String(error.message || '').includes('gozsdu_laundry_duties');
      if (missingTable) {
        // A GitHub merge does not itself apply the new Supabase migrations.
        // Never disable the established housekeeping UI just for that rollout gap.
        setActiveDuty(false);
        setFailed(false);
        setReady(true);
        return;
      }
      console.error('[HousekeepingTab] Laundryner duty read failed', error);
      setFailed(true);
      setReady(true);
      return;
    }
    setActiveDuty(!!data);
    setFailed(false);
    setReady(true);
  }, [scoped, user?.id, profile?.organization_slug, workDate]);

  useEffect(() => {
    if (!scoped) return;
    setReady(false);
    void refresh();
    const channel = supabase.channel(`my-gozsdu-laundry-duty-${user?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gozsdu_laundry_duties' }, () => { void refresh(); })
      .subscribe();
    const poll = window.setInterval(() => {
      const date = todayBudapest();
      if (date !== workDate) setWorkDate(date);
      else void refresh();
    }, 20_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
      void supabase.removeChannel(channel);
    };
  }, [scoped, user?.id, workDate, refresh]);

  if (!scoped) return <HousekeepingTabEnhanced {...props} />;
  if (!ready) return <p className="p-4 text-sm text-muted-foreground">Checking Gozsdu housekeeping duty…</p>;
  if (failed) return <div role="alert" className="space-y-3 rounded-lg border p-4">
    <p className="text-sm">Cannot verify today's Laundryner duty. Tasks are hidden rather than showing incorrect cleaning assignments.</p>
    <Button variant="outline" size="sm" onClick={() => { setReady(false); void refresh(); }}>Retry</Button>
  </div>;
  return activeDuty ? <GozsduLaundrynerTasks /> : <HousekeepingTabEnhanced {...props} />;
}
