// Shared helpers for saving price drafts and sending them to Previo.
//
// The rate grid, the bulk editor and the pickup movement board all do the same
// two things: write drafts, then (optionally) push exactly those drafts. Keeping
// it in one place means a fix to the push path applies everywhere.
import { supabase } from "@/integrations/supabase/client";

export interface DraftChange {
  stay_date: string;
  obk_id: string | null;
  room_type_name: string;
  occupancy: number;
  old_price: number | null;
  new_price: number;
}

/** Upsert drafts (one per date/room type/occupancy) and return their ids. */
export async function saveRateDrafts(opts: {
  hotelId: string;
  organizationSlug?: string | null;
  changes: DraftChange[];
}): Promise<string[]> {
  if (opts.changes.length === 0) return [];
  const { data: auth } = await supabase.auth.getUser();
  const rows = opts.changes.map((c) => ({
    hotel_id: opts.hotelId,
    organization_slug: opts.organizationSlug ?? null,
    stay_date: c.stay_date,
    obk_id: c.obk_id,
    room_type_name: c.room_type_name,
    occupancy: c.occupancy,
    old_price: c.old_price,
    new_price: c.new_price,
    status: "draft",
    push_error: null,
    created_by: auth.user?.id ?? null,
  }));
  const ids: string[] = [];
  for (const row of rows) {
    const { data: existing, error: readError } = await supabase
      .from("revenue_rate_drafts")
      .select("id")
      .eq("hotel_id", row.hotel_id)
      .eq("stay_date", row.stay_date)
      .eq("room_type_name", row.room_type_name)
      .eq("occupancy", row.occupancy)
      .in("status", ["draft", "failed"])
      .maybeSingle();
    if (readError) throw readError;

    const write = existing?.id
      ? supabase.from("revenue_rate_drafts").update(row).eq("id", existing.id).select("id").single()
      : supabase.from("revenue_rate_drafts").insert(row).select("id").single();
    const { data, error } = await write;
    if (error) throw error;
    if (data?.id) ids.push(data.id);
  }
  return ids;
}

export interface PushOutcome {
  pushed: number;
  failed: number;
  errors?: Array<{ stay_date: string; room_type_name: string; error: string }>;
}

/** Send the given drafts to Previo. Throws with Previo's own message on refusal. */
export async function pushRateDrafts(hotelId: string, draftIds: string[]): Promise<PushOutcome> {
  const { data, error } = await supabase.functions.invoke("revenue-push-drafts", {
    body: { hotelId, draftIds },
  });
  if (error) throw error;
  const res = data as {
    ok?: boolean; pushed?: number; failed?: number; error?: string;
    errors?: Array<{ stay_date: string; room_type_name: string; error: string }>;
  };
  if (res?.error || res?.ok === false) throw new Error(res?.error || "Previo refused the price push.");
  return { pushed: res?.pushed ?? 0, failed: res?.failed ?? 0, errors: res?.errors };
}
