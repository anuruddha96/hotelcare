// Engine V2 orchestrator.
//
// This is NOT a second pricing engine: it lives inside the same function, uses
// the same lock, the same drafts table and the same background publisher. It
// only replaces the decision path — the pure rules in _shared/engineV2.ts —
// and it decides ONCE PER STAY DATE instead of once per cell per rule pass.
//
// Flow: refresh the discovery ledger → gather facts for the horizon → one
// decision per date → build and validate every child cell (in shadow mode too)
// → record the decision → (live mode only) queue whole-euro prices → evaluate
// the automatic activation gate and the live watchdog.

import {
  buildMarketSignal,
  decideDate,
  explainDecision,
  DEFAULT_DECISION_SETTINGS,
  DEFAULT_MARKET_VALIDATION,
  OTTOFIORI_WINDOW_RULES,
  DEFAULT_PICKUP_LADDER,
  type CompetitorObservation,
  type Decision,
  type DecisionInput,
  type DecisionSettings,
  type PaceBand,
  type PickupLadderBand,
  type WindowRule,
} from "../_shared/engineV2.ts";

import {
  assertWholeEuro,
  headroom,
  uniformDateStep,
  isBoundsFailure,
  makeBoundsResolver,
  validateCells,
  type CellPrice,
} from "../_shared/priceBounds.ts";

import { evaluateGates, evaluateWatchdog, supervisedCaps } from "../_shared/activationGate.ts";
import { computeAdrGuard, type AdrGuardNight } from "../_shared/adrGuard.ts";
import { anchorFor, buildAnchorTable } from "../_shared/seasonalAnchor.ts";

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
  queue: (
    payload: Array<Record<string, unknown>>,
    priority: number,
    context?: { automationRunId: string; dateManifest: Record<string, unknown> },
  ) => Promise<string | null>;
}

const whole = (value: number) => Math.round(value);
const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const unwrap = <T = any>(res: any): T[] => (res?.data ?? res ?? []) as T[];

