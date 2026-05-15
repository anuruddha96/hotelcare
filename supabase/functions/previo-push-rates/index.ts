// Push approved rate recommendations to Previo.
// Phase 1 implementation: validates mapping is configured, fetches approved
// recs, calls Previo's rate update endpoint per (rec × mapping), records
// pushed_at + audit history. The exact endpoint path/payload is read from
// env (PREVIO_RATE_UPDATE_PATH) so it can be flipped without redeploying.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  hotel_id?: string;
  stay_dates?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const hotelId = body.hotel_id;
    if (!hotelId) {
      return json({ error: "hotel_id required" }, 400);
    }

    // Hotel + PMS config
    const { data: cfg } = await supabase
      .from("pms_configurations")
      .select("hotel_id, pms_hotel_id, credentials_secret_name, is_active, organization_slug")
      .eq("hotel_id", hotelId)
      .maybeSingle();

    if (!cfg || !cfg.is_active) {
      return json({ error: "PMS not configured or inactive for this hotel" }, 400);
    }

    // Mapping
    const { data: mappings } = await supabase
      .from("previo_rate_plan_mapping")
      .select("room_type_id, previo_rate_plan_id, previo_room_type_id, is_default")
      .eq("hotel_id", hotelId);

    const validMaps = (mappings ?? []).filter(
      (m: any) => m.previo_rate_plan_id && m.previo_room_type_id,
    );
    if (validMaps.length === 0) {
      return json(
        {
          code: "no_mapping",
          error:
            "No Previo rate-plan mapping configured. Add room-type and rate-plan IDs in Pricing Strategy → Rooms Setup.",
        },
        412,
      );
    }
    const defaultMap =
      validMaps.find((m: any) => m.is_default) ?? validMaps[0];

    // Approved recs not yet pushed in next 90 days
    const today = new Date().toISOString().slice(0, 10);
    const horizon = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 90);
      return d.toISOString().slice(0, 10);
    })();

    let recsQuery = supabase
      .from("rate_recommendations")
      .select("id, stay_date, recommended_rate_eur, current_rate_eur, reason")
      .eq("hotel_id", hotelId)
      .eq("status", "approved")
      .is("pushed_at", null)
      .gte("stay_date", today)
      .lte("stay_date", horizon);

    if (body.stay_dates && body.stay_dates.length > 0) {
      recsQuery = recsQuery.in("stay_date", body.stay_dates);
    }

    const { data: recs, error: recsErr } = await recsQuery;
    if (recsErr) throw recsErr;

    if (!recs || recs.length === 0) {
      return json({ ok: true, pushed: 0, failed: 0, skipped: 0, message: "No approved recs pending push." });
    }

    const ratePath =
      Deno.env.get("PREVIO_RATE_UPDATE_PATH") ||
      "/v1/rates/update"; // placeholder until Previo confirms exact endpoint

    let pushed = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const rec of recs as any[]) {
      const payload = {
        hotelId: cfg.pms_hotel_id,
        rateId: defaultMap.previo_rate_plan_id,
        roomTypeId: defaultMap.previo_room_type_id,
        date: rec.stay_date,
        priceEur: rec.recommended_rate_eur,
      };

      try {
        const { response } = await fetchPrevioWithAuth({
          credentialsSecretName: cfg.credentials_secret_name,
          path: ratePath,
          pmsHotelId: String(cfg.pms_hotel_id || ""),
          method: "POST",
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Previo ${response.status}: ${text.slice(0, 200)}`);
        }

        await supabase
          .from("rate_recommendations")
          .update({ pushed_at: new Date().toISOString() })
          .eq("id", rec.id);

        await supabase.from("rate_history").insert({
          hotel_id: hotelId,
          organization_slug: cfg.organization_slug,
          stay_date: rec.stay_date,
          old_rate_eur: rec.current_rate_eur,
          new_rate_eur: rec.recommended_rate_eur,
          source: "previo_push",
          notes: rec.reason ?? null,
        });

        pushed++;
      } catch (e: any) {
        failed++;
        errors.push({ stay_date: rec.stay_date, error: e.message ?? String(e) });
        console.error("push failed", rec.stay_date, e);
      }
    }

    await supabase.from("pms_sync_history").insert({
      sync_type: "rate_push",
      direction: "to_previo",
      hotel_id: hotelId,
      sync_status: failed === 0 ? "success" : pushed === 0 ? "failed" : "partial",
      data: { pushed, failed, errors: errors.slice(0, 10) },
      error_message: failed > 0 ? errors[0]?.error : null,
    });

    return json({ ok: true, pushed, failed, errors });
  } catch (e: any) {
    console.error("previo-push-rates error", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
