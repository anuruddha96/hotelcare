import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { isSlntOrganization } from '@/lib/slnt14DayHousekeeping';

/** Independent Team A release control. Leave off until SLNT confirms mapping. */
export function useSlntTeamAEnabled() {
  const { user, profile } = useAuth();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    setEnabled(false);
    if (!user?.id || !isSlntOrganization(profile?.organization_slug)) return;
    void (async () => {
      const { data, error } = await (supabase as any).rpc('slnt_team_a_housekeeping_enabled');
      if (current) setEnabled(!error && data === true);
    })();
    return () => { current = false; };
  }, [user?.id, profile?.organization_slug]);
  return enabled;
}
