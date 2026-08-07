import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { UnitMapping } from '@/lib/slntUnitMapping';

type PmsAccount = { id: string; label: string; pms_hotel_id: string };

/** SLNT-only: draft Previo unit mappings awaiting manager verification. */
export function useUnitMappings() {
  const { profile } = useAuth();
  const orgSlug = profile?.organization_slug ?? '';
  const [mappings, setMappings] = useState<UnitMapping[]>([]);
  const [accounts, setAccounts] = useState<PmsAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgSlug) return;
    setLoading(true);
    const [{ data: rows }, { data: accs }] = await Promise.all([
      supabase
        .from('pms_unit_mappings')
        .select('*')
        .eq('organization_slug', orgSlug)
        .order('pms_hotel_id')
        .order('suggested_venue_name')
        .order('source_name'),
      supabase
        .from('pms_accounts')
        .select('id, label, pms_hotel_id')
        .eq('organization_slug', orgSlug)
        .order('pms_hotel_id'),
    ]);
    setMappings((rows ?? []) as unknown as UnitMapping[]);
    setAccounts((accs ?? []) as PmsAccount[]);
    setLoading(false);
  }, [orgSlug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { mappings, accounts, loading, refresh, orgSlug };
}