/** Event titles are normalised so the same festival never pays twice. */
export function eventKeyOf(ev: { id: string; title?: string | null; city?: string | null; venue?: string | null }, stayDate: string): string {
  const title = String(ev.title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
  const base = title || String(ev.id);
  return `${base}|${String(ev.city ?? "").toLowerCase()}|${String(ev.venue ?? "").toLowerCase()}|${stayDate}`;
}

/** Mojibake or empty titles mean the row is not trustworthy enough to price on. */
export function eventTitleUsable(title: string | null | undefined): boolean {
  const value = String(title ?? "").trim();
  if (value.length < 3) return false;
  if (/[\uFFFD]/.test(value)) return false;
  if (/Ã.|â€|Å¡|Ä\u008D/.test(value)) return false;
  return true;
}

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
  const horizonDays = Math.max(1, Math.min(400, Number(rule.future_booking_window_days || 365)));
  const horizonDate = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + horizonDays);
    return d.toISOString().slice(0, 10);
  })();
  // `mode` is the operator's deliberate state. Keep the legacy auto_publish
  // flag in lockstep instead of silently demoting an explicitly-live property
  // to another shadow review.
  const mode: "shadow" | "live" = rule.mode === "live" ? "live" : "shadow";
  const runBudgetMs = Math.max(5_000, Number(rule.run_budget_ms || 30_000));

  if (rule.auto_publish !== (mode === "live")) {
    await admin.from("revenue_pickup_automation_rules").update({
      auto_publish: mode === "live",
      auto_pause_reason: mode === "live" ? null : rule.auto_pause_reason,
    }).eq("id", rule.id);
  }

  const { data: runRow, error: runError } = await admin.from("revenue_automation_runs").insert({
    hotel_id: rule.hotel_id,
    organization_slug: rule.organization_slug,
    rule_id: rule.id,
    mode,
    status: "in_progress",
  }).select("id").single();
  if (runError) throw runError;
  const runId: string = runRow.id;

  const notifyRun = async (input: {
    severity?: "info" | "warning" | "error";
    summary: string;
    pickups?: number;
    actions?: number;
    pushed?: number;
    failed?: number;
  }) => {
    const row: Record<string, unknown> = {
      hotel_id: rule.hotel_id,
      organization_slug: rule.organization_slug,
      notification_type: "engine_v2_run",
      run_source: deps.isEngine ? "automatic" : "manual",
      actor_name: deps.isEngine ? "Automatic pricing" : (deps.actorName ?? "Manual run"),
      actor_user_id: deps.isEngine ? null : deps.actorUserId,
      rule_id: rule.id,
      automation_run_id: runId,
      action_ids: [],
      pickups_count: input.pickups ?? 0,
      actions_count: input.actions ?? 0,
      pushed_count: input.pushed ?? 0,
      failed_count: input.failed ?? 0,
      currency: rule.currency ?? "EUR",
      severity: input.severity ?? "info",
      summary: input.summary,
      changes: [],
    };
    const { error } = await admin.from("revenue_automation_notifications").insert(row);
    if (!error) return;
    console.error("Engine V2 run notification insert failed", error);
    // Never let a run go silent: retry once without the newer column, then
    // record the failure on the run itself so the gap is visible in history
    // instead of only in the function log.
    const { automation_run_id: _drop, ...legacy } = row;
    const retry = await admin.from("revenue_automation_notifications").insert(legacy);
    if (!retry.error) return;
    console.error("Engine V2 run notification retry failed", retry.error);
    await admin.from("revenue_automation_runs")
      .update({ failure_reason: `Run activity item could not be written: ${String(error.message ?? error)}`.slice(0, 500) })
      .eq("id", runId).is("failure_reason", null);
  };


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
      await notifyRun({
        severity: "warning",
        failed: 1,
        summary: `Run stopped safely: booking data is ${Math.round(dataAgeHours)}h old. No prices were sent.`,
      });
      return { hotel_id: rule.hotel_id, engine: "v2", mode, run_id: runId, skipped: true, reason: "stale_data", data_age_hours: Math.round(dataAgeHours) };
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
      ledgerRes,
      cancellationRes,
      rateRes,
      snapshotRes,
      floorsRes,
      paceRes,
      competitorRes,
      decisionRes,
      manualRes,
      appliedEventsRes,
      eventsRes,
      roomTypesRes,
      anchorRes,
    ] = await Promise.all([
      deps.pagedAll((f, t) => admin.from("revenue_pickup_ledger")
        .select("id, stay_date, reservation_id, first_seen_at, cancelled_at, increase_spent_at").eq("hotel_id", rule.hotel_id)
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
      // Occupancy: only the two newest captures per stay date. Reading the raw
      // history (Ottofiori alone holds ~237k rows in the horizon) paged the
      // engine into a statement timeout every run.
      admin.rpc("revenue_latest_snapshots", {
        p_hotel_id: rule.hotel_id, p_from: today, p_to: horizonDate,
      }),

      admin.from("revenue_price_floors").select("*").eq("hotel_id", rule.hotel_id),
      admin.from("revenue_pace_targets").select("min_days_out, max_days_out, target_occupancy_pct")
        .eq("hotel_id", rule.hotel_id).order("min_days_out"),
      deps.pagedAll((f, t) => admin.from("competitor_rates")
        .select("stay_date, competitor_id, rate, captured_at").eq("hotel_id", rule.hotel_id)
        .gte("stay_date", today).lte("stay_date", horizonDate)
        .gte("captured_at", since(48)).order("stay_date").range(f, t)),
      deps.pagedAll((f, t) => admin.from("revenue_date_decisions")
        .select("stay_date, direction, movement, created_at").eq("hotel_id", rule.hotel_id)
        .gte("stay_date", today).neq("direction", "hold")
        .gte("created_at", since(96)).order("created_at", { ascending: false }).range(f, t)),
      // Manual protection: manager locks (hard) and ordinary human price edits
      // (soft), aggregated in the database — the audit table holds >1.3M rows.
      admin.rpc("revenue_manual_hold_state", {
        p_hotel_id: rule.hotel_id,
        p_since: since(Math.max(1, Number(rule.manual_hold_hours || 2))),
        p_sources: ["cell-edit", "cell-selection", "day-tool", "bulk", "bulk-edit", "manual", "quick-adjust"],
      }),

      admin.from("revenue_event_applications").select("event_key, stay_date")
        .eq("hotel_id", rule.hotel_id).gte("stay_date", today),
      admin.from("demand_events")
        .select("id, title, city, venue, event_date, end_date, expected_impact, confidence, approved")
        .eq("hotel_id", rule.hotel_id).gte("end_date", today).lte("event_date", horizonDate),
      admin.from("room_types")
        .select("name, num_rooms, is_sellable, counts_toward_inventory, base_price_eur, min_price_eur, max_price_eur")
        .eq("hotel_id", rule.hotel_id),
      // Seasonal anchor from the hotel's own realised ADR, by month and weekday.
      rule.seasonal_anchor_enabled === false
        ? Promise.resolve({ data: [] })
        : admin.rpc("revenue_seasonal_anchor", { p_hotel_id: rule.hotel_id, p_min_samples: 4 }),
    ]);

    const typeAvail = await deps.loadTypeAvailability(admin, rule.hotel_id, today, horizonDate);

    // Only real, sellable room types may ever be priced.
    const roomTypes = unwrap(roomTypesRes);
    const sellableNames = new Set(roomTypes.filter((r) => r.is_sellable !== false).map((r) => r.name));
    const sellableRooms = roomTypes
      .filter((r) => r.is_sellable !== false && r.counts_toward_inventory !== false)
      .reduce((sum, r) => sum + (Number(r.num_rooms) || 0), 0);
    const anchorByType = new Map<string, number>();
    for (const r of roomTypes) {
      const anchor = Number(r.base_price_eur);
      if (r.name && Number.isFinite(anchor) && anchor > 0) anchorByType.set(r.name, whole(anchor));
    }

    // Seasonal anchor: the hotel's own realised ADR per month and weekday. It
    // replaces the old generic floor, so a quiet Tuesday in February and a busy
    // Friday in September no longer share one anchor.
    const anchorTable = buildAnchorTable(
      (unwrap(anchorRes) as any[]).map((r) => ({
        month: Number(r.month), dow: Number(r.dow),
        anchorEur: Number(r.anchor_eur), samples: Number(r.samples),
      })),
    );

    // Pickup counts, per window, from the ledger's own first-seen stamp.
    const ledgerArr = unwrap(ledgerRes).filter((r: any) => !r.cancelled_at);
    const countIn = (rows: any[], field: string, hours: number) => {
      const cutoff = since(hours);
      const map = new Map<string, Set<string>>();
      for (const row of rows) {
        if (!row[field] || row[field] < cutoff) continue;
        const set = map.get(row.stay_date) ?? new Set<string>();
        set.add(String(row.reservation_id ?? row.id ?? Math.random()));
        map.set(row.stay_date, set);
      }
      return new Map([...map].map(([k, v]) => [k, v.size]));
    };
    // Each booking may drive at most ONE increase. Rows already consumed by an
    // earlier run keep their stamp, so the same reservation can never be paid
    // for twice, however often the engine runs.
    const unspentLedger = (ledgerArr as any[]).filter((r) => !r.increase_spent_at);
    const unspentIdsByDate = new Map<string, string[]>();
    for (const row of unspentLedger) {
      if (!row.id) continue;
      const list = unspentIdsByDate.get(row.stay_date) ?? [];
      list.push(String(row.id));
      unspentIdsByDate.set(row.stay_date, list);
    }
    const pickup1h = countIn(unspentLedger, "first_seen_at", 1);
    const pickup6h = countIn(unspentLedger, "first_seen_at", 6);
    const pickup24h = countIn(unspentLedger, "first_seen_at", 24);
    const pickup48h = countIn(ledgerArr, "first_seen_at", 48);
    const pickup7d = countIn(ledgerArr, "first_seen_at", 24 * 7);
    const lastPickupAt = new Map<string, string>();
    for (const row of ledgerArr as any[]) {
      const seen = lastPickupAt.get(row.stay_date);
      if (!seen || row.first_seen_at > seen) lastPickupAt.set(row.stay_date, row.first_seen_at);
    }

    const cancelArr = unwrap(cancellationRes) as any[];
    const cancels24h = (() => {
      const cutoff = since(24);
      const map = new Map<string, number>();
      for (const row of cancelArr) {
        if (!row.cancelled_at || row.cancelled_at < cutoff) continue;
        map.set(row.stay_date, (map.get(row.stay_date) ?? 0) + 1);
      }
      return map;
    })();
    const lastCancel = new Map<string, string>();
    for (const c of cancelArr) {
      const seen = lastCancel.get(c.stay_date);
      if (!seen || c.cancelled_at > seen) lastCancel.set(c.stay_date, c.cancelled_at);
    }

    const rateRows = unwrap(rateRes) as any[];
    const rates = latestRates(rateRows);
    const byDate = new Map<string, CellRate[]>();
    for (const cell of rates.values()) {
      if (cell.room_type_name && !sellableNames.has(cell.room_type_name)) continue;
      const list = byDate.get(cell.stay_date) ?? [];
      list.push(cell);
      byDate.set(cell.stay_date, list);
    }

    // Campaign start price per date: the highest 2-pax reference price the date
    // carried in the last 30 days. Fill mode is not allowed to take a date more
    // than the configured percentage below it, however many runs happen.
    const campaignStartByDate = (() => {
      const cutoff = since(24 * 30);
      const peakByCell = new Map<string, number>();
      for (const row of rateRows) {
        if (Number(row.occupancy) !== 2) continue;
        if (row.captured_at && row.captured_at < cutoff) continue;
        const name = row.room_type_name ?? "";
        if (name && !sellableNames.has(name)) continue;
        const price = Number(row.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const key = `${row.stay_date}|${name}`;
        peakByCell.set(key, Math.max(peakByCell.get(key) ?? 0, price));
      }
      const out = new Map<string, number>();
      for (const [key, price] of peakByCell) {
        const stayDate = key.split("|")[0];
        const seen = out.get(stayDate);
        // The cheapest room type is the reference cell, so take the lowest peak.
        if (seen == null || price < seen) out.set(stayDate, price);
      }
      return out;
    })();


    const occByDate = new Map<string, {
      pct: number | null; sold: number | null; left: number | null; revenue: number | null;
    }>();
    const prevOccByDate = new Map<string, number | null>();
    const snapshotRows = (unwrap(snapshotRes) as any[])
      .slice()
      .sort((a, b) => (Number(a.rn ?? 1) - Number(b.rn ?? 1)));
    for (const row of snapshotRows) {

      const pct = row.occupancy_pct == null ? null : Number(row.occupancy_pct);
      if (occByDate.has(row.stay_date)) {
        if (!prevOccByDate.has(row.stay_date)) prevOccByDate.set(row.stay_date, pct);
        continue; // newest capture first
      }
      const available = Number(row.rooms_available);
      const sold = Number(row.rooms_sold);
      const revenue = Number(row.revenue_eur);
      const adr = Number(row.adr_eur);
      occByDate.set(row.stay_date, {
        pct,
        sold: Number.isFinite(sold) ? sold : null,
        left: Number.isFinite(available) && Number.isFinite(sold) ? Math.max(0, available - sold) : null,
        revenue: Number.isFinite(revenue) && revenue > 0
          ? revenue
          : (Number.isFinite(adr) && Number.isFinite(sold) ? adr * sold : null),
      });
    }

    // Market signal: one observation per DISTINCT competitor, outliers removed.
    const compByDate = new Map<string, CompetitorObservation[]>();
    for (const row of unwrap(competitorRes) as any[]) {
      if (!row.competitor_id) continue;
      const list = compByDate.get(row.stay_date) ?? [];
      list.push({
        competitor_id: String(row.competitor_id),
        stay_date: row.stay_date,
        rate: Number(row.rate),
        captured_at: row.captured_at,
      });
      compByDate.set(row.stay_date, list);
    }
    const marketValidation = { ...DEFAULT_MARKET_VALIDATION, ...(rule.market_validation ?? {}) };
    const marketFor = (stayDate: string) =>
      buildMarketSignal(compByDate.get(stayDate) ?? [], now, marketValidation);

    const decisionHistory = unwrap(decisionRes) as any[];
    const lastDecisionByDate = new Map<string, { direction: string; at: string }>();
    const lastDecreaseByDate = new Map<string, string>();
    for (const row of decisionHistory) {
      if (!lastDecisionByDate.has(row.stay_date)) {
        lastDecisionByDate.set(row.stay_date, { direction: row.direction, at: row.created_at });
      }
      if (row.direction === "decrease" && !lastDecreaseByDate.has(row.stay_date)) {
        lastDecreaseByDate.set(row.stay_date, row.created_at);
      }
    }

    const holdHours = Math.max(0, Number(rule.manual_hold_hours || 2));
    const manualHold = new Map<string, { until: string; kind: "soft" | "hard" }>();
    // Two kinds of protection: a manager lock stops everything until it expires,
    // an ordinary human price edit only protects the price for a short while.
    for (const row of unwrap(manualRes) as any[]) {
      const kind: "soft" | "hard" = row.hold_kind === "hard" ? "hard" : "soft";
      const at = Date.parse(row.hold_until);
      if (!Number.isFinite(at)) continue;
      const until = kind === "hard"
        ? new Date(at).toISOString()
        : new Date(at + holdHours * 3_600_000).toISOString();
      const seen = manualHold.get(row.stay_date);
      // A hard lock always wins over a soft hold for the same date.
      if (!seen || seen.kind !== "hard" && (kind === "hard" || until > seen.until)) {
        manualHold.set(row.stay_date, { until, kind });
      }
    }

    // The daily movement allowance resets at the property's local midnight, not
    // at UTC midnight — otherwise Budapest loses one or two hours of allowance.
    const localDayStart = (() => {
      const [hh, mm] = String(local.time || "00:00").split(":").map(Number);
      const elapsed = ((hh || 0) * 60 + (mm || 0)) * 60_000;
      return new Date(now.getTime() - elapsed).toISOString();
    })();

    // Movement already spent in the local day, per stay date and per direction.
    const { data: spentToday } = await deps.pagedAll((f, t) => admin
      .from("revenue_date_decisions").select("stay_date, movement, direction")
      .eq("hotel_id", rule.hotel_id).in("status", ["published", "queued"])
      .gte("created_at", localDayStart).order("stay_date").range(f, t));
    const movedUpToday = new Map<string, number>();
    const movedDownToday = new Map<string, number>();
    for (const row of (spentToday ?? []) as any[]) {
      const amount = Math.abs(Number(row.movement) || 0);
      if (row.direction === "increase") movedUpToday.set(row.stay_date, (movedUpToday.get(row.stay_date) ?? 0) + amount);
      if (row.direction === "decrease") movedDownToday.set(row.stay_date, (movedDownToday.get(row.stay_date) ?? 0) + amount);
    }

    // Events: approved, confident, readable, deduplicated, once per date.
    const appliedKeys = new Set(unwrap(appliedEventsRes).map((r: any) => `${r.event_key}|${r.stay_date}`));
    const eventUplift = new Map<string, { key: string; uplift: number }>();
    const seenEventKeys = new Set<string>();
    for (const ev of unwrap(eventsRes) as any[]) {
      if (ev.approved === false) continue;
      if (Number(ev.confidence ?? 1) < 0.6) continue;
      if (!eventTitleUsable(ev.title)) continue;
      const impact = String(ev.expected_impact ?? "").toLowerCase();
      const uplift = impact === "high" ? 10 : impact === "medium" ? 5 : 0;
      if (uplift <= 0) continue;
      const from = ev.event_date;
      const to = ev.end_date ?? ev.event_date;
      for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        const stayDate = d.toISOString().slice(0, 10);
        if (stayDate < today || stayDate > horizonDate) continue;
        const key = eventKeyOf(ev, stayDate);
        if (seenEventKeys.has(key)) continue;      // duplicate listing of one event
        if (appliedKeys.has(`${key}|${stayDate}`)) continue; // already paid for
        seenEventKeys.add(key);
        if (!eventUplift.has(stayDate)) eventUplift.set(stayDate, { key, uplift });
      }
    }

    // Absolute floors and ceilings — never step limits.
    const floorRows = unwrap(floorsRes) as any[];
    const safetyRow = floorRows.find((r) => r.is_global_safety_max) ?? null;
    const boundsFor = makeBoundsResolver({
      floors: floorRows,
      roomTypes: roomTypes as any[],
      globalSafetyMax: Number(safetyRow?.max_price ?? 500) || 500,
      globalMin: Number(safetyRow?.min_price ?? 0) || null,
    });

    const paceBands = unwrap(paceRes).map((r: any) => ({
      min_days_out: Number(r.min_days_out),
      max_days_out: Number(r.max_days_out),
      target_occupancy_pct: Number(r.target_occupancy_pct),
    })) as PaceBand[];

    // Supervised caps for the first 48 live hours.
    const liveHours = rule.live_activated_at
      ? (now.getTime() - Date.parse(rule.live_activated_at)) / 3_600_000
      : 0;
    const supervised = mode === "live" && liveHours < 48;
    const configuredWindows = (Array.isArray(rule.window_rules) && rule.window_rules.length > 0
      ? rule.window_rules
      : OTTOFIORI_WINDOW_RULES) as WindowRule[];
    const windowRules = configuredWindows.map((w) => {
      const caps = supervisedCaps(w.max_daily_increase, w.max_daily_decrease, supervised);
      return { ...w, max_daily_increase: caps.maxIncrease, max_daily_decrease: w.max_daily_decrease === 0 ? 0 : caps.maxDecrease };
    });

    const settings: DecisionSettings = {
      ...DEFAULT_DECISION_SETTINGS,
      now,
      paceBands,
      windowRules,
      marketValidation,
      minMovementEur: Math.max(1, Number(rule.min_movement_eur || 3)),
      directionChangeHours: Math.max(0, Number(rule.direction_change_hours ?? 6)),
      cancellationWaitMinutes: Math.max(0, Number(rule.cancellation_wait_minutes ?? 60)),
      soldOutOccupancyPct: Math.max(50, Number(rule.sold_out_occupancy_pct || 98)),
      fill: {
        enabled: Boolean(rule.fill_mode_enabled),
        windowDays: Math.max(0, Number(rule.fill_window_days ?? 60)),
        maxTotalDropPct: Math.min(50, Math.max(0, Number(rule.fill_max_total_drop_pct ?? 15))),
      },
    };


    // Rolling ADR guard: the next few nights must still average the target rate,
    // so a sell-down can never dump the week below what it needs to earn.
    const adrGuard = rule.adr_guard_enabled
      ? computeAdrGuard(
        Array.from(byDate.keys()).sort().map((stayDate): AdrGuardNight => {
          const occ = occByDate.get(stayDate);
          const cells = byDate.get(stayDate) ?? [];
          const ref = cells.filter((c) => c.occupancy === 2).sort((a, b) => a.price - b.price)[0] ?? null;
          const bounds = boundsFor(ref?.room_type_name ?? null, 2);
          return {
            stayDate,
            daysOut: dayDiff(today, stayDate),
            roomsSold: occ?.sold ?? null,
            roomsRemaining: occ?.left ?? null,
            revenueOnBooks: occ?.revenue ?? null,
            currentPrice: ref ? whole(ref.price) : null,
            maxPrice: isBoundsFailure(bounds) ? null : bounds.max,
          };
        }),
        {
          targetAdr: Number(rule.adr_target_eur ?? 0),
          windowDays: Math.max(1, Number(rule.adr_window_days ?? 7)),
        },
      )
      : { floors: {}, projectedAdr: null, requiredRate: null, feasible: false, reason: "guard_off" };


    // ---- 3. One decision per stay date -------------------------------------
    const decisions: Decision[] = [];
    const decisionRows: Array<Record<string, unknown>> = [];
    const payload: Array<Record<string, unknown>> = [];
    const skipReasons: Record<string, number> = {};
    const violations: Array<Record<string, unknown>> = [];
    let budgetHit = false;
    let simulatedCells = 0;

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

      const occ = occByDate.get(stayDate) ?? { pct: null, sold: null, left: null, revenue: null };
      const refBounds = boundsFor(reference?.room_type_name ?? null, 2);
      const pendingEvent = eventUplift.get(stayDate);
      const last = lastDecisionByDate.get(stayDate);
      const prevOcc = prevOccByDate.get(stayDate) ?? null;
      const lastPickup = lastPickupAt.get(stayDate) ?? null;

      const input: DecisionInput = {
        stayDate,
        daysOut,
        currentPrice: reference ? whole(reference.price) : null,
        occupancyPct: occ.pct,
        roomsSold: occ.sold,
        roomsRemaining: occ.left,
        pickup1h: pickup1h.get(stayDate) ?? 0,
        pickup6h: pickup6h.get(stayDate) ?? 0,
        pickup24h: pickup24h.get(stayDate) ?? 0,
        pickup48h: pickup48h.get(stayDate) ?? 0,
        pickup7d: pickup7d.get(stayDate) ?? 0,
        cancellations24h: cancels24h.get(stayDate) ?? 0,
        hoursSinceLastPickup: lastPickup ? (now.getTime() - Date.parse(lastPickup)) / 3_600_000 : null,
        lastCancellationAt: lastCancel.get(stayDate) ?? null,
        lastDirection: (last?.direction as any) ?? null,
        lastDecisionAt: last?.at ?? null,
        lastDecreaseAt: lastDecreaseByDate.get(stayDate) ?? null,
        movedUpTodayEur: movedUpToday.get(stayDate) ?? 0,
        movedDownTodayEur: movedDownToday.get(stayDate) ?? 0,
        manualHoldUntil: manualHold.get(stayDate)?.until ?? null,
        holdKind: manualHold.get(stayDate)?.kind ?? null,
        minPrice: isBoundsFailure(refBounds) ? null : refBounds.min,
        maxPrice: isBoundsFailure(refBounds) ? null : refBounds.max,
        adrFloor: adrGuard.floors[stayDate] ?? null,
        // Seasonal anchor first (the hotel's own history), room-type base price
        // only as a fallback so a date is never left without an anchor.
        anchorPrice: anchorFor(stayDate, anchorTable, {
          min: isBoundsFailure(refBounds) ? null : refBounds.min,
          max: isBoundsFailure(refBounds) ? null : refBounds.max,
        }) ?? (reference?.room_type_name ? (anchorByType.get(reference.room_type_name) ?? null) : null),
        crossed60Occupancy: prevOcc != null && occ.pct != null && prevOcc < 60 && occ.pct >= 60,
        pendingEventUplift: pendingEvent?.uplift ?? 0,
        market: marketFor(stayDate),
        campaignStartPrice: campaignStartByDate.get(stayDate) ?? null,
      };


      const decision = decideDate(input, settings);
      decisions.push(decision);
      const wasBlocked = decision.blocked;
      if (wasBlocked) skipReasons[decision.reason] = (skipReasons[decision.reason] ?? 0) + 1;


      // Build every child cell — in shadow mode too, so the gate can prove the
      // real payload would have been safe before anything is published.
      //
      // THE DATE IS THE UNIT OF CHANGE: every cell of the day moves by exactly
      // the same whole-euro amount, or the day does not move at all. The step
      // is throttled to the smallest headroom on the date (never clamped per
      // cell), so a day can never end up half-moved or moved unevenly.
      const cellPrices: CellPrice[] = [];
      let requestedMovement = decision.movement;
      let limitedBy: string | null = null;
      if (!decision.blocked) {
        const dir = Math.sign(decision.movement);
        const wanted = Math.abs(decision.movement);
        let boundsProblem: string | null = null;
        const prepared: Array<{ cell: typeof cells[number]; bounds: { min: number; max: number }; old: number; allowed: number }> = [];
        for (const cell of cells) {
          const cellBounds = boundsFor(cell.room_type_name, cell.occupancy);
          if (isBoundsFailure(cellBounds)) {
            boundsProblem = `${cell.room_type_name ?? "unknown room type"} / ${cell.occupancy} pax — ${cellBounds.detail}`;
            break;
          }
          const old = whole(cell.price);
          const allowed = headroom(cellBounds, old, dir);
          prepared.push({ cell, bounds: { min: cellBounds.min, max: cellBounds.max }, old, allowed });

        }

        if (boundsProblem) {
          // One unusable cell holds the WHOLE date — never publish a partial day.
          decision.blocked = true;
          decision.direction = "hold";
          decision.movement = 0;
          decision.targetPrice = decision.currentPrice;
          decision.reason = "bounds_missing";
          decision.reasonDetail = `Held: no usable price limits for ${boundsProblem}`;
        } else if (prepared.length === 0) {
          decision.blocked = true;
          decision.direction = "hold";
          decision.movement = 0;
          decision.targetPrice = decision.currentPrice;
          decision.reason = "no_cells";
          decision.reasonDetail = "Held: no live prices for this date.";
        } else {
          const uniform = uniformDateStep(
            prepared.map((p) => ({ room_type_name: p.cell.room_type_name, allowed: p.allowed })),
            wanted,
            settings.minMovementEur,
          );
          const step = uniform.step;
          limitedBy = uniform.limitedBy;
          if (uniform.held) {
            decision.blocked = true;
            decision.direction = "hold";
            decision.movement = 0;
            decision.targetPrice = decision.currentPrice;
            decision.reason = "bounds_headroom";
            decision.reasonDetail = limitedBy
              ? `Held: ${limitedBy} is at its price limit, so the whole day stayed put.`
              : "Held: no room left to move every price of this date together.";
          } else {
            if (step < wanted) {
              decision.movement = dir * step;
              decision.targetPrice = decision.currentPrice == null ? null : whole(decision.currentPrice + dir * step);
              decision.reasonDetail = `${decision.reasonDetail} Step reduced to €${step} so every room type moves together${limitedBy ? ` (${limitedBy} is closest to its limit)` : ""}.`;
            }

            for (const p of prepared) {
              // The stay date is the unit of change. A legacy cell outside its
              // bounds may improve gradually, but it must take exactly the same
              // step as every sibling — never snap one occupancy to its floor.
              const next = whole(p.old + dir * step);
              if (next === p.old) continue;
              cellPrices.push({
                stay_date: stayDate,
                obk_id: p.cell.obk_id,
                room_type_name: p.cell.room_type_name,
                occupancy: p.cell.occupancy,
                old_price: p.old,
                new_price: next,
                currency: p.cell.currency ?? rule.currency ?? "EUR",
                min_price: p.bounds.min,
                max_price: p.bounds.max,
              });
            }
          }
        }
        const cellViolations = validateCells(cellPrices);
        if (cellViolations.length > 0) {
          // Hold only the affected date. Other safe date-columns can continue
          // to Previo in the same run.
          violations.push(...cellViolations.map((v) => ({ stay_date: stayDate, ...v })));
          decision.blocked = true;
          decision.direction = "hold";
          decision.movement = 0;
          decision.targetPrice = decision.currentPrice;
          decision.reason = "price_safety";
          decision.reasonDetail = `Held: ${cellViolations.length} price${cellViolations.length === 1 ? " was" : "s were"} outside the configured limits.`;
          cellPrices.splice(0, cellPrices.length);
        }
        simulatedCells += cellPrices.length;
      }
      if (!wasBlocked && decision.blocked) {
        skipReasons[decision.reason] = (skipReasons[decision.reason] ?? 0) + 1;
      }



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
        pickup_6h: input.pickup6h,
        pickup_24h: input.pickup24h,
        pickup_48h: input.pickup48h,
        pickup_7d: input.pickup7d,
        cancellations_24h: input.cancellations24h,
        pace_target_pct: decision.paceTargetPct,
        pace_gap_pct: decision.paceGapPct,
        current_price: decision.currentPrice,
        target_price: decision.targetPrice,
        movement: decision.movement,
        movement_requested: requestedMovement,
        limited_by_room_type: limitedBy,

        direction: decision.direction,
        decision_reason: decision.reason,
        reason_detail: decision.reasonDetail,
        window_id: decision.windowId,
        event_signal: pendingEvent ? { event_key: pendingEvent.key, uplift: pendingEvent.uplift } : null,
        market_signal: input.market.median == null ? null : input.market,
        manual_hold_until: input.manualHoldUntil,
        hold_kind: input.holdKind ?? null,
        adr_required_rate: adrGuard.requiredRate,
        adr_feasible: rule.adr_guard_enabled ? adrGuard.feasible : null,
        anchor_price: input.anchorPrice,
        cap_applied: decision.capApplied,
        simulated_cells: cellPrices.length === 0 ? null : cellPrices,
        cells_simulated: cellPrices.length,
        status,
      });

      if (decision.blocked || mode !== "live" || dryRun) continue;

      for (const cell of cellPrices) {
        payload.push({
          hotel_id: rule.hotel_id,
          organization_slug: rule.organization_slug,
          stay_date: cell.stay_date,
          obk_id: cell.obk_id,
          room_type_name: cell.room_type_name,
          occupancy: cell.occupancy,
          old_price: cell.old_price,
          new_price: cell.new_price,
          currency: cell.currency,
          status: "draft",
          intent_source: decision.direction === "increase" ? "automation_pickup" : "automation_markdown",
          decision_reason: decision.reason,
          reason_detail: explainDecision(decision),
        });
      }
    }

    const insertedDecisionIds = new Map<string, string>();
    for (let i = 0; i < decisionRows.length; i += 500) {
      const { data, error } = await admin.from("revenue_date_decisions")
        .insert(decisionRows.slice(i, i + 500)).select("id, stay_date");
      if (error) throw error;
      for (const row of (data ?? []) as any[]) insertedDecisionIds.set(row.stay_date, row.id);
    }
    for (const row of payload) {
      row.decision_id = insertedDecisionIds.get(String(row.stay_date)) ?? null;
    }

    // ---- 4. Publish (live mode only) ---------------------------------------
    let pushRunId: string | null = null;
    const queuedDates = new Set<string>();
    if (payload.length > 0) {
      assertWholeEuro(payload.map((p) => Number(p.new_price)));
      const dateManifest = Object.fromEntries(
        decisionRows
          .filter((row) => row.status === "queued")
          .map((row) => {
            const stayDate = String(row.stay_date);
            const cells = payload.filter((cell) => cell.stay_date === stayDate);
            return [stayDate, {
              movement: row.movement,
              movement_requested: row.movement_requested,
              expected_cells: cells.length,
              decision_id: insertedDecisionIds.get(stayDate) ?? null,
            }];
          }),
      );
      pushRunId = await deps.queue(payload, 5, { automationRunId: runId, dateManifest });
      const movedDates = Object.keys(dateManifest);
      for (const stayDate of movedDates) queuedDates.add(stayDate);
      await admin.from("revenue_date_decisions")
        .update({ status: "queued" }).eq("run_id", runId).in("stay_date", movedDates);
      // Record event uplifts so an event can never lift the same date twice.
      const eventApplications = decisions
        .filter((d) => queuedDates.has(d.stayDate) && eventUplift.has(d.stayDate))
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

      // Each booking pays for exactly one increase: stamp the ledger rows that
      // justified the rises this run so the next run cannot spend them again.
      const spentIds = decisions
        .filter((d) => queuedDates.has(d.stayDate) && d.direction === "increase")
        .flatMap((d) => unspentIdsByDate.get(d.stayDate) ?? []);
      for (let i = 0; i < spentIds.length; i += 500) {
        await admin.from("revenue_pickup_ledger")
          .update({ increase_spent_at: new Date().toISOString() })
          .in("id", spentIds.slice(i, i + 500));
      }
    }

    const increases = decisions.filter((d) => d.direction === "increase" && (mode !== "live" ? !d.blocked : queuedDates.has(d.stayDate))).length;
    const decreases = decisions.filter((d) => d.direction === "decrease" && (mode !== "live" ? !d.blocked : queuedDates.has(d.stayDate))).length;
    const held = decisions.length - increases - decreases;

    await finish({
      status: budgetHit ? "timed_out" : "completed",
      dates_evaluated: decisions.length,
      dates_increased: increases,
      dates_decreased: decreases,
      dates_held: held,
      cells_queued: payload.length,
      // The delivery batch this run produced, so the activity feed can show
      // real Previo outcomes instead of "queued and hope".
      push_run_id: pushRunId,
      skip_reasons: {
        ...skipReasons,
        simulated_cells: simulatedCells,
        adr_guard: rule.adr_guard_enabled
          ? { required_rate: adrGuard.requiredRate, projected_adr: adrGuard.projectedAdr, feasible: adrGuard.feasible, reason: adrGuard.reason }
          : null,
      },
    });

    await admin.from("revenue_pickup_automation_rules").update({
      last_evaluated_at: new Date(startedAt).toISOString(),
      // A timed-out run is not a success and must never advance this stamp.
      ...(budgetHit ? {} : { last_successful_evaluation_at: new Date(startedAt).toISOString() }),
      last_run_at: new Date(startedAt).toISOString(),
      last_evaluation_status: budgetHit ? "timed_out" : (mode === "live" ? "ok" : "shadow_ok"),
      last_evaluation_error: budgetHit ? "run budget exhausted" : null,
      next_run_at: new Date(now.getTime() + Math.max(60, Number(rule.evaluation_interval_minutes || 60)) * 60_000).toISOString(),
    }).eq("id", rule.id);

    // ---- 5. Automatic activation gate / live watchdog ----------------------
    const gate = await evaluateActivation({
      admin, rule, now, mode, sellableRooms, violations: violations.length, budgetHit, liveHours,
    });

    const runStatus = budgetHit ? "Run reached its time limit" : "Run completed";
    const delivery = mode === "shadow" || dryRun
      ? `Shadow test only — ${simulatedCells} price cell${simulatedCells === 1 ? " was" : "s were"} simulated and none were sent to Previo.`
      : payload.length > 0
        ? `${payload.length} price cell${payload.length === 1 ? " was" : "s were"} queued for Previo.`
        : "No prices needed to be sent to Previo.";
    const activation = gate.phase === "shadow" && gate.passed
      ? " The 24-hour safety review passed; live mode is enabled for the next run."
      : gate.phase === "live" && gate.paused
        ? ` Automation returned to shadow mode${gate.reason ? `: ${gate.reason}` : "."}`
        : "";
    await notifyRun({
      severity: budgetHit ? "warning" : "info",
      pickups: decisions.filter((d) => d.reason.includes("pickup")).length,
      actions: increases + decreases,
      pushed: 0,
      failed: budgetHit ? 1 : 0,
      summary: `${runStatus}: ${decisions.length} dates checked, ${increases} increased, ${decreases} decreased, ${held} held. ${delivery}${activation}`,
    });

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
      cells_simulated: simulatedCells,
      skip_reasons: skipReasons,
      timed_out: budgetHit,
      gate,
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
    await notifyRun({
      severity: "error",
      failed: 1,
      summary: `Run failed: ${message.slice(0, 350)} No prices were sent by this run.`,
    });
    throw e;
  }
}

