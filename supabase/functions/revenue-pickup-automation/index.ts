// Pickup price automation.
//
// When a new booking lands for a stay date, the rule raises that date's prices
// by a tier that depends on how far away the stay is, plus a surcharge when
// several bookings arrive inside the same short window. Only stay dates that
// actually picked up are touched — nothing else on the calendar moves.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Tier { max_days: number | null; increase: number }

interface Rule {
  id: string;
  hotel_id: string;
  organization_slug: string | null;
  name: string;
  is_enabled: boolean;
  auto_publish: boolean;
  booking_window_tiers: Tier[];
  same_hour_window_minutes: number;
  second_pickup_surcharge: number;
  minimum_adr: number | null;
  maximum_increase: number | null;
  max_daily_increase_per_date: number;
  version: number;
  last_run_at: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Tiers are ordered by how far out the stay is; the last tier is the catch-all. */
function tierIncrease(tiers: Tier[], daysOut: number): number {
  for (const tier of tiers) {
    if (tier.max_days === null || tier.max_days === undefined) return Number(tier.increase) || 0;
    if (daysOut <= Number(tier.max_days)) return Number(tier.increase) || 0;
  }
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({} as any));
    const onlyHotel: string | null = typeof body.hotelId === "string" ? body.hotelId : null;
    const dryRun: boolean = body.dryRun === true;

    let q = admin.from("revenue_pickup_automation_rules").select("*").eq("is_enabled", true);
    if (onlyHotel) q = q.eq("hotel_id", onlyHotel);
    const { data: ruleRows, error: ruleErr } = await q;
    if (ruleErr) throw ruleErr;

    const rules = (ruleRows ?? []) as unknown as Rule[];
    const summary: Array<Record<string, unknown>> = [];

