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

    // Pull today's reservations via the XML searchReservations API so we
    // can read the reception-confirmed status. Previo statusId 5 = Departed
    // (reception checked the guest out in the PMS). The /rest/rooms response
    // for this hotel does not embed reservation data, so the XML feed is
    // the only reliable signal.
    const rawSecret = String(Deno.env.get(cfg.credentials_secret_name || "") || "").trim();
    const stripQuotes = (s: string) =>
      (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
        ? s.slice(1, -1).trim() : s;
    let xmlUser = ""; let xmlPass = "";
    const cleaned = stripQuotes(rawSecret);
    try {
      const j = JSON.parse(cleaned);
      if (j && typeof j === "object") {
        xmlUser = stripQuotes(String(j.username ?? j.user ?? j.login ?? j.email ?? ""));
        xmlPass = stripQuotes(String(j.password ?? j.pass ?? j.secret ?? ""));
      }
    } catch {}
    if (!xmlUser || !xmlPass) {
      const m = cleaned.match(/^([^:\s]+):(.+)$/);
      if (m) { xmlUser = stripQuotes(m[1]); xmlPass = stripQuotes(m[2]); }
    }

    const checkedOutByName = new Map<string, true>();
    const checkedOutByObjId = new Map<number, true>();
    let reservationFetchError: string | null = null;
    if (xmlUser && xmlPass) {
      try {
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const xmlBody = `<?xml version="1.0"?>
<request>
<login>${xmlUser}</login>
<password>${xmlPass}</password>
<hotId>${String(cfg.pms_hotel_id || "")}</hotId>
<term><from>${today}</from><to>${tomorrow}</to></term>
</request>`;
        const xmlResp = await fetch("https://api.previo.cz/x1/hotel/searchReservations/", {
          method: "POST",
          headers: { "Content-Type": "text/xml; charset=UTF-8" },
          body: xmlBody,
        });
        const xmlText = await xmlResp.text();
        if (!xmlResp.ok || /<error>/i.test(xmlText)) {
          const errMatch = xmlText.match(/<message>([^<]*)<\/message>/i);
          reservationFetchError = `XML API ${xmlResp.status}: ${errMatch?.[1] || xmlText.slice(0, 200)}`;
        } else {
          const blocks = xmlText.match(/<reservation>[\s\S]*?<\/reservation>/g) || [];
          const grab = (s: string, tag: string) => {
            const m = s.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
            return m ? m[1].trim() : "";
          };
          for (const block of blocks) {
            const statusId = parseInt(grab(block, "statusId") || "0", 10);
            if (statusId !== 5) continue; // only reception-confirmed checkouts
            const toStr = grab(block, "to");
            if (!toStr || toStr.slice(0, 10) !== today) continue;
            const objMatch = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/);
            if (!objMatch) continue;
            const objId = parseInt(objMatch[1], 10);
            const roomName = objMatch[2].trim();
            if (roomName) checkedOutByName.set(roomName, true);
            if (!isNaN(objId)) checkedOutByObjId.set(objId, true);
          }
        }
      } catch (e: any) {
        reservationFetchError = e?.message || String(e);
      }
    } else {
      reservationFetchError = "Could not parse Previo XML credentials";
    }

    const classify = (r: PrevioRoom) => {
      const departed = checkedOutByObjId.has(r.roomId) || checkedOutByName.has(r.name);
      const previoDirty = r.roomCleanStatusId !== 1; // 1 = clean in Previo
      return { departed, previoDirty };
    };
    const candidates = rooms.filter((r) => {
      const { departed, previoDirty } = classify(r);
      return departed || previoDirty;
    });

    const results = { checked: rooms.length, marked: 0, skipped: 0, cleared: 0, errors: [] as string[], unmatched: [] as string[], reservationFetchError };
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

        const { departed, previoDirty } = classify(r);
        if (departed) trueCheckoutRoomIds.add(localRoom.id);

        const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
        if (localRoom.status !== "dirty" && (departed || previoDirty)) {
          updateData.status = "dirty";
        }
        if (departed) {
          updateData.is_checkout_room = true;
          updateData.checkout_time = new Date().toISOString();
        }
        if (Object.keys(updateData).length > 1) {
          const { error: updErr } = await service
            .from("rooms")
            .update(updateData)
            .eq("id", localRoom.id);
          if (updErr) throw updErr;
          if (updateData.status === "dirty") results.marked++;
        }

        if (departed) {
          const today = new Date().toISOString().slice(0, 10);
          const { error: asgErr } = await service
            .from("room_assignments")
            .update({ ready_to_clean: true, updated_at: new Date().toISOString() })
            .eq("room_id", localRoom.id)
            .eq("assignment_date", today)
            .eq("assignment_type", "checkout_cleaning")
            .in("status", ["assigned", "in_progress"])
            .eq("ready_to_clean", false);
          if (asgErr) results.errors.push(`${r.name} assignment: ${asgErr.message}`);
        }
      } catch (e: any) {
        results.errors.push(`${r.name}: ${e?.message || e}`);
      }
    }

    // Clear stale checkout flags: any room currently flagged is_checkout_room
    // that is NOT in today's true-departure set must be reset, so leftover
    // flags from earlier polls / manual tests can't linger in the UI.
    try {
      const { data: stale } = await service
        .from("rooms")
        .select("id")
        .eq("hotel", targetHotel)
        .eq("is_checkout_room", true);
      const staleIds = (stale ?? [])
        .map((r: any) => r.id as string)
        .filter((id) => !trueCheckoutRoomIds.has(id));
      if (staleIds.length > 0) {
        await service
          .from("rooms")
          .update({ is_checkout_room: false, checkout_time: null, updated_at: new Date().toISOString() })
          .in("id", staleIds);
        results.cleared = staleIds.length;
      }
    } catch (e: any) {
      results.errors.push(`stale cleanup: ${e?.message || e}`);
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
