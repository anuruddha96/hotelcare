import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-worker-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function budapestClock(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  return {
    hour: Number(parts.find(part => part.type === "hour")?.value),
    minute: Number(parts.find(part => part.type === "minute")?.value),
  };
}

function mapPrevioStatus(statusId: number): string {
  const statusMap: Record<number, string> = {
    1: "dirty",
    2: "clean",
    3: "clean",
    4: "out_of_order",
    5: "out_of_order",
  };
  return statusMap[statusId] || "dirty";
}

type EdgeCall = {
  ok: boolean;
  status: number;
  payload: Record<string, any>;
};

type PrevioRoom = {
  roomId: number;
  roomKindId: number;
  roomKindName: string;
  roomTypeId: number;
  roomCleanStatusId: number;
};

async function callRoomsSync(
  supabaseUrl: string,
  serviceRole: string,
  hotelId: string,
  body: Record<string, unknown>,
): Promise<EdgeCall> {
  const response = await fetch(`${supabaseUrl}/functions/v1/previo-sync-rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRole}`,
      apikey: serviceRole,
    },
    body: JSON.stringify({ hotelId, ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok && payload?.success === true && !payload?.error,
    status: response.status,
    payload,
  };
}

/**
 * Refresh physical mappings, fetch the current Previo room roster, and update
 * HotelCare by canonical room id. This is alias-safe for both slug-based hotels
 * (Mika/Gozsdu) and display-name hotels (Memories/Ottofiori).
 */
async function syncHotelRoomState(
  admin: any,
  supabaseUrl: string,
  serviceRole: string,
  hotelId: string,
) {
  const mapping = await callRoomsSync(supabaseUrl, serviceRole, hotelId, { mapOnly: true });
  if (!mapping.ok) {
    throw new Error(
      mapping.payload?.error
      || `Previo room mapping refresh failed for ${hotelId} (${mapping.status})`,
    );
  }

  const preview = await callRoomsSync(supabaseUrl, serviceRole, hotelId, { previewOnly: true });
  const freshRooms = Array.isArray(preview.payload?.rooms)
    ? preview.payload.rooms as PrevioRoom[]
    : [];
  if (!preview.ok || freshRooms.length === 0) {
    throw new Error(
      preview.payload?.error
      || `Previo room-state preview failed for ${hotelId} (${preview.status})`,
    );
  }

  const { data: pmsConfig, error: configError } = await admin
    .from("pms_configurations")
    .select("id")
    .eq("hotel_id", hotelId)
    .eq("pms_type", "previo")
    .eq("is_active", true)
    .maybeSingle();
  if (configError) throw new Error(`PMS config lookup failed: ${errorText(configError)}`);
  if (!pmsConfig?.id) throw new Error(`No active Previo configuration for ${hotelId}.`);

  const { data: mappings, error: mappingsError } = await admin
    .from("pms_room_mappings")
    .select("pms_room_id,hotelcare_room_id")
    .eq("pms_config_id", pmsConfig.id)
    .eq("is_active", true);
  if (mappingsError) throw new Error(`Room mapping lookup failed: ${errorText(mappingsError)}`);

  const roomIdByPmsId = new Map<string, string>();
  for (const row of mappings || []) {
    if (row.pms_room_id && row.hotelcare_room_id) {
      roomIdByPmsId.set(String(row.pms_room_id), String(row.hotelcare_room_id));
    }
  }

  const mappedRoomIds = [...new Set([...roomIdByPmsId.values()])];
  const { data: existingRooms, error: roomsError } = mappedRoomIds.length
    ? await admin
      .from("rooms")
      .select("id,hotel,room_number,pms_metadata")
      .in("id", mappedRoomIds)
    : { data: [], error: null };
  if (roomsError) throw new Error(`HotelCare room lookup failed: ${errorText(roomsError)}`);
  const existingById = new Map((existingRooms || []).map((room: any) => [String(room.id), room]));

  const errors: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  for (const room of freshRooms) {
    const roomId = roomIdByPmsId.get(String(room.roomId));
    if (!roomId) {
      errors.push(`No HotelCare mapping for Previo room ${room.roomId}`);
      continue;
    }
    const existing = existingById.get(roomId);
    if (!existing) {
      errors.push(`Mapped HotelCare room ${roomId} was not found`);
      continue;
    }
    updates.push({
      id: roomId,
      hotel: existing.hotel,
      room_number: existing.room_number,
      status: mapPrevioStatus(Number(room.roomCleanStatusId || 0)),
      room_type: room.roomKindName || "",
      pms_metadata: {
        ...(existing.pms_metadata || {}),
        roomId: room.roomId,
        roomKindId: room.roomKindId,
        roomKindName: room.roomKindName,
        roomTypeId: room.roomTypeId,
        roomCleanStatusId: room.roomCleanStatusId,
      },
      updated_at: new Date().toISOString(),
    });
  }

  // Fail before any room update if Previo contains an unmapped physical room.
  if (errors.length > 0 || updates.length !== freshRooms.length) {
    throw new Error(errors.slice(0, 8).join("; ") || "Incomplete Previo room mapping.");
  }

  const { error: updateError } = await admin
    .from("rooms")
    .upsert(updates, { onConflict: "id" });
  if (updateError) throw new Error(`HotelCare room-state update failed: ${errorText(updateError)}`);

  const syncedAt = new Date().toISOString();
  const historyData = {
    operation: "housekeeping_pre_release_server_sync",
    trigger: "housekeeping_pms_preflight_worker",
    total: freshRooms.length,
    updated: updates.length,
    mapped: Number(mapping.payload?.results?.mapped || 0),
    mapping_unmapped: Array.isArray(mapping.payload?.results?.unmapped)
      ? mapping.payload.results.unmapped.length
      : 0,
    synced_at: syncedAt,
  };
  const { error: historyError } = await admin.from("pms_sync_history").insert({
    sync_type: "rooms",
    direction: "from_previo",
    hotel_id: hotelId,
    data: historyData,
    changed_by: null,
    sync_status: "success",
    error_message: null,
  });
  if (historyError) throw new Error(`PMS sync history write failed: ${errorText(historyError)}`);

  return historyData;
}

async function runMorningWarmup(admin: any, supabaseUrl: string, serviceRole: string) {
  const { hour, minute } = budapestClock();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 6 || hour > 8) {
    return { skipped: true, reason: "outside_budapest_06_09_window" };
  }

  const slot = (hour - 6) * 12 + Math.floor(minute / 5);
  const { data: configs, error } = await admin
    .from("pms_configurations")
    .select("hotel_id")
    .eq("pms_type", "previo")
    .eq("is_active", true)
    .eq("sync_enabled", true)
    .order("hotel_id", { ascending: true });
  if (error) throw new Error(`Warm-up hotel lookup failed: ${errorText(error)}`);

  const config = (configs || [])[slot];
  if (!config?.hotel_id) return { skipped: true, reason: "no_property_for_slot", slot };

  try {
    const result = await syncHotelRoomState(admin, supabaseUrl, serviceRole, config.hotel_id);
    return { ok: true, hotel_id: config.hotel_id, slot, ...result };
  } catch (error) {
    const message = errorText(error);
    console.error(`[HK PMS warmup] ${config.hotel_id}:`, message);
    return { ok: false, hotel_id: config.hotel_id, slot, error: message };
  }
}