    for (const rule of rules) {
      const runStartedAt = new Date().toISOString();
      const today = new Date().toISOString().slice(0, 10);
      // Look back a little further than the last run so a missed tick still
      // catches its pickups; the unique index stops double-charging.
      const lookbackFrom = new Date(
        Math.max(
          Date.parse(rule.last_run_at ?? "") || 0,
          Date.now() - 6 * 60 * 60 * 1000,
        ),
      ).toISOString();

      // 1. New booking nights created since the cursor.
      const { data: nightRows, error: nightErr } = await admin
        .from("revenue_booking_nights")
        .select("stay_date, res_id, created_at_pms")
        .eq("hotel_id", rule.hotel_id)
        .gte("stay_date", today)
        .gte("created_at_pms", lookbackFrom)
        .limit(5000);
      if (nightErr) throw nightErr;

      const pickups = (nightRows ?? []) as Array<{ stay_date: string; res_id: string; created_at_pms: string }>;
      if (pickups.length === 0) {
        await admin.from("revenue_pickup_automation_rules")
          .update({ last_run_at: runStartedAt }).eq("id", rule.id);
        summary.push({ hotel_id: rule.hotel_id, pickups: 0, actions: 0 });
        continue;
      }

      const stayDates = Array.from(new Set(pickups.map((p) => p.stay_date))).sort();

      // 2. All bookings for those stay dates, so pickup sequence inside the
      //    same window can be counted honestly (not just this batch).
      const { data: historyRows } = await admin
        .from("revenue_booking_nights")
        .select("stay_date, res_id, created_at_pms")
        .eq("hotel_id", rule.hotel_id)
        .in("stay_date", stayDates)
        .limit(20000);
      const history = (historyRows ?? []) as Array<{ stay_date: string; res_id: string; created_at_pms: string }>;

      // 3. Current prices per stay date / room type / occupancy (newest wins).
      const { data: rateRows } = await admin
        .from("revenue_room_type_rates")
        .select("stay_date, obk_id, room_type_name, occupancy, price, currency, captured_at")
        .eq("hotel_id", rule.hotel_id)
        .in("stay_date", stayDates)
        .order("captured_at", { ascending: false })
        .limit(20000);
      const latestRate = new Map<string, any>();
      for (const r of (rateRows ?? []) as any[]) {
        const key = `${r.stay_date}|${r.obk_id}|${r.occupancy}`;
        if (!latestRate.has(key)) latestRate.set(key, r);
      }

      // 4. How much this stay date already went up today (daily cap).
      const dayStart = `${today}T00:00:00Z`;
      const { data: todaysActions } = await admin
        .from("revenue_pickup_automation_actions")
        .select("stay_date, increase_amount")
        .eq("hotel_id", rule.hotel_id)
        .in("stay_date", stayDates)
        .gte("created_at", dayStart)
        .limit(20000);
      const raisedToday = new Map<string, number>();
      for (const a of (todaysActions ?? []) as any[]) {
        raisedToday.set(a.stay_date, (raisedToday.get(a.stay_date) ?? 0) + Number(a.increase_amount || 0));
      }

      // 5. One decision per (stay_date, reservation).
      const seen = new Set<string>();
      const events: Array<{ stay_date: string; res_id: string; at: string; sequence: number }> = [];
      for (const p of pickups) {
        const key = `${p.stay_date}|${p.res_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const at = Date.parse(p.created_at_pms);
        if (!Number.isFinite(at)) continue;
        const windowMs = Math.max(1, rule.same_hour_window_minutes) * 60_000;
        const earlier = new Set(
          history
            .filter((h) =>
              h.stay_date === p.stay_date &&
              h.res_id !== p.res_id &&
              Date.parse(h.created_at_pms) <= at &&
              at - Date.parse(h.created_at_pms) <= windowMs
            )
            .map((h) => h.res_id),
        );
        events.push({ stay_date: p.stay_date, res_id: p.res_id, at: p.created_at_pms, sequence: earlier.size + 1 });
      }
      events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

      const draftsToInsert: any[] = [];
      const actionsToInsert: any[] = [];

      for (const ev of events) {
        const daysOut = dayDiff(today, ev.stay_date);
        if (daysOut < 0) continue;

        // The 3rd booking inside the window is the "heat" signal: it takes the
        // surcharge instead of the ordinary booking-window tier.
        const base = tierIncrease(rule.booking_window_tiers ?? [], daysOut);
        let increase = ev.sequence >= 3 ? Number(rule.second_pickup_surcharge || 0) : base;
        if (rule.maximum_increase) increase = Math.min(increase, Number(rule.maximum_increase));
        if (increase <= 0) continue;

        const already = raisedToday.get(ev.stay_date) ?? 0;
        const room = Math.max(0, Number(rule.max_daily_increase_per_date || 0) - already);
        if (room <= 0) continue;
        increase = Math.min(increase, room);
        raisedToday.set(ev.stay_date, already + increase);

        for (const rate of latestRate.values()) {
          if (rate.stay_date !== ev.stay_date) continue;
          const oldPrice = Number(rate.price);
          if (!Number.isFinite(oldPrice) || oldPrice <= 0) continue;
          let newPrice = Math.round(oldPrice + increase);
          if (rule.minimum_adr && newPrice < Number(rule.minimum_adr)) newPrice = Math.round(Number(rule.minimum_adr));
          if (newPrice === oldPrice) continue;

          actionsToInsert.push({
            rule_id: rule.id,
            rule_version: rule.version,
            hotel_id: rule.hotel_id,
            organization_slug: rule.organization_slug,
            reservation_id: String(ev.res_id),
            stay_date: ev.stay_date,
            pickup_at: ev.at,
            pickup_sequence: ev.sequence,
            room_type_name: rate.room_type_name,
            obk_id: String(rate.obk_id),
            occupancy: Number(rate.occupancy) || 2,
            old_price: oldPrice,
            increase_amount: newPrice - oldPrice,
            new_price: newPrice,
            status: rule.auto_publish ? "queued" : "suggested",
          });

          if (rule.auto_publish) {
            draftsToInsert.push({
              hotel_id: rule.hotel_id,
              organization_slug: rule.organization_slug,
              stay_date: ev.stay_date,
              obk_id: String(rate.obk_id),
              room_type_name: rate.room_type_name,
              occupancy: Number(rate.occupancy) || 2,
              old_price: oldPrice,
              new_price: newPrice,
              currency: rate.currency ?? "EUR",
              status: "draft",
            });
          }
        }
      }

      if (dryRun) {
        summary.push({
          hotel_id: rule.hotel_id, pickups: events.length,
          actions: actionsToInsert.length, dryRun: true,
          preview: actionsToInsert.slice(0, 10),
        });
        continue;
      }

      let inserted = 0;
      if (actionsToInsert.length > 0) {
        // The unique index makes a repeated tick a no-op for the same event.
        const { data: ins, error: insErr } = await admin
          .from("revenue_pickup_automation_actions")
          .upsert(actionsToInsert, {
            onConflict: "hotel_id,stay_date,reservation_id,obk_id,occupancy",
            ignoreDuplicates: true,
          })
          .select("id, stay_date, obk_id, occupancy");
        if (insErr) throw insErr;
        inserted = (ins ?? []).length;
      }

      let pushed = 0;
      // Only publish prices for events that were genuinely new this tick.
      if (rule.auto_publish && inserted > 0 && draftsToInsert.length > 0) {
        const insertedKeys = new Set<string>();
        const { data: freshRows } = await admin
          .from("revenue_pickup_automation_actions")
          .select("stay_date, obk_id, occupancy")
          .eq("hotel_id", rule.hotel_id)
          .eq("status", "queued")
          .gte("created_at", runStartedAt);
        for (const r of (freshRows ?? []) as any[]) {
          insertedKeys.add(`${r.stay_date}|${r.obk_id}|${r.occupancy}`);
        }
        const payload = draftsToInsert.filter((d) =>
          insertedKeys.has(`${d.stay_date}|${d.obk_id}|${d.occupancy}`)
        );
        if (payload.length > 0) {
          // A cell can only carry one pending draft, so clear any stale one
          // for the same cell before writing the automated price.
          for (const d of payload) {
            await admin.from("revenue_rate_drafts").delete()
              .eq("hotel_id", d.hotel_id).eq("stay_date", d.stay_date)
              .eq("room_type_name", d.room_type_name).eq("occupancy", d.occupancy)
              .in("status", ["draft", "failed"]);
          }
          const { data: drafts, error: draftErr } = await admin
            .from("revenue_rate_drafts")
            .insert(payload)
            .select("id");
          if (draftErr) throw draftErr;
          const draftIds = ((drafts ?? []) as any[]).map((d) => d.id);

          const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-push-drafts`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-engine-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            },
            body: JSON.stringify({ hotelId: rule.hotel_id, draftIds }),
          });
          const out = await res.json().catch(() => ({}));
          pushed = Number(out?.pushed ?? 0);
          const status = pushed > 0 ? "pushed" : "failed";
          await admin.from("revenue_pickup_automation_actions")
            .update({
              status,
              pushed_at: pushed > 0 ? new Date().toISOString() : null,
              push_error: pushed > 0 ? null : (out?.error ?? "Previo did not accept the change"),
            })
            .eq("hotel_id", rule.hotel_id)
            .eq("status", "queued")
            .gte("created_at", runStartedAt);
        }
      }

      await admin.from("revenue_pickup_automation_rules")
        .update({ last_run_at: runStartedAt }).eq("id", rule.id);

      summary.push({
        hotel_id: rule.hotel_id, pickups: events.length,
        actions: inserted, pushed, auto_publish: rule.auto_publish,
      });
    }

    return json({ ok: true, rules: rules.length, summary });
  } catch (e) {
    console.error("pickup automation failed", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
