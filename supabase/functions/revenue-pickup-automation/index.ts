// Hourly demand evaluation for one property at a time.
//
// Every cycle the scheduler hands this function exactly ONE due hotel. For that
// hotel it refreshes reservations from the PMS, then for every stay date inside
// the configured horizon it either raises the price (genuine positive pickup in
// this hour's observation window) or lowers it by a fixed amount (no pickup),
// honouring the floor, the per-stay-date daily caps and the safety guards.
//
// Delivery to Previo is asynchronous: HotelCare records the intended price and
// a serialized background publisher sends it, one hotel at a time.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  roundMoney,
  priorityOf,
  nextRunAt,
  observationWindow,
  markdownBlockReason,
  computeMarkdown,
  dateAllowedStep,
  netPickupByDate,
  effectivePrice,

} from "../_shared/pricingRules.ts";


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
  no_pickup_scope: "booked_room_type" | "all_room_types";
  evaluation_interval_minutes: number;
  next_run_at: string | null;
  last_evaluated_at: string | null;
  last_successful_evaluation_at: string | null;
  protect_high_occupancy: boolean;
  markdown_max_occupancy_pct: number;
  manual_markdown_hold_hours: number;
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

/**
 * Record an intended price and hand it to the background publisher. HotelCare
 * owns the intent; delivery to Previo happens out of band, serialized by the
 * global publisher lock, so a slow PMS never blocks the pricing cycle.
 */
