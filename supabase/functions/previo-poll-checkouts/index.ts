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

    if (!isCronCall && userId) {
      const { data: profile } = await service
        .from("profiles")
        .select("role, assigned_hotel")
        .eq("id", userId)
        .maybeSingle();
      const isAdmin = profile?.role === "admin" || profile?.role === "top_management";
      if (!isAdmin && profile?.assigned_hotel !== targetHotel) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

    // Classify rooms:
    //  - departed: guest actually checked out today (real checkout — set is_checkout_room=true)
    //  - previoDirty: Previo says dirty/untidy but no departure (sync status only — DO NOT flag as checkout)
    const classify = (r: PrevioRoom) => {
      const res = r.reservation;
      const departed = !!(res && res.departureDate <= today &&
        /^(checked.?out|no.?show|cancelled|canceled|departed|left|finished|done)$/i.test((res.status || "").trim()));
      const previoDirty = r.roomCleanStatusId !== 1; // 1 = clean in Previo
      return { departed, previoDirty };
    };
    const candidates = rooms.filter((r) => {
      const { departed, previoDirty } = classify(r);
      return departed || previoDirty;
    });

    const results = { checked: rooms.length, marked: 0, skipped: 0, cleared: 0, errors: [] as string[], unmatched: [] as string[] };
    const trueCheckoutRoomIds = new Set<string>();

    const extractRoomNumber = (raw: string): string => {
      const m = String(raw).match(/\d+/);
      return m ? m[0] : String(raw).trim();
    };

    for (const r of candidates) {
      try {
        const rawName = String(r.name ?? "").trim();
        const numToken = extractRoomNumber(rawName);
        const previoRoomId = r.roomId != null ? String(r.roomId) : "";

        // Robust lookup: exact name, then ilike, then numeric token, then pms_metadata->>roomId
        let localRoom: { id: string; status: string } | null = null;

        const tryQ = async (mut: (q: any) => any) => {
          const { data } = await mut(
            service.from("rooms").select("id, status").eq("hotel", targetHotel),
          ).maybeSingle();
          return (data as any) || null;
        };

        localRoom = await tryQ((q) => q.eq("room_number", rawName));
        if (!localRoom && rawName) localRoom = await tryQ((q) => q.ilike("room_number", rawName));
        if (!localRoom && numToken && numToken !== rawName) localRoom = await tryQ((q) => q.eq("room_number", numToken));
        if (!localRoom && previoRoomId) {
          localRoom = await tryQ((q) => q.filter("pms_metadata->>roomId", "eq", previoRoomId));
        }

        if (!localRoom) {
          results.skipped++;
          results.unmatched.push(rawName || previoRoomId);
          continue;
        }

        if (localRoom.status !== "dirty") {
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
        } else {
          // Make sure checkout flag is set even if room was already dirty.
          await service
            .from("rooms")
            .update({ is_checkout_room: true, checkout_time: localRoom.status === "dirty" ? new Date().toISOString() : new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", localRoom.id)
            .eq("is_checkout_room", false);
        }

        // Flip ready_to_clean on any open checkout_cleaning assignment so
        // housekeepers can start immediately.
        const today = new Date().toISOString().slice(0, 10);
        const { error: asgErr } = await service
          .from("room_assignments")
          .update({ ready_to_clean: true, updated_at: new Date().toISOString() })
          .eq("room_id", localRoom.id)
          .eq("assignment_date", today)
          .in("status", ["assigned", "in_progress"])
          .eq("ready_to_clean", false);
        if (asgErr) results.errors.push(`${r.name} assignment: ${asgErr.message}`);
      } catch (e: any) {
        results.errors.push(`${r.name}: ${e?.message || e}`);
      }
    }

    await service.from("pms_sync_history").insert({
      sync_type: "checkouts_poll",
      direction: "from_previo",
      hotel_id: targetHotel,
      data: results,
      changed_by: userId,
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
