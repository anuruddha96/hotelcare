// Engine V2 orchestrator.
//
// This is NOT a second pricing engine: it lives inside the same function, uses
// the same lock, the same drafts table and the same background publisher. It
// only replaces the decision path — the pure rules in _shared/engineV2.ts —
// and it decides ONCE PER STAY DATE instead of once per cell per rule pass.
//
// Flow: refresh the discovery ledger → gather facts for the horizon → one
// decision per date → record the decision → (live mode only) queue whole-euro
// prices for every sellable cell of that date.

import {
  decideDate,
  explainDecision,
  DEFAULT_DECISION_SETTINGS,
  DEFAULT_MARKET_VALIDATION,
  DEFAULT_WINDOW_RULES,
  type Decision,
  type DecisionInput,
  type DecisionSettings,
  type MarketSignal,
  type PaceBand,
  type WindowRule,
} from "../_shared/engineV2.ts";

export interface V2Deps {
  admin: any;
  rule: any;
  isEngine: boolean;
  actorName: string | null;
  actorUserId: string | null;
  dryRun: boolean;
  pagedAll: <T = any>(build: (from: number, to: number) => any) => Promise<{ data: T[] }>;
  localParts: (timeZone: string) => { date: string; time: string };
  loadTypeAvailability: (
    admin: any,
    hotelId: string,
    fromDate: string,
    toDate: string,
  ) => Promise<{ left: (roomTypeName: unknown, obkId: unknown, stayDate: string) => number | null }>;
  queue: (payload: Array<Record<string, unknown>>, priority: number) => Promise<string | null>;
}

const whole = (value: number) => Math.round(value);
const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

interface CellRate {
  stay_date: string;
  obk_id: string | null;
  room_type_name: string | null;
  occupancy: number;
  price: number;
  currency: string | null;
}

/** Freshest price per (date, room type, occupancy). */
function latestRates(rows: any[]): Map<string, CellRate> {
  const out = new Map<string, CellRate>();
  for (const row of rows) {
    const key = `${row.stay_date}|${row.obk_id ?? ""}|${row.room_type_name ?? ""}|${row.occupancy}`;
    if (out.has(key)) continue; // rows arrive newest-first
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.set(key, {
      stay_date: row.stay_date,
      obk_id: row.obk_id ?? null,
      room_type_name: row.room_type_name ?? null,
      occupancy: Number(row.occupancy),
      price,
      currency: row.currency ?? null,
    });
  }
  return out;
}

