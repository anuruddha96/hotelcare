import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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

    // Resolve credentials: prefer per-hotel secret, fall back to legacy env (OttoFiori)
    let user = "";
    let pass = "";
    if (cfg.credentials_secret_name) {
      const combined = Deno.env.get(cfg.credentials_secret_name) || "";
      const idx = combined.indexOf(":");
      if (idx > 0) {
        user = combined.slice(0, idx);
        pass = combined.slice(idx + 1);
      }
    }
    if (!user || !pass) {
      user = Deno.env.get("PREVIO_API_USER") || "";
      pass = Deno.env.get("PREVIO_API_PASSWORD") || "";
    }
    if (!user || !pass) {
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

    const auth = btoa(`${user}:${pass}`);
    const startedAt = Date.now();
    const resp = await fetch("https://api.previo.app/rest/rooms", {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Previo-Hotel-ID": String(cfg.pms_hotel_id || ""),
        "Content-Type": "application/json",
      },
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

    const data = await resp.json();
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
      JSON.stringify({ ok: true, roomCount, latencyMs }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
