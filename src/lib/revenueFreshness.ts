import { supabase } from "@/integrations/supabase/client";

/**
 * Shared "how fresh is this property's revenue data" rule.
 *
 * Two different Previo pulls write history rows — the full revenue sync
 * (`revenue_sync`) and the lighter live pull (`revenue_live`) — so a property
 * that had only ever been refreshed by one of them looked as if it had never
 * synced at all.
 *
 * Freshness is tracked per property (a venue never inherits another venue's
 * sync), and anything older than 30 minutes is considered stale: the next
 * person who opens the page pulls once for the whole team.
 */
export const REVENUE_SYNC_TYPES = ["revenue_sync", "revenue_live"] as const;

/** Data older than this triggers an automatic refresh. */
export const REVENUE_STALE_MS = 30 * 60 * 1000;

export interface RevenueSyncInfo {
  at: string | null;
  by: string | null;
  /** true when there is no sync, or the newest one is older than 30 minutes. */
  stale: boolean;
}

export type RevenueSyncClaim = "fresh" | "already_running" | "claimed";

/** Atomically decide whether this browser should start the property refresh. */
export async function claimRevenueSync(hotelId: string): Promise<RevenueSyncClaim> {
  const { data, error } = await (supabase as any).rpc("claim_revenue_sync", {
    _hotel_id: hotelId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row?.status ?? "already_running") as RevenueSyncClaim;
}

/** Newest successful revenue pull for one property. */
export async function fetchRevenueSyncInfo(hotelId: string): Promise<RevenueSyncInfo> {
  const { data } = await (supabase as any)
    .from("revenue_sync_state")
    .select("last_success_at, lease_expires_at")
    .eq("hotel_id", hotelId)
    .maybeSingle();

  const row = data as { last_success_at?: string } | null;
  const at = row?.last_success_at ?? null;
  return {
    at,
    by: null,
    stale: !at || Date.now() - new Date(at).getTime() > REVENUE_STALE_MS,
  };
}
