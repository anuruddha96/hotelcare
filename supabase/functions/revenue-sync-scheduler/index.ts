// Server-side revenue refresh scheduler.
//
// Runs every 5 minutes from pg_cron. Each run refreshes AT MOST ONE property:
// the one whose revenue data is oldest and older than 30 minutes. A global
// single-flight lease in `revenue_sync_state` guarantees that no two
// properties — across any organisation — are ever pulled from Previo at the
// same time. Users therefore never have to wait for a sync when they open the
// app: they always read the last stored data.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);

  const started = Date.now();
  let hotelId: string | null = null;

  try {
    // Global single-flight claim — returns nothing when another property is
    // already refreshing, or when everything is fresh.
    const { data: claim, error: claimErr } = await service.rpc("claim_next_revenue_sync", {});
    if (claimErr) throw new Error(claimErr.message);

    const row = Array.isArray(claim) ? claim[0] : claim;
    hotelId = row?.hotel_id ?? null;

    if (!hotelId) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const call = (fn: string, body: Record<string, unknown>) =>
      fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify(body),
      });

    const revResp = await call("previo-revenue-sync", { hotelId, horizonDays: 365 });
    const revJson = await revResp.json().catch(() => null);
    if (!revResp.ok || revJson?.success === false) {
      throw new Error(revJson?.errors?.[0] || revJson?.error || `Revenue sync failed (${revResp.status})`);
    }

    // Occupancy + friendly room-type names, best effort: a failure here must
    // not mark the property stale, the revenue pull already landed.
    await Promise.allSettled([
      call("previo-sync-daily-overview", { hotelId, days: 120 }),
      call("translate-room-types", { hotelId }),
      call("revenue-rate-alerts", { hotelId }),
    ]);

    return new Response(
      JSON.stringify({ ok: true, hotel_id: hotelId, ms: Date.now() - started }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (hotelId) {
      // Release the lease so the queue keeps moving; the property stays stale
      // and will be retried on a later tick.
      try {
        await service.rpc("complete_revenue_sync", {
          _hotel_id: hotelId,
          _success: false,
          _error: message,
        });
      } catch { /* lease expiry is the safety net */ }
    }
    console.error("revenue-sync-scheduler failed", message);
    return new Response(JSON.stringify({ ok: false, hotel_id: hotelId, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
