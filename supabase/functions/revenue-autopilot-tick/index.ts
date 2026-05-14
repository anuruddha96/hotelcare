// Revenue Autopilot — top-down decay + pickup-velocity surge detector.
//
// HARD-GATED: only runs for hotels with `hotel_revenue_settings.autopilot_enabled = true`.
// (Previo-test is intended to be the first; manager toggles others on later.)
//
// On each tick (called from LiveSyncContext after revenue pull, or by cron):
//   A. DECAY — for each stay_date in [today, today + decay_window_days] where the
//      latest pickup snapshot shows zero new arrivals in the last 24h, drop the
//      rate by weekday/weekend decrease, clamped by floor & max-daily-change.
//      Persist as a pending rate_recommendation. Auto-approve if `auto_apply`.
//   B. SURGE — for each stay_date in [today, today + decay_window_days], count
//      arrivals captured in the last `surge_window_minutes`. If ≥ surge_threshold,
//      insert booking_velocity_event + raise rate by surge_increase_eur.
//      Mark priority='urgent' if window <14d or arrivals ≥ 3.
//   C. AUDIT — every action logged in `autopilot_decisions`.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Settings {
  hotel_id: string;
  organization_slug: string;
  floor_price_eur: number;
  max_daily_change_eur: number;
  weekday_decrease_eur: number;
  weekend_decrease_eur: number;
  surge_threshold: number;
  surge_window_minutes: number;
  surge_increase_eur: number;
  decay_window_days: number;
  auto_apply: boolean;
  autopilot_enabled: boolean;
  pickup_increase_tiers: { min: number; max: number; increase: number }[];
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: string, n: number): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
  return d === 5 || d === 6;
}
function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(SUPABASE_URL, SERVICE);

    const body = await req.json().catch(() => ({}));
    const explicitHotelId: string | null = body.hotelId || null;

    // Pick hotels to process: explicit, or all with autopilot_enabled.
    let q = service
      .from("hotel_revenue_settings")
      .select("*")
      .eq("autopilot_enabled", true);
    if (explicitHotelId) q = q.eq("hotel_id", explicitHotelId);
    const { data: settingsRows } = await q;
    if (!settingsRows || settingsRows.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, message: "No hotels with autopilot enabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summaries: any[] = [];
    for (const s of settingsRows as any[]) {
      const settings = s as Settings;
      const summary = await processHotel(service, settings);
      summaries.push(summary);
    }

    return new Response(JSON.stringify({ ok: true, processed: summaries.length, summaries }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("revenue-autopilot-tick error:", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processHotel(service: any, settings: Settings) {
  const today = isoDate(new Date());
  const horizon = addDays(today, settings.decay_window_days);
  const orgSlug = settings.organization_slug || "rdhotels";

  // Load current daily rates and recent pickup snapshots in window.
  const [{ data: rates }, { data: pickups }, { data: roomTypes }] = await Promise.all([
    service.from("daily_rates").select("stay_date,rate_eur")
      .eq("hotel_id", settings.hotel_id).gte("stay_date", today).lte("stay_date", horizon).limit(2000),
    service.from("pickup_snapshots").select("stay_date,bookings_current,delta,captured_at,snapshot_label")
      .eq("hotel_id", settings.hotel_id).gte("stay_date", today).lte("stay_date", horizon)
      .order("captured_at", { ascending: false }).limit(5000),
    service.from("room_types").select("min_price_eur,max_price_eur,is_reference,base_price_eur")
      .eq("hotel_id", settings.hotel_id),
  ]);

  const refRoom = (roomTypes ?? []).find((r: any) => r.is_reference) ?? (roomTypes ?? [])[0];
  const minPrice = Math.max(
    Number(settings.floor_price_eur) || 0,
    Number(refRoom?.min_price_eur) || 0,
  );
  const maxPrice = Number(refRoom?.max_price_eur) || Infinity;

  const rateByDate = new Map<string, number>();
  for (const r of rates ?? []) rateByDate.set(r.stay_date, Number(r.rate_eur));

  // Group pickup snapshots per stay_date, newest first.
  const snapsByDate = new Map<string, any[]>();
  for (const s of pickups ?? []) {
    const arr = snapsByDate.get(s.stay_date) ?? [];
    arr.push(s);
    snapsByDate.set(s.stay_date, arr);
  }

  const nowMs = Date.now();
  const surgeWindowMs = settings.surge_window_minutes * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  let decayApplied = 0;
  let surgesDetected = 0;
  let recsCreated = 0;
  const decisions: any[] = [];
  const velocityEvents: any[] = [];
  const newRecs: any[] = [];

  for (let i = 0; i < settings.decay_window_days; i++) {
    const stayDate = addDays(today, i);
    const snaps = snapsByDate.get(stayDate) ?? [];
    const latest = snaps[0];
    const currentRate = rateByDate.get(stayDate);
    if (currentRate == null) continue;

    // ---- B. SURGE detection (priority over decay) ----
    // Sum bookings_current captured within the last `surge_window_minutes`
    // that increased vs the immediately prior snapshot.
    let arrivalsInWindow = 0;
    for (let j = 0; j < snaps.length - 1; j++) {
      const cur = snaps[j];
      const prev = snaps[j + 1];
      const ageMs = nowMs - new Date(cur.captured_at).getTime();
      if (ageMs > surgeWindowMs) break;
      const inc = Number(cur.bookings_current) - Number(prev.bookings_current);
      if (inc > 0) arrivalsInWindow += inc;
    }
    // Also catch the very first snapshot in window (no "prev" to compare to)
    if (snaps.length === 1 && nowMs - new Date(snaps[0].captured_at).getTime() <= surgeWindowMs) {
      arrivalsInWindow = Math.max(arrivalsInWindow, Number(snaps[0].bookings_current) || 0);
    }

    if (arrivalsInWindow >= settings.surge_threshold) {
      const daysOut = i;
      const urgent = arrivalsInWindow >= 3 || daysOut < 14;
      const baseIncrease = settings.surge_increase_eur || 25;
      const increase = Math.min(
        urgent ? Math.max(baseIncrease, 30) : baseIncrease,
        Number(settings.max_daily_change_eur) || baseIncrease,
      );
      const newRate = Math.min(maxPrice, currentRate + increase);

      // De-dup: skip if a velocity event already exists for this hotel/date in the same hour bucket.
      const hourBucket = new Date(Math.floor(nowMs / 3600000) * 3600000).toISOString();
      const { data: dup } = await service.from("booking_velocity_events")
        .select("id").eq("hotel_id", settings.hotel_id).eq("stay_date", stayDate)
        .gte("detected_at", hourBucket).limit(1).maybeSingle();

      if (!dup) {
        velocityEvents.push({
          hotel_id: settings.hotel_id,
          organization_slug: orgSlug,
          stay_date: stayDate,
          arrivals_in_window: arrivalsInWindow,
          window_minutes: settings.surge_window_minutes,
          recommended_increase_eur: increase,
        });
        newRecs.push({
          hotel_id: settings.hotel_id,
          organization_slug: orgSlug,
          stay_date: stayDate,
          current_rate_eur: currentRate,
          recommended_rate_eur: newRate,
          delta_eur: newRate - currentRate,
          reason: `Surge: ${arrivalsInWindow} bookings in ${settings.surge_window_minutes} min`,
          status: settings.auto_apply ? "approved" : "pending",
          priority: urgent ? "urgent" : "normal",
          auto_generated: true,
          source_kind: "surge",
        });
        decisions.push({
          hotel_id: settings.hotel_id,
          organization_slug: orgSlug,
          stay_date: stayDate,
          decision_type: "surge",
          before_rate_eur: currentRate,
          after_rate_eur: newRate,
          delta_eur: newRate - currentRate,
          reason: `Pickup surge: ${arrivalsInWindow} arrivals in ${settings.surge_window_minutes}m`,
          meta: { arrivalsInWindow, daysOut, urgent },
        });
        // Also raise an alert
        await service.from("revenue_alerts").insert({
          hotel_id: settings.hotel_id,
          organization_slug: orgSlug,
          stay_date: stayDate,
          alert_type: "pickup_surge",
          payload: { arrivalsInWindow, recommendedIncrease: increase, urgent },
        });
        surgesDetected += 1;
        recsCreated += 1;
      }
      continue; // surge handled; skip decay for this date
    }

    // ---- A. DECAY ----
    // Decay only if no pickup in last 24h.
    let arrivalsLast24h = 0;
    for (const s of snaps) {
      const ageMs = nowMs - new Date(s.captured_at).getTime();
      if (ageMs > dayMs) break;
      arrivalsLast24h += Number(s.delta) || 0;
    }
    if (arrivalsLast24h > 0) continue;        // there was pickup, don't decay
    if (currentRate <= minPrice) continue;    // already at floor

    // Skip the very last day before stay to avoid undercutting last-minute walk-ins.
    if (i < 2) continue;

    const decAmount = isWeekend(stayDate)
      ? Number(settings.weekend_decrease_eur) || 0
      : Number(settings.weekday_decrease_eur) || 0;
    if (decAmount <= 0) continue;

    const proposedRate = Math.max(minPrice, currentRate - decAmount);
    const cappedDelta = Math.max(-Number(settings.max_daily_change_eur), proposedRate - currentRate);
    const newRate = Math.round(currentRate + cappedDelta);
    if (newRate >= currentRate) continue;

    // De-dup: skip if a pending decay rec already exists for today on this date.
    const { data: existingRec } = await service.from("rate_recommendations")
      .select("id").eq("hotel_id", settings.hotel_id).eq("stay_date", stayDate)
      .eq("status", "pending").eq("auto_generated", true).eq("source_kind", "decay")
      .gte("created_at", new Date(nowMs - dayMs).toISOString()).limit(1).maybeSingle();
    if (existingRec) continue;

    newRecs.push({
      hotel_id: settings.hotel_id,
      organization_slug: orgSlug,
      stay_date: stayDate,
      current_rate_eur: currentRate,
      recommended_rate_eur: newRate,
      delta_eur: newRate - currentRate,
      reason: `Top-down decay (no pickup 24h, ${i}d out)`,
      status: settings.auto_apply ? "approved" : "pending",
      priority: "normal",
      auto_generated: true,
      source_kind: "decay",
    });
    decisions.push({
      hotel_id: settings.hotel_id,
      organization_slug: orgSlug,
      stay_date: stayDate,
      decision_type: "decay",
      before_rate_eur: currentRate,
      after_rate_eur: newRate,
      delta_eur: newRate - currentRate,
      reason: `No pickup in 24h, decay €${decAmount}`,
      meta: { daysOut: i, weekend: isWeekend(stayDate) },
    });
    decayApplied += 1;
    recsCreated += 1;
  }

  // Persist
  if (velocityEvents.length > 0) {
    await service.from("booking_velocity_events").insert(velocityEvents);
  }
  let insertedRecs: any[] = [];
  if (newRecs.length > 0) {
    const { data } = await service.from("rate_recommendations").insert(newRecs).select("id,stay_date,recommended_rate_eur,current_rate_eur,status,source_kind");
    insertedRecs = data ?? [];

    // If auto_apply, also write rate_history rows + update daily_rates.
    if (settings.auto_apply) {
      const histRows = insertedRecs.map((r: any) => ({
        hotel_id: settings.hotel_id,
        organization_slug: orgSlug,
        stay_date: r.stay_date,
        old_rate_eur: r.current_rate_eur,
        new_rate_eur: r.recommended_rate_eur,
        source: "autopilot",
        notes: `auto-applied (${r.source_kind})`,
      }));
      await service.from("rate_history").insert(histRows);

      for (const r of insertedRecs) {
        await service.from("daily_rates").upsert({
          hotel_id: settings.hotel_id,
          organization_slug: orgSlug,
          stay_date: r.stay_date,
          rate_eur: r.recommended_rate_eur,
          source: "autopilot",
        }, { onConflict: "hotel_id,stay_date" });
      }
    }
  }
  if (decisions.length > 0) {
    await service.from("autopilot_decisions").insert(decisions);
  }

  return {
    hotel_id: settings.hotel_id,
    decayApplied,
    surgesDetected,
    recsCreated,
    autoApplied: settings.auto_apply,
  };
}
