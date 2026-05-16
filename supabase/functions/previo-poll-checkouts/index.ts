// Polls Previo /rest/rooms and auto-marks rooms as ready-to-clean (dirty)
// once the guest has departed. HARD-GATED to hotel_id = 'previo-test'.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_HOTEL_ID = "previo-test";

interface PrevioRoom {
  roomId: number;
  name: string;
  roomCleanStatusId: number;
  reservation?: {
    arrivalDate: string;
    departureDate: string;
    status: string;
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const cronSecret = req.headers.get("x-cron-secret") || "";
    const expectedCronSecret = Deno.env.get("CRON_SECRET") || "";
    const isCronCall = !!expectedCronSecret && cronSecret === expectedCronSecret;

    let userId: string | null = null;
    if (!isCronCall) {
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anon = createClient(SUPABASE_URL, ANON);
      const { data: userRes } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!userRes?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = userRes.user.id;
    }

    const service = createClient(SUPABASE_URL, SERVICE);
    const { hotelId } = await req.json().catch(() => ({}));
    const targetHotel = hotelId || ALLOWED_HOTEL_ID;

    if (targetHotel !== ALLOWED_HOTEL_ID) {
      return new Response(
        JSON.stringify({ skipped: true, reason: `Restricted to ${ALLOWED_HOTEL_ID}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: profile } = await service
      .from("profiles")
      .select("role, assigned_hotel")
      .eq("id", userRes.user.id)
      .maybeSingle();
    const isAdmin = profile?.role === "admin" || profile?.role === "top_management";
    if (!isAdmin && profile?.assigned_hotel !== targetHotel) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cfg } = await service
      .from("pms_configurations")
      .select("pms_hotel_id, credentials_secret_name")
      .eq("hotel_id", targetHotel)
      .eq("pms_type", "previo")
      .maybeSingle();
    if (!cfg) {
      return new Response(JSON.stringify({ error: `No Previo config for ${targetHotel}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { response: resp } = await fetchPrevioWithAuth({
      credentialsSecretName: cfg.credentials_secret_name,
      path: "/rest/rooms",
      pmsHotelId: String(cfg.pms_hotel_id || ""),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: `Previo ${resp.status}: ${t.slice(0, 300)}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rooms = await safePrevioJson<PrevioRoom[]>(resp, { path: "/rest/rooms" });
    const today = todayUtc();

    // Find rooms whose guest has checked out (departureDate <= today and status indicates departed)
    // OR whose Previo clean status is "dirty/untidy" while the local row still says clean.
    const candidates = rooms.filter((r) => {
      const res = r.reservation;
      const departed = res && res.departureDate <= today &&
        /(checked.?out|departed|left|finished|done)/i.test(res.status || "");
      const previoDirty = r.roomCleanStatusId !== 1; // 1 = clean in Previo
      return departed || previoDirty;
    });

    const results = { checked: rooms.length, marked: 0, skipped: 0, errors: [] as string[] };

    for (const r of candidates) {
      try {
        const { data: localRoom } = await service
          .from("rooms")
          .select("id, status")
          .eq("hotel", targetHotel)
          .eq("room_number", r.name)
          .maybeSingle();
        if (!localRoom) { results.skipped++; continue; }
        if (localRoom.status === "dirty") { results.skipped++; continue; }

        const { error: updErr } = await service
          .from("rooms")
          .update({
            status: "dirty",
            is_checkout_room: true,
            checkout_time: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", localRoom.id);
        if (updErr) throw updErr;
        results.marked++;
      } catch (e: any) {
        results.errors.push(`${r.name}: ${e?.message || e}`);
      }
    }

    await service.from("pms_sync_history").insert({
      sync_type: "checkouts_poll",
      direction: "from_previo",
      hotel_id: targetHotel,
      data: results,
      changed_by: userRes.user.id,
      sync_status: results.errors.length ? "partial" : "success",
      error_message: results.errors.length ? results.errors.join("; ") : null,
    });

    return new Response(JSON.stringify({ ok: true, ...results }), {
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
