// Push confirmed rate drafts back to Previo.
//
// The grid stores every manual price change as a draft; nothing leaves the
// app until someone with rate-push rights confirms. This function validates
// the caller, sends each draft to Previo through the confirmed rate-write
// method, reads the price back to prove it landed, and records the outcome per
// draft so a partial failure is visible instead of silent.
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadPrevioCredentials } from "../_shared/previoCredentials.ts";
import { readPrevioRate, writePrevioRate } from "../_shared/previoRateWrite.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PUSH_ROLES = ["admin", "top_management", "top_management_manager"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // --- caller must be signed in and allowed to push rates -------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: userRes } = await admin.auth.getUser(token);
    const user = userRes?.user;
    if (!user) return json({ error: "Not signed in" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("role, assigned_hotel, organization_slug")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || !PUSH_ROLES.includes(String(profile.role))) {
      return json({ error: "You do not have permission to push rates" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const hotelId: string | null = typeof body.hotelId === "string" ? body.hotelId : null;
    const draftIds: string[] = Array.isArray(body.draftIds) ? body.draftIds : [];
    if (!hotelId) return json({ error: "hotelId is required" }, 400);

    if (profile.role !== "admin" && profile.assigned_hotel && profile.assigned_hotel !== hotelId) {
      return json({ error: "You can only push rates for your own hotel" }, 403);
    }

    // --- PMS config + rate-plan mapping ---------------------------------
    const { data: cfg } = await admin
      .from("pms_configurations")
      .select("hotel_id, pms_hotel_id, credentials_secret_name, is_active, organization_slug")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    if (!cfg || !cfg.is_active) {
      return json({ code: "pms_inactive", error: "PMS is not configured or is inactive for this hotel" }, 412);
    }

    const { data: mappings } = await admin
      .from("previo_rate_plan_mapping")
      .select("room_type_id, previo_rate_plan_id, previo_room_type_id, is_default")
      .eq("hotel_id", hotelId);
    const validMaps = (mappings ?? []).filter(
      (m: any) => m.previo_rate_plan_id && m.previo_room_type_id,
    );
    if (validMaps.length === 0) {
      return json({
        code: "no_mapping",
        error: "No Previo rate-plan mapping configured. Add room-type and rate-plan IDs in Pricing Strategy → Rooms Setup.",
      }, 412);
    }
    const defaultMap = validMaps.find((m: any) => m.is_default) ?? validMaps[0];

    const { data: settings } = await admin
      .from("hotel_revenue_settings")
      .select("rate_write_method, base_currency")
      .eq("hotel_id", hotelId)
      .maybeSingle();

    let writeMethod: string | null = settings?.rate_write_method ?? null;

    // --- drafts to push --------------------------------------------------
    let q = admin
      .from("revenue_rate_drafts")
      .select("id, stay_date, obk_id, room_type_name, occupancy, old_price, new_price, currency")
      .eq("hotel_id", hotelId)
      .in("status", ["draft", "failed"]);
    if (draftIds.length > 0) q = q.in("id", draftIds);

    const { data: drafts, error: draftErr } = await q;
    if (draftErr) throw draftErr;
    if (!drafts || drafts.length === 0) {
      return json({ ok: true, pushed: 0, failed: 0, message: "Nothing to push." });
    }

    let creds;
    try {
      creds = loadPrevioCredentials(cfg.credentials_secret_name);
    } catch (e) {
      return json({
        code: "no_credentials",
        error: e instanceof Error ? e.message : String(e),
      }, 412);
    }
    const pmsHotelId = String(cfg.pms_hotel_id ?? "");

    let pushed = 0;
    let failed = 0;
    let verified = 0;
    const errors: Array<{ stay_date: string; room_type_name: string; error: string }> = [];

    for (const d of drafts as any[]) {
      const mapForType = validMaps.find((m: any) => String(m.previo_room_type_id) === String(d.obk_id));
      const map: any = mapForType ?? defaultMap;
      // Multi-account hotels prefix the obk id with the Previo hotId.
      const obkId = String(map.previo_room_type_id ?? d.obk_id).split(":").pop() as string;

      try {
        const result = await writePrevioRate({
          creds,
          pmsHotelId,
          preferredMethod: writeMethod,
          target: {
            prlId: String(map.previo_rate_plan_id),
            obkId,
            from: d.stay_date,
            to: d.stay_date,
            occupancy: Number(d.occupancy) || 2,
            price: Number(d.new_price),
            currency: d.currency ?? settings?.base_currency ?? "EUR",
          },
        });

        if (!result.ok) {
          const detail = result.attempts
            .map((a) => `${a.method} → ${a.status}${a.message ? `: ${a.message}` : ""}`)
            .join(" | ");
          throw new Error(`Previo rejected the price change. ${detail}`);
        }

        if (result.method && result.method !== writeMethod) {
          writeMethod = result.method;
          await admin
            .from("hotel_revenue_settings")
            .update({ rate_write_method: result.method, rate_write_verified_at: new Date().toISOString() })
            .eq("hotel_id", hotelId);
        }

        // Prove it landed: read the price straight back from Previo.
        const readBack = await readPrevioRate({
          creds,
          pmsHotelId,
          from: d.stay_date,
          to: d.stay_date,
          obkId,
          occupancy: Number(d.occupancy) || 2,
        });
        const isVerified = readBack !== null && Math.round(readBack) === Math.round(Number(d.new_price));
        if (isVerified) verified += 1;

        await admin.from("revenue_rate_drafts")
          .update({
            status: "pushed",
            pushed_at: new Date().toISOString(),
            push_error: isVerified
              ? null
              : `Sent to Previo, but the read-back price was ${readBack === null ? "unavailable" : readBack}. Re-sync to confirm.`,
          })
          .eq("id", d.id);

        await admin.from("rate_history").insert({
          hotel_id: hotelId,
          organization_slug: cfg.organization_slug ?? profile.organization_slug ?? null,
          stay_date: d.stay_date,
          old_rate_eur: d.old_price,
          new_rate_eur: d.new_price,
          source: "manual_push",
          notes: `${d.room_type_name} · ${d.occupancy} guest(s) · ${result.method} · ${isVerified ? "verified in Previo" : "not verified"} · pushed by ${user.email ?? user.id}`,
        });

        pushed += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failed += 1;
        errors.push({ stay_date: d.stay_date, room_type_name: d.room_type_name, error: message });
        await admin.from("revenue_rate_drafts")
          .update({ status: "failed", push_error: message.slice(0, 500) })
          .eq("id", d.id);
        console.error("rate push failed", d.stay_date, message);
      }
    }

    await admin.from("pms_sync_history").insert({
      sync_type: "rate_push",
      direction: "to_previo",
      hotel_id: hotelId,
      sync_status: failed === 0 ? "success" : pushed === 0 ? "failed" : "partial",
      data: { pushed, failed, verified, method: writeMethod, errors: errors.slice(0, 10), by: user.email ?? user.id },
      error_message: failed > 0 ? errors[0]?.error : null,
    });

    return json({ ok: true, pushed, failed, verified, method: writeMethod, errors });
  } catch (e) {
    console.error("revenue-push-drafts error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
