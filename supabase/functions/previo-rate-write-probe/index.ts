// Read-only capability probe: does this Previo account accept rate writes?
//
// It never changes a price. For a single date / room type / occupancy it reads
// the CURRENT published price with getRates and then writes that exact same
// value back. If Previo accepts it, the write scope exists and the method name
// is stored on hotel_revenue_settings so the push path can use it directly.
// If Previo rejects it, the verbatim rejection is returned so the hotel can
// forward it to Previo support.

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadPrevioCredentials } from "../_shared/previoCredentials.ts";
import { readPrevioRate, writePrevioRate, RATE_WRITE_METHODS } from "../_shared/previoRateWrite.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROBE_ROLES = ["admin", "top_management", "top_management_manager"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: userRes } = await admin.auth.getUser(token);
    const user = userRes?.user;
    if (!user) return json({ error: "Not signed in" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("role, assigned_hotel, organization_slug")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || !PROBE_ROLES.includes(String(profile.role))) {
      return json({ error: "You do not have permission to probe rate write access" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const hotelId: string | null = typeof body.hotelId === "string" ? body.hotelId : null;
    if (!hotelId) return json({ error: "hotelId is required" }, 400);
    if (profile.role !== "admin" && profile.assigned_hotel && profile.assigned_hotel !== hotelId) {
      return json({ error: "You can only probe your own hotel" }, 403);
    }

    const { data: cfg } = await admin
      .from("pms_configurations")
      .select("pms_hotel_id, credentials_secret_name, is_active, organization_slug")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    if (!cfg || !cfg.is_active) {
      return json({ code: "pms_inactive", error: "Previo is not configured or is inactive for this hotel" }, 412);
    }

    const { data: mappings } = await admin
      .from("previo_rate_plan_mapping")
      .select("previo_rate_plan_id, previo_room_type_id, is_default")
      .eq("hotel_id", hotelId);
    const valid = (mappings ?? []).filter((m: any) => m.previo_rate_plan_id && m.previo_room_type_id);
    if (valid.length === 0) {
      return json({
        code: "no_mapping",
        error: "No Previo rate-plan mapping configured. Add room-type and rate-plan ids in Pricing Strategy → Rooms Setup first.",
        methodsTried: RATE_WRITE_METHODS,
      }, 412);
    }
    const map: any = valid.find((m: any) => m.is_default) ?? valid[0];

    const creds = loadPrevioCredentials(cfg.credentials_secret_name);
    const pmsHotelId = String(cfg.pms_hotel_id ?? "");

    // Pick a date far enough out that a same-value write is harmless.
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 14);
    const stayDate = day.toISOString().slice(0, 10);
    const occupancy = 2;

    const current = await readPrevioRate({
      creds,
      pmsHotelId,
      from: stayDate,
      to: stayDate,
      obkId: String(map.previo_room_type_id),
      occupancy,
    });

    if (current === null) {
      return json({
        ok: false,
        readable: false,
        error: `Could not read a current price for ${stayDate} (room type ${map.previo_room_type_id}, ${occupancy} guests). Run a revenue sync first.`,
      }, 200);
    }

    const write = await writePrevioRate({
      creds,
      pmsHotelId,
      target: {
        prlId: String(map.previo_rate_plan_id),
        obkId: String(map.previo_room_type_id),
        from: stayDate,
        to: stayDate,
        occupancy,
        price: current, // same value in, same value out — nothing changes
        currency: "EUR",
      },
    });

    if (write.ok && write.method) {
      await admin
        .from("hotel_revenue_settings")
        .update({ rate_write_method: write.method, rate_write_verified_at: new Date().toISOString() })
        .eq("hotel_id", hotelId);
    }

    return json({
      ok: write.ok,
      readable: true,
      probedDate: stayDate,
      currentPrice: current,
      method: write.method,
      attempts: write.attempts,
      supportRequest: write.ok
        ? null
        : [
          `Hotel: ${hotelId} (Previo hotId ${pmsHotelId})`,
          `Rate plan: ${map.previo_rate_plan_id}, room type: ${map.previo_room_type_id}`,
          "We can read prices with getRates but every rate-write call is rejected.",
          `Methods tried: ${write.attempts.map((a) => `${a.method} (${a.status}: ${a.message})`).join(" | ")}`,
          "Please enable rate write access (XML rate write or EQC) for this property and confirm the exact method and payload we should send.",
        ].join("\n"),
    });
  } catch (e) {
    console.error("previo-rate-write-probe error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
