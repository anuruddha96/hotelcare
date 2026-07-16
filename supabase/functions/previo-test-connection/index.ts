import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";
import {
  loadPrevioCredentials,
  callPrevioXml,
  PrevioCredentialParseError,
  type PrevioXmlAuthVariant,
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
      .select("id, hotel_id, pms_type, pms_hotel_id, credentials_secret_name, is_active, settings")
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
    const pmsHotelId = String(cfg.pms_hotel_id || "");
    if (!pmsHotelId) {
      const msg = "pms_hotel_id (Previo hotId) is not set on this configuration.";
      await recordResult("error", msg);
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const tomorrowDate = new Date(`${today}T00:00:00Z`);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);

    const testReservations = async (preferredVariant?: PrevioXmlAuthVariant) => {
      const r = await callPrevioXml({
        method: "searchReservations",
        creds,
        pmsHotelId,
        extraXml: `<term><from>${today}</from><to>${tomorrow}</to></term>`,
        authVariant: preferredVariant,
      });
      const reservationCount = r.ok ? (r.text.match(/<reservation>[\s\S]*?<\/reservation>/g) || []).length : 0;
      return {
        ok: r.ok,
        status: r.status,
        error: r.errorMessage,
        usedAuthVariant: r.usedAuthVariant ?? null,
        reservationCount,
      };
    };

    const testRestReservationEndpoints = async () => {
      const paths = [
        `/rest/reservations?from=${today}&to=${tomorrow}`,
        `/rest/reservations?dateFrom=${today}&dateTo=${tomorrow}`,
        `/rest/reservations?arrivalDateFrom=${today}&arrivalDateTo=${tomorrow}`,
        `/rest/reservations?departureDateFrom=${today}&departureDateTo=${tomorrow}`,
      ];
      const results: Array<{ path: string; ok: boolean; status: number; contentType: string | null; itemCount: number | null; sampleKeys?: string[]; error?: string }> = [];
      for (const path of paths) {
        try {
          const { response } = await fetchPrevioWithAuth({
            credentialsSecretName: cfg.credentials_secret_name,
            path,
            pmsHotelId,
          });
          const contentType = response.headers.get("content-type");
          const text = await response.text();
          let itemCount: number | null = null;
          let sampleKeys: string[] | undefined;
          if (response.ok && /json/i.test(contentType || "")) {
            try {
              const parsed = JSON.parse(text);
              const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.reservations) ? parsed.reservations : [];
              itemCount = items.length;
              if (items[0] && typeof items[0] === "object") sampleKeys = Object.keys(items[0]).slice(0, 12);
            } catch {
              itemCount = null;
            }
          }
          results.push({ path, ok: response.ok, status: response.status, contentType, itemCount, sampleKeys, error: response.ok ? undefined : text.slice(0, 160) });
        } catch (e: any) {
          results.push({ path, ok: false, status: 0, contentType: null, itemCount: null, error: e?.message || String(e) });
        }
      }
      return results;
    };

    // -------- XML protocol (single-key auth, e.g. Ottofiori) ---------------
    if (creds.protocol === "xml") {
      // Try the documented XML auth header first. Older body/header variants
      // remain as fallbacks for legacy tenants.
      const variants: PrevioXmlAuthVariant[] = [
        "authorizationApiKey", "apiKey", "login", "password", "loginPassword", "header",
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
        const msg = `Previo rejected every XML auth variant for getRoomKinds. Attempts: ${summary}. The documented format Authorization: ApiKey was tried first; if it still returns 401, confirm with Previo that this API key is active for hotId ${pmsHotelId}.`;
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

      const reservations = await testReservations(winning.variant as PrevioXmlAuthVariant);
      if (!reservations.ok) {
        const msg = `Previo room catalog works, but reservation/departure feed failed (${reservations.status}${reservations.error ? `: ${reservations.error}` : ""}).`;
        await recordResult("error", msg);
        return new Response(JSON.stringify({ ok: false, error: msg, latencyMs, protocol: "xml", roomCatalog: { ok: true, roomKindCount }, reservations }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await service
        .from("pms_configurations")
        .update({
          last_test_at: new Date().toISOString(),
          last_test_status: "ok",
          last_test_error: null,
          settings: {
            ...(((cfg as any).settings && typeof (cfg as any).settings === "object") ? (cfg as any).settings : {}),
            previo_xml_auth_variant: reservations.usedAuthVariant || winning.variant,
          },
        })
        .eq("id", cfg.id);
      return new Response(
        JSON.stringify({
          ok: true,
          protocol: "xml",
          roomCatalog: { ok: true, method: "Hotel.getRoomKinds", roomKindCount },
          reservations,
          xmlAuthVariant: reservations.usedAuthVariant || winning.variant,
          hotIdConfirmed: returnedHotId ?? pmsHotelId,
          latencyMs,
          note: (reservations.usedAuthVariant || winning.variant) === "authorizationApiKey"
            ? `Using Previo's documented Authorization: ApiKey header.`
            : `Legacy auth variant ${reservations.usedAuthVariant || winning.variant} worked for this tenant.`,
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
    const restReservationEndpoints = await testRestReservationEndpoints();
    const reservations = await testReservations(
      typeof (cfg as any).settings?.previo_xml_auth_variant === "string"
        ? ((cfg as any).settings.previo_xml_auth_variant as PrevioXmlAuthVariant)
        : undefined,
    );

    if (!reservations.ok) {
      const msg = `Previo room list works, but reservation/departure feed failed (${reservations.status}${reservations.error ? `: ${reservations.error}` : ""}).`;
      await recordResult("error", msg);
      return new Response(JSON.stringify({ ok: false, error: msg, latencyMs, protocol: "rest", roomCatalog: { ok: true, roomCount, credentialSource: source }, reservations, restReservationEndpoints }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await service
      .from("pms_configurations")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_status: "ok",
        last_test_error: null,
        settings: {
          ...(((cfg as any).settings && typeof (cfg as any).settings === "object") ? (cfg as any).settings : {}),
          previo_xml_auth_variant: reservations.usedAuthVariant,
        },
      })
      .eq("id", cfg.id);

    return new Response(
      JSON.stringify({ ok: true, protocol: "rest", roomCatalog: { ok: true, roomCount, credentialSource: source }, reservations, restReservationEndpoints, latencyMs }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
