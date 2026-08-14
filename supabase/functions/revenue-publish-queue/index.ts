// Global publishing queue drainer.
//
// Price changes are durable the moment they are written as drafts. Delivery to
// Previo is serialized: only one worker anywhere may hold the publisher lease,
// so a run that met a busy publisher simply stays queued. This function wakes
// on a short cron, takes the single most urgent unfinished run in the whole
// system (manual change → pickup increase → reconciliation → markdown) and
// hands it to `revenue-push-drafts`. No browser tab is involved.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // The same master brake that pauses automation pauses delivery.
    const { data: config } = await admin
      .from("revenue_engine_config")
      .select("automation_enabled, publisher_lock_at")
      .eq("id", "global")
      .maybeSingle();
    if (config && config.automation_enabled === false) {
      return json({ ok: true, code: "paused", msg: "Revenue automation is paused." });
    }

    // Somebody is already publishing — leave the queue alone, we run again in
    // a few minutes. A stale lease is recovered by the lease claim itself.
    const lockedAt = config?.publisher_lock_at ? Date.parse(config.publisher_lock_at) : NaN;
    if (Number.isFinite(lockedAt) && Date.now() - lockedAt < 15 * 60_000) {
      return json({ ok: true, code: "busy", msg: "A publisher is already sending prices." });
    }

    const { data: claimed, error: claimErr } = await admin.rpc("claim_next_push_run", { p_stale_minutes: 10 });
    if (claimErr) throw claimErr;
    const run = (Array.isArray(claimed) ? claimed[0] : claimed) as
      | { run_id: string; hotel_id: string; priority: number }
      | null;
    if (!run?.run_id) {
      return json({ ok: true, code: "idle", msg: "Nothing is waiting to be published." });
    }

    // Only drafts that are still the newest intent for their cell are sent.
    const { data: drafts } = await admin
      .from("revenue_rate_drafts")
      .select("id")
      .eq("push_run_id", run.run_id)
      .in("status", ["draft", "failed"])
      .is("superseded_at", null)
      .limit(2000);
    const draftIds = ((drafts ?? []) as Array<{ id: string }>).map((d) => d.id);
    if (draftIds.length === 0) {
      await admin.from("revenue_rate_push_runs")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", run.run_id);
      return json({ ok: true, code: "superseded", runId: run.run_id, msg: "Nothing left to send for this job." });
    }

    const work = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-push-drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-engine-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      },
      body: JSON.stringify({ hotelId: run.hotel_id, pushRunId: run.run_id, draftIds }),
    }).catch((e) => console.error("queue drainer could not start push", run.run_id, e));

    const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (rt) rt.waitUntil(work); else await work;

    return json({
      ok: true, code: "started", runId: run.run_id, hotelId: run.hotel_id,
      priority: run.priority, drafts: draftIds.length,
    });
  } catch (e) {
    console.error("revenue-publish-queue failed", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
