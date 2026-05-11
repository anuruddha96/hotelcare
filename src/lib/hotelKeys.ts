// Shared helper to resolve a profile's `assigned_hotel` (which may be a
// hotel slug like "memories-budapest") into ALL the keys the `rooms` /
// `profiles` / `assignments` tables might use for that hotel: the slug
// itself, plus the human hotel_name from `hotel_configurations`
// (e.g. "Hotel Memories Budapest").
//
// Some legacy rows store the slug; rooms imported via PMS sync usually
// store the full hotel_name. Filtering by .in('hotel', keys) makes both
// cases work without touching live data.

import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, string[]>();

export async function resolveHotelKeys(
  assignedHotel: string | null | undefined,
): Promise<string[]> {
  if (!assignedHotel) return [];
  if (cache.has(assignedHotel)) return cache.get(assignedHotel)!;

  const keys = new Set<string>([assignedHotel]);

  // Try slug -> name
  try {
    const { data: bySlug } = await supabase
      .from("hotel_configurations")
      .select("hotel_id, hotel_name")
      .eq("hotel_id", assignedHotel)
      .maybeSingle();
    if (bySlug?.hotel_name) keys.add(bySlug.hotel_name);
    if (bySlug?.hotel_id) keys.add(bySlug.hotel_id);
  } catch (_) { /* ignore */ }

  // Try name -> slug (in case profile already stores the name)
  try {
    const { data: byName } = await supabase
      .from("hotel_configurations")
      .select("hotel_id, hotel_name")
      .eq("hotel_name", assignedHotel)
      .maybeSingle();
    if (byName?.hotel_id) keys.add(byName.hotel_id);
    if (byName?.hotel_name) keys.add(byName.hotel_name);
  } catch (_) { /* ignore */ }

  const arr = Array.from(keys).filter(Boolean);
  cache.set(assignedHotel, arr);
  return arr;
}
