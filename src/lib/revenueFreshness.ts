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

/** Newest successful revenue pull for one property. */
export async function fetchRevenueSyncInfo(hotelId: string): Promise<RevenueSyncInfo> {
  const { data } = await supabase
    .from("pms_sync_history")
    .select("created_at, synced_by_name")
    .eq("hotel_id", hotelId)
    .in("sync_type", REVENUE_SYNC_TYPES as unknown as string[])
    .in("sync_status", ["success", "partial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as { created_at?: string; synced_by_name?: string | null } | null;
  const at = row?.created_at ?? null;
  return {
    at,
    by: row?.synced_by_name ?? null,
    stale: !at || Date.now() - new Date(at).getTime() > REVENUE_STALE_MS,
  };
}