export async function runEngineV2(deps: V2Deps): Promise<Record<string, unknown>> {
  const { admin, rule, dryRun } = deps;
  const startedAt = Date.now();
  const now = new Date();
  const tz = rule.run_timezone || "Europe/Budapest";
  const local = deps.localParts(tz);
  const today = local.date;
  const horizonDays = Math.max(1, Math.min(400, Number(rule.future_booking_window_days || 183)));
  const horizonDate = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + horizonDays);
    return d.toISOString().slice(0, 10);
  })();
  const mode: "shadow" | "live" = rule.mode === "live" && rule.auto_publish ? "live" : "shadow";
  const runBudgetMs = Math.max(5_000, Number(rule.run_budget_ms || 30_000));

  const { data: runRow, error: runError } = await admin.from("revenue_automation_runs").insert({
    hotel_id: rule.hotel_id,
    organization_slug: rule.organization_slug,
    rule_id: rule.id,
    mode,
    status: "in_progress",
  }).select("id").single();
  if (runError) throw runError;
  const runId: string = runRow.id;

  const finish = async (patch: Record<string, unknown>) => {
    await admin.from("revenue_automation_runs").update({
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      ...patch,
    }).eq("id", runId);
  };

  try {
    // ---- 1. Refresh the discovery ledger ----------------------------------
    // Every booking night in the horizon gets a permanent "first seen" stamp.
    // A booking is only pickup on the run that first records it, so a full
    // re-sync of the calendar can never be mistaken for demand.
    const { data: nightRows } = await deps.pagedAll((f, t) => admin
      .from("revenue_booking_nights")
      .select("stay_date, res_id, created_at_pms, captured_at, obk_id, room_type_name")
      .eq("hotel_id", rule.hotel_id)
      .gte("stay_date", today).lte("stay_date", horizonDate)
      .order("stay_date").range(f, t));
    const nights = (nightRows ?? []) as any[];

    // Stale data must never become a price change.
    const freshest = nights.reduce<number>((max, n) => Math.max(max, Date.parse(n.captured_at ?? "") || 0), 0);
    const dataAgeHours = freshest > 0 ? (now.getTime() - freshest) / 3_600_000 : null;
    if (dataAgeHours != null && dataAgeHours > 6) {
      await finish({ status: "stopped_stale_data", failure_reason: `Booking data is ${Math.round(dataAgeHours)}h old.` });
      return { hotel_id: rule.hotel_id, skipped: true, reason: "stale_data", data_age_hours: Math.round(dataAgeHours) };
    }

    const ledgerRows = nights.map((n) => ({
      hotel_id: rule.hotel_id,
      organization_slug: rule.organization_slug,
      reservation_id: String(n.res_id ?? ""),
      stay_date: n.stay_date,
      pms_created_at: n.created_at_pms ?? null,
      // Anchor discovery to when the GUEST booked, not when this row was
      // written. Without it the very first ledger fill would make the entire
      // existing book look like it arrived in the last hour.
      first_seen_at: n.created_at_pms ?? n.captured_at ?? new Date().toISOString(),
    })).filter((r) => r.reservation_id);
    for (let i = 0; i < ledgerRows.length; i += 500) {
      await admin.from("revenue_pickup_ledger")
        .upsert(ledgerRows.slice(i, i + 500), { onConflict: "hotel_id,reservation_id,stay_date", ignoreDuplicates: true });
    }

    // ---- 2. Gather the facts ----------------------------------------------
    const since = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
    const [
      { data: ledger },
      { data: cancellations },
      { data: rateRows },
      { data: snapshots },
      { data: floors },
      { data: paceRows },
      { data: competitorRows },
      { data: recentDecisions },
      { data: manualEdits },
      { data: appliedEvents },
      { data: events },
    ] = await Promise.all([
      deps.pagedAll((f, t) => admin.from("revenue_pickup_ledger")
        .select("stay_date, first_seen_at").eq("hotel_id", rule.hotel_id)
        .gte("stay_date", today).lte("stay_date", horizonDate)
        .gte("first_seen_at", since(24 * 7)).order("stay_date").range(f, t)),
      deps.pagedAll((f, t) => admin.from("revenue_cancelled_nights")
        .select("stay_date, cancelled_at").eq("hotel_id", rule.hotel_id)
        .gte("stay_date", today).lte("stay_date", horizonDate)
        .gte("cancelled_at", since(48)).order("stay_date").range(f, t)),
      deps.pagedAll((f, t) => admin.from("revenue_room_type_rates")
        .select("stay_date, obk_id, room_type_name, occupancy, price, currency, captured_at")
        .eq("hotel_id", rule.hotel_id).gte("stay_date", today).lte("stay_date", horizonDate)
        .order("captured_at", { ascending: false }).order("stay_date").range(f, t)),
      deps.pagedAll((f, t) => admin.from("revenue_daily_snapshots")
        .select("stay_date, occupancy_pct, rooms_sold, rooms_available, captured_date")
        .eq("hotel_id", rule.hotel_id).gte("stay_date", today).lte("stay_date", horizonDate)
        .order("captured_date", { ascending: false }).order("stay_date").range(f, t)),
      admin.from("revenue_price_floors").select("*").eq("hotel_id", rule.hotel_id),
      admin.from("revenue_pace_targets").select("min_days_out, max_days_out, target_occupancy_pct")
        .eq("hotel_id", rule.hotel_id).order("min_days_out"),
      deps.pagedAll((f, t) => admin.from("competitor_rates")
        .select("stay_date, rate, captured_at").eq("hotel_id", rule.hotel_id)
        .gte("stay_date", today).lte("stay_date", horizonDate)
        .gte("captured_at", since(48)).order("stay_date").range(f, t)),
      deps.pagedAll((f, t) => admin.from("revenue_date_decisions")
        .select("stay_date, direction, created_at").eq("hotel_id", rule.hotel_id)
        .gte("stay_date", today).neq("direction", "hold")
        .gte("created_at", since(72)).order("created_at", { ascending: false }).range(f, t)),
      deps.pagedAll((f, t) => admin.from("rate_change_audit")
        .select("stay_date, performed_at, source").eq("hotel_id", rule.hotel_id)
        .gte("stay_date", today)
        .gte("performed_at", since(Math.max(0, Number(rule.manual_hold_hours || 24))))
        .order("stay_date").range(f, t)),
      admin.from("revenue_event_applications").select("event_key, stay_date")
        .eq("hotel_id", rule.hotel_id).gte("stay_date", today),
      admin.from("demand_events").select("id, start_date, end_date, impact_level")
        .eq("hotel_id", rule.hotel_id).gte("end_date", today).lte("start_date", horizonDate),
    ]);

    const typeAvail = await deps.loadTypeAvailability(admin, rule.hotel_id, today, horizonDate);

    // Pickup counts, per window, from the ledger's own first-seen stamp.
    const countIn = (rows: any[], field: string, hours: number) => {
      const cutoff = since(hours);
      const map = new Map<string, number>();
      for (const row of rows) {
        if (!row[field] || row[field] < cutoff) continue;
        map.set(row.stay_date, (map.get(row.stay_date) ?? 0) + 1);
      }
      return map;
    };
    const ledgerArr = (ledger ?? []) as any[];
    const pickup1h = countIn(ledgerArr, "first_seen_at", 1);
    const pickup24h = countIn(ledgerArr, "first_seen_at", 24);
    const pickup48h = countIn(ledgerArr, "first_seen_at", 48);
    const pickup7d = countIn(ledgerArr, "first_seen_at", 24 * 7);
    const cancelArr = (cancellations ?? []) as any[];
    const cancels24h = countIn(cancelArr, "cancelled_at", 24);
    const lastCancel = new Map<string, string>();
    for (const c of cancelArr) {
      const seen = lastCancel.get(c.stay_date);
      if (!seen || c.cancelled_at > seen) lastCancel.set(c.stay_date, c.cancelled_at);
    }

    const rates = latestRates((rateRows ?? []) as any[]);
    const byDate = new Map<string, CellRate[]>();
    for (const cell of rates.values()) {
      const list = byDate.get(cell.stay_date) ?? [];
      list.push(cell);
      byDate.set(cell.stay_date, list);
    }

    const occByDate = new Map<string, { pct: number | null; sold: number | null; left: number | null }>();
    for (const row of (snapshots ?? []) as any[]) {
      if (occByDate.has(row.stay_date)) continue; // newest capture first
      const available = Number(row.rooms_available);
      const sold = Number(row.rooms_sold);
      occByDate.set(row.stay_date, {
        pct: row.occupancy_pct == null ? null : Number(row.occupancy_pct),
        sold: Number.isFinite(sold) ? sold : null,
        left: Number.isFinite(available) && Number.isFinite(sold) ? Math.max(0, available - sold) : null,
      });
    }

    // Market median per date from fresh competitor observations.
    const compByDate = new Map<string, { prices: number[]; newest: number }>();
    for (const row of (competitorRows ?? []) as any[]) {
      const price = Number(row.rate);
      if (!Number.isFinite(price) || price <= 0) continue;
      const bucket = compByDate.get(row.stay_date) ?? { prices: [], newest: 0 };
      bucket.prices.push(price);
      bucket.newest = Math.max(bucket.newest, Date.parse(row.captured_at ?? "") || 0);
      compByDate.set(row.stay_date, bucket);
    }
    const marketFor = (stayDate: string): MarketSignal => {
      const bucket = compByDate.get(stayDate);
      if (!bucket || bucket.prices.length === 0) return { median: null, sampleSize: 0, ageHours: null };
      const sorted = [...bucket.prices].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return {
        median,
        sampleSize: sorted.length,
        ageHours: bucket.newest ? (now.getTime() - bucket.newest) / 3_600_000 : null,
      };
    };

    const lastDecisionByDate = new Map<string, { direction: string; at: string }>();
    for (const row of (recentDecisions ?? []) as any[]) {
      if (!lastDecisionByDate.has(row.stay_date)) {
        lastDecisionByDate.set(row.stay_date, { direction: row.direction, at: row.created_at });
      }
    }

    const holdHours = Math.max(0, Number(rule.manual_hold_hours || 24));
    const manualHold = new Map<string, string>();
    // Only a change a PERSON made protects a date. Previo confirmations and
    // the publisher's own audit rows are machine echoes of automation work —
    // treating those as manual froze the whole calendar in the first V2 run.
    const HUMAN_SOURCES = new Set(["cell-edit", "cell-selection", "day-tool", "bulk", "bulk-edit", "manual", "quick-adjust"]);
    for (const row of (manualEdits ?? []) as any[]) {
      if (!HUMAN_SOURCES.has(String(row.source ?? ""))) continue;
      const until = new Date(Date.parse(row.performed_at) + holdHours * 3_600_000).toISOString();
      const seen = manualHold.get(row.stay_date);
      if (!seen || until > seen) manualHold.set(row.stay_date, until);
    }

    // Movement already spent today, per stay date.
    const { data: spentToday } = await deps.pagedAll((f, t) => admin
      .from("revenue_date_decisions").select("stay_date, movement")
      .eq("hotel_id", rule.hotel_id).eq("status", "published")
      .gte("created_at", `${today}T00:00:00Z`).order("stay_date").range(f, t));
    const movedToday = new Map<string, number>();
    for (const row of (spentToday ?? []) as any[]) {
      movedToday.set(row.stay_date, (movedToday.get(row.stay_date) ?? 0) + Math.abs(Number(row.movement) || 0));
    }

    // Events that have not yet lifted their dates.
    const appliedKeys = new Set(((appliedEvents as any)?.data ?? (appliedEvents as any) ?? []).map?.((r: any) => `${r.event_key}|${r.stay_date}`) ?? []);
    const eventUplift = new Map<string, { key: string; uplift: number }>();
    for (const ev of (((events as any)?.data ?? events ?? []) as any[])) {
      const uplift = ev.impact_level === "high" ? 20 : ev.impact_level === "medium" ? 10 : 0;
      if (uplift <= 0) continue;
      for (let d = new Date(`${ev.start_date}T00:00:00Z`); d.toISOString().slice(0, 10) <= ev.end_date; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if (key < today || key > horizonDate) continue;
        if (appliedKeys.has(`${ev.id}|${key}`)) continue;
        eventUplift.set(key, { key: String(ev.id), uplift });
      }
    }

    // Floors and ceilings.
    const floorRows = (((floors as any)?.data ?? floors ?? []) as any[]);
    const floorFor = (roomTypeName: string | null, occupancy: number) => {
      const exact = floorRows.find((r) => r.room_type_name === roomTypeName && Number(r.occupancy) === occupancy);
      const byType = floorRows.find((r) => r.room_type_name === roomTypeName && r.occupancy == null);
      const byOcc = floorRows.find((r) => r.room_type_name == null && Number(r.occupancy) === occupancy);
      const global = floorRows.find((r) => r.room_type_name == null && r.occupancy == null);
      const pick = (field: string) =>
        [exact, byType, byOcc, global].map((r) => r?.[field]).find((v) => v != null && Number.isFinite(Number(v)));
      return {
        min: Number(pick("min_price") ?? rule.minimum_adr ?? 0) || 0,
        max: Number(pick("max_price") ?? rule.maximum_increase ?? 100000) || 100000,
      };
    };

    const paceBands = (((paceRows as any)?.data ?? paceRows ?? []) as any[]).map((r) => ({
      min_days_out: Number(r.min_days_out),
      max_days_out: Number(r.max_days_out),
      target_occupancy_pct: Number(r.target_occupancy_pct),
    })) as PaceBand[];

    const settings: DecisionSettings = {
      ...DEFAULT_DECISION_SETTINGS,
      now,
      paceBands,
      windowRules: (Array.isArray(rule.window_rules) && rule.window_rules.length > 0
        ? rule.window_rules
        : DEFAULT_WINDOW_RULES) as WindowRule[],
      marketValidation: { ...DEFAULT_MARKET_VALIDATION, ...(rule.market_validation ?? {}) },
      minMovementEur: Math.max(1, Number(rule.min_movement_eur || 3)),
      directionChangeHours: Math.max(0, Number(rule.direction_change_hours ?? 6)),
      cancellationWaitMinutes: Math.max(0, Number(rule.cancellation_wait_minutes ?? 60)),
      abnormalPickupThreshold: Math.max(1, Number(rule.abnormal_pickup_threshold || 2)),
      soldOutOccupancyPct: Math.max(50, Number(rule.sold_out_occupancy_pct || 98)),
    };

    // ---- 3. One decision per stay date -------------------------------------
    const decisions: Decision[] = [];
    const decisionRows: Array<Record<string, unknown>> = [];
    const payload: Array<Record<string, unknown>> = [];
    const skipReasons: Record<string, number> = {};
    let budgetHit = false;

    const dates = Array.from(byDate.keys()).sort();
    for (const stayDate of dates) {
      if (Date.now() - startedAt > runBudgetMs) { budgetHit = true; break; }
      const daysOut = dayDiff(today, stayDate);
      if (daysOut < 0 || daysOut > horizonDays) continue;
      const cells = byDate.get(stayDate)!;

      // Reference price: the cheapest 2-pax cell still on sale for the date.
      const referenceCells = cells.filter((c) => c.occupancy === 2 && typeAvail.left(c.room_type_name, c.obk_id, stayDate) !== 0);
      const reference = referenceCells.length > 0
        ? referenceCells.reduce((min, c) => (c.price < min.price ? c : min))
        : null;

      const occ = occByDate.get(stayDate) ?? { pct: null, sold: null, left: null };
      const bounds = floorFor(reference?.room_type_name ?? null, 2);
      const pendingEvent = eventUplift.get(stayDate);
      const last = lastDecisionByDate.get(stayDate);

      const input: DecisionInput = {
        stayDate,
        daysOut,
        currentPrice: reference ? whole(reference.price) : null,
        occupancyPct: occ.pct,
        roomsSold: occ.sold,
        roomsRemaining: occ.left,
        pickup1h: pickup1h.get(stayDate) ?? 0,
        pickup24h: pickup24h.get(stayDate) ?? 0,
        pickup48h: pickup48h.get(stayDate) ?? 0,
        pickup7d: pickup7d.get(stayDate) ?? 0,
        cancellations24h: cancels24h.get(stayDate) ?? 0,
        lastCancellationAt: lastCancel.get(stayDate) ?? null,
        lastDirection: (last?.direction as any) ?? null,
        lastDecisionAt: last?.at ?? null,
        movedTodayEur: movedToday.get(stayDate) ?? 0,
        manualHoldUntil: manualHold.get(stayDate) ?? null,
        minPrice: bounds.min,
        maxPrice: bounds.max,
        pendingEventUplift: pendingEvent?.uplift ?? 0,
        market: marketFor(stayDate),
      };

      const decision = decideDate(input, settings);
      decisions.push(decision);
      if (decision.blocked) skipReasons[decision.reason] = (skipReasons[decision.reason] ?? 0) + 1;

      const status = decision.blocked ? "held" : (mode === "live" ? "queued" : "shadow");
      decisionRows.push({
        run_id: runId,
        hotel_id: rule.hotel_id,
        organization_slug: rule.organization_slug ?? "",
        stay_date: stayDate,
        days_out: daysOut,
        occupancy_pct: occ.pct,
        rooms_sold: occ.sold,
        rooms_remaining: occ.left,
        pickup_1h: input.pickup1h,
        pickup_6h: input.pickup1h,
        pickup_24h: input.pickup24h,
        pickup_48h: input.pickup48h,
        pickup_7d: input.pickup7d,
        cancellations_24h: input.cancellations24h,
        pace_target_pct: decision.paceTargetPct,
        pace_gap_pct: decision.paceGapPct,
        current_price: decision.currentPrice,
        target_price: decision.targetPrice,
        movement: decision.movement,
        direction: decision.direction,
        decision_reason: decision.reason,
        reason_detail: decision.reasonDetail,
        event_signal: pendingEvent ? { event_key: pendingEvent.key, uplift: pendingEvent.uplift } : null,
        market_signal: input.market.median == null ? null : input.market,
        manual_hold_until: input.manualHoldUntil,
        cap_applied: decision.capApplied,
        status,
      });

      if (decision.blocked || mode !== "live" || dryRun) continue;

      // Apply the SAME whole-euro movement to every sellable cell of the date,
      // so the occupancy ladder keeps its shape by construction.
      for (const cell of cells) {
        if (typeAvail.left(cell.room_type_name, cell.obk_id, stayDate) === 0) continue;
        const cellBounds = floorFor(cell.room_type_name, cell.occupancy);
        const old = whole(cell.price);
        let next = whole(old + decision.movement);
        if (next < cellBounds.min) next = whole(cellBounds.min);
        if (next > cellBounds.max) next = whole(cellBounds.max);
        if (next === old) continue;
        payload.push({
          hotel_id: rule.hotel_id,
          organization_slug: rule.organization_slug,
          stay_date: stayDate,
          obk_id: cell.obk_id,
          room_type_name: cell.room_type_name,
          occupancy: cell.occupancy,
          old_price: old,
          new_price: next,
          currency: cell.currency ?? rule.currency ?? "EUR",
          status: "draft",
          intent_source: decision.direction === "increase" ? "automation_pickup" : "automation_markdown",
          decision_reason: decision.reason,
          reason_detail: explainDecision(decision),
        });
      }
    }

    for (let i = 0; i < decisionRows.length; i += 500) {
      const { error } = await admin.from("revenue_date_decisions").insert(decisionRows.slice(i, i + 500));
      if (error) throw error;
    }

    // ---- 4. Publish (live mode only) ---------------------------------------
    let pushRunId: string | null = null;
    if (payload.length > 0) {
      pushRunId = await deps.queue(payload, 5);
      const movedDates = decisions.filter((d) => !d.blocked).map((d) => d.stayDate);
      await admin.from("revenue_date_decisions")
        .update({ status: "published" }).eq("run_id", runId).in("stay_date", movedDates);
      // Record event uplifts so an event can never lift the same date twice.
      const eventApplications = decisions
        .filter((d) => !d.blocked && eventUplift.has(d.stayDate))
        .map((d) => ({
          hotel_id: rule.hotel_id,
          organization_slug: rule.organization_slug ?? "",
          event_key: eventUplift.get(d.stayDate)!.key,
          stay_date: d.stayDate,
          impact: "uplift",
          uplift_eur: eventUplift.get(d.stayDate)!.uplift,
        }));
      if (eventApplications.length > 0) {
        await admin.from("revenue_event_applications")
          .upsert(eventApplications, { onConflict: "hotel_id,event_key,stay_date", ignoreDuplicates: true });
      }
    }

    const increases = decisions.filter((d) => d.direction === "increase" && !d.blocked).length;
    const decreases = decisions.filter((d) => d.direction === "decrease" && !d.blocked).length;
    const held = decisions.filter((d) => d.blocked).length;

    await finish({
      status: budgetHit ? "timed_out" : "completed",
      dates_evaluated: decisions.length,
      dates_increased: increases,
      dates_decreased: decreases,
      dates_held: held,
      cells_queued: payload.length,
      skip_reasons: skipReasons,
    });

    await admin.from("revenue_pickup_automation_rules").update({
      last_evaluated_at: new Date(startedAt).toISOString(),
      last_successful_evaluation_at: new Date(startedAt).toISOString(),
      last_run_at: new Date(startedAt).toISOString(),
      last_evaluation_status: mode === "live" ? "ok" : "shadow_ok",
      last_evaluation_error: null,
      next_run_at: new Date(now.getTime() + Math.max(60, Number(rule.evaluation_interval_minutes || 60)) * 60_000).toISOString(),
    }).eq("id", rule.id);

    // Shadow runs are silent by design; a live run announces what it did.
    if (mode === "live" && payload.length > 0 && !dryRun) {
      await admin.from("revenue_automation_notifications").insert({
        hotel_id: rule.hotel_id,
        organization_slug: rule.organization_slug,
        notification_type: "pickup_automation",
        run_source: deps.isEngine ? "automatic" : "manual",
        actor_name: deps.isEngine ? "Automatic pricing" : (deps.actorName ?? "Manual run"),
        actor_user_id: deps.isEngine ? null : deps.actorUserId,
        rule_id: rule.id,
        action_ids: [],
        pickups_count: increases,
        actions_count: increases + decreases,
        pushed_count: payload.length,
        failed_count: 0,
        currency: rule.currency ?? "EUR",
        severity: "info",
        summary: `${increases} date${increases === 1 ? "" : "s"} priced up, ${decreases} priced down, ${held} left alone`,
        changes: decisions.filter((d) => !d.blocked).slice(0, 50).map(explainDecision),
      });
    }

    return {
      hotel_id: rule.hotel_id,
      engine: "v2",
      mode,
      run_id: runId,
      push_run_id: pushRunId,
      dates_evaluated: decisions.length,
      increases,
      decreases,
      held,
      cells_queued: payload.length,
      skip_reasons: skipReasons,
      timed_out: budgetHit,
    };
  } catch (e) {
    const message = e instanceof Error
      ? e.message
      : (typeof e === "object" && e !== null
        ? String((e as any).message ?? (e as any).details ?? JSON.stringify(e))
        : String(e));
    await finish({ status: "failed", failure_reason: message.slice(0, 500) });
    await admin.from("revenue_pickup_automation_rules").update({
      last_evaluated_at: new Date(startedAt).toISOString(),
      last_evaluation_status: "error",
      last_evaluation_error: message.slice(0, 500),
      next_run_at: new Date(now.getTime() + Math.max(60, Number(rule.evaluation_interval_minutes || 60)) * 60_000).toISOString(),
    }).eq("id", rule.id);
    throw e;
  }
}
