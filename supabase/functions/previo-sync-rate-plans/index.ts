// Fill previo_rate_plan_mapping straight from Previo, so nobody has to type
// pricelist ids by hand before prices can be pushed back.

import { createClient } from "npm:@supabase/supabase-js@2";
import { syncPrevioRatePlanMappings } from "../_shared/previoRatePlans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = ["admin", "top_management", "top_management_manager"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
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
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ ok: false, error: "Not signed in" }, 401);
    const { data: userRes } = await admin.auth.getUser(token);
    const user = userRes?.user;
    if (!user) return json({ ok: false, error: "Not signed in" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("role, assigned_hotel")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) {
      return json({ ok: false, error: "You do not have permission to sync rate plans" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const hotelId: string | null = typeof body.hotelId === "string" ? body.hotelId : null;
    if (!hotelId) return json({ ok: false, error: "hotelId is required" }, 400);
    if (profile.role !== "admin" && profile.assigned_hotel && profile.assigned_hotel !== hotelId) {
      return json({ ok: false, error: "You can only sync your own hotel" }, 403);
    }

    const result = await syncPrevioRatePlanMappings(admin, hotelId);
    return json({
      ...result,
      error: result.ok ? null : result.notes.join(" "),
    });
  } catch (e) {
    console.error("previo-sync-rate-plans error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
