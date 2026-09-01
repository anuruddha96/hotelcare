import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/emailSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

interface SameDayRule {
  id: string;
  hotel_id: string;
  organization_slug: string | null;
  currency: string | null;
  is_enabled: boolean;
  mode: string | null;
  engine_version: number | null;
  run_timezone: string | null;
  manual_hold_hours: number | null;
  same_day_sellout_enabled: boolean;
  same_day_check_interval_minutes: number | null;
  same_day_cutoff_local: string | null;
  same_day_min_rate_eur: number | null;
  same_day_last_checked_at: string | null;
  same_day_handover_date: string | null;
}

interface RateCell {
  stay_date: string;
  obk_id: string | null;
  room_type_name: string | null;
  occupancy: number;
  price: number;
  currency: string | null;
  captured_at: string | null;
}

function localParts(timeZone: string, at = new Date()): { date: string; time: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
    minutes: hour * 60 + minute,
  };
}

function minutesOf(value: string | null | undefined, fallback: number): number {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function urgencyStep(localMinutes: number, roomsRemaining: number): number {
  let base = 3;
  if (localMinutes >= 14 * 60 + 30) base = 10;
  else if (localMinutes >= 14 * 60) base = 8;
  else if (localMinutes >= 13 * 60) base = 7;
  else if (localMinutes >= 12 * 60) base = 6;
  else if (localMinutes >= 10 * 60) base = 5;
  else if (localMinutes >= 8 * 60) base = 4;

  if (roomsRemaining >= 4) base += 2;
  else if (roomsRemaining === 1) base = Math.max(3, base - 2);
  return Math.round(base);
}

function latestCells(rows: any[]): RateCell[] {
  const out = new Map<string, RateCell>();
  for (const row of rows) {
    const price = Number(row.price);
    const occupancy = Number(row.occupancy);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(occupancy)) continue;
    const key = `${row.obk_id ?? ""}|${row.room_type_name ?? ""}|${occupancy}`;
    if (out.has(key)) continue;
    out.set(key, {
      stay_date: String(row.stay_date),
      obk_id: row.obk_id ?? null,
      room_type_name: row.room_type_name ?? null,
      occupancy,
      price: Math.round(price),
      currency: row.currency ?? null,
      captured_at: row.captured_at ?? null,
    });
  }
  return [...out.values()];
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error).slice(0, 500); } catch { return "Unexpected error"; }
}

async function recordRunNotification(admin: any, rule: SameDayRule, summary: string, severity: "info" | "warning" | "error" = "info") {
  await admin.from("revenue_automation_notifications").insert({
    hotel_id: rule.hotel_id,
    organization_slug: rule.organization_slug,
    notification_type: severity === "warning" ? "same_day_floor_handover" : "same_day_sellout_run",
    run_source: "automatic",
    actor_name: "Same-day sell-out automation",
    actor_user_id: null,
    rule_id: rule.id,
    action_ids: [],
    pickups_count: 0,
    actions_count: 0,
    pushed_count: 0,
    failed_count: severity === "error" ? 1 : 0,
    currency: rule.currency ?? "EUR",
    severity,
    summary,
    changes: [],
  });
}

