// AI-assisted Previo room importer.
//
// Two modes:
//   1. suggest (default): fetches Previo's room list, feeds it to the Lovable
//      AI Gateway (Gemini) and asks it to normalise each Previo room into a
//      clean HotelCare room definition (room_number, room_type,
//      room_category, floor, capacity). Returns the suggestions for admin
//      review.
//   2. apply: takes the (possibly admin-edited) suggestions, upserts rows
//      into public.rooms for the target hotel, and creates matching
//      pms_room_mappings entries linking each new room to its Previo
//      physical roomId.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PrevioRoom {
  roomId: number;
  name: string;
  roomKindId: number;
  roomKindName: string;
  roomTypeId: number;
  roomCleanStatusId: number;
  hasCapacity: boolean;
  isHourlyBased: boolean;
  capacity: number;
  extraCapacity: number;
  order: number;
}

interface Suggestion {
  previo_room_id: string;
  previo_room_name: string;
  room_number: string;
  room_type: string;
  room_category: string | null;
  floor: number | null;
  capacity: number | null;
  reasoning?: string;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { hotelId, apply, rows } = body as {
      hotelId?: string;
      apply?: boolean;
      rows?: Suggestion[];
    };
    if (!hotelId) return jsonResponse({ success: false, error: "hotelId is required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve PMS config
    const { data: pmsConfig } = await supabase
      .from("pms_configurations")
      .select("id, hotel_id, pms_hotel_id, credentials_secret_name")
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .maybeSingle();
    if (!pmsConfig) return jsonResponse({ success: false, error: `No Previo PMS config for ${hotelId}` }, 404);
    if (!pmsConfig.credentials_secret_name || !pmsConfig.pms_hotel_id) {
      return jsonResponse({ success: false, error: "PMS config missing credentials_secret_name or pms_hotel_id" }, 400);
    }

    const previoNumericId = String(pmsConfig.pms_hotel_id);

    // ------------------------------------------------------------------
    // APPLY MODE — write rooms + mappings from admin-approved suggestions
    // ------------------------------------------------------------------
    if (apply) {
      if (!Array.isArray(rows) || rows.length === 0) {
        return jsonResponse({ success: false, error: "rows[] is required when apply=true" }, 400);
      }

      // Look up org slug for the new room rows
      const { data: hotelRec } = await supabase
        .from("hotel_configurations")
        .select("organization_id")
        .eq("hotel_id", pmsConfig.hotel_id)
        .maybeSingle();
      let orgSlug: string | null = null;
      if (hotelRec?.organization_id) {
        const { data: org } = await supabase
          .from("organizations").select("slug").eq("id", hotelRec.organization_id).maybeSingle();
        orgSlug = org?.slug ?? null;
      }

      const result = { total: rows.length, inserted: 0, updated: 0, mapped: 0, errors: [] as string[] };

      for (const s of rows) {
        try {
          if (!s.room_number || !s.previo_room_id) {
            result.errors.push(`Skipped ${s.previo_room_name || s.previo_room_id}: missing room_number`);
            continue;
          }
          const pmsMetadata = {
            roomId: Number(s.previo_room_id),
            roomKindName: s.room_type,
            previoName: s.previo_room_name,
            floor: s.floor,
          };

          // Match existing by Previo id or (hotel, room_number)
          let { data: existing } = await supabase
            .from("rooms")
            .select("id")
            .eq("hotel", pmsConfig.hotel_id)
            .filter("pms_metadata->>roomId", "eq", String(s.previo_room_id))
            .maybeSingle();
          if (!existing) {
            ({ data: existing } = await supabase
              .from("rooms")
              .select("id")
              .eq("hotel", pmsConfig.hotel_id)
              .eq("room_number", s.room_number)
              .maybeSingle());
          }

          if (existing) {
            const { error } = await supabase.from("rooms").update({
              room_number: s.room_number,
              room_type: s.room_type || "",
              room_category: s.room_category ?? null,
              room_capacity: s.capacity ?? null,
              floor_number: s.floor ?? null,
              pms_metadata: pmsMetadata,
              updated_at: new Date().toISOString(),
            }).eq("id", existing.id);
            if (error) throw error;
            result.updated++;
          } else {
            const { data: inserted, error } = await supabase.from("rooms").insert({
              hotel: pmsConfig.hotel_id,
              room_number: s.room_number,
              room_type: s.room_type || "",
              room_category: s.room_category ?? null,
              room_capacity: s.capacity ?? null,
              floor_number: s.floor ?? null,
              status: "clean",
              organization_slug: orgSlug,
              pms_metadata: pmsMetadata,
            }).select("id").single();
            if (error) throw error;
            existing = inserted as any;
            result.inserted++;
          }

          // Upsert mapping
          const { data: existingMap } = await supabase.from("pms_room_mappings")
            .select("id")
            .eq("pms_config_id", pmsConfig.id)
            .or(`pms_room_id.eq.${s.previo_room_id},hotelcare_room_number.eq.${s.room_number}`)
            .maybeSingle();
          const mappingPayload = {
            pms_config_id: pmsConfig.id,
            hotelcare_room_number: s.room_number,
            hotelcare_room_id: existing!.id,
            pms_room_id: String(s.previo_room_id),
            pms_room_name: s.previo_room_name,
            is_active: true,
            mapping_status: "ai_import",
            last_verified_at: new Date().toISOString(),
          };
          if (existingMap) {
            await supabase.from("pms_room_mappings").update({ ...mappingPayload, updated_at: new Date().toISOString() }).eq("id", existingMap.id);
          } else {
            await supabase.from("pms_room_mappings").insert(mappingPayload);
          }
          result.mapped++;
        } catch (e: any) {
          result.errors.push(`${s.previo_room_name || s.previo_room_id}: ${e?.message || e}`);
        }
      }

      await supabase.from("pms_sync_history").insert({
        sync_type: "rooms",
        direction: "from_previo",
        hotel_id: pmsConfig.hotel_id,
        data: { ...result, operation: "ai_import_rooms" },
        sync_status: result.errors.length ? "partial" : "success",
        error_message: result.errors.length ? result.errors.join("; ") : null,
      });

      return jsonResponse({ success: true, results: result });
    }

    // ------------------------------------------------------------------
    // SUGGEST MODE — fetch Previo, ask AI, return proposals
    // ------------------------------------------------------------------
    const { response, source } = await fetchPrevioWithAuth({
      credentialsSecretName: pmsConfig.credentials_secret_name,
      path: "/rest/rooms",
      pmsHotelId: previoNumericId,
    });
    const previoRooms = await safePrevioJson<PrevioRoom[]>(response, { path: "/rest/rooms", source });

    // Slim payload for the model
    const slim = previoRooms.map((r) => ({
      previo_room_id: String(r.roomId),
      previo_room_name: r.name,
      room_kind_name: r.roomKindName,
      capacity: r.capacity,
      extra_capacity: r.extraCapacity,
    }));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return jsonResponse({ success: false, error: "LOVABLE_API_KEY not configured" }, 500);

    const systemPrompt = `You normalise a hotel PMS (Previo) room list into a clean HotelCare room roster.
For each Previo room, output:
- room_number: JUST the numeric room number a housekeeper would use (e.g. "DB/TW-102" => "102", "TRP-305" => "305", "Q-101" => "101").
- room_type: an ENGLISH label for the room kind. Translate Czech/Hungarian names to English (e.g. "Ekonomický dvoulůžkový pokoj" => "Economy Double", "Luxusní třílůžkový pokoj" => "Deluxe Triple", "Deluxe Čtyřlůžkový Pokoj" => "Deluxe Quad", "Egyágyas szoba Deluxe" => "Deluxe Single").
- room_category: a short one-word bucket ("Single" | "Double" | "Twin" | "Triple" | "Quad" | "Queen" | "Suite" | "Family"). Best guess.
- floor: infer the floor from the first digit of the room number if it looks like a standard 3-digit hotel number (101 => 1, 205 => 2, 305 => 3, 406 => 4). Return null if unclear.
- capacity: use the Previo capacity + extra_capacity when > 0, otherwise infer from the type (Single=1, Double/Twin/Queen=2, Triple=3, Quad=4).
- reasoning: one short sentence.
Return STRICT JSON only: { "suggestions": [ { "previo_room_id", "previo_room_name", "room_number", "room_type", "room_category", "floor", "capacity", "reasoning" } ] }
No prose, no markdown.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Previo rooms JSON:\n${JSON.stringify(slim, null, 2)}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      if (aiResp.status === 429) return jsonResponse({ success: false, error: "AI rate limit reached, try again shortly" }, 429);
      if (aiResp.status === 402) return jsonResponse({ success: false, error: "AI credits exhausted — top up in Lovable settings" }, 402);
      return jsonResponse({ success: false, error: `AI gateway error ${aiResp.status}: ${txt}` }, 500);
    }
    const aiJson = await aiResp.json();
    const content: string = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { suggestions?: Suggestion[] } = {};
    try { parsed = JSON.parse(content); } catch {
      return jsonResponse({ success: false, error: "AI returned invalid JSON", raw: content }, 500);
    }
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

    return jsonResponse({
      success: true,
      previo_room_count: previoRooms.length,
      suggestions,
    });
  } catch (e: any) {
    console.error("previo-ai-import-rooms error:", e);
    return jsonResponse({ success: false, error: e?.message || String(e) }, 500);
  }
});
