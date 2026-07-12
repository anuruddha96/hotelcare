// previo-outbound-worker
//
// Drains `pms_outbound_queue`: picks up to N pending items whose
// `next_attempt_at` has passed, marks them in_progress, delegates the
// actual Previo push to the existing `previo-update-room-status`
// edge function (so all Previo API logic stays in one place), and
// records success/failure with exponential backoff.
//
// Safe by construction: if a hotel has no pending items (which is true
// for every hotel at rollout — see F1 trigger gating), this function
// does nothing.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MAX_PER_TICK = 25;
const MAX_ATTEMPTS = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: items, error } = await supabase
      .from("pms_outbound_queue")
      .select("id, hotel_id, room_id, previo_room_id, target_status, attempts")
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(MAX_PER_TICK);

    if (error) return json({ error: error.message }, 500);
    if (!items || items.length === 0) return json({ ok: true, processed: 0 });

    let succeeded = 0;
    let failed = 0;

    for (const item of items) {
      // Claim the row.
      const { error: claimErr } = await supabase
        .from("pms_outbound_queue")
        .update({ status: "in_progress" })
        .eq("id", item.id)
        .eq("status", "pending");
      if (claimErr) continue;

      try {
        const { data: res, error: invErr } = await supabase.functions.invoke(
          "previo-update-room-status",
          { body: { roomId: item.room_id, status: item.target_status } },
        );
        if (invErr) throw new Error(invErr.message);
        if ((res as any)?.error) throw new Error(String((res as any).error));

        await supabase
          .from("pms_outbound_queue")
          .update({
            status: "succeeded",
            attempts: item.attempts + 1,
            completed_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", item.id);
        succeeded++;
      } catch (e) {
        const attempts = item.attempts + 1;
        const done = attempts >= MAX_ATTEMPTS;
        const backoffSec = Math.min(60 * 2 ** attempts, 60 * 60);
        await supabase
          .from("pms_outbound_queue")
          .update({
            status: done ? "failed" : "pending",
            attempts,
            next_attempt_at: new Date(Date.now() + backoffSec * 1000).toISOString(),
            last_error: String((e as Error).message ?? e).slice(0, 500),
          })
          .eq("id", item.id);
        failed++;
      }
    }

    return json({ ok: true, processed: items.length, succeeded, failed });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