async function sendFloorHandoverAlert(
  admin: any,
  rule: SameDayRule,
  input: {
    stayDate: string;
    localTime: string;
    roomsRemaining: number;
    occupancyPct: number | null;
    floor: number;
    startingRate: number;
    currentRate: number;
    pickup30m: number;
  },
) {
  const { data: recipients } = await admin
    .from("profiles")
    .select("email")
    .eq("organization_slug", rule.organization_slug)
    .in("role", ["top_management", "top_management_manager"])
    .is("deleted_at", null);

  const emails = (recipients ?? [])
    .map((r: any) => String(r.email ?? "").trim())
    .filter((email: string) => /\S+@\S+\.\S+/.test(email));

  const subject = `Hotel Ottofiori: same-day rate reached €${input.floor} floor — manual action required`;
  const text = [
    `HotelCare has completed its authorised same-day sell-out markdowns for ${input.stayDate}.`,
    `Local time: ${input.localTime}`,
    `Rooms remaining: ${input.roomsRemaining}`,
    `Occupancy: ${input.occupancyPct == null ? "unknown" : `${Math.round(input.occupancyPct)}%`}`,
    `Current minimum sellable rate: €${input.currentRate}`,
    `Authorised automatic floor: €${input.floor}`,
    `Pickup in the last 30 minutes: ${input.pickup30m}`,
    "The automation will not reduce this stay date again. Please take over manually if you want to sell below the authorised floor.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111827">
      <h2 style="margin-bottom:8px">Same-day rate reached the authorised floor</h2>
      <p>HotelCare has tried to sell the remaining rooms for <strong>${input.stayDate}</strong> and has reached the minimum rate it is authorised to publish automatically.</p>
      <table style="border-collapse:collapse;width:100%;margin:18px 0">
        <tr><td style="padding:7px;border-bottom:1px solid #e5e7eb">Local time</td><td style="padding:7px;border-bottom:1px solid #e5e7eb"><strong>${input.localTime}</strong></td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #e5e7eb">Rooms remaining</td><td style="padding:7px;border-bottom:1px solid #e5e7eb"><strong>${input.roomsRemaining}</strong></td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #e5e7eb">Occupancy</td><td style="padding:7px;border-bottom:1px solid #e5e7eb"><strong>${input.occupancyPct == null ? "Unknown" : `${Math.round(input.occupancyPct)}%`}</strong></td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #e5e7eb">Current minimum rate</td><td style="padding:7px;border-bottom:1px solid #e5e7eb"><strong>€${input.currentRate}</strong></td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #e5e7eb">Automatic floor</td><td style="padding:7px;border-bottom:1px solid #e5e7eb"><strong>€${input.floor}</strong></td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #e5e7eb">Pickup, last 30 min</td><td style="padding:7px;border-bottom:1px solid #e5e7eb"><strong>${input.pickup30m}</strong></td></tr>
      </table>
      <p><strong>Automatic same-day markdowns are now stopped for this stay date.</strong> If you want to continue below €${input.floor}, please review and take over the price manually.</p>
      <p><a href="https://my.hotelcare.app" style="display:inline-block;background:#20aee5;color:white;text-decoration:none;padding:11px 18px;border-radius:7px">Open HotelCare</a></p>
    </div>`;

  const result = await sendEmail({
    admin,
    organizationSlug: rule.organization_slug,
    to: emails,
    subject,
    html,
    text,
    kind: "transactional",
  });

  await recordRunNotification(
    admin,
    rule,
    `Same-day sell-out reached the €${input.floor} authorised floor with ${input.roomsRemaining} room${input.roomsRemaining === 1 ? "" : "s"} still unsold. Top management handover requested${result.ok ? " by email" : ""}.`,
    "warning",
  );

  return result;
}

async function queueSameDayChange(
  admin: any,
  rule: SameDayRule,
  input: {
    today: string;
    occupancyPct: number | null;
    roomsSold: number | null;
    roomsRemaining: number;
    pickup30m: number;
    pickup1h: number;
    pickup6h: number;
    pickup24h: number;
    cancellations24h: number;
    requestedStep: number;
    actualStep: number;
    floor: number;
    cells: RateCell[];
    detail: string;
  },
) {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  await admin.from("revenue_automation_runs").insert({
    id: runId,
    hotel_id: rule.hotel_id,
    organization_slug: rule.organization_slug ?? "",
    rule_id: rule.id,
    mode: "live",
    status: "in_progress",
  });

  const referenceCells = input.cells.filter((c) => c.occupancy === 2);
  const reference = (referenceCells.length ? referenceCells : input.cells)
    .reduce((min, cell) => cell.price < min.price ? cell : min);
  const targetReference = Math.round(reference.price - input.actualStep);

  const simulated = input.cells.map((cell) => ({
    obk_id: cell.obk_id,
    room_type_name: cell.room_type_name,
    occupancy: cell.occupancy,
    old_price: cell.price,
    new_price: Math.round(cell.price - input.actualStep),
  }));

  const { data: decision, error: decisionError } = await admin.from("revenue_date_decisions").insert({
    run_id: runId,
    hotel_id: rule.hotel_id,
    organization_slug: rule.organization_slug ?? "",
    stay_date: input.today,
    days_out: 0,
    occupancy_pct: input.occupancyPct,
    rooms_sold: input.roomsSold,
    rooms_remaining: input.roomsRemaining,
    pickup_1h: input.pickup1h,
    pickup_6h: input.pickup6h,
    pickup_24h: input.pickup24h,
    pickup_48h: input.pickup24h,
    pickup_7d: input.pickup24h,
    cancellations_24h: input.cancellations24h,
    pace_target_pct: null,
    pace_gap_pct: null,
    current_price: Math.round(reference.price),
    target_price: targetReference,
    movement: -input.actualStep,
    movement_requested: -input.requestedStep,
    direction: "decrease",
    decision_reason: "same_day_sellout",
    reason_detail: input.detail,
    market_signal: null,
    event_signal: null,
    cap_applied: input.actualStep < input.requestedStep ? input.floor : null,
    status: "queued",
    window_id: "same_day_00_15",
    simulated_cells: simulated,
    cells_simulated: simulated.length,
  }).select("id").single();
  if (decisionError) throw decisionError;
  const decisionId = decision.id as string;

  const payload = input.cells.map((cell) => ({
    hotel_id: rule.hotel_id,
    organization_slug: rule.organization_slug,
    stay_date: input.today,
    obk_id: cell.obk_id,
    room_type_name: cell.room_type_name,
    occupancy: cell.occupancy,
    old_price: cell.price,
    new_price: Math.round(cell.price - input.actualStep),
    currency: cell.currency ?? rule.currency ?? "EUR",
    status: "draft",
    priority: 5,
    intent_source: "automation_same_day_sellout",
    decision_id: decisionId,
    decision_reason: "same_day_sellout",
    reason_detail: input.detail,
  }));

  const pushRunId = crypto.randomUUID();
  const dateManifest = {
    [input.today]: {
      decision_id: decisionId,
      expected_cells: payload.length,
      movement: -input.actualStep,
      movement_requested: -input.requestedStep,
    },
  };

  await admin.from("revenue_rate_push_runs").insert({
    id: pushRunId,
    hotel_id: rule.hotel_id,
    organization_slug: rule.organization_slug,
    source: "automation",
    requested_count: payload.length,
    priority: 5,
    automation_run_id: runId,
    date_manifest: dateManifest,
  });

  const incomingKeys = new Set(payload.map((row) => `${row.stay_date}|${row.room_type_name}|${row.occupancy}`));
  const { data: staleDrafts } = await admin.from("revenue_rate_drafts")
    .select("id,stay_date,room_type_name,occupancy")
    .eq("hotel_id", rule.hotel_id)
    .eq("stay_date", input.today)
    .in("status", ["draft", "failed"])
    .is("superseded_at", null)
    .is("claimed_at", null);
  const staleIds = (staleDrafts ?? [])
    .filter((row: any) => incomingKeys.has(`${row.stay_date}|${row.room_type_name}|${row.occupancy}`))
    .map((row: any) => row.id);
  if (staleIds.length) {
    await admin.from("revenue_rate_drafts")
      .update({ superseded_at: new Date().toISOString(), status: "superseded" })
      .in("id", staleIds)
      .is("claimed_at", null);
  }

  const { data: drafts, error: draftError } = await admin.from("revenue_rate_drafts")
    .insert(payload.map((row) => ({ ...row, push_run_id: pushRunId, confirmation_status: "queued" })))
    .select("id,stay_date,room_type_name,occupancy");
  if (draftError) throw draftError;

  const draftMap = new Map((drafts ?? []).map((row: any) => [`${row.stay_date}|${row.room_type_name}|${row.occupancy}`, row.id]));
  const { error: itemError } = await admin.from("revenue_rate_push_items").insert(payload.map((row) => ({
    run_id: pushRunId,
    hotel_id: rule.hotel_id,
    organization_slug: rule.organization_slug,
    stay_date: row.stay_date,
    obk_id: row.obk_id,
    room_type_name: row.room_type_name,
    occupancy: row.occupancy,
    old_price: row.old_price,
    target_price: row.new_price,
    currency: row.currency,
    draft_id: draftMap.get(`${row.stay_date}|${row.room_type_name}|${row.occupancy}`),
    decision_id: decisionId,
  })));
  if (itemError) throw itemError;

  await admin.from("revenue_automation_runs").update({
    status: "completed",
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    dates_evaluated: 1,
    dates_increased: 0,
    dates_decreased: 1,
    dates_held: 0,
    dates_blocked: 0,
    cells_queued: payload.length,
    push_run_id: pushRunId,
    skip_reasons: {},
  }).eq("id", runId);

  await admin.from("revenue_automation_notifications").insert({
    hotel_id: rule.hotel_id,
    organization_slug: rule.organization_slug,
    notification_type: "same_day_sellout_run",
    run_source: "automatic",
    actor_name: "Same-day sell-out automation",
    actor_user_id: null,
    rule_id: rule.id,
    automation_run_id: runId,
    action_ids: [],
    pickups_count: input.pickup30m,
    actions_count: payload.length,
    pushed_count: 0,
    failed_count: 0,
    currency: rule.currency ?? "EUR",
    severity: "info",
    summary: `Same-day sell-out lowered ${input.today} by €${input.actualStep}; ${input.roomsRemaining} room${input.roomsRemaining === 1 ? "" : "s"} remain.`,
    changes: simulated,
  });

  return { runId, pushRunId, decisionId, payload };
}

async function processRule(admin: any, rule: SameDayRule) {
  const tz = rule.run_timezone || "Europe/Budapest";
  const local = localParts(tz);
  const cutoff = minutesOf(rule.same_day_cutoff_local, 15 * 60);
  const interval = Math.max(15, Number(rule.same_day_check_interval_minutes ?? 30));
  const floor = Math.round(Math.max(1, Number(rule.same_day_min_rate_eur ?? 100)));
  const now = new Date();

  if (local.minutes >= cutoff) {
    await admin.from("revenue_pickup_automation_rules").update({
      same_day_last_status: "cutoff",
      same_day_last_error: null,
    }).eq("id", rule.id);
    return { hotel_id: rule.hotel_id, skipped: true, reason: "cutoff", local_time: local.time };
  }

  if (rule.same_day_handover_date === local.date) {
    return { hotel_id: rule.hotel_id, skipped: true, reason: "management_handover", local_time: local.time };
  }

  if (rule.same_day_last_checked_at) {
    const elapsed = (now.getTime() - Date.parse(rule.same_day_last_checked_at)) / 60_000;
    if (Number.isFinite(elapsed) && elapsed < interval - 2) {
      return { hotel_id: rule.hotel_id, skipped: true, reason: "not_due", minutes_since_last: Math.round(elapsed) };
    }
  }

  const { data: gotLock } = await admin.rpc("claim_automation_lock", { p_hotel: rule.hotel_id, p_stale_minutes: 10 });
  if (gotLock !== true) return { hotel_id: rule.hotel_id, skipped: true, reason: "busy" };

  try {
    await admin.from("revenue_pickup_automation_rules").update({
      same_day_last_checked_at: now.toISOString(),
      same_day_last_status: "checking",
      same_day_last_error: null,
    }).eq("id", rule.id);

    const { data: snapshot, error: snapshotError } = await admin.from("revenue_daily_snapshots")
      .select("stay_date,occupancy_pct,rooms_sold,rooms_available,revenue_eur,adr_eur,captured_at")
      .eq("hotel_id", rule.hotel_id)
      .eq("stay_date", local.date)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotError) throw snapshotError;
    if (!snapshot) {
      await admin.from("revenue_pickup_automation_rules").update({ same_day_last_status: "no_snapshot" }).eq("id", rule.id);
      return { hotel_id: rule.hotel_id, skipped: true, reason: "no_snapshot" };
    }

    const snapshotAge = (now.getTime() - Date.parse(snapshot.captured_at)) / 60_000;
    if (!Number.isFinite(snapshotAge) || snapshotAge > 20) {
      await admin.from("revenue_pickup_automation_rules").update({
        same_day_last_status: "stale_data",
        same_day_last_error: `Current-day occupancy snapshot is ${Math.round(snapshotAge)} minutes old.`,
      }).eq("id", rule.id);
      return { hotel_id: rule.hotel_id, skipped: true, reason: "stale_data", age_minutes: Math.round(snapshotAge) };
    }

    const roomsSold = Number(snapshot.rooms_sold);
    const roomsAvailable = Number(snapshot.rooms_available);
    const roomsRemaining = Math.max(0, roomsAvailable - roomsSold);
    const occupancyPct = snapshot.occupancy_pct == null ? null : Number(snapshot.occupancy_pct);
    if (roomsRemaining <= 0) {
      await admin.from("revenue_pickup_automation_rules").update({ same_day_last_status: "sold_out", same_day_last_error: null }).eq("id", rule.id);
      return { hotel_id: rule.hotel_id, skipped: true, reason: "sold_out" };
    }

    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const { data: bookingRows } = await admin.from("revenue_booking_nights")
      .select("created_at_pms")
      .eq("hotel_id", rule.hotel_id)
      .eq("stay_date", local.date)
      .gte("created_at_pms", cutoff24h);
    const ages = (bookingRows ?? []).map((r: any) => Date.parse(r.created_at_pms)).filter(Number.isFinite);
    const countSince = (minutes: number) => ages.filter((at: number) => now.getTime() - at <= minutes * 60_000).length;
    const pickup30m = countSince(30);
    const pickup1h = countSince(60);
    const pickup6h = countSince(360);
    const pickup24h = countSince(24 * 60);

    const { count: cancellations24h } = await admin.from("revenue_cancelled_nights")
      .select("stay_date", { count: "exact", head: true })
      .eq("hotel_id", rule.hotel_id)
      .eq("stay_date", local.date)
      .gte("cancelled_at", cutoff24h);

    if (pickup30m > 0) {
      await admin.from("revenue_pickup_automation_rules").update({
        same_day_last_status: "pickup_hold",
        same_day_last_error: null,
      }).eq("id", rule.id);
      await recordRunNotification(admin, rule, `Same-day check held ${local.date}: ${pickup30m} genuine booking${pickup30m === 1 ? "" : "s"} arrived in the last 30 minutes; ${roomsRemaining} room${roomsRemaining === 1 ? "" : "s"} remain.`);
      return { hotel_id: rule.hotel_id, skipped: true, reason: "pickup_last_30m", pickup30m };
    }

    const holdHours = Math.max(0, Number(rule.manual_hold_hours ?? 2));
    const pSince = new Date(now.getTime() - Math.max(1, holdHours) * 60 * 60_000).toISOString();
    const { data: holds } = await admin.rpc("revenue_manual_hold_state", {
      p_hotel_id: rule.hotel_id,
      p_since: pSince,
      p_sources: ["cell-edit", "cell-selection", "day-tool", "bulk", "bulk-edit", "manual", "quick-adjust"],
    });
    const activeHold = (holds ?? []).find((h: any) => {
      if (String(h.stay_date) !== local.date) return false;
      const at = Date.parse(h.hold_until);
      if (!Number.isFinite(at)) return false;
      if (h.hold_kind === "hard") return at > now.getTime();
      return at + holdHours * 60 * 60_000 > now.getTime();
    });
    if (activeHold) {
      await admin.from("revenue_pickup_automation_rules").update({ same_day_last_status: "manual_hold" }).eq("id", rule.id);
      return { hotel_id: rule.hotel_id, skipped: true, reason: "manual_hold", hold_kind: activeHold.hold_kind };
    }

    const { data: rateRows, error: rateError } = await admin.from("revenue_room_type_rates")
      .select("stay_date,obk_id,room_type_name,occupancy,price,currency,captured_at")
      .eq("hotel_id", rule.hotel_id)
      .eq("stay_date", local.date)
      .order("captured_at", { ascending: false })
      .limit(1000);
    if (rateError) throw rateError;

    const { data: mappings } = await admin.from("previo_rate_plan_mapping")
      .select("previo_room_type_id,previo_rate_plan_id")
      .eq("hotel_id", rule.hotel_id);
    const mapped = new Set((mappings ?? [])
      .filter((m: any) => m.previo_room_type_id && m.previo_rate_plan_id)
      .map((m: any) => String(m.previo_room_type_id).trim()));

    const { data: roomTypes } = await admin.from("room_types")
      .select("pms_room_id,is_sellable,counts_toward_inventory")
      .eq("hotel_id", rule.hotel_id);
    const sellableIds = new Set<string>();
    for (const room of (roomTypes ?? []) as any[]) {
      if (room.is_sellable === false || room.counts_toward_inventory === false) continue;
      for (const raw of String(room.pms_room_id ?? "").split(",")) {
        const id = raw.trim();
        if (id) sellableIds.add(id);
      }
    }

    const cells = latestCells(rateRows ?? []).filter((cell) => {
      const id = String(cell.obk_id ?? "").trim();
      return id && mapped.has(id) && (sellableIds.size === 0 || sellableIds.has(id));
    });
    if (!cells.length) {
      await admin.from("revenue_pickup_automation_rules").update({ same_day_last_status: "no_rates" }).eq("id", rule.id);
      return { hotel_id: rule.hotel_id, skipped: true, reason: "no_mapped_rates" };
    }

    const mostRecentRate = Math.max(...cells.map((c) => Date.parse(c.captured_at ?? "")).filter(Number.isFinite));
    const rateAge = (now.getTime() - mostRecentRate) / 60_000;
    if (!Number.isFinite(rateAge) || rateAge > 20) {
      await admin.from("revenue_pickup_automation_rules").update({
        same_day_last_status: "stale_rates",
        same_day_last_error: `Current-day rates are ${Math.round(rateAge)} minutes old.`,
      }).eq("id", rule.id);
      return { hotel_id: rule.hotel_id, skipped: true, reason: "stale_rates", age_minutes: Math.round(rateAge) };
    }

    const minCurrent = Math.min(...cells.map((c) => c.price));
    if (minCurrent <= floor) {
      const result = await sendFloorHandoverAlert(admin, rule, {
        stayDate: local.date,
        localTime: local.time,
        roomsRemaining,
        occupancyPct,
        floor,
        startingRate: minCurrent,
        currentRate: minCurrent,
        pickup30m,
      });
      await admin.from("revenue_pickup_automation_rules").update({
        same_day_handover_date: local.date,
        same_day_floor_alerted_at: now.toISOString(),
        same_day_last_status: result.ok ? "floor_handover_emailed" : "floor_handover_email_failed",
        same_day_last_error: result.ok ? null : result.error,
      }).eq("id", rule.id);
      return { hotel_id: rule.hotel_id, skipped: true, reason: "floor_handover", emailed: result.ok };
    }

    const requestedStep = urgencyStep(local.minutes, roomsRemaining);
    const headroom = Math.max(0, minCurrent - floor);
    const actualStep = Math.min(requestedStep, headroom);
    if (actualStep <= 0) {
      return { hotel_id: rule.hotel_id, skipped: true, reason: "no_headroom" };
    }

    const detail = `${roomsRemaining} room${roomsRemaining === 1 ? "" : "s"} left at ${local.time}; no genuine pickup in the last 30 minutes. Same-day sell-out mode lowers every mapped room-rate cell by €${actualStep}${actualStep < requestedStep ? ` (limited by the €${floor} authorised floor)` : ""} to maximise occupancy before 15:00.`;

    const queued = await queueSameDayChange(admin, rule, {
      today: local.date,
      occupancyPct,
      roomsSold: Number.isFinite(roomsSold) ? roomsSold : null,
      roomsRemaining,
      pickup30m,
      pickup1h,
      pickup6h,
      pickup24h,
      cancellations24h: cancellations24h ?? 0,
      requestedStep,
      actualStep,
      floor,
      cells,
      detail,
    });

    const newMin = minCurrent - actualStep;
    if (newMin <= floor) {
      const alert = await sendFloorHandoverAlert(admin, rule, {
        stayDate: local.date,
        localTime: local.time,
        roomsRemaining,
        occupancyPct,
        floor,
        startingRate: minCurrent,
        currentRate: floor,
        pickup30m,
      });
      await admin.from("revenue_pickup_automation_rules").update({
        same_day_handover_date: local.date,
        same_day_floor_alerted_at: now.toISOString(),
        same_day_last_status: alert.ok ? "floor_handover_emailed" : "floor_handover_email_failed",
        same_day_last_error: alert.ok ? null : alert.error,
      }).eq("id", rule.id);
      return { hotel_id: rule.hotel_id, queued: cells.length, step: actualStep, reached_floor: true, emailed: alert.ok, ...queued };
    }

    await admin.from("revenue_pickup_automation_rules").update({
      same_day_last_status: "queued",
      same_day_last_error: null,
    }).eq("id", rule.id);
    return { hotel_id: rule.hotel_id, queued: cells.length, step: actualStep, rooms_remaining: roomsRemaining, ...queued };
  } catch (error) {
    const message = describeError(error);
    await admin.from("revenue_pickup_automation_rules").update({
      same_day_last_status: "error",
      same_day_last_error: message,
    }).eq("id", rule.id);
    await recordRunNotification(admin, rule, `Same-day sell-out check failed safely: ${message}. No rate was intentionally changed by this failed check.`, "error");
    return { hotel_id: rule.hotel_id, error: message };
  } finally {
    await admin.rpc("release_automation_lock", { p_hotel: rule.hotel_id });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const apiKey = req.headers.get("apikey") ?? "";
  const body = await req.json().catch(() => ({} as any));
  const serviceCall = (!!serviceKey && (bearer === serviceKey || apiKey === serviceKey));
  const schedulerCall = body?.scheduled === true && !!anonKey && apiKey === anonKey;
  if (!serviceCall && !schedulerCall) return json({ ok: false, error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: rules, error } = await admin.from("revenue_pickup_automation_rules")
    .select("id,hotel_id,organization_slug,currency,is_enabled,mode,engine_version,run_timezone,manual_hold_hours,same_day_sellout_enabled,same_day_check_interval_minutes,same_day_cutoff_local,same_day_min_rate_eur,same_day_last_checked_at,same_day_handover_date")
    .eq("is_enabled", true)
    .eq("same_day_sellout_enabled", true)
    .eq("mode", "live")
    .gte("engine_version", 2);
  if (error) return json({ ok: false, error: error.message }, 500);

  const results = [];
  for (const rule of (rules ?? []) as SameDayRule[]) {
    results.push(await processRule(admin, rule));
  }
  return json({ ok: true, checked: results.length, results });
});
