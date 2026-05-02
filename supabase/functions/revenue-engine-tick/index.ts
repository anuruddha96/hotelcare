import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Tier { min: number; max: number; increase: number; }

function tierIncrease(tiers: Tier[], n: number): number {
  for (const t of tiers) if (n >= t.min && n <= t.max) return t.increase;
  return 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const onlyHotel = body.hotel_id as string | undefined;
    const trigger = (body.trigger as string) || "cron";

    const { data: settings } = await supabase
      .from("hotel_revenue_settings")
      .select("*")
      .eq("is_engine_enabled", true);

    if (!settings || settings.length === 0) {
      return new Response(JSON.stringify({ ok: true, msg: "no settings" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + 120);
    const horizonStr = horizon.toISOString().slice(0, 10);

    let recsCreated = 0;
    let alertsCreated = 0;

    for (const s of settings) {
      if (onlyHotel && s.hotel_id !== onlyHotel) continue;

      // fetch latest 2 snapshots per stay_date for this hotel within horizon
      const { data: snaps } = await supabase
        .from("pickup_snapshots")
        .select("*")
        .eq("hotel_id", s.hotel_id)
        .gte("stay_date", today)
        .lte("stay_date", horizonStr)
        .order("captured_at", { ascending: false })
        .limit(2000);

      if (!snaps || snaps.length === 0) continue;

      // group by stay_date → [latest, prev]
      const byDate = new Map<string, any[]>();
      for (const r of snaps) {
        const arr = byDate.get(r.stay_date) ?? [];
        if (arr.length < 2) arr.push(r);
        byDate.set(r.stay_date, arr);
      }

      const tiers = (s.pickup_increase_tiers as Tier[]) ?? [];

      for (const [stay_date, arr] of byDate) {
        const latest = arr[0];
        const prev = arr[1];

        // Skip if too close
        const daysOut =
          Math.floor((Date.parse(stay_date) - Date.now()) / 86400000);
        if (daysOut < (s.skip_within_days ?? 2)) continue;

        // Determine pickup count "in window"
        const pickupInWindow = prev
          ? Math.max(0, latest.bookings_current - prev.bookings_current)
          : latest.bookings_current;

        // Get current rate (latest pending or last history)
        const { data: lastHist } = await supabase
          .from("rate_history")
          .select("new_rate_eur")
          .eq("hotel_id", s.hotel_id)
          .eq("stay_date", stay_date)
          .order("changed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const currentRate = Number(lastHist?.new_rate_eur ?? s.floor_price_eur);

        let delta = 0;
        let reason = "";

        if (pickupInWindow >= 3) {
          delta = tierIncrease(tiers, pickupInWindow);
          reason = `Pickup detected: +${pickupInWindow} bookings → +€${delta}`;
        } else if (trigger === "decrease" || trigger === "cron") {
          // Only decrease if 0 pickup and on the 12h decrease cadence
          if (pickupInWindow === 0 && trigger === "decrease") {
            const dow = new Date(stay_date).getUTCDay(); // 0=Sun..6=Sat
            const isWeekend = dow === 5 || dow === 6;
            delta = -(isWeekend ? Number(s.weekend_decrease_eur) : Number(s.weekday_decrease_eur));
            reason = `No pickup in window → ${delta}€ (${isWeekend ? "Fri/Sat" : "weekday"})`;
          }
        }

        if (delta === 0) continue;

        // Apply guards
        if (Math.abs(delta) > Number(s.max_daily_change_eur)) {
          delta = Math.sign(delta) * Number(s.max_daily_change_eur);
        }
        let newRate = Number((currentRate + delta).toFixed(2));
        if (newRate < Number(s.floor_price_eur)) {
          newRate = Number(s.floor_price_eur);
          delta = newRate - currentRate;
          if (delta === 0) continue;
        }

        await supabase.from("rate_recommendations").insert({
          hotel_id: s.hotel_id,
          organization_slug: s.organization_slug,
          stay_date,
          current_rate_eur: currentRate,
          recommended_rate_eur: newRate,
          delta_eur: delta,
          reason,
          status: "pending",
        });
        recsCreated++;

        // Abnormal pickup alert
        if (pickupInWindow >= Number(s.abnormal_pickup_threshold)) {
          await supabase.from("revenue_alerts").insert({
            hotel_id: s.hotel_id,
            organization_slug: s.organization_slug,
            stay_date,
            alert_type: "abnormal_pickup",
            payload: { bookings: pickupInWindow, recommended_increase: delta },
          });
          alertsCreated++;
        }
      }
    }

    // Expire stale (errors swallowed; non-critical)
    try { await supabase.rpc("expire_stale_recommendations"); } catch (_) { /* ignore */ }

    return new Response(
      JSON.stringify({ ok: true, recsCreated, alertsCreated, trigger }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("engine-tick error", e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
