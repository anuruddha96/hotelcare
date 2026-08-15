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
  smartMarkdownAllowed,
  strongDemandStep,
  clampAiFactor,
  applyRounding,
  shortWindowIncreaseAllowed,
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
  // Smart pricing (all optional, neutral defaults)
  smart_pricing_enabled: boolean;
  near_term_days: number;
  low_occupancy_pct: number;
  long_lead_days: number;
  high_occupancy_pct: number;
  strong_demand_increase: number;
  ai_assist_enabled: boolean;
  // Short booking window guard + rounding
  short_window_guard_enabled: boolean;
  short_window_days: number;
  short_window_min_occupancy_pct: number;
  whole_number_prices: boolean;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * A readable sentence for ANY thrown value. A Postgres/PostgREST error is a
 * plain object, and `String(object)` is the literal "[object Object]" that
 * users were seeing in the toast.
 */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const any = e as Record<string, unknown>;
    const parts = [any.message, any.error, any.details, any.hint, any.code]
      .filter((v) => typeof v === "string" && v.trim().length > 0) as string[];
    if (parts.length > 0) return parts.join(" · ");
    try { return JSON.stringify(e).slice(0, 500); } catch { /* ignore */ }
  }
  return "Unexpected error";
}

interface AiCandidate {
  stay_date: string;
  days_out: number;
  occupancy_pct: number | null;
  rooms_left?: number | null;
  net_pickup?: number;
  proposed_delta: number;
  direction: "increase" | "decrease";
}

/**
 * Optional advisor using the property owner's own OpenAI key.
 *
 * One compact request per hotel evaluation, aggregated non-personal features
 * only. It returns a factor between 0 and 1 per stay date: the model may
 * CONFIRM or SOFTEN a deterministic move, never enlarge or invent one, so
 * every HotelCare guardrail (floor, daily caps, manual hold, sold-out
 * protection, publisher queue) stays final. Any failure — missing key,
 * timeout, malformed JSON — silently falls back to the deterministic result.
 */
