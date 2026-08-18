// Fan-out refresher for the live Daily Overview (breakfast) data.
// Called by pg_cron every 15 minutes and by the "Refresh now" button on the
// BB page. Loops over every hotel with an active Previo configuration and
// invokes previo-sync-daily-overview with the service token.
//
// Bounded work: one pass over the active Previo hotels (a handful), a short
// window per hotel, sequential calls. No self-invocation, no queue.

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

  try {
    const body = await req.json().catch(() => ({} as any));
    const days = Math.min(Math.max(Number(body.days) || 3, 1), 60);
    const only: string | null = body.hotelId || null;

    let query = service
      .from("pms_configurations")
      .select("hotel_id")
      .eq("pms_type", "previo")
      .eq("is_active", true);
    if (only) query = query.eq("hotel_id", only);
    const { data: cfgs, error } = await query;
    if (error) throw error;

    const results: any[] = [];
    for (const c of cfgs ?? []) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/previo-sync-daily-overview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE}`,
            apikey: SERVICE,
          },
          body: JSON.stringify({ hotelId: c.hotel_id, days }),
        });
        const json = await res.json().catch(() => ({}));
        results.push({ hotel_id: c.hotel_id, ok: json?.ok !== false, rows: json?.rowsInserted ?? 0, error: json?.error ?? null });
      } catch (e: any) {
        results.push({ hotel_id: c.hotel_id, ok: false, error: e?.message || String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, days, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
