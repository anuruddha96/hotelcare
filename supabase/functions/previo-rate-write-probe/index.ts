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
import { readPrevioRate, writePrevioRate, RATE_WRITE_METHOD } from "../_shared/previoRateWrite.ts";

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
      return json({ ok: false, code: "pms_inactive", error: "Previo is not configured or is inactive for this hotel" });
    }

    const loadMaps = async () => {
      const { data } = await admin
        .from("previo_rate_plan_mapping")
        .select("previo_rate_plan_id, previo_room_type_id, is_default")
        .eq("hotel_id", hotelId);
      return ((data ?? []) as any[]).filter((m) => m.previo_rate_plan_id && m.previo_room_type_id);
    };

    let valid = await loadMaps();
    let mappingNote = "";
    if (valid.length === 0) {
      const derived = await syncPrevioRatePlanMappings(admin, hotelId);
      mappingNote = derived.notes.join(" ");
      valid = await loadMaps();
    }
    if (valid.length === 0) {
      return json({
        ok: false,
        code: "no_mapping",
        error: `No Previo pricelist could be resolved for this hotel. ${mappingNote} Run a revenue sync and try again.`.trim(),
        methodsTried: [RATE_WRITE_METHOD],
      });
    }
    const map: any = valid.find((m: any) => m.is_default) ?? valid[0];

    // Multi-account hotels prefix the obk id with the Previo hotId.
    const scoped = String(map.previo_room_type_id);
    const scopedParts = scoped.split(":");
    const obkId = scopedParts.pop() as string;
    let pmsHotelId = String(cfg.pms_hotel_id ?? "");
    let creds = loadPrevioCredentials(cfg.credentials_secret_name);
    if (scopedParts.length) {
      const { data: acc } = await admin
        .from("pms_accounts")
        .select("pms_hotel_id, credentials_secret_name")
        .eq("hotel_id", hotelId)
        .eq("pms_hotel_id", scopedParts.join(":"))
        .maybeSingle();
      if (acc?.credentials_secret_name) {
        creds = loadPrevioCredentials(acc.credentials_secret_name);
        pmsHotelId = String(acc.pms_hotel_id);
      }
    }


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
          "We read prices with the XML API getRates and write them with EQC AvailRateUpdate (POST https://api.previo.app/eqc1/ar).",
          `Methods tried: ${write.attempts.map((a) => `${a.method} (${a.status}: ${a.message})`).join(" | ")}`,
          "Please enable EQC (AvailRateUpdate) access for this property and confirm the EQC api key, hotel id, room type ids and rate plan ids we should send.",
        ].join("\n"),
    });
  } catch (e) {
    console.error("previo-rate-write-probe error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