async function aiScaleDeltas(candidates: AiCandidate[], rule: Rule): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key || candidates.length === 0) return out;
  const compact = candidates.slice(0, 120).map((c) => ({
    d: c.stay_date, lead: c.days_out, occ: c.occupancy_pct,
    left: c.rooms_left ?? null, pickup: c.net_pickup ?? 0,
    delta: c.proposed_delta, dir: c.direction,
  }));
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a hotel revenue analyst. For each stay date you receive lead time in days, occupancy percent, rooms left, net pickup in the last hour and a proposed price move. Reply with JSON {\"dates\":[{\"d\":\"YYYY-MM-DD\",\"factor\":0..1,\"reason\":\"short\"}]}. factor 1 keeps the proposed move, 0 cancels it, values in between soften it. You may never increase a move.",
          },
          {
            role: "user",
            content: JSON.stringify({
              currency: rule.currency ?? "EUR",
              floor: rule.minimum_adr,
              horizon_days: rule.future_booking_window_days,
              dates: compact,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return out;
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return out;
    const parsed = JSON.parse(text);
    for (const row of (parsed?.dates ?? []) as any[]) {
      const date = String(row?.d ?? "");
      const factor = Number(row?.factor);
      if (!date || !Number.isFinite(factor)) continue;
      out.set(date, clampAiFactor(factor));
    }
  } catch (e) {
    console.warn("ai assist unavailable", describeError(e));
    return new Map();
  }
  return out;
}

/**
 * Scale already-computed decisions by the advisor's factors, in place. Rows the
 * advisor effectively cancels (below a fifth of the deterministic move) are
 * dropped entirely.
 */
function applyAiFactors(
  rows: any[],
  drafts: any[],
  factors: Map<string, number>,
  direction: "increase" | "decrease",
): void {
  if (factors.size === 0) return;
  const dropped = new Set<string>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const factor = factors.get(row.stay_date);
    if (factor === undefined || factor >= 0.999) continue;
    const cell = `${row.stay_date}|${row.obk_id}|${row.occupancy}`;
    if (factor < 0.2) { dropped.add(cell); rows.splice(i, 1); continue; }
    const magnitude = roundMoney(Math.abs(Number(row.increase_amount || 0)) * factor);
    if (magnitude <= 0) { dropped.add(cell); rows.splice(i, 1); continue; }
    const old = Number(row.old_price);
    const next = roundMoney(direction === "increase" ? old + magnitude : old - magnitude);
    row.increase_amount = direction === "increase" ? magnitude : -magnitude;
    row.new_price = next;
    row.cap_applied = magnitude;
    for (const draft of drafts) {
      if (`${draft.stay_date}|${draft.obk_id}|${draft.occupancy}` === cell) draft.new_price = next;
    }
  }
  for (let i = drafts.length - 1; i >= 0; i--) {
    const draft = drafts[i];
    if (dropped.has(`${draft.stay_date}|${draft.obk_id}|${draft.occupancy}`)) drafts.splice(i, 1);
  }
}



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
  const { error: runError } = await admin.from("revenue_rate_push_runs").insert({
    id: runId, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
    source: "automation", requested_count: payload.length, priority,
  });
  if (runError) throw runError;

  const keyOf = (row: any) => `${row.stay_date}|${row.room_type_name}|${row.occupancy}`;
  const incomingKeys = new Set(payload.map(keyOf));
  const dates = Array.from(new Set(payload.map((row: any) => row.stay_date)));

  // Coalesce only work that has not been claimed by the publisher. Historical
  // rows remain in place as superseded intents; claimed/sending rows are never
  // touched. This also satisfies the one-active-draft-per-cell index.
  const { data: staleDrafts } = await admin.from("revenue_rate_drafts")
    .select("id,stay_date,room_type_name,occupancy")
    .eq("hotel_id", rule.hotel_id)
    .in("stay_date", dates)
    .in("status", ["draft", "failed"])
    .is("superseded_at", null)
    .is("claimed_at", null);
  const staleIds = ((staleDrafts ?? []) as any[])
    .filter((row) => incomingKeys.has(keyOf(row)))
    .map((row) => row.id);
  for (let index = 0; index < staleIds.length; index += 200) {
    await admin.from("revenue_rate_drafts")
      .update({ superseded_at: new Date().toISOString(), status: "superseded" })
      .in("id", staleIds.slice(index, index + 200))
      .is("claimed_at", null);
  }

  // Persist large horizons in bounded chunks. The 3-minute queue drainer, not
  // this evaluator, starts Previo delivery after the transaction is durable.
  for (let index = 0; index < payload.length; index += 500) {
    const batch = payload.slice(index, index + 500);
    const { data: drafts, error: draftError } = await admin.from("revenue_rate_drafts")
      .insert(batch.map((row) => ({ ...row, priority, push_run_id: runId, confirmation_status: "queued" })))
      .select("id,stay_date,room_type_name,occupancy");
    if (draftError) throw draftError;
    const draftMap = new Map((drafts ?? []).map((row: any) => [keyOf(row), row.id]));
    const { error: itemError } = await admin.from("revenue_rate_push_items").insert(batch.map((row: any) => ({
      run_id: runId, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
      stay_date: row.stay_date, obk_id: row.obk_id, room_type_name: row.room_type_name,
      occupancy: row.occupancy, old_price: row.old_price, target_price: row.new_price,
      currency: row.currency, draft_id: draftMap.get(keyOf(row)),
    })));
    if (itemError) throw itemError;
  }
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
    const apiKeyHeader = req.headers.get("apikey") ?? "";
    // Scheduled ticks call in with the service key (header or bearer); those
    // are the machine runs and keep working exactly as before.
    //
    // The database scheduler (pg_cron → pg_net) can only send the project
    // apikey, not a user session. Such a call is accepted ONLY in scheduler
    // mode: it may not name a hotel, it just asks the database for whichever
    // property is due. That is idempotent — `claim_due_automation_rule`
    // returns nothing until a property's own interval has elapsed — so an
    // extra call can never bring a price change forward.
    const schedulerCall = body?.scheduled === true && !onlyHotel;
    const isEngine = (!!engineKey && engineKey === serviceKey)
      || (!!bearer && bearer === serviceKey)
      || (apiKeyHeader === serviceKey)
      || schedulerCall;
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
      let markdownStayDates = 0;
      const markdownBlocks: Record<string, number> = {};
      /** Dates already moved DOWN this cycle — they must not also move up. */
      const markdownDatesThisRun = new Set<string>();
      let strongActions = 0;
      const strongDates = new Set<string>();

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

        // NET pickup for the observation window: new booking nights minus
        // cancellations. Only a genuinely positive net blocks a markdown; a
        // cancellation can never create an increase.
        const netByDate = netPickupByDate(
          (recentBookings ?? []) as Array<{ stay_date: string }>,
          (recentCancellations ?? []) as Array<{ stay_date: string }>,
        );

        // Daily cap is consumed per STAY DATE: the largest cumulative movement
        // any single cell of that date already made today. This is the state
        // BEFORE this evaluation and is never mutated inside the cell loop —
        // one evaluation costs the date exactly one step, not one step per cell.
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
        // One allowed step per stay date, derived from movement recorded before
        // this evaluation. Every eligible cell of that date uses the SAME step.
        const allowedStepByDate = new Map<string, number>();
        const markdownDates = new Set<string>();

        for (const rate of latest.values()) {
          const cellKey = `${rate.stay_date}|${rate.obk_id}|${rate.occupancy}`;
          const net = netByDate.get(rate.stay_date) ?? 0;
          const guardsFor = occupancyByDate.get(rate.stay_date);
          const block = markdownBlockReason({
            hadPickup: net > 0,
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

          // Smart pricing: only genuinely weak demand is marked down. A date
          // whose occupancy is already at or above the "weak" threshold is
          // left alone even when this single hour brought no booking; near-term
          // dates below the threshold are the ones worth stimulating.
          if (rule.smart_pricing_enabled) {
            const allowed = smartMarkdownAllowed({
              occupancyPct: guardsFor?.pct ?? null,
              daysOut: dayDiff(local.date, rate.stay_date),
              nearTermDays: Math.max(0, Number(rule.near_term_days ?? 30)),
              lowOccupancyPct: Number(rule.low_occupancy_pct ?? 50),
            });
            if (!allowed) {
              if (!blockedDates.has(rate.stay_date)) {
                blockedDates.set(rate.stay_date, "demand_healthy");
                markdownBlocks["demand_healthy"] = (markdownBlocks["demand_healthy"] ?? 0) + 1;
              }
              continue;
            }
          }

          if (!allowedStepByDate.has(rate.stay_date)) {
            allowedStepByDate.set(rate.stay_date, dateAllowedStep({
              decreasePerEvaluation: Number(rule.no_pickup_decrease ?? 0.5),
              stayDateMovedToday: movedTodayByDate.get(rate.stay_date) ?? 0,
              maxDailyDecreasePerDate: Number(rule.max_daily_decrease_per_date || 10),
            }));
          }
          const allowed = allowedStepByDate.get(rate.stay_date) ?? 0;
          if (allowed <= 0) {
            if (!blockedDates.has(rate.stay_date)) {
              blockedDates.set(rate.stay_date, "daily_cap");
              markdownBlocks["daily_cap"] = (markdownBlocks["daily_cap"] ?? 0) + 1;
            }
            continue;
          }

          const pending = pendingByCell.get(cellKey) ?? [];
          const current = effectivePrice(Number(rate.price), pending);
          if (current === null) continue;

          // The cap is already honoured by `allowed`; per cell only the ADR
          // floor can shrink the step further.
          const step = computeMarkdown({
            effectivePrice: current,
            decreasePerEvaluation: allowed,
            floorPrice: rule.minimum_adr === null ? null : Number(rule.minimum_adr),
            stayDateMovedToday: 0,
            maxDailyDecreasePerDate: 0,
          });
          if (!step) continue;

          // Whole prices only (when the property asked for it): a markdown
          // rounds DOWN so it can never round itself back up over the floor.
          const wholeNumbers = rule.whole_number_prices !== false;
          const targetPrice = applyRounding(
            step.newPrice, "decrease", wholeNumbers,
            rule.minimum_adr === null ? null : Number(rule.minimum_adr),
          );
          if (!(targetPrice > 0) || targetPrice >= current) continue;
          step.newPrice = targetPrice;
          step.applied = roundMoney(current - targetPrice);

          markdownDates.add(rate.stay_date);
          for (const intent of pending) if (!intent.claimed) supersede.push(intent.id);

          markdownRows.push({
            rule_id: rule.id, rule_version: rule.version, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
            reservation_id: null, stay_date: rate.stay_date, pickup_at: null, pickup_sequence: 0,
            room_type_name: rate.room_type_name, obk_id: String(rate.obk_id), occupancy: Number(rate.occupancy) || 2,
            old_price: current, increase_amount: step.newPrice - current, new_price: step.newPrice,
            status: rule.auto_publish ? "queued" : "suggested", decision_type: "no_pickup_markdown",
            observation_from: observationFrom, observation_to: runStartedAt,
            net_pickup: net,
            schedule_slot: slot, local_business_date: local.date, cap_applied: step.applied,
          });
          if (rule.auto_publish) markdownDrafts.push({
            hotel_id: rule.hotel_id, organization_slug: rule.organization_slug, stay_date: rate.stay_date,
            obk_id: String(rate.obk_id), room_type_name: rate.room_type_name, occupancy: Number(rate.occupancy) || 2,
            old_price: current, new_price: step.newPrice, currency: rate.currency ?? rule.currency ?? "EUR", status: "draft",
            priority: priorityOf("markdown"), intent_source: "automation_markdown",
          });
        }
        markdownStayDates = markdownDates.size;
        for (const d of markdownDates) markdownDatesThisRun.add(d);

        // Optional AI advisor on the markdown side: it can only confirm or
        // soften a deterministic decrease, never deepen it.
        if (rule.ai_assist_enabled && markdownRows.length > 0) {
          const factors = await aiScaleDeltas(
            Array.from(markdownDates).map((d) => ({
              stay_date: d, days_out: dayDiff(local.date, d),
              occupancy_pct: occupancyByDate.get(d)?.pct ?? null,
              rooms_left: occupancyByDate.get(d)?.left ?? null,
              net_pickup: netByDate.get(d) ?? 0,
              proposed_delta: allowedStepByDate.get(d) ?? 0,
              direction: "decrease" as const,
            })),
            rule,
          );
          applyAiFactors(markdownRows, markdownDrafts, factors, "decrease");
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
            const runId = await queueIntents(admin, rule, payload, priorityOf("markdown"));
            if (runId) {
              await admin.from("revenue_pickup_automation_actions")
                .update({ push_run_id: runId })
                .eq("hotel_id", rule.hotel_id)
                .eq("rule_version", rule.version)
                .eq("schedule_slot", slot)
                .eq("local_business_date", local.date)
                .eq("decision_type", "no_pickup_markdown")
                .is("push_run_id", null);
            }
          }
        }
      }

      // ------------------------------------------------------------------
      // Smart pricing — strong early demand.
      //
      // A stay date far in the future that is already filling up is worth
      // more, even during an hour in which no new booking arrived. Every
      // deterministic guardrail still applies: the daily rise cap for that
      // date, the per-change maximum, a recent manual edit and the publisher
      // queue. Dates that were marked down in this same evaluation are left
      // alone so one date can only move one way per cycle.
      // ------------------------------------------------------------------
      if (rule.smart_pricing_enabled && Number(rule.strong_demand_increase || 0) > 0) {
        const local = localParts(rule.run_timezone || "Europe/Budapest");
        const slot = `${local.time.slice(0, 2)}:${String(Math.floor(Number(local.time.slice(3, 5)) / 15) * 15).padStart(2, "0")}`;
        const horizon = new Date(`${local.date}T00:00:00Z`);
        horizon.setUTCDate(horizon.getUTCDate() + Math.max(1, Number(rule.future_booking_window_days || 183)));
        const horizonDate = horizon.toISOString().slice(0, 10);
        const leadDays = Math.max(0, Number(rule.long_lead_days ?? 30));
        const highPct = Number(rule.high_occupancy_pct ?? 85);

        const [
          { data: strongRates },
          { data: strongSnapshots },
          { data: strongToday },
          { data: strongManual },
          { data: strongPending },
        ] = await Promise.all([
          admin.from("revenue_room_type_rates").select("stay_date, obk_id, room_type_name, occupancy, price, currency, captured_at").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).lte("stay_date", horizonDate).order("captured_at", { ascending: false }).limit(50000),
          admin.from("revenue_daily_snapshots").select("stay_date, occupancy_pct, rooms_sold, rooms_available, captured_date").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).lte("stay_date", horizonDate).order("captured_date", { ascending: false }).limit(20000),
          admin.from("revenue_pickup_automation_actions").select("stay_date, increase_amount").eq("hotel_id", rule.hotel_id).eq("local_business_date", local.date).gt("increase_amount", 0).limit(50000),
          admin.from("rate_change_audit").select("stay_date, performed_at, source").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).gte("performed_at", new Date(Date.now() - Math.max(0, Number(rule.manual_markdown_hold_hours || 0)) * 3_600_000).toISOString()).limit(20000),
          admin.from("revenue_rate_drafts").select("id, stay_date, obk_id, occupancy, new_price, status, created_at").eq("hotel_id", rule.hotel_id).gte("stay_date", local.date).in("status", ["draft", "sending", "pushed"]).is("superseded_at", null).limit(50000),
        ]);

        const occByDate = new Map<string, number | null>();
        for (const row of (strongSnapshots ?? []) as any[]) {
          if (occByDate.has(row.stay_date)) continue;
          occByDate.set(row.stay_date, row.occupancy_pct === null || row.occupancy_pct === undefined ? null : Number(row.occupancy_pct));
        }
        const raisedTodayByDate = new Map<string, number>();
        for (const row of (strongToday ?? []) as any[]) {
          raisedTodayByDate.set(row.stay_date, (raisedTodayByDate.get(row.stay_date) ?? 0) + Math.abs(Number(row.increase_amount || 0)));
        }
        const manualHold = new Map<string, string>();
        for (const row of (strongManual ?? []) as any[]) {
          if (String(row.source ?? "").includes("automation")) continue;
          const seen = manualHold.get(row.stay_date);
          if (!seen || row.performed_at > seen) manualHold.set(row.stay_date, row.performed_at);
        }
        const strongPendingByCell = new Map<string, Array<{ new_price: number; created_at: string }>>();
        for (const row of (strongPending ?? []) as any[]) {
          const key = `${row.stay_date}|${row.obk_id}|${row.occupancy}`;
          const list = strongPendingByCell.get(key) ?? [];
          list.push({ new_price: Number(row.new_price), created_at: row.created_at });
          strongPendingByCell.set(key, list);
        }
        const newestRate = new Map<string, any>();
        for (const rate of (strongRates ?? []) as any[]) {
          const key = `${rate.stay_date}|${rate.obk_id}|${rate.occupancy}`;
          if (!newestRate.has(key)) newestRate.set(key, rate);
        }

        const strongRows: any[] = [];
        const strongDrafts: any[] = [];
        const stepByDate = new Map<string, number>();
        for (const rate of newestRate.values()) {
          const holdMs = Math.max(0, Number(rule.manual_markdown_hold_hours ?? 6)) * 3_600_000;
          const editedAt = manualHold.get(rate.stay_date);
          if (editedAt && Date.now() - Date.parse(editedAt) < holdMs) continue;

          if (!stepByDate.has(rate.stay_date)) {
            stepByDate.set(rate.stay_date, strongDemandStep({
              occupancyPct: occByDate.get(rate.stay_date) ?? null,
              daysOut: dayDiff(local.date, rate.stay_date),
              longLeadDays: leadDays,
              highOccupancyPct: highPct,
              increase: Number(rule.strong_demand_increase || 0),
              maximumIncrease: rule.maximum_increase,
              raisedToday: raisedTodayByDate.get(rate.stay_date) ?? 0,
              maxDailyIncreasePerDate: Number(rule.max_daily_increase_per_date || 0),
              markedDownToday: markdownDatesThisRun.has(rate.stay_date),
            }));
          }
          const step = stepByDate.get(rate.stay_date) ?? 0;
          if (step <= 0) continue;

          const cell = `${rate.stay_date}|${rate.obk_id}|${rate.occupancy}`;
          const current = effectivePrice(Number(rate.price), strongPendingByCell.get(cell) ?? []);
          if (current === null) continue;
          const newPrice = applyRounding(
            current + step, "increase", rule.whole_number_prices !== false,
            rule.minimum_adr === null ? null : Number(rule.minimum_adr),
          );
          if (!(newPrice > current)) continue;

          strongDates.add(rate.stay_date);
          strongRows.push({
            rule_id: rule.id, rule_version: rule.version, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
            reservation_id: null, stay_date: rate.stay_date, pickup_at: null, pickup_sequence: 0,
            room_type_name: rate.room_type_name, obk_id: String(rate.obk_id), occupancy: Number(rate.occupancy) || 2,
            old_price: current, increase_amount: step, new_price: newPrice,
            status: rule.auto_publish ? "queued" : "suggested", decision_type: "smart_strong_demand",
            observation_from: evalWindow.from, observation_to: runStartedAt,
            net_pickup: 0, schedule_slot: slot, local_business_date: local.date, cap_applied: step,
          });
          if (rule.auto_publish) strongDrafts.push({
            hotel_id: rule.hotel_id, organization_slug: rule.organization_slug, stay_date: rate.stay_date,
            obk_id: String(rate.obk_id), room_type_name: rate.room_type_name, occupancy: Number(rate.occupancy) || 2,
            old_price: current, new_price: newPrice, currency: rate.currency ?? rule.currency ?? "EUR", status: "draft",
            priority: priorityOf("pickup"), intent_source: "automation_smart_strong",
          });
        }

        // Optional AI advisor: it may only confirm or SHRINK a deterministic
        // move, never invent or exceed one.
        if (rule.ai_assist_enabled && strongRows.length > 0) {
          const factors = await aiScaleDeltas(
            Array.from(strongDates).map((d) => ({
              stay_date: d, days_out: dayDiff(local.date, d),
              occupancy_pct: occByDate.get(d) ?? null,
              proposed_delta: stepByDate.get(d) ?? 0,
              direction: "increase" as const,
            })),
            rule,
          );
          applyAiFactors(strongRows, strongDrafts, factors, "increase");
        }

        if (!dryRun && strongRows.length > 0) {
          const { data: insertedStrong, error: strongError } = await admin.from("revenue_pickup_automation_actions")
            .upsert(strongRows, { onConflict: "hotel_id,stay_date,obk_id,occupancy,rule_version,schedule_slot,local_business_date", ignoreDuplicates: true })
            .select("stay_date,obk_id,occupancy");
          if (strongError) throw strongError;
          const accepted = new Set((insertedStrong ?? []).map((row: any) => `${row.stay_date}|${row.obk_id}|${row.occupancy}`));
          const payload = strongDrafts.filter((row) => accepted.has(`${row.stay_date}|${row.obk_id}|${row.occupancy}`));
          strongActions = payload.length;
          if (payload.length > 0) {
            const runId = await queueIntents(admin, rule, payload, priorityOf("pickup"));
            if (runId) {
              await admin.from("revenue_pickup_automation_actions")
                .update({ push_run_id: runId })
                .eq("hotel_id", rule.hotel_id)
                .eq("rule_version", rule.version)
                .eq("schedule_slot", slot)
                .eq("local_business_date", local.date)
                .eq("decision_type", "smart_strong_demand")
                .is("push_run_id", null);
            }
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
          markdowns: markdownActions, markdown_stay_dates: markdownStayDates,
          queued: markdownActions, blocked: markdownBlocks,

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

      // 2d. Occupancy per stay date, so the short-booking-window guard can tell
      //     a genuinely busy near date from a near date that is still empty.
      const { data: pickupSnapshots } = await admin
        .from("revenue_daily_snapshots")
        .select("stay_date, occupancy_pct, captured_date")
        .eq("hotel_id", rule.hotel_id)
        .in("stay_date", stayDates)
        .order("captured_date", { ascending: false })
        .limit(20000);
      const occByStayDate = new Map<string, number | null>();
      for (const row of (pickupSnapshots ?? []) as any[]) {
        if (occByStayDate.has(row.stay_date)) continue;
        occByStayDate.set(
          row.stay_date,
          row.occupancy_pct === null || row.occupancy_pct === undefined ? null : Number(row.occupancy_pct),
        );
      }
      let heldShortWindow = 0;

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

        // Short booking window guard. Close to arrival a single new booking
        // must not push an empty date higher — that is exactly how last-minute
        // rooms go unsold. Inside the protected window a rise needs the date to
        // be selling well already; otherwise the pickup is recorded and the
        // price is held (the markdown side may still lower it).
        if (!shortWindowIncreaseAllowed({
          daysOut,
          occupancyPct: occByStayDate.get(ev.stay_date) ?? null,
          enabled: rule.short_window_guard_enabled !== false,
          shortWindowDays: Math.max(0, Number(rule.short_window_days ?? 7)),
          minOccupancyPct: Number(rule.short_window_min_occupancy_pct ?? 70),
        })) { heldShortWindow++; continue; }


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


      let queued = 0;
      const changed: Array<Record<string, unknown>> = [];
      // Only queue prices for events that were genuinely new this tick.
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
            for (const row of payload) row.intent_source = "automation_pickup";
            const pushRunId = await queueIntents(admin, rule, payload, priorityOf("pickup"));
            queued = payload.length;
            if (pushRunId && insertedActionIds.length > 0) {
              await admin.from("revenue_pickup_automation_actions")
                .update({ push_run_id: pushRunId })
                .in("id", insertedActionIds);
            }
          } catch (err) {
            const queueError = describeError(err);
            console.error("automation enqueue failed", queueError);
            await admin.from("revenue_pickup_automation_actions")
              .update({ status: "failed", push_error: queueError })
              .in("id", insertedActionIds);
            throw err;
          }

          for (const d of payload) {
            changed.push({
              stay_date: d.stay_date, room_type_name: d.room_type_name, occupancy: d.occupancy,
              old_price: d.old_price, new_price: d.new_price, currency: d.currency,
              status: "queued",
            });
          }
        }
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
          pushed_count: 0,
          failed_count: failedCount,
          currency: rule.currency ?? "EUR",
          severity: failedCount > 0 ? "warning" : "info",
          summary: `${queued} prices queued safely · ${failedCount} failed`,
          changes: changed,
        });
        if (notifErr) console.error("notification insert failed", notifErr);
      }

      summary.push({
        hotel_id: rule.hotel_id, pickups: events.length,
        skipped_not_new: skippedStale, skipped_negative_pickup: skippedNegative,
        actions: inserted, markdowns: markdownActions,
        markdown_stay_dates: markdownStayDates, blocked: markdownBlocks,
        queued: queued + markdownActions + strongActions,
        pushed: 0, failed: failedCount,

        push_error: null, auto_publish: rule.auto_publish, changed,
        smart_strong: strongActions, smart_pricing: rule.smart_pricing_enabled === true,
        next_run_at: nextRunAt(now, intervalMinutes),
      });

    }
    } finally {
      await admin.rpc("release_automation_lock", { p_hotel: lockHotel });
    }

    return json({ ok: true, code: "ran", rules: rules.length, hotel_id: lockHotel, actor: actorName, summary });
  } catch (e) {
    console.error("pickup automation failed", e);
    // Never hand the browser a bare object: a Postgres error stringifies to
    // "[object Object]", which is exactly what users used to see in the toast.
    const detail = describeError(e);
    return json({ ok: false, code: "error", error: detail, msg: detail }, 500);
  }
});
