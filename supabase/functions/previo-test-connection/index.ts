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

      // Try each XML auth variant in turn until one authenticates. Previo's
      // single-key auth slot is not officially documented — we probe.
      const variants: Array<"apiKey" | "login" | "password" | "loginPassword" | "header"> = [
        "apiKey", "login", "password", "loginPassword", "header",
      ];
      const attempts: Array<{ variant: string; status: number; error: string | null }> = [];
      let winning: { variant: string; text: string } | null = null;

      for (const variant of variants) {
        const r = await callPrevioXml({ method: "getRoomKinds", creds, pmsHotelId, authVariant: variant });
        attempts.push({ variant, status: r.status, error: r.errorMessage });
        if (r.ok) { winning = { variant, text: r.text }; break; }
      }
      const latencyMs = Date.now() - startedAt;

      if (!winning) {
        const summary = attempts.map((a) => `${a.variant}=${a.status}${a.error ? `(${a.error})` : ""}`).join("; ");
        const msg = `Previo rejected every XML auth variant for getRoomKinds. Attempts: ${summary}. Confirm with Previo whether the key belongs in <login>, <password>, <apiKey>, or an HTTP header — and whether a matching hotel login is required.`;
        await recordResult("error", msg);
        return new Response(JSON.stringify({ ok: false, error: msg, latencyMs, protocol: "xml", attempts }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const roomKindCount = (winning.text.match(/<roomKind[\s>]/g) || []).length;
      const hotIdMatch = winning.text.match(/<hotId>(\d+)<\/hotId>/i);
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
          method: "Hotel.getRoomKinds",
          xmlAuthVariant: winning.variant,
          roomKindCount,
          hotIdConfirmed: returnedHotId ?? pmsHotelId,
          latencyMs,
          note: `Save "authElement":"${winning.variant}" in the secret JSON to lock this in.`,
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
