import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { earliestBusinessDay } from '@/lib/businessMoment';

export interface BackdatingPolicy {
  allowed: boolean;
  minimum: string | undefined;
}

const DEFAULT_POLICY: BackdatingPolicy = { allowed: false, minimum: undefined };
const MANAGE_ROLES = new Set(['admin', 'top_management', 'top_management_manager', 'manager']);

/** This controls visibility only; every dated write is authorized again inside PostgreSQL. */
export function useNtakBackdating(hotelId?: string | null): BackdatingPolicy {
  const [policy, setPolicy] = useState<BackdatingPolicy>(DEFAULT_POLICY);
  useEffect(() => {
    let alive = true;
    setPolicy(DEFAULT_POLICY);
    if (!hotelId) return;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const [{ data: profile }, { data: settings }] = await Promise.all([
        supabase.from('profiles').select('role,is_super_admin,nickname,organization_slug').eq('id', auth.user.id).maybeSingle(),
        (supabase.from as CallableFunction)('ntak_settings')
          .select('allow_backdating,backdating_min_date,first_closure_date')
          .eq('hotel_id', hotelId).maybeSingle(),
      ]);
      if (!alive) return;
      const canManage = !!profile && (
        profile.is_super_admin === true
        || MANAGE_ROLES.has(String(profile.role))
        || (profile.organization_slug === 'rdhotels' && String(profile.nickname ?? '').toLowerCase() === 'anu_000')
      );
      setPolicy({
        allowed: canManage && settings?.allow_backdating === true,
        minimum: earliestBusinessDay(settings?.first_closure_date, settings?.backdating_min_date),
      });
    })().catch(() => { if (alive) setPolicy(DEFAULT_POLICY); });
    return () => { alive = false; };
  }, [hotelId]);
  return policy;
}
