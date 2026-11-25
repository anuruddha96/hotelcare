/* eslint-disable @typescript-eslint/no-explicit-any -- the NAV/reconciliation tables are not in the generated Supabase types yet */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { canAccessLegacyModules } from '@/lib/roleAccess';

/**
 * Purchase-invoice module rollout, decided by the database (pi_module_access /
 * pi_can_control_nav) so navigation, routing and RLS agree. The UI only hides
 * what the server would refuse anyway.
 */
export interface PurchaseInvoiceAccess {
  loading: boolean;
  /** The module is enabled for this user (or the legacy pilot account). */
  hasAccess: boolean;
  /** Controlling / admins: NAV status, sync, reconciliation decisions. */
  canControlNav: boolean;
  /** Organization finance admin: module settings and NAV credentials. */
  isFinanceAdmin: boolean;
}

type Cached = { userId: string; value: Omit<PurchaseInvoiceAccess, 'loading'>; at: number };
let cache: Cached | null = null;
let inflight: Promise<Cached['value']> | null = null;
const TTL_MS = 5 * 60_000;

async function fetchAccess(legacy: boolean): Promise<Cached['value']> {
  // New rollout RPCs are not in the generated types yet.
  const db = supabase as any;
  const [access, control, admin] = await Promise.all([
    db.rpc('pi_module_access'),
    db.rpc('pi_can_control_nav'),
    db.rpc('fin_is_admin'),
  ]);
  // Before the rollout migration is deployed the RPC does not exist: keep the legacy pilot gate.
  if (access.error) return { hasAccess: legacy, canControlNav: legacy, isFinanceAdmin: legacy };
  return {
    hasAccess: access.data === true,
    canControlNav: control.data === true,
    isFinanceAdmin: admin.data === true,
  };
}

/** Clears the cached decision (e.g. after an admin changes the rollout settings). */
export function invalidatePurchaseInvoiceAccess() {
  cache = null;
  inflight = null;
}

export function usePurchaseInvoiceAccess(): PurchaseInvoiceAccess {
  const { user, profile } = useAuth();
  const legacy = canAccessLegacyModules(profile?.nickname);
  const fresh = cache && user && cache.userId === user.id && Date.now() - cache.at < TTL_MS ? cache.value : null;
  const [state, setState] = useState<PurchaseInvoiceAccess>(
    fresh ? { loading: false, ...fresh } : { loading: !!user, hasAccess: false, canControlNav: false, isFinanceAdmin: false },
  );

  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) { setState({ loading: false, hasAccess: false, canControlNav: false, isFinanceAdmin: false }); return; }
    if (cache && cache.userId === userId && Date.now() - cache.at < TTL_MS) { setState({ loading: false, ...cache.value }); return; }
    let cancelled = false;
    inflight = inflight ?? fetchAccess(legacy);
    inflight
      .then((value) => {
        cache = { userId, value, at: Date.now() };
        if (!cancelled) setState({ loading: false, ...value });
      })
      .catch(() => { if (!cancelled) setState({ loading: false, hasAccess: legacy, canControlNav: false, isFinanceAdmin: false }); })
      .finally(() => { inflight = null; });
    return () => { cancelled = true; };
  }, [userId, legacy]);

  return state;
}
