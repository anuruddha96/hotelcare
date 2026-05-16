// Nightly auto-sync for Previo. Runs daily via pg_cron after midnight.
// Hard-gated to hotel_id = 'previo-test' so OttoFiori and other hotels
// are never touched. Pulls room catalog + today's PMS snapshot, and
// applies the same status-mapping rules as the manual refresh.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_HOTEL_ID = "previo-test";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);

  const started = new Date().toISOString();
  let importResult: any = null;
  let pmsResult: any = null;
  let updateErrors: string[] = [];
  let updatedRooms = 0;
  let createdRooms = 0;

  try {
    // 1) Pull/refresh the rooms catalog from Previo (importLocal=true)
    const importResp = await fetch(`${SUPABASE_URL}/functions/v1/previo-sync-rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE}`,
      },
      body: JSON.stringify({ hotelId: ALLOWED_HOTEL_ID, importLocal: true }),
    });
    importResult = await importResp.json().catch(() => null);

    if (importResult?.results) {
      // upserted = updates + creates combined; we don't separate here, but
      // creations are tracked via rooms.created_at >= started.
    }

    // 2) Pull today's PMS snapshot and apply room status updates.
    // We replicate the relevant parts of pmsRefresh.ts here (server-side)
    // so the cron job doesn't need a browser session.
    const pmsResp = await fetch(`${SUPABASE_URL}/functions/v1/previo-pms-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE}`,
      },
      body: JSON.stringify({ hotelId: ALLOWED_HOTEL_ID }),
    });
    pmsResult = await pmsResp.json().catch(() => null);

    const rows: any[] = pmsResult?.rows || [];
    const today = new Date().toISOString().slice(0, 10);

    for (const row of rows) {
      try {
        const rawRoomName = String(row.Room ?? "").trim();
        if (!rawRoomName) continue;
        const previoRoomId = row.RoomId != null ? String(row.RoomId) : "";

        // Match by Previo roomId first, then by room name.
        let { data: rooms } = await service
          .from("rooms")
          .select("id")
          .eq("hotel", ALLOWED_HOTEL_ID)
          .filter("pms_metadata->>roomId", "eq", previoRoomId);
        if (!rooms || rooms.length === 0) {
          ({ data: rooms } = await service
            .from("rooms")
            .select("id")
            .eq("hotel", ALLOWED_HOTEL_ID)
            .eq("room_number", rawRoomName));
        }
        if (!rooms || rooms.length === 0) continue;

        const previoStatusRaw = row.Status ? String(row.Status).trim().toLowerCase() : "";
        const mappedStatus =
          previoStatusRaw === "" ? null
          : previoStatusRaw.startsWith("clean") ? "clean"
          : "dirty";

        const updateData: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };
        if (mappedStatus) {
          updateData.status = mappedStatus;
          if (mappedStatus === "clean") {
            updateData.last_cleaned_at = new Date().toISOString();
          }
        }

        const { error: updErr } = await service.from("rooms").update(updateData).eq("id", rooms[0].id);
        if (updErr) updateErrors.push(`${rawRoomName}: ${updErr.message}`);
        else updatedRooms++;
      } catch (e: any) {
        updateErrors.push(`row error: ${e?.message || String(e)}`);
      }
    }

    // Count newly-created rooms during this run
    const { count } = await service
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("hotel", ALLOWED_HOTEL_ID)
      .gte("created_at", started);
    createdRooms = count ?? 0;

    const status = updateErrors.length ? "partial" : "success";
    await service.from("pms_sync_history").insert({
      sync_type: "nightly_auto",
      direction: "from_previo",
      hotel_id: ALLOWED_HOTEL_ID,
      sync_status: status,
      error_message: updateErrors.length ? updateErrors.slice(0, 5).join(" | ") : null,
      data: {
        started,
        finished: new Date().toISOString(),
        catalog: importResult?.results ?? null,
        rooms_in_snapshot: rows.length,
        rooms_updated: updatedRooms,
        rooms_created: createdRooms,
        update_errors: updateErrors.slice(0, 20),
      },
    } as any);

    return new Response(
      JSON.stringify({
        ok: true,
        hotel_id: ALLOWED_HOTEL_ID,
        rooms_in_snapshot: rows.length,
        rooms_updated: updatedRooms,
        rooms_created: createdRooms,
        errors: updateErrors.slice(0, 20),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    try {
      await service.from("pms_sync_history").insert({
        sync_type: "nightly_auto",
        direction: "from_previo",
        hotel_id: ALLOWED_HOTEL_ID,
        sync_status: "failed",
        error_message: e?.message || String(e),
        data: { started, importResult, pmsResult },
      } as any);
    } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
