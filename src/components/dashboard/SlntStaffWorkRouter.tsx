import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSlntSimplifiedHousekeeping } from '@/hooks/useSlntSimplifiedHousekeeping';
import { supabase } from '@/integrations/supabase/client';
import { HousekeepingStaffView } from './HousekeepingStaffView';
import { SlntTeamBSharedWorklist } from './SlntTeamBSharedWorklist';

/** Only Team B substitutes a shared task queue; Team A keeps individual assignments. */
export function SlntStaffWorkRouter() {
  const { user, profile } = useAuth();
  const simplifiedEnabled = useSlntSimplifiedHousekeeping();
  const [isTeamB, setIsTeamB] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (!simplifiedEnabled || !user || !['slnt','slnt-group'].includes(profile?.organization_slug || '')) {
      setIsTeamB(false); return;
    }
    void (async () => {
      const { data, error: membershipError } = await (supabase as any).rpc('slnt_is_team_b_member');
      if (!current) return;
      if (membershipError) {
        setError(membershipError.message);
        setIsTeamB(null);
      } else { setError(null); setIsTeamB(data === true); }
    })();
    return () => { current = false; };
  }, [user?.id, profile?.organization_slug, simplifiedEnabled]);
  if (!simplifiedEnabled) return <HousekeepingStaffView />;
  if (error) return <div role="alert" className="rounded-md border border-destructive p-4 text-sm">
    {error} — {profile?.preferred_language === 'hu' ? 'A feladatlista nem tölthető be.' : 'Cannot load the team worklist.'}
  </div>;
  if (isTeamB === null) return <p className="p-4 text-sm text-muted-foreground">Loading housekeeping…</p>;
  return isTeamB ? <SlntTeamBSharedWorklist /> : <HousekeepingStaffView />;
}