async function runReleasePreflight(admin: any, supabaseUrl: string, serviceRole: string) {
  const { data: plans, error: claimError } = await admin.rpc(
    "claim_due_next_day_housekeeping_pms_preflight_plans",
    { p_limit: 10 },
  );
  if (claimError) throw new Error(`Preflight claim failed: ${errorText(claimError)}`);

  const results: Array<Record<string, unknown>> = [];
  for (const plan of plans || []) {
    const startedAt = new Date().toISOString();
    try {
      const sync = await syncHotelRoomState(admin, supabaseUrl, serviceRole, plan.hotel_id);
      const finishedAt = new Date().toISOString();
      const result = {
        source: "previo_sync_rooms_server_preflight",
        trigger: "next_day_housekeeping_pre_release",
        started_at: startedAt,
        finished_at: finishedAt,
        ...sync,
      };

      const { error: updateError } = await admin
        .from("next_day_housekeeping_plans")
        .update({
          pre_release_pms_sync_status: "passed",
          pre_release_pms_synced_at: finishedAt,
          pre_release_pms_sync_result: result,
          last_error: null,
        })
        .eq("id", plan.id)
        .eq("status", "approved");
      if (updateError) throw new Error(`Plan preflight update failed: ${errorText(updateError)}`);

      results.push({ plan_id: plan.id, hotel_id: plan.hotel_id, ok: true, sync: result });
    } catch (error) {
      const message = errorText(error);
      console.error(`[HK PMS preflight] ${plan.hotel_id}/${plan.id}:`, message);
      await admin
        .from("next_day_housekeeping_plans")
        .update({
          pre_release_pms_sync_status: "failed",
          pre_release_pms_sync_result: {
            source: "previo_sync_rooms_server_preflight",
            trigger: "next_day_housekeeping_pre_release",
            started_at: startedAt,
            failed_at: new Date().toISOString(),
            error: message,
          },
          last_error: `Pre-release PMS sync failed: ${message}`,
        })
        .eq("id", plan.id)
        .eq("status", "approved");
      results.push({ plan_id: plan.id, hotel_id: plan.hotel_id, ok: false, error: message });
    }
  }
  return results;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const providedSecret = req.headers.get("x-worker-secret") || "";
  const { data: expectedSecret, error: secretError } = await admin.rpc("get_housekeeping_release_worker_secret");
  if (secretError || !safeEqual(providedSecret, String(expectedSecret || ""))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode || "preflight");

  try {
    if (mode === "sync_hotel") {
      const hotelId = String(body?.hotel_id || body?.hotelId || "").trim();
      if (!hotelId) return json({ error: "hotel_id required" }, 400);
      const result = await syncHotelRoomState(admin, supabaseUrl, serviceRole, hotelId);
      return json({ ok: true, mode, hotel_id: hotelId, result });
    }
    if (mode === "warmup") {
      return json({ ok: true, mode, result: await runMorningWarmup(admin, supabaseUrl, serviceRole) });
    }
    if (mode !== "preflight") return json({ error: "Unsupported mode" }, 400);

    const results = await runReleasePreflight(admin, supabaseUrl, serviceRole);
    return json({ ok: true, mode, processed: results.length, results });
  } catch (error) {
    const message = errorText(error);
    console.error("[HK PMS preflight] worker failed:", message);
    return json({ ok: false, error: message }, 500);
  }
});