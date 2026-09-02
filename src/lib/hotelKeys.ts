// Shared helpers for hotel identifiers.
//
// Legacy profiles / rooms may store either a canonical hotel slug such as
// "memories-budapest" or the human hotel name such as
// "Hotel Memories Budapest". Read queries therefore need ALL aliases, while
// write/integration actions should always use the canonical
// hotel_configurations.hotel_id.

import { supabase } from "@/integrations/supabase/client";

const keyCache = new Map<string, string[]>();
const canonicalCache = new Map<string, string>();

async function lookupHotelIdentity(value: string): Promise<{ hotel_id: string; hotel_name: string | null } | null> {
  try {
    const { data: bySlug } = await supabase
      .from("hotel_configurations")
      .select("hotel_id, hotel_name")
      .eq("hotel_id", value)
      .maybeSingle();
    if (bySlug?.hotel_id) return bySlug;
  } catch (_) { /* ignore and try legacy display-name key */ }

  try {
    const { data: byName } = await supabase
      .from("hotel_configurations")
      .select("hotel_id, hotel_name")
      .eq("hotel_name", value)
      .maybeSingle();
    if (byName?.hotel_id) return byName;
  } catch (_) { /* ignore */ }

  return null;
}

/** Resolve a slug OR legacy display name to the canonical hotel_id. */
export async function resolveCanonicalHotelId(
  assignedHotel: string | null | undefined,
): Promise<string | null> {
  if (!assignedHotel) return null;
  if (canonicalCache.has(assignedHotel)) return canonicalCache.get(assignedHotel)!;

  const identity = await lookupHotelIdentity(assignedHotel);
  const canonical = identity?.hotel_id || assignedHotel;
  canonicalCache.set(assignedHotel, canonical);
  canonicalCache.set(canonical, canonical);
  return canonical;
}

/**
 * Return every key variant that existing room/profile rows may use. Canonical
 * hotel_id is deliberately first so callers that need one preferred key do
 * not accidentally choose a legacy display name.
 */
export async function resolveHotelKeys(
  assignedHotel: string | null | undefined,
): Promise<string[]> {
  if (!assignedHotel) return [];
  if (keyCache.has(assignedHotel)) return keyCache.get(assignedHotel)!;

  const identity = await lookupHotelIdentity(assignedHotel);
  const canonical = identity?.hotel_id || assignedHotel;
  const keys = new Set<string>([canonical]);
  if (identity?.hotel_name) keys.add(identity.hotel_name);
  keys.add(assignedHotel);

  const arr = Array.from(keys).filter(Boolean);
  keyCache.set(assignedHotel, arr);
  keyCache.set(canonical, arr);
  canonicalCache.set(assignedHotel, canonical);
  canonicalCache.set(canonical, canonical);
  return arr;
}
