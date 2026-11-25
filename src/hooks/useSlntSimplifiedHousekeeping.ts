import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { isSlntOrganization } from '@/lib/slnt14DayHousekeeping';

/**
 * Safe-by-default release gate. A merged frontend must not expose new SLNT
 * workflows before the migration, Team A mappings and acceptance sign-off.
 * Read-only RPC; missing RPC, sign-out or network error means legacy mode.
 */
export function useSlntSimplifiedHousekeeping(): boolean | null {
  const { user, profile } = useAuth();
  const org = profile?.organization_slug;
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    setReady(isSlntOrganization(org) && !!user?.id ? null : false);
    if (!user?.id || !isSlntOrganization(org)) return;
    void (async () => {
      try {
        const { data, error } = await (supabase as any).rpc('slnt_simple_housekeeping_enabled', { p_org: 'slnt' });
        if (active) setReady(!error && data === true);
      } catch {
        if (active) setReady(false);
      }
    })();
    return () => { active = false; };
  }, [user?.id, org]);
  return ready;
}
