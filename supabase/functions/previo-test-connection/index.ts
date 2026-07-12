import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";
import {
  loadPrevioCredentials,
  callPrevioXml,
  PrevioCredentialParseError,
} from "../_shared/previoCredentials.ts";

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

    const recordResult = async (
      status: "ok" | "error",
      errorMessage: string | null,
    ) => {
      await service
        .from("pms_configurations")
        .update({
          last_test_at: new Date().toISOString(),
          last_test_status: status,
          last_test_error: errorMessage,
        })
        .eq("id", cfg.id);
    };

    // Parse creds → decide protocol (xml vs rest). Never log the secret.
    let creds;
    try {
      creds = loadPrevioCredentials(cfg.credentials_secret_name);
    } catch (e) {
      const msg = e instanceof PrevioCredentialParseError
        ? e.message
        : `Credential load failed: ${(e as Error).message}`;
      await recordResult("error", msg);
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startedAt = Date.now();

    // -------- XML protocol (single-key auth, e.g. Ottofiori) ---------------
    if (creds.protocol === "xml") {
      const pmsHotelId = String(cfg.pms_hotel_id || "");
      if (!pmsHotelId) {
        const msg = "pms_hotel_id (Previo hotId) is not set on this configuration.";
        await recordResult("error", msg);
        return new Response(JSON.stringify({ ok: false, error: msg }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Read-only permitted method: Hotel.rooms
      const result = await callPrevioXml({
        method: "rooms",
        creds,
        pmsHotelId,
      });
      const latencyMs = Date.now() - startedAt;

      if (!result.ok) {
        const msg = `Previo XML rooms failed (status=${result.status})${result.errorMessage ? `: ${result.errorMessage}` : ""}`;
        await recordResult("error", msg);
        return new Response(JSON.stringify({ ok: false, error: msg, latencyMs, protocol: "xml" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Confirm the response is scoped to the configured hotId. Previo echoes
      // hotId in the response envelope on most methods; also count rooms.
      const roomCount = (result.text.match(/<room[\s>]/g) || []).length;
      const hotIdMatch = result.text.match(/<hotId>(\d+)<\/hotId>/i);
      const returnedHotId = hotIdMatch ? hotIdMatch[1] : null;
      if (returnedHotId && returnedHotId !== pmsHotelId) {
        const msg = `Previo returned hotId=${returnedHotId} but configuration expects ${pmsHotelId}. Refusing to proceed.`;
        await recordResult("error", msg);
        return new Response(JSON.stringify({ ok: false, error: msg, latencyMs, protocol: "xml" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await recordResult("ok", null);
      return new Response(
        JSON.stringify({
          ok: true,
          protocol: "xml",
          method: "Hotel.rooms",
          roomCount,
          hotIdConfirmed: returnedHotId ?? pmsHotelId,
          latencyMs,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // -------- REST protocol (legacy Basic Auth) ---------------------------
    const { response: resp, source } = await fetchPrevioWithAuth({
      credentialsSecretName: cfg.credentials_secret_name,
      path: "/rest/rooms",
      pmsHotelId: String(cfg.pms_hotel_id || ""),
    });
    const latencyMs = Date.now() - startedAt;

    if (!resp.ok) {
      const text = await resp.text();
      const msg = `Previo ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`;
      await recordResult("error", msg);
      return new Response(JSON.stringify({ ok: false, error: msg, latencyMs, protocol: "rest" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await safePrevioJson<unknown>(resp, { path: "/rest/rooms", source });
    const roomCount = Array.isArray(data) ? data.length : 0;

    await recordResult("ok", null);

    return new Response(
      JSON.stringify({ ok: true, protocol: "rest", roomCount, latencyMs, credentialSource: source }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
