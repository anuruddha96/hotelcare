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

    const body = await req.json().catch(() => ({}));
    const hotelId: string | undefined = body.hotelId;
    const dateFrom: string | undefined = body.dateFrom;
    const dateTo: string | undefined = body.dateTo;

    if (!hotelId || !dateFrom || !dateTo) {
      return new Response(
        JSON.stringify({ error: "hotelId, dateFrom, dateTo required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await service
      .from("profiles")
      .select("role, assigned_hotel, organization_slug")
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
      .select("id, hotel_id, pms_hotel_id, credentials_secret_name, is_active, sync_enabled")
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .maybeSingle();

    if (!cfg || !cfg.is_active) {
      return new Response(
        JSON.stringify({ error: "Previo is not active for this hotel" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
      return new Response(JSON.stringify({ error: "Credentials missing" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = btoa(`${user}:${pass}`);
    // Pull rate plans + per-day calendar. Endpoint shapes vary; we try the
    // standard REST calendar endpoint and gracefully return an empty list if
    // unsupported on this hotel — no destructive writes.
    const url = new URL("https://api.previo.app/rest/calendar");
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);

    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Previo-Hotel-ID": String(cfg.pms_hotel_id || ""),
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Previo ${resp.status}: ${text.slice(0, 300)}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await resp.json().catch(() => []);
    const rows: any[] = Array.isArray(data) ? data : (data?.items ?? []);

    let upserted = 0;
    for (const r of rows) {
      const stay_date = String(r.date || r.stayDate || "").slice(0, 10);
      const rate_plan_id = String(r.ratePlanId ?? r.rateplanId ?? "default");
      const room_kind_id = String(r.roomKindId ?? r.roomTypeId ?? "default");
      if (!stay_date) continue;
      const rate_eur = r.price ?? r.rate ?? null;
      const availability = r.availability ?? r.free ?? null;

      const { error } = await service
        .from("previo_rate_snapshots")
        .upsert(
          {
            hotel_id: hotelId,
            organization_slug: profile?.organization_slug || "rdhotels",
            stay_date,
            rate_plan_id,
            room_kind_id,
            rate_eur,
            availability,
            restrictions: r.restrictions || {},
            source: "previo",
            pulled_at: new Date().toISOString(),
          },
          { onConflict: "hotel_id,stay_date,rate_plan_id,room_kind_id" }
        );
      if (!error) upserted++;
    }

    return new Response(JSON.stringify({ ok: true, upserted, total: rows.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
