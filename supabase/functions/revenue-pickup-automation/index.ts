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
  application_scope: "booked_room_type" | "all_room_types";
  positive_pickup_enabled: boolean;
  pickup_lookback_hours: number;
  no_pickup_enabled: boolean;
  no_pickup_lookback_hours: number;
  future_booking_window_days: number;
  no_pickup_run_times: string[];
  run_timezone: string;
  no_pickup_decrease: number;
  max_daily_decrease_per_date: number;
  currency: string;
  last_no_pickup_slot: string | null;
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

function localParts(timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}

const minutesOf = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

/** UTC instant at which the property's local business day started. */
function localDayStartUtc(timeZone: string): string {
  const { date, time } = localParts(timeZone);
  const elapsedMs = minutesOf(time) * 60_000;
  void date;
  return new Date(Date.now() - elapsedMs).toISOString();
}


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

    // Recovery backstop for a browser/tab or Edge Runtime that stopped after
    // enqueueing. Absolute target prices make this safe to resume.
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: recoveryRuns } = await admin.from("revenue_rate_push_runs")
      .select("id,hotel_id,status,started_at").or(`status.eq.queued,and(status.eq.processing,started_at.lt.${staleBefore})`)
      .order("created_at", { ascending: true }).limit(5);
    for (const run of (recoveryRuns ?? []) as any[]) {
      const { data: recoveryItems } = await admin.from("revenue_rate_push_items")
        .select("draft_id").eq("run_id", run.id).in("status", ["queued", "processing", "failed"]);
      const ids = (recoveryItems ?? []).map((item: any) => item.draft_id).filter(Boolean);
      if (ids.length === 0) continue;
      const work = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-push-drafts`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-engine-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
        body: JSON.stringify({ hotelId: run.hotel_id, draftIds: ids, pushRunId: run.id }),
      });
      (globalThis as any).EdgeRuntime?.waitUntil(work);
    }

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

      // 1. New booking nights Hotel Care captured since the cursor. The cursor
      //    follows capture time, not Previo's creation time: a booking made at
      //    16:27 but only synced at 18:21 must still be priced.
      const { data: nightRows, error: nightErr } = await admin
        .from("revenue_booking_nights")
        .select("stay_date, res_id, created_at_pms, captured_at, obk_id, room_type_name, guests")
        .eq("hotel_id", rule.hotel_id)
        .gte("stay_date", today)
        .gte("captured_at", lookbackFrom)
        .limit(5000);
      if (nightErr) throw nightErr;

      const pickups = (nightRows ?? []) as Array<{
        stay_date: string; res_id: string; created_at_pms: string;
        obk_id: string | null; room_type_name: string | null; guests: number | null;
      }>;

      // No-pickup markdowns run only once per configured local-time slot. They
      // never share the positive-pickup path, so a negative pickup cannot raise
      // a price and a stay date cannot move in both directions in one tick.
      let markdownActions = 0;
      if (rule.no_pickup_enabled) {
        const local = localParts(rule.run_timezone || "Europe/Budapest");
        const nowMinutes = minutesOf(local.time);
        const slot = (rule.no_pickup_run_times ?? []).find((candidate) => {
          const delta = nowMinutes - minutesOf(candidate);
          return delta >= 0 && delta < 15 && rule.last_no_pickup_slot !== `${local.date}|${candidate}`;
        });
        if (slot) {
          const horizon = new Date(`${local.date}T00:00:00Z`);
          horizon.setUTCDate(horizon.getUTCDate() + Math.max(1, Number(rule.future_booking_window_days || 183)));
          const horizonDate = horizon.toISOString().slice(0, 10);
          const observationFrom = new Date(Date.now() - Math.max(1, Number(rule.no_pickup_lookback_hours || 8)) * 3_600_000).toISOString();
          const [{ data: recentBookings }, { data: recentCancellations }, { data: horizonRates }, { data: markdownToday }] = await Promise.all([
            admin.from("revenue_booking_nights").select("stay_date").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).lte("stay_date", horizonDate).gte("created_at_pms", observationFrom).limit(20000),
            admin.from("revenue_cancelled_nights").select("stay_date").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).lte("stay_date", horizonDate).gte("cancelled_at", observationFrom).limit(20000),
            admin.from("revenue_room_type_rates").select("stay_date, obk_id, room_type_name, occupancy, price, currency, captured_at").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).lte("stay_date", horizonDate).order("captured_at", { ascending: false }).limit(50000),
            admin.from("revenue_pickup_automation_actions").select("stay_date, increase_amount").eq("hotel_id", rule.hotel_id).eq("decision_type", "no_pickup_markdown").eq("local_business_date", local.date).limit(50000),
          ]);
          const positiveDates = new Set((recentBookings ?? []).map((row: any) => row.stay_date));
          const negativeDates = new Set((recentCancellations ?? []).map((row: any) => row.stay_date));
          const decreasedToday = new Map<string, number>();
          for (const action of (markdownToday ?? []) as any[]) decreasedToday.set(action.stay_date, (decreasedToday.get(action.stay_date) ?? 0) + Math.abs(Number(action.increase_amount || 0)));
          const latest = new Map<string, any>();
          for (const rate of (horizonRates ?? []) as any[]) {
            const key = `${rate.stay_date}|${rate.obk_id}|${rate.occupancy}`;
            if (!latest.has(key)) latest.set(key, rate);
          }
          const markdownRows: any[] = [];
          const markdownDrafts: any[] = [];
          for (const rate of latest.values()) {
            if (positiveDates.has(rate.stay_date)) continue;
            const already = decreasedToday.get(rate.stay_date) ?? 0;
            const remaining = Math.max(0, Number(rule.max_daily_decrease_per_date || 10) - already);
            if (remaining <= 0) continue;
            const decrease = Math.min(Math.max(1, Number(rule.no_pickup_decrease || 2)), 3, remaining);
            const oldPrice = Number(rate.price);
            const floor = Number(rule.minimum_adr || 0);
            const newPrice = Math.max(floor, Math.round(oldPrice - decrease));
            if (!Number.isFinite(oldPrice) || newPrice >= oldPrice) continue;
            decreasedToday.set(rate.stay_date, already + (oldPrice - newPrice));
            markdownRows.push({
              rule_id: rule.id, rule_version: rule.version, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
              reservation_id: null, stay_date: rate.stay_date, pickup_at: null, pickup_sequence: 0,
              room_type_name: rate.room_type_name, obk_id: String(rate.obk_id), occupancy: Number(rate.occupancy) || 2,
              old_price: oldPrice, increase_amount: newPrice - oldPrice, new_price: newPrice,
              status: rule.auto_publish ? "queued" : "suggested", decision_type: "no_pickup_markdown",
              observation_from: observationFrom, observation_to: runStartedAt, net_pickup: negativeDates.has(rate.stay_date) ? -1 : 0,
              schedule_slot: slot, local_business_date: local.date, cap_applied: oldPrice - newPrice,
            });
            if (rule.auto_publish) markdownDrafts.push({
              hotel_id: rule.hotel_id, organization_slug: rule.organization_slug, stay_date: rate.stay_date,
              obk_id: String(rate.obk_id), room_type_name: rate.room_type_name, occupancy: Number(rate.occupancy) || 2,
              old_price: oldPrice, new_price: newPrice, currency: rate.currency ?? rule.currency ?? "EUR", status: "draft",
            });
          }
          if (!dryRun && markdownRows.length > 0) {
            const { data: insertedMarkdowns, error: markdownError } = await admin.from("revenue_pickup_automation_actions")
              .upsert(markdownRows, { onConflict: "hotel_id,stay_date,obk_id,occupancy,rule_version,schedule_slot,local_business_date", ignoreDuplicates: true })
              .select("stay_date,obk_id,occupancy");
            if (markdownError) throw markdownError;
            const accepted = new Set((insertedMarkdowns ?? []).map((row: any) => `${row.stay_date}|${row.obk_id}|${row.occupancy}`));
            const payload = markdownDrafts.filter((row) => accepted.has(`${row.stay_date}|${row.obk_id}|${row.occupancy}`));
            markdownActions = payload.length;
            if (payload.length > 0) {
              const runId = crypto.randomUUID();
              await admin.from("revenue_rate_push_runs").insert({ id: runId, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug, source: "automation", requested_count: payload.length });
              const { data: drafts, error: draftError } = await admin.from("revenue_rate_drafts").insert(payload.map((row) => ({ ...row, push_run_id: runId, confirmation_status: "sending" }))).select("id,stay_date,room_type_name,occupancy");
              if (draftError) throw draftError;
              const draftMap = new Map((drafts ?? []).map((row: any) => [`${row.stay_date}|${row.room_type_name}|${row.occupancy}`, row.id]));
              await admin.from("revenue_rate_push_items").insert(payload.map((row) => ({ run_id: runId, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug, stay_date: row.stay_date, obk_id: row.obk_id, room_type_name: row.room_type_name, occupancy: row.occupancy, old_price: row.old_price, target_price: row.new_price, currency: row.currency, draft_id: draftMap.get(`${row.stay_date}|${row.room_type_name}|${row.occupancy}`) })));
              const work = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-push-drafts`, { method: "POST", headers: { "Content-Type": "application/json", "x-engine-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! }, body: JSON.stringify({ hotelId: rule.hotel_id, draftIds: (drafts ?? []).map((row: any) => row.id), pushRunId: runId }) });
              (globalThis as any).EdgeRuntime?.waitUntil(work);
            }
          }
          if (!dryRun) await admin.from("revenue_pickup_automation_rules").update({ last_no_pickup_slot: `${local.date}|${slot}` }).eq("id", rule.id);
        }
      }
      if (pickups.length === 0) {
        await admin.from("revenue_pickup_automation_rules")
          .update({ last_run_at: runStartedAt }).eq("id", rule.id);
        summary.push({ hotel_id: rule.hotel_id, pickups: 0, actions: markdownActions, markdowns: markdownActions });
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

      // 2b. Net pickup per stay date over the last 48 hours. A re-sync of an
      //     old booking is not pickup, and a day that lost more nights than it
      //     gained must never be priced up — surge only follows real,
      //     positive, brand-new demand.
      const NEW_BOOKING_MAX_AGE_MS = Math.max(1, Number(rule.pickup_lookback_hours || 48)) * 60 * 60 * 1000;
      const freshFrom = new Date(Date.now() - NEW_BOOKING_MAX_AGE_MS).toISOString();
      const netPickup = new Map<string, number>();
      for (const h of history) {
        if (h.created_at_pms >= freshFrom) {
          netPickup.set(h.stay_date, (netPickup.get(h.stay_date) ?? 0) + 1);
        }
      }
      const { data: cancelRows } = await admin
        .from("revenue_cancelled_nights")
        .select("stay_date, cancelled_at")
        .eq("hotel_id", rule.hotel_id)
        .in("stay_date", stayDates)
        .gte("cancelled_at", freshFrom)
        .limit(20000);
      for (const c of (cancelRows ?? []) as Array<{ stay_date: string; cancelled_at: string }>) {
        netPickup.set(c.stay_date, (netPickup.get(c.stay_date) ?? 0) - 1);
      }

      // 2c. Same guard, but for today only: a booking taken yesterday must not
      //     raise a price on a day whose only movement today is cancellations.
      const dayStartUtc = localDayStartUtc(rule.run_timezone || "Europe/Budapest");
      const netToday = new Map<string, number>();
      for (const h of history) {
        if (h.created_at_pms >= dayStartUtc) netToday.set(h.stay_date, (netToday.get(h.stay_date) ?? 0) + 1);
      }
      for (const c of (cancelRows ?? []) as Array<{ stay_date: string; cancelled_at: string }>) {
        if (c.cancelled_at >= dayStartUtc) netToday.set(c.stay_date, (netToday.get(c.stay_date) ?? 0) - 1);
      }


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
        .select("stay_date, reservation_id, increase_amount")
        .eq("hotel_id", rule.hotel_id)
        .in("stay_date", stayDates)
        .gte("created_at", dayStart)
        .limit(20000);
      const raisedByEvent = new Map<string, number>();
      for (const a of (todaysActions ?? []) as any[]) {
        const eventKey = `${a.stay_date}|${a.reservation_id ?? ""}`;
        raisedByEvent.set(eventKey, Math.max(raisedByEvent.get(eventKey) ?? 0, Number(a.increase_amount || 0)));
      }
      const raisedToday = new Map<string, number>();
      for (const [eventKey, amount] of raisedByEvent) {
        const stayDate = eventKey.split("|")[0];
        raisedToday.set(stayDate, (raisedToday.get(stayDate) ?? 0) + amount);
      }

      // 5. One decision per (stay_date, reservation).
      const seen = new Set<string>();
      const events: Array<{
        stay_date: string; res_id: string; at: string; sequence: number;
        obk_id: string | null; room_type_name: string | null; guests: number | null;
      }> = [];
      let skippedStale = 0;
      let skippedNegative = 0;
      for (const p of pickups) {
        if (rule.positive_pickup_enabled === false) continue;
        const key = `${p.stay_date}|${p.res_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Only a booking Previo itself created today (property-local) is
        // pickup — a re-synced or older booking must not move a price.
        if (!p.created_at_pms || p.created_at_pms < freshFrom) { skippedStale++; continue; }
        if (p.created_at_pms < dayStartUtc) { skippedStale++; continue; }
        // And the stay date must be up both over the window and today, so a
        // day whose only movement today is cancellations never goes up.
        if ((netPickup.get(p.stay_date) ?? 0) <= 0) { skippedNegative++; continue; }
        if ((netToday.get(p.stay_date) ?? 0) <= 0) { skippedNegative++; continue; }

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
        events.push({
          stay_date: p.stay_date, res_id: p.res_id, at: p.created_at_pms,
          sequence: earlier.size + 1, obk_id: p.obk_id,
          room_type_name: p.room_type_name, guests: p.guests,
        });
      }
      events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

      const draftsToInsert: any[] = [];
      const actionsToInsert: any[] = [];

      for (const ev of events) {
        const daysOut = dayDiff(today, ev.stay_date);
        if (daysOut < 0) continue;

        // The 2nd booking inside the window is the "heat" signal: it takes the
        // surcharge instead of the ordinary booking-window tier.
        const base = tierIncrease(rule.booking_window_tiers ?? [], daysOut);
        let increase = ev.sequence >= 2 ? Number(rule.second_pickup_surcharge || 0) : base;
        if (rule.maximum_increase) increase = Math.min(increase, Number(rule.maximum_increase));
        if (increase <= 0) continue;

        const already = raisedToday.get(ev.stay_date) ?? 0;
        const room = Math.max(0, Number(rule.max_daily_increase_per_date || 0) - already);
        if (room <= 0) continue;
        increase = Math.min(increase, room);
        raisedToday.set(ev.stay_date, already + increase);

        for (const rate of latestRate.values()) {
          if (rate.stay_date !== ev.stay_date) continue;
          if (rule.application_scope !== "all_room_types") {
            const rateObk = String(rate.obk_id ?? "").split(":").pop();
            const eventObk = String(ev.obk_id ?? "").split(":").pop();
            const sameRoom = eventObk
              ? rateObk === eventObk
              : String(rate.room_type_name ?? "").trim().toLowerCase() === String(ev.room_type_name ?? "").trim().toLowerCase();
            if (!sameRoom) continue;
          }
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
        skipped_not_new: skippedStale, skipped_negative_pickup: skippedNegative,
        actions: inserted, pushed, auto_publish: rule.auto_publish,
      });
    }

    return json({ ok: true, rules: rules.length, summary });
  } catch (e) {
    console.error("pickup automation failed", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
