import { useEffect, useState } from 'react';
import { callNtak, type NtakStatus } from '@/components/ntak/ntakApi';
import { earliestBusinessDay } from '@/lib/businessMoment';

export interface BackdatingPolicy {
  allowed: boolean;
  minimum: string | undefined;
}

const DEFAULT_POLICY: BackdatingPolicy = { allowed: false, minimum: undefined };

/** Visibility only; every write is independently authorized in PostgreSQL.
 * The NTAK status API uses the existing MANAGE_ROLES and hotel-access checks,
 * so the frontend does not need direct SELECT privileges on ntak_settings.
 */
export function useNtakBackdating(hotelId?: string | null): BackdatingPolicy {
  const [policy, setPolicy] = useState<BackdatingPolicy>(DEFAULT_POLICY);
  useEffect(() => {
    let alive = true;
    setPolicy(DEFAULT_POLICY);
    if (!hotelId) return;
    callNtak<NtakStatus>({ action: 'status', hotel_id: hotelId })
      .then(({ can_manage, settings }) => {
        if (!alive) return;
        setPolicy({
          allowed: can_manage && settings?.allow_backdating === true,
          minimum: earliestBusinessDay(settings?.first_closure_date, settings?.backdating_min_date),
        });
      })
      .catch(() => { if (alive) setPolicy(DEFAULT_POLICY); });
    return () => { alive = false; };
  }, [hotelId]);
  return policy;
}
