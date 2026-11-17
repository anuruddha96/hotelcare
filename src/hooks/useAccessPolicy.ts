import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePurchaseInvoiceAccess } from '@/hooks/usePurchaseInvoiceAccess';
import { capabilitiesFor, type AccessCapabilities } from '@/lib/accessPolicy';

/** What the signed-in person may see and do (role from the work schedule). */
export function useAccessPolicy(): AccessCapabilities {
  const { profile } = useAuth();
  return useMemo(
    () => capabilitiesFor(profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.role, (profile as { access_role?: string | null } | null)?.access_role, profile?.is_super_admin],
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type LiveCache = { org: string; live: boolean; at: number };
let liveCache: LiveCache | null = null;
const LIVE_TTL_MS = 5 * 60_000;

/** Clears the cached go-live state after it was switched. */
export function invalidateStaffScheduleLive() {
  liveCache = null;
}

/**
 * Whether housekeepers and maintenance staff may see their own work schedule
 * yet (switched on by HR / top management). The database enforces the same
 * rule, so a stale "true" here only shows an empty card.
 */
export function useStaffScheduleLive(): { live: boolean; loading: boolean } {
  const { profile } = useAuth();
  const org = profile?.organization_slug ?? '';
  const fresh = liveCache && liveCache.org === org && Date.now() - liveCache.at < LIVE_TTL_MS ? liveCache.live : null;
  const [state, setState] = useState<{ live: boolean; loading: boolean }>(
    fresh === null ? { live: false, loading: !!org } : { live: fresh, loading: false },
  );

  useEffect(() => {
    if (!org) { setState({ live: false, loading: false }); return; }
    if (liveCache && liveCache.org === org && Date.now() - liveCache.at < LIVE_TTL_MS) {
      setState({ live: liveCache.live, loading: false });
      return;
    }
    let cancelled = false;
    void db.from('workforce_settings').select('staff_schedule_live').eq('organization_slug', org).maybeSingle()
      .then(({ data, error }: { data: { staff_schedule_live?: boolean } | null; error: unknown }) => {
        // Before the migration the table does not exist: keep the schedule hidden.
        const live = !error && data?.staff_schedule_live === true;
        liveCache = { org, live, at: Date.now() };
        if (!cancelled) setState({ live, loading: false });
      });
    return () => { cancelled = true; };
  }, [org]);

  return state;
}

/** Housekeepers and maintenance staff see their own schedule only once it is live. */
export function useCanSeeOwnSchedule(): boolean {
  const { accessRole } = useAccessPolicy();
  const { live } = useStaffScheduleLive();
  if (accessRole !== 'housekeeping' && accessRole !== 'maintenance') return true;
  return live;
}

/**
 * Whether Purchase invoices may be opened (used for the Controlling landing
 * page). Follows the organization's module rollout (pi_module_access); the
 * result is shared and cached with the navigation and the route gate.
 */
export function useInvoicesAvailable(enabled: boolean): { available: boolean; loading: boolean } {
  // Exactly the decision of the /purchase-invoices route gate, so the first
  // screen can never send someone to a page that sends them back.
  const access = usePurchaseInvoiceAccess();
  if (!enabled) return { available: false, loading: false };
  return { available: access.hasAccess || access.isFinanceAdmin, loading: access.loading };
}

/** HotelCare runs the PMS itself (Channex) instead of Previo. Same rule as the module navigation. */
export function isNativePmsOrganization(organizationSlug: string | null | undefined): boolean {
  return organizationSlug === 'channex';
}

export type WorkforceScope = { accessLevel: 'org' | 'property' | 'self' | null; hotelId: string | null; loading: boolean };

/**
 * The work-schedule scope the database applies (workforce_access()). For
 * housekeeping managers and supervisors this is their own hotel, even after
 * they switched hotel for the day.
 */
export function useWorkforceScope(): WorkforceScope {
  const { profile } = useAuth();
  const [scope, setScope] = useState<WorkforceScope>({ accessLevel: null, hotelId: null, loading: true });
  const key = `${profile?.id ?? ''}|${profile?.assigned_hotel ?? ''}|${profile?.role ?? ''}`;

  useEffect(() => {
    if (!profile?.id) { setScope({ accessLevel: null, hotelId: null, loading: false }); return; }
    let cancelled = false;
    void db.rpc('workforce_access').then(({ data, error }: { data: Array<{ access_level?: string; hotel_id?: string | null }> | null; error: unknown }) => {
      if (cancelled) return;
      const row = !error && Array.isArray(data) ? data[0] : null;
      const level = row?.access_level === 'org' || row?.access_level === 'property' || row?.access_level === 'self' ? row.access_level : null;
      setScope({ accessLevel: level, hotelId: row?.hotel_id ?? null, loading: false });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return scope;
}
