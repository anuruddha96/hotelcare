import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const anon = createClient(SUPABASE_URL, ANON);
    const { data: userRes, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const service = createClient(SUPABASE_URL, SERVICE);

    const { hotelId } = await req.json();
    if (!hotelId || typeof hotelId !== "string") {
      return new Response(JSON.stringify({ error: "hotelId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: must be admin OR assigned to this hotel
    const { data: profile } = await service
      .from("profiles")
      .select("role, assigned_hotel")
      .eq("id", userRes.user.id)
      .maybeSingle();
    const isAdmin =
      profile?.role === "admin" || profile?.role === "top_management";
    if (!isAdmin && profile?.assigned_hotel !== hotelId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load PMS config for this hotel
    const { data: cfg } = await service
      .from("pms_configurations")
      .select("id, hotel_id, pms_type, pms_hotel_id, credentials_secret_name, is_active")
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .maybeSingle();

    if (!cfg) {
      return new Response(
        JSON.stringify({ error: "No Previo configuration for this hotel" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!cfg.credentials_secret_name && !Deno.env.get("PREVIO_API_USER") && !Deno.env.get("PREVIO_API_USERNAME")) {
      const errMsg = "Previo credentials not configured for this hotel";
      await service
        .from("pms_configurations")
        .update({
          last_test_at: new Date().toISOString(),
          last_test_status: "error",
          last_test_error: errMsg,
        })
        .eq("id", cfg.id);
      return new Response(JSON.stringify({ ok: false, error: errMsg }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startedAt = Date.now();
    const { response: resp, source } = await fetchPrevioWithAuth({
      credentialsSecretName: cfg.credentials_secret_name,
      path: "/rest/rooms",
      pmsHotelId: String(cfg.pms_hotel_id || ""),
    });
    const latencyMs = Date.now() - startedAt;

    if (!resp.ok) {
      const text = await resp.text();
      const msg = `Previo ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`;
      await service
        .from("pms_configurations")
        .update({
          last_test_at: new Date().toISOString(),
          last_test_status: "error",
          last_test_error: msg,
        })
        .eq("id", cfg.id);
      return new Response(JSON.stringify({ ok: false, error: msg, latencyMs }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await safePrevioJson<unknown>(resp, { path: "/rest/rooms", source });
    const roomCount = Array.isArray(data) ? data.length : 0;

    await service
      .from("pms_configurations")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_status: "ok",
        last_test_error: null,
      })
      .eq("id", cfg.id);

    return new Response(
      JSON.stringify({ ok: true, roomCount, latencyMs, credentialSource: source }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