async function queueIntents(
  admin: any,
  rule: Rule,
  payload: Array<Record<string, unknown>>,
  priority: number,
): Promise<string | null> {
  if (payload.length === 0) return null;
  const runId = crypto.randomUUID();
  await admin.from("revenue_rate_push_runs").insert({
    id: runId, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
    source: "automation", requested_count: payload.length, priority,
  });
  const { data: drafts, error: draftError } = await admin.from("revenue_rate_drafts")
    .insert(payload.map((row) => ({ ...row, priority, push_run_id: runId, confirmation_status: "sending" })))
    .select("id,stay_date,room_type_name,occupancy");
  if (draftError) throw draftError;
  const keyOf = (row: any) => `${row.stay_date}|${row.room_type_name}|${row.occupancy}`;
  const draftMap = new Map((drafts ?? []).map((row: any) => [keyOf(row), row.id]));
  await admin.from("revenue_rate_push_items").insert(payload.map((row: any) => ({
    run_id: runId, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
    stay_date: row.stay_date, obk_id: row.obk_id, room_type_name: row.room_type_name,
    occupancy: row.occupancy, old_price: row.old_price, target_price: row.new_price,
    currency: row.currency, draft_id: draftMap.get(keyOf(row)),
  })));
  const work = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-push-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-engine-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
    body: JSON.stringify({ hotelId: rule.hotel_id, draftIds: (drafts ?? []).map((row: any) => row.id), pushRunId: runId }),
  });
  (globalThis as any).EdgeRuntime?.waitUntil(work);
  return runId;
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

    // A run asked for by a person carries their session. We keep the same
    // tenant rules the rest of the app uses: you can only run automation for a
    // property inside your own organization, and only revenue roles may do it.
    const engineKey = req.headers.get("x-engine-key");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    // Scheduled ticks call in with the service key (header or bearer); those
    // are the machine runs and keep working exactly as before.
    const isEngine = (!!engineKey && engineKey === serviceKey) || (!!bearer && bearer === serviceKey);
    let actorName: string | null = null;
    let actorUserId: string | null = null;
    if (!isEngine) {
      if (!bearer) return json({ ok: false, code: "unauthenticated", msg: "Please sign in again and retry." }, 401);
      const { data: userData } = await admin.auth.getUser(bearer);
      const user = userData?.user;
      if (!user) return json({ ok: false, code: "unauthenticated", msg: "Your session has expired. Sign in again and retry." }, 401);
      const { data: profile } = await admin.from("profiles")
        .select("full_name, role, is_super_admin, organization_slug, assigned_hotel").eq("id", user.id).maybeSingle();
      const role = String((profile as any)?.role ?? "");
      const allowedRoles = ["admin", "manager", "top_management", "top_management_manager"];
      if (!profile || (!(profile as any).is_super_admin && !allowedRoles.includes(role))) {
        return json({ ok: false, code: "forbidden", msg: "Your role cannot run price automation." }, 403);
      }
      if (!onlyHotel) return json({ ok: false, code: "no_hotel", msg: "Choose a property first." }, 400);
      if (!(profile as any).is_super_admin) {
        const { data: allowed } = await admin.rpc("hotel_belongs_to_user_organization", { _uid: user.id, _hotel_id: onlyHotel });
        if (allowed !== true) {
          return json({ ok: false, code: "forbidden", msg: "This property is not in your organization." }, 403);
        }
      }
      actorName = ((profile as any)?.full_name as string | null) ?? user.email ?? null;
      actorUserId = user.id;
    }

    // Global, admin-controlled brake. When automation is paused the tick does
    // no work at all; in dry-run it still calculates and records suggestions
    // but never publishes a price.
    const { data: config } = await admin
      .from("revenue_engine_config").select("automation_enabled, dry_run").eq("id", "global").maybeSingle();
    if (config && config.automation_enabled === false) {
      return json({ ok: true, paused: true, code: "paused", msg: "Revenue automation is paused by an administrator." });
    }
    const dryRun: boolean = body.dryRun === true || config?.dry_run === true;


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

    // Scheduler: the cron wakes every few minutes but only ever evaluates ONE
    // due property, chosen by `next_run_at`. `claim_due_automation_rule` moves
    // that property's next slot forward inside the same transaction, so two
    // overlapping ticks can never take the same hotel and properties naturally
    // stagger instead of all firing on the hour.
    let rules: Rule[] = [];
    if (onlyHotel) {
      const { data: ruleRows, error: ruleErr } = await admin
        .from("revenue_pickup_automation_rules").select("*")
        .eq("hotel_id", onlyHotel).eq("is_enabled", true).limit(1);
      if (ruleErr) throw ruleErr;
      rules = (ruleRows ?? []) as unknown as Rule[];
      if (rules.length === 0) {
        // Say precisely why nothing happened: no rule saved yet, or saved but off.
        const { data: anyRule } = await admin.from("revenue_pickup_automation_rules")
          .select("id, is_enabled").eq("hotel_id", onlyHotel).maybeSingle();
        if (!anyRule) return json({ ok: true, rules: 0, summary: [], code: "no_rule", msg: "This property has no automation rule saved yet." });
        return json({ ok: true, rules: 0, summary: [], code: "disabled", msg: "Automation is switched off for this property." });
      }
    } else {
      const { data: due, error: dueErr } = await admin.rpc("claim_due_automation_rule");
      if (dueErr) throw dueErr;
      const claimed = (Array.isArray(due) ? due[0] : due) as { hotel_id?: string } | null;
      if (!claimed?.hotel_id) {
        return json({ ok: true, rules: 0, summary: [], code: "idle", msg: "No property is due for evaluation right now." });
      }
      const { data: ruleRows } = await admin.from("revenue_pickup_automation_rules")
        .select("*").eq("hotel_id", claimed.hotel_id).eq("is_enabled", true).limit(1);
      rules = (ruleRows ?? []) as unknown as Rule[];
      if (rules.length === 0) {
        return json({ ok: true, rules: 0, summary: [], code: "idle", msg: "The due property is no longer enabled." });
      }
    }


    const lockHotel = rules[0].hotel_id;
    const { data: gotLock, error: lockError } = await admin.rpc("claim_automation_lock", { p_hotel: lockHotel, p_stale_minutes: 10 });
    if (lockError) console.error("automation lock claim failed", lockError);
    if (gotLock !== true) {
      return json({
        ok: true, skipped: true, code: "busy",
        msg: "A pricing run is already in progress. Try again in a minute.",
        lockError: lockError?.message ?? null,
      });
    }

    const summary: Array<Record<string, unknown>> = [];
    try {

    for (const rule of rules) {
      const runStartedAt = new Date().toISOString();
      const now = new Date();
      const today = new Date().toISOString().slice(0, 10);
      const intervalMinutes = Math.max(60, Number(rule.evaluation_interval_minutes || 60));

      // Fresh reservations before any decision. The probe mode of the revenue
      // sync pulls new/changed bookings and cancellations only — it does not
      // re-read the whole six-month rate universe every hour. It runs for this
      // one hotel, inside the global automation lock, so two properties never
      // hit Previo at the same time.
      let pmsFresh = true;
      let pmsNote: string | null = null;
      try {
        const probe = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/previo-revenue-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          },
          body: JSON.stringify({
            hotelId: rule.hotel_id,
            mode: "automation_probe",
            horizonDays: Math.max(30, Math.min(400, Number(rule.future_booking_window_days || 183))),
          }),
        });
        const probeBody = await probe.json().catch(() => ({} as any));
        if (!probe.ok || probeBody?.error) {
          pmsFresh = false;
          pmsNote = String(probeBody?.error ?? `PMS refresh failed (${probe.status})`);
        }
      } catch (e) {
        pmsFresh = false;
        pmsNote = e instanceof Error ? e.message : String(e);
      }

      // Stale pickup data must never become a markdown. Skip the property for
      // this cycle, record why, and let the next cycle try again.
      if (!pmsFresh) {
        await admin.from("revenue_pickup_automation_rules").update({
          last_evaluated_at: runStartedAt,
          last_evaluation_status: "pms_unavailable",
          last_evaluation_error: pmsNote?.slice(0, 500) ?? "PMS data could not be refreshed",
          next_run_at: nextRunAt(now, intervalMinutes),
        }).eq("id", rule.id);
        summary.push({ hotel_id: rule.hotel_id, skipped: true, reason: "pms_unavailable", detail: pmsNote });
        continue;
      }

      // Observation window: since the previous SUCCESSFUL evaluation (normally
      // ~60 minutes), so a slightly late scheduler still sees every booking.
      const evalWindow = observationWindow(now, rule.last_successful_evaluation_at, intervalMinutes);
      const lookbackFrom = new Date(
        Math.min(
          Date.parse(evalWindow.from),
          Math.max(Date.parse(rule.last_run_at ?? "") || 0, Date.now() - 6 * 60 * 60 * 1000),
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

      // No-pickup markdown. It runs on the same hourly cadence as the pickup
      // check — not on fixed clock slots — and never touches a stay date that
      // picked up in this window, so one date can only move one way per cycle.
      let markdownActions = 0;
      const markdownBlocks: Record<string, number> = {};
      if (rule.no_pickup_enabled) {
        const local = localParts(rule.run_timezone || "Europe/Budapest");
        // A stable per-cycle slot label keeps the "one action per cell per
        // evaluation" index meaningful now that runs are interval based.
        const slot = `${local.time.slice(0, 2)}:${String(Math.floor(Number(local.time.slice(3, 5)) / 15) * 15).padStart(2, "0")}`;
        const horizon = new Date(`${local.date}T00:00:00Z`);
        horizon.setUTCDate(horizon.getUTCDate() + Math.max(1, Number(rule.future_booking_window_days || 183)));
        const horizonDate = horizon.toISOString().slice(0, 10);
        const observationFrom = evalWindow.from;

        const [
          { data: recentBookings },
          { data: recentCancellations },
          { data: horizonRates },
          { data: markdownToday },
          { data: snapshotRows },
          { data: pendingDrafts },
          { data: manualEdits },
        ] = await Promise.all([
          admin.from("revenue_booking_nights").select("stay_date").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).lte("stay_date", horizonDate).gte("captured_at", observationFrom).limit(20000),
          admin.from("revenue_cancelled_nights").select("stay_date").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).lte("stay_date", horizonDate).gte("cancelled_at", observationFrom).limit(20000),
          admin.from("revenue_room_type_rates").select("stay_date, obk_id, room_type_name, occupancy, price, currency, captured_at").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).lte("stay_date", horizonDate).order("captured_at", { ascending: false }).limit(50000),
          admin.from("revenue_pickup_automation_actions").select("stay_date, obk_id, occupancy, increase_amount").eq("hotel_id", rule.hotel_id).eq("decision_type", "no_pickup_markdown").eq("local_business_date", local.date).limit(50000),
          admin.from("revenue_daily_snapshots").select("stay_date, occupancy_pct, rooms_sold, rooms_available, captured_date").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).lte("stay_date", horizonDate).order("captured_date", { ascending: false }).limit(20000),
          admin.from("revenue_rate_drafts").select("id, stay_date, room_type_name, obk_id, occupancy, new_price, old_price, status, created_at, push_run_id").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).in("status", ["draft", "sending", "pushed"]).is("superseded_at", null).limit(50000),
          admin.from("rate_change_audit").select("stay_date, performed_at, source").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).gte("performed_at", new Date(Date.now() - Math.max(0, Number(rule.manual_markdown_hold_hours || 0)) * 3_600_000).toISOString()).limit(20000),
        ]);

        const positiveDates = new Set((recentBookings ?? []).map((row: any) => row.stay_date));
        const negativeDates = new Set((recentCancellations ?? []).map((row: any) => row.stay_date));

        // Daily cap is consumed per STAY DATE: take the largest movement any one
        // cell of that date already made today.
        const movedTodayByCell = new Map<string, number>();
        for (const action of (markdownToday ?? []) as any[]) {
          const key = `${action.stay_date}|${action.obk_id}|${action.occupancy}`;
          movedTodayByCell.set(key, (movedTodayByCell.get(key) ?? 0) + Math.abs(Number(action.increase_amount || 0)));
        }
        const movedTodayByDate = new Map<string, number>();
        for (const [key, amount] of movedTodayByCell) {
          const date = key.split("|")[0];
          movedTodayByDate.set(date, Math.max(movedTodayByDate.get(date) ?? 0, amount));
        }

        const occupancyByDate = new Map<string, { pct: number | null; left: number | null }>();
        for (const row of (snapshotRows ?? []) as any[]) {
          if (occupancyByDate.has(row.stay_date)) continue;
          const sold = Number(row.rooms_sold);
          const total = Number(row.rooms_available);
          occupancyByDate.set(row.stay_date, {
            pct: row.occupancy_pct === null || row.occupancy_pct === undefined ? null : Number(row.occupancy_pct),
            left: Number.isFinite(sold) && Number.isFinite(total) ? total - sold : null,
          });
        }

        const lastManualByDate = new Map<string, string>();
        for (const row of (manualEdits ?? []) as any[]) {
          const src = String(row.source ?? "");
          if (src.includes("automation")) continue;   // only a human puts a date on hold
          const seen = lastManualByDate.get(row.stay_date);
          if (!seen || row.performed_at > seen) lastManualByDate.set(row.stay_date, row.performed_at);
        }

        // Pending intents win over the PMS mirror so an hourly step never
        // recomputes from a price we already decided to replace.
        const pendingByCell = new Map<string, Array<{ id: string; new_price: number; created_at: string; claimed: boolean }>>();
        for (const row of (pendingDrafts ?? []) as any[]) {
          const key = `${row.stay_date}|${row.obk_id}|${row.occupancy}`;
          const list = pendingByCell.get(key) ?? [];
          list.push({ id: row.id, new_price: Number(row.new_price), created_at: row.created_at, claimed: row.status !== "draft" });
          pendingByCell.set(key, list);
        }

        const latest = new Map<string, any>();
        for (const rate of (horizonRates ?? []) as any[]) {
          const key = `${rate.stay_date}|${rate.obk_id}|${rate.occupancy}`;
          if (!latest.has(key)) latest.set(key, rate);
        }

        const markdownRows: any[] = [];
        const markdownDrafts: any[] = [];
        const supersede: string[] = [];
        const blockedDates = new Map<string, string>();

        for (const rate of latest.values()) {
          const cellKey = `${rate.stay_date}|${rate.obk_id}|${rate.occupancy}`;
          const guardsFor = occupancyByDate.get(rate.stay_date);
          const block = markdownBlockReason({
            hadPickup: positiveDates.has(rate.stay_date),
            roomsAvailable: guardsFor?.left ?? null,
            occupancyPct: guardsFor?.pct ?? null,
            protectHighOccupancy: rule.protect_high_occupancy !== false,
            markdownMaxOccupancyPct: Number(rule.markdown_max_occupancy_pct ?? 88),
            lastManualEditAt: lastManualByDate.get(rate.stay_date) ?? null,
            manualHoldHours: Number(rule.manual_markdown_hold_hours ?? 6),
            now,
          });
          if (block) {
            if (!blockedDates.has(rate.stay_date)) {
              blockedDates.set(rate.stay_date, block);
              markdownBlocks[block] = (markdownBlocks[block] ?? 0) + 1;
            }
            continue;
          }

          const pending = pendingByCell.get(cellKey) ?? [];
          const current = effectivePrice(Number(rate.price), pending);
          if (current === null) continue;

          const step = computeMarkdown({
            effectivePrice: current,
            decreasePerEvaluation: Number(rule.no_pickup_decrease || 2),
            floorPrice: rule.minimum_adr === null ? null : Number(rule.minimum_adr),
            stayDateMovedToday: movedTodayByDate.get(rate.stay_date) ?? 0,
            maxDailyDecreasePerDate: Number(rule.max_daily_decrease_per_date || 10),
          });
          if (!step) continue;

          movedTodayByDate.set(rate.stay_date, (movedTodayByDate.get(rate.stay_date) ?? 0) + step.applied);
          for (const intent of pending) if (!intent.claimed) supersede.push(intent.id);

          markdownRows.push({
            rule_id: rule.id, rule_version: rule.version, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
            reservation_id: null, stay_date: rate.stay_date, pickup_at: null, pickup_sequence: 0,
            room_type_name: rate.room_type_name, obk_id: String(rate.obk_id), occupancy: Number(rate.occupancy) || 2,
            old_price: current, increase_amount: step.newPrice - current, new_price: step.newPrice,
            status: rule.auto_publish ? "queued" : "suggested", decision_type: "no_pickup_markdown",
            observation_from: observationFrom, observation_to: runStartedAt,
            net_pickup: negativeDates.has(rate.stay_date) ? -1 : 0,
            schedule_slot: slot, local_business_date: local.date, cap_applied: step.applied,
          });
          if (rule.auto_publish) markdownDrafts.push({
            hotel_id: rule.hotel_id, organization_slug: rule.organization_slug, stay_date: rate.stay_date,
            obk_id: String(rate.obk_id), room_type_name: rate.room_type_name, occupancy: Number(rate.occupancy) || 2,
            old_price: current, new_price: step.newPrice, currency: rate.currency ?? rule.currency ?? "EUR", status: "draft",
            priority: priorityOf("markdown"), intent_source: "automation_markdown",
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
            for (let i = 0; i < supersede.length; i += 200) {
              await admin.from("revenue_rate_drafts")
                .update({ superseded_at: new Date().toISOString(), status: "superseded" })
                .in("id", supersede.slice(i, i + 200));
            }
            await queueIntents(admin, rule, payload, priorityOf("markdown"));
          }
        }
      }

      if (pickups.length === 0) {
        await admin.from("revenue_pickup_automation_rules").update({
          last_run_at: runStartedAt,
          last_evaluated_at: runStartedAt,
          last_successful_evaluation_at: runStartedAt,
          last_evaluation_status: "ok",
          last_evaluation_error: null,
          next_run_at: nextRunAt(now, intervalMinutes),
        }).eq("id", rule.id);
        summary.push({
          hotel_id: rule.hotel_id, pickups: 0, actions: markdownActions,
          markdowns: markdownActions, blocked: markdownBlocks,
          next_run_at: nextRunAt(now, intervalMinutes),
        });
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

      /**
       * Two bookings on the same stay date used to produce two identical action
       * rows for the same price cell (each computed from the same starting
       * price), so the history read "raised by 8" twice while the price only
       * ever moved once. Decisions are now accumulated per price cell: the
       * increases add up and exactly ONE action (and one draft) is written.
       */
      type CellDecision = {
        stay_date: string; obk_id: string; room_type_name: string; occupancy: number;
        currency: string; old_price: number; increase: number;
        res_id: string; at: string; sequence: number; events: number;
      };
      const cellDecisions = new Map<string, CellDecision>();

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

          const cellKey = `${ev.stay_date}|${String(rate.obk_id)}|${Number(rate.occupancy) || 2}`;
          const current = cellDecisions.get(cellKey);
          if (current) {
            current.increase += increase;
            current.events += 1;
            // Attribute the row to the most recent booking that moved it.
            if (Date.parse(ev.at) >= Date.parse(current.at)) {
              current.at = ev.at;
              current.res_id = ev.res_id;
              current.sequence = ev.sequence;
            }
          } else {
            cellDecisions.set(cellKey, {
              stay_date: ev.stay_date,
              obk_id: String(rate.obk_id),
              room_type_name: rate.room_type_name,
              occupancy: Number(rate.occupancy) || 2,
              currency: rate.currency ?? "EUR",
              old_price: oldPrice,
              increase,
              res_id: ev.res_id,
              at: ev.at,
              sequence: ev.sequence,
              events: 1,
            });
          }
        }
      }

      for (const decision of cellDecisions.values()) {
        let newPrice = Math.round(decision.old_price + decision.increase);
        if (rule.minimum_adr && newPrice < Number(rule.minimum_adr)) newPrice = Math.round(Number(rule.minimum_adr));
        if (newPrice === decision.old_price) continue;

        actionsToInsert.push({
          rule_id: rule.id,
          rule_version: rule.version,
          hotel_id: rule.hotel_id,
          organization_slug: rule.organization_slug,
          reservation_id: String(decision.res_id),
          stay_date: decision.stay_date,
          pickup_at: decision.at,
          pickup_sequence: decision.sequence,
          room_type_name: decision.room_type_name,
          obk_id: decision.obk_id,
          occupancy: decision.occupancy,
          old_price: decision.old_price,
          increase_amount: newPrice - decision.old_price,
          new_price: newPrice,
          status: rule.auto_publish ? "queued" : "suggested",
        });

        if (rule.auto_publish) {
          draftsToInsert.push({
            hotel_id: rule.hotel_id,
            organization_slug: rule.organization_slug,
            stay_date: decision.stay_date,
            obk_id: decision.obk_id,
            room_type_name: decision.room_type_name,
            occupancy: decision.occupancy,
            old_price: decision.old_price,
            new_price: newPrice,
            currency: decision.currency,
            status: "draft",
          });
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
      let insertedActionIds: string[] = [];
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
        insertedActionIds = (ins ?? []).map((row: any) => row.id).filter(Boolean);
      }


      let pushed = 0;
      let pushError: string | null = null;
      const changed: Array<Record<string, unknown>> = [];
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
        // One draft per price cell (decisions are already collapsed above).
        const byCell = new Map<string, any>();
        for (const d of draftsToInsert) {
          if (!insertedKeys.has(`${d.stay_date}|${d.obk_id}|${d.occupancy}`)) continue;
          const cell = `${d.stay_date}|${d.room_type_name}|${d.occupancy}`;
          const existing = byCell.get(cell);
          if (!existing || Number(d.new_price) > Number(existing.new_price)) {
            byCell.set(cell, existing ? { ...d, old_price: existing.old_price } : d);
          }
        }
        const payload = Array.from(byCell.values());
        if (payload.length > 0) {
          try {
            // Older unsent intents for the same cell are superseded, never
            // deleted: history stays intact and only the newest target is sent.
            const staleDates = Array.from(new Set(payload.map((d) => d.stay_date)));
            const { data: staleDrafts } = await admin.from("revenue_rate_drafts")
              .select("id, stay_date, room_type_name, occupancy")
              .eq("hotel_id", rule.hotel_id).in("stay_date", staleDates)
              .in("status", ["draft", "failed"]).is("superseded_at", null);
            const staleIds = ((staleDrafts ?? []) as any[])
              .filter((row) => byCell.has(`${row.stay_date}|${row.room_type_name}|${row.occupancy}`))
              .map((row) => row.id);
            for (let i = 0; i < staleIds.length; i += 200) {
              await admin.from("revenue_rate_drafts")
                .update({ superseded_at: new Date().toISOString(), status: "superseded" })
                .in("id", staleIds.slice(i, i + 200));
            }
            const pushRunId = crypto.randomUUID();
            await admin.from("revenue_rate_push_runs").insert({
              id: pushRunId, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
              source: "automation", requested_count: payload.length, priority: priorityOf("pickup"),
            });
            const { data: drafts, error: draftErr } = await admin
              .from("revenue_rate_drafts")
              .insert(payload.map((row: any) => ({
                ...row,
                priority: priorityOf("pickup"),
                intent_source: "automation_pickup",
                push_run_id: pushRunId,
              })))
              .select("id");
            if (draftErr) throw draftErr;
            const draftIds = ((drafts ?? []) as any[]).map((d) => d.id);

            const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-push-drafts`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-engine-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
              },
              body: JSON.stringify({ hotelId: rule.hotel_id, draftIds, pushRunId }),
            });

            const out = await res.json().catch(() => ({}));
            pushed = Number(out?.pushed ?? 0);
            pushError = pushed > 0 ? null : (out?.error ?? "Previo did not accept the change");
          } catch (err) {
            // Never leave the decisions sitting in "queued" — that is what made
            // the tool look like it had raised a price it never sent.
            pushed = 0;
            pushError = err instanceof Error ? err.message : String(err);
            console.error("automation publish failed", pushError);
          }

          const status = pushed > 0 ? "pushed" : "failed";
          for (const d of payload) {
            changed.push({
              stay_date: d.stay_date, room_type_name: d.room_type_name, occupancy: d.occupancy,
              old_price: d.old_price, new_price: d.new_price, currency: d.currency,
              status,
            });
          }
          await admin.from("revenue_pickup_automation_actions")
            .update({
              status,
              pushed_at: pushed > 0 ? new Date().toISOString() : null,
              push_error: pushed > 0 ? null : pushError,
            })
            .eq("hotel_id", rule.hotel_id)
            .eq("status", "queued")
            .gte("created_at", runStartedAt);
        }
      }

      // Anything left "queued" from an earlier crashed tick is not pending —
      // it never reached Previo. Surface it as failed so the UI stops showing
      // a raise that did not happen.
      {
        const staleQueuedBefore = new Date(Date.now() - 30 * 60_000).toISOString();
        await admin.from("revenue_pickup_automation_actions")
          .update({ status: "failed", push_error: "Publishing never completed — price was not sent to Previo" })
          .eq("hotel_id", rule.hotel_id)
          .eq("status", "queued")
          .lt("created_at", staleQueuedBefore);
      }

      if (!rule.auto_publish && inserted > 0) {
        for (const a of actionsToInsert) {
          changed.push({
            stay_date: a.stay_date, room_type_name: a.room_type_name, occupancy: a.occupancy,
            old_price: a.old_price, new_price: a.new_price, currency: rule.currency ?? "EUR",
            status: "suggested",
          });
        }
      }

      await admin.from("revenue_pickup_automation_rules").update({
        last_run_at: runStartedAt,
        last_evaluated_at: runStartedAt,
        last_successful_evaluation_at: runStartedAt,
        last_evaluation_status: "ok",
        last_evaluation_error: null,
        next_run_at: nextRunAt(now, intervalMinutes),
      }).eq("id", rule.id);


      const failedCount = Math.max(0, changed.filter((c) => c.status === "failed").length);

      // Durable history so a person who was away still learns what the engine
      // did. Routine "nothing happened" automatic checks stay silent.
      if (changed.length > 0 || failedCount > 0) {
        const { error: notifErr } = await admin.from("revenue_automation_notifications").insert({
          hotel_id: rule.hotel_id,
          organization_slug: rule.organization_slug,
          notification_type: "pickup_automation",
          run_source: isEngine ? "automatic" : "manual",
          actor_name: isEngine ? "Automatic pricing" : (actorName ?? "Manual run"),
          actor_user_id: isEngine ? null : actorUserId,
          rule_id: rule.id,
          action_ids: insertedActionIds,
          pickups_count: events.length,
          actions_count: inserted,
          pushed_count: pushed,
          failed_count: failedCount,
          currency: rule.currency ?? "EUR",
          severity: failedCount > 0 ? "warning" : "info",
          summary: `${changed.length} prices changed · ${pushed} sent · ${failedCount} failed`,
          changes: changed,
        });
        if (notifErr) console.error("notification insert failed", notifErr);
      }

      summary.push({
        hotel_id: rule.hotel_id, pickups: events.length,
        skipped_not_new: skippedStale, skipped_negative_pickup: skippedNegative,
        actions: inserted, markdowns: markdownActions, blocked: markdownBlocks,
        pushed, failed: failedCount,
        push_error: pushError, auto_publish: rule.auto_publish, changed,
        next_run_at: nextRunAt(now, intervalMinutes),
      });

    }
    } finally {
      await admin.rpc("release_automation_lock", { p_hotel: lockHotel });
    }

    return json({ ok: true, code: "ran", rules: rules.length, hotel_id: lockHotel, actor: actorName, summary });
  } catch (e) {
    console.error("pickup automation failed", e);
    return json({ ok: false, code: "error", error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
