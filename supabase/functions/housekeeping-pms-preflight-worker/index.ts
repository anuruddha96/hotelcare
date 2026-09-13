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

type EdgeCall = {
  ok: boolean;
  status: number;
  payload: Record<string, any>;
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
 * Make the HotelCare room table reflect Previo before a planned assignment is
 * released. Mapping is refreshed first because older hotels (notably Gozsdu)
 * can have a complete local room roster without pms_room_mappings yet.
 *
 * mapOnly never imports/creates rooms. The second call performs the actual
 * room-state sync and merges Previo clean/OOO metadata onto the mapped rooms.
 */
async function syncHotelRoomState(
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

  const sync = await callRoomsSync(supabaseUrl, serviceRole, hotelId, {});
  const errors = Array.isArray(sync.payload?.results?.errors)
    ? sync.payload.results.errors.filter(Boolean)
    : [];
  if (!sync.ok || errors.length > 0) {
    throw new Error(
      sync.payload?.error
      || errors.slice(0, 5).join("; ")
      || `Previo room-state sync failed for ${hotelId} (${sync.status})`,
    );
  }

  return {
    mapped: Number(mapping.payload?.results?.mapped || 0),
    mapping_unmapped: Array.isArray(mapping.payload?.results?.unmapped)
      ? mapping.payload.results.unmapped.length
      : 0,
    total: Number(sync.payload?.results?.total || 0),
    updated: Number(sync.payload?.results?.updated || 0),
    synced_at: new Date().toISOString(),
  };
}

async function runMorningWarmup(admin: any, supabaseUrl: string, serviceRole: string) {
  const { hour, minute } = budapestClock();
  // One property every five minutes from 06:00 Budapest. The three-hour
  // window leaves room to scale to 36 standard Previo properties without
  // creating a burst of simultaneous PMS calls.
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
  if (error) throw error;

  const config = (configs || [])[slot];
  if (!config?.hotel_id) return { skipped: true, reason: "no_property_for_slot", slot };

  try {
    const result = await syncHotelRoomState(supabaseUrl, serviceRole, config.hotel_id);
    return { ok: true, hotel_id: config.hotel_id, slot, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[HK PMS warmup] ${config.hotel_id}:`, message);
    return { ok: false, hotel_id: config.hotel_id, slot, error: message };
  }
}

async function runReleasePreflight(admin: any, supabaseUrl: string, serviceRole: string) {
  const { data: plans, error: claimError } = await admin.rpc(
    "claim_due_next_day_housekeeping_pms_preflight_plans",
    { p_limit: 10 },
  );
  if (claimError) throw claimError;

  const results: Array<Record<string, unknown>> = [];
  for (const plan of plans || []) {
    const startedAt = new Date().toISOString();
    try {
      const sync = await syncHotelRoomState(supabaseUrl, serviceRole, plan.hotel_id);
      const finishedAt = new Date().toISOString();
      const result = {
        source: "previo_sync_rooms",
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
      if (updateError) throw updateError;

      results.push({ plan_id: plan.id, hotel_id: plan.hotel_id, ok: true, sync: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[HK PMS preflight] ${plan.hotel_id}/${plan.id}:`, message);
      await admin
        .from("next_day_housekeeping_plans")
        .update({
          pre_release_pms_sync_status: "failed",
          pre_release_pms_sync_result: {
            source: "previo_sync_rooms",
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
    if (mode === "warmup") {
      return json({ ok: true, mode, result: await runMorningWarmup(admin, supabaseUrl, serviceRole) });
    }
    if (mode !== "preflight") return json({ error: "Unsupported mode" }, 400);

    const results = await runReleasePreflight(admin, supabaseUrl, serviceRole);
    return json({ ok: true, mode, processed: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[HK PMS preflight] worker failed:", message);
    return json({ ok: false, error: message }, 500);
  }
});