/**
 * After every run: in shadow, check whether 24 clean hours have passed and go
 * live automatically; in live, run the 48-hour watchdog.
 */
async function evaluateActivation(ctx: {
  admin: any; rule: any; now: Date; mode: "shadow" | "live";
  sellableRooms: number; violations: number; budgetHit: boolean; liveHours: number;
}): Promise<Record<string, unknown>> {
  const { admin, rule, now, mode } = ctx;
  const shadowStart = rule.shadow_started_at ? Date.parse(rule.shadow_started_at) : null;
  const windowStart = new Date((mode === "live" ? now.getTime() - 48 * 3_600_000 : (shadowStart ?? now.getTime()))).toISOString();

  const [{ data: runs }, { data: decisionRows }] = await Promise.all([
    admin.from("revenue_automation_runs")
      .select("status, started_at, finished_at, failure_reason")
      .eq("hotel_id", rule.hotel_id).gte("started_at", windowStart),
    admin.from("revenue_date_decisions")
      .select("stay_date, direction, movement, target_price, decision_reason, cells_simulated, status")
      .eq("hotel_id", rule.hotel_id).gte("created_at", windowStart),
  ]);

  const runRows = (runs ?? []) as any[];
  const dRows = (decisionRows ?? []) as any[];
  const moved = dRows.filter((r) => r.direction && r.direction !== "hold");
  const dirs = new Map<string, Set<string>>();
  for (const r of moved) {
    const set = dirs.get(r.stay_date) ?? new Set<string>();
    set.add(r.direction);
    dirs.set(r.stay_date, set);
  }
  const dualDirection = [...dirs.values()].filter((s) => s.size > 1).length;
  const fractional = moved.filter((r) => r.target_price != null && !Number.isInteger(Number(r.target_price))).length;
  const staleDecisions = runRows.filter((r) => r.status === "stopped_stale_data").length;
  const childCellsConsistent = moved.every((r) => Number(r.cells_simulated ?? 0) > 0);

  if (mode === "shadow") {
    const shadowHours = shadowStart ? (now.getTime() - shadowStart) / 3_600_000 : 0;
    const gate = evaluateGates({
      shadowHours,
      runsTotal: runRows.length,
      runsFailed: runRows.filter((r) => r.status === "failed" || r.status === "timed_out").length,
      datesEvaluated: dRows.length,
      datesIncreased: moved.filter((r) => r.direction === "increase").length,
      datesDecreased: moved.filter((r) => r.direction === "decrease").length,
      allWholeEuro: fractional === 0 && ctx.violations === 0,
      allWithinBounds: ctx.violations === 0,
      noDualDirection: dualDirection === 0,
      noBudgetBreach: true,
      sellableRooms: ctx.sellableRooms,
      expectedRooms: Number(rule.expected_sellable_rooms ?? ctx.sellableRooms),
      childCellsConsistent,
      noStaleDecisions: staleDecisions === 0,
    });
    await admin.from("revenue_pickup_automation_rules").update({
      gate_results: { ...gate.checks, evaluated_at: now.toISOString(), shadow_hours: Math.round(shadowHours) },
      ...(gate.passed ? { mode: "live", auto_publish: true, live_activated_at: now.toISOString(), auto_pause_reason: null } : {}),
    }).eq("id", rule.id);
    return { phase: "shadow", passed: gate.passed, failing: gate.failing, shadow_hours: Math.round(shadowHours) };
  }

  const watchdog = evaluateWatchdog({
    liveHours: ctx.liveHours,
    fractionalPrices: fractional,
    boundsBreaches: ctx.violations,
    staleDataDecisions: staleDecisions,
    overlappingRuns: 0,
    consecutiveTimeouts: runRows.slice(-3).filter((r) => r.status === "timed_out").length,
    repeatedEventUplifts: 0,
    dualDirectionDates: dualDirection,
    previoRejections: 0,
    mappingErrors: 0,
  });
  // Live mode is an explicit operator setting. Unsafe date-columns are held
  // individually; the watchdog reports issues but must not silently disable
  // publishing or restart a shadow countdown.
  return { phase: "live", supervised: watchdog.supervised, paused: watchdog.pause, reason: watchdog.reason };
}
