import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const EQC_AR_ENDPOINT = "https://api.previo.app/eqc1/ar";
const EQC_NS = "http://www.expediaconnect.com/EQC/AR/2007/02";
const HOTEL_ID = "ottofiori";
const TIME_ZONE = "Europe/Budapest";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const isoDateInZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string): number => Math.round(
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
);

const isoDow = (date: string): number => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};

const monthKey = (date: string) => date.slice(0, 7);

function esc(v: string | number): string {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function eqcKeyFromSecret(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  try {
    const j = JSON.parse(value);
    if (j && typeof j === "object") {
      return String(
        j.eqcApiKey ?? j.eqc_api_key ?? j.eqcKey ?? j.eqc_key ??
        j.apiKey ?? j.api_key ?? j.key ?? j.token ?? j.password ?? "",
      ).trim();
    }
  } catch { /* non-JSON secret */ }
  for (const line of value.split(/\r?\n|;/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (["eqcapikey", "eqc_api_key", "apikey", "api_key", "key", "token"].includes(key)) {
      return match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  if (/^[^\s:={}\[\]"']+$/.test(value)) return value;
  return "";
}

async function writeMinStay(input: {
  apiKey: string;
  pmsHotelId: string;
  obkId: string;
  prlId: string;
  from: string;
  to: string;
  minStay: number;
}): Promise<{ ok: boolean; message: string }> {
  const body = `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<AvailRateUpdateRQ xmlns="${EQC_NS}">\n` +
    `  <Hotel id="${esc(input.pmsHotelId)}" />\n` +
    `  <DateRange from="${esc(input.from)}" to="${esc(input.to)}" />\n` +
    `  <RoomType id="${esc(input.obkId)}">\n` +
    `    <RatePlan id="${esc(input.prlId)}">\n` +
    `      <Restrictions minLOS="${esc(input.minStay)}" />\n` +
    `    </RatePlan>\n` +
    `  </RoomType>\n` +
    `</AvailRateUpdateRQ>`;
  try {
    const res = await fetch(EQC_AR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Authorization": `ApiKey ${input.apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    const err = text.match(/<Error[^>]*code="([^"]*)"[^>]*>([^<]*)<\/Error>/i);
    const success = /<Success\s*\/?>/i.test(text);
    const ok = res.ok && !err && success;
    return {
      ok,
      message: err ? `${err[1]}: ${err[2].trim()}` : ok ? "Success" : text.replace(/\s+/g, " ").trim().slice(0, 300),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

type EventSignal = { impact: "high" | "medium" | "low" | null; title: string | null };
type DecisionFacts = {
  stayDate: string;
  daysOut: number;
  current: number;
  occupancy: number | null;
  roomsLeft: number | null;
  pickup24h: number;
  monthOcc: number | null;
  event: EventSignal;
};

function decideMinStay(f: DecisionFacts, maxNights: number): { target: number; reason: string } {
  const occ = f.occupancy ?? 0;
  const left = f.roomsLeft;
  const pickup = f.pickup24h;
  const dow = isoDow(f.stayDate);
  const weekend = dow === 5 || dow === 6;
  const highEvent = f.event.impact === "high";
  const monthOcc = f.monthOcc ?? 0;
  const two = Math.min(2, Math.max(1, maxNights));

  if (left !== null && left <= 0) return { target: f.current, reason: "sold_out_hold" };

  // Soft future months must remain discoverable to one-night shoppers. This is
  // intentionally stronger than a generic weekend restriction.
  if (monthOcc > 0 && monthOcc < 45) {
    return { target: 1, reason: `soft_month_${Math.round(monthOcc)}pct_release` };
  }

  // Final seven days are conversion-first. MLOS survives only under proven
  // compression, never just because the date is Friday or Saturday.
  if (f.daysOut <= 7) {
    if ((weekend || highEvent) && occ >= 90 && left !== null && left <= 2 && pickup >= 1) {
      return { target: two, reason: "final_week_compression" };
    }
    return { target: 1, reason: "final_week_open_to_one_night" };
  }

  if (f.daysOut <= 14) {
    if (highEvent && occ >= 78 && left !== null && left <= 4) return { target: two, reason: "event_compression_8_14" };
    if (weekend && occ >= 82 && left !== null && left <= 3 && pickup >= 1) return { target: two, reason: "weekend_compression_8_14" };
    return { target: 1, reason: "open_demand_8_14" };
  }

  if (f.daysOut <= 30) {
    if (highEvent && occ >= 70 && left !== null && left <= 6) return { target: two, reason: "event_compression_15_30" };
    if (weekend && occ >= 75 && left !== null && left <= 5 && pickup >= 1) return { target: two, reason: "weekend_compression_15_30" };
    return { target: 1, reason: "open_demand_15_30" };
  }

  if (f.daysOut <= 60) {
    if (highEvent && occ >= 65 && left !== null && left <= 7) return { target: two, reason: "event_compression_31_60" };
    if (weekend && occ >= 70 && left !== null && left <= 6 && monthOcc >= 50) return { target: two, reason: "weekend_compression_31_60" };
    return { target: 1, reason: "open_demand_31_60" };
  }

  if (highEvent && occ >= 60 && left !== null && left <= 8) return { target: two, reason: "event_compression_61_90" };
  if (weekend && occ >= 70 && monthOcc >= 55) return { target: two, reason: "weekend_compression_61_90" };
  return { target: 1, reason: "open_demand_61_90" };
}

function eventStrength(v: unknown): number {
  const s = String(v ?? "").toLowerCase();
  return s === "high" ? 3 : s === "medium" ? 2 : s === "low" ? 1 : 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "Supabase runtime configuration missing" }, 500);
  const admin = createClient(url, serviceKey);
  const now = new Date();
  const today = isoDateInZone(now, TIME_ZONE);
  const hotelId = HOTEL_ID;
  let runId: string | null = null;

  try {
    const { data: active } = await admin.from("revenue_min_stay_automation_runs")
      .select("id,started_at")
      .eq("hotel_id", hotelId).eq("status", "in_progress")
      .gte("started_at", new Date(now.getTime() - 15 * 60_000).toISOString())
      .limit(1);
    if ((active ?? []).length > 0) return json({ ok: true, skipped: true, reason: "run_already_in_progress" });

    const { data: rule, error: ruleError } = await admin.from("revenue_pickup_automation_rules")
      .select("hotel_id,organization_slug,min_stay_automation_enabled,min_stay_automation_horizon_days,min_stay_max_nights,min_stay_change_cooldown_hours")
      .eq("hotel_id", hotelId).maybeSingle();
    if (ruleError) throw ruleError;
    if (!rule?.min_stay_automation_enabled) return json({ ok: true, skipped: true, reason: "disabled" });

    const horizonDays = Math.max(7, Math.min(120, Number(rule.min_stay_automation_horizon_days ?? 90)));
    const horizonDate = addDays(today, horizonDays);
    const maxNights = Math.max(1, Math.min(2, Number(rule.min_stay_max_nights ?? 2)));
    const cooldownHours = Math.max(0, Number(rule.min_stay_change_cooldown_hours ?? 12));

    const { data: run, error: runError } = await admin.from("revenue_min_stay_automation_runs").insert({
      hotel_id: hotelId, organization_slug: rule.organization_slug, status: "in_progress",
    }).select("id").single();
    if (runError) throw runError;
    runId = run.id;

    const [snapshotRes, minStayRes, pickupRes, eventRes, cfgRes, mappingRes, recentDecisionRes] = await Promise.all([
      admin.rpc("revenue_latest_snapshots", { p_hotel_id: hotelId, p_from: today, p_to: horizonDate }),
      admin.from("min_stay_rules").select("stay_date,min_nights,updated_at").eq("hotel_id", hotelId)
        .gte("stay_date", today).lte("stay_date", horizonDate),
      admin.from("revenue_pickup_ledger").select("stay_date,reservation_id,first_seen_at,cancelled_at")
        .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonDate)
        .gte("first_seen_at", new Date(now.getTime() - 24 * 3_600_000).toISOString()).is("cancelled_at", null),
      admin.from("demand_events").select("title,event_date,end_date,expected_impact,confidence,approved")
        .eq("hotel_id", hotelId).lte("event_date", horizonDate),
      admin.from("pms_configurations").select("pms_hotel_id,credentials_secret_name,is_active")
        .eq("hotel_id", hotelId).maybeSingle(),
      admin.from("previo_rate_plan_mapping").select("previo_room_type_id,previo_rate_plan_id").eq("hotel_id", hotelId),
      admin.from("revenue_min_stay_decisions").select("stay_date,target_min_stay,status,created_at")
        .eq("hotel_id", hotelId).eq("status", "applied")
        .gte("created_at", new Date(now.getTime() - Math.max(1, cooldownHours) * 3_600_000).toISOString())
        .order("created_at", { ascending: false }),
    ]);

    for (const response of [snapshotRes, minStayRes, pickupRes, eventRes, cfgRes, mappingRes, recentDecisionRes]) {
      if (response.error) throw response.error;
    }

    const cfg: any = cfgRes.data;
    if (!cfg?.is_active || !cfg?.pms_hotel_id || !cfg?.credentials_secret_name) throw new Error("Active Previo configuration is missing.");
    const secretRaw = Deno.env.get(String(cfg.credentials_secret_name)) ?? "";
    const apiKey = eqcKeyFromSecret(secretRaw);
    if (!apiKey) throw new Error("Previo EQC API key could not be read from the configured credential secret.");

    const mappings = ((mappingRes.data ?? []) as any[])
      .filter((m) => m.previo_room_type_id && m.previo_rate_plan_id)
      .map((m) => ({ obkId: String(m.previo_room_type_id).split(":").pop()!, prlId: String(m.previo_rate_plan_id) }));
    const uniqueMappings = Array.from(new Map(mappings.map((m) => [`${m.obkId}|${m.prlId}`, m])).values());
    if (uniqueMappings.length === 0) throw new Error("No exact Previo rate-plan mappings are available.");

    let snapshotRows = ((snapshotRes.data ?? []) as any[]).filter((r) => Number(r.rn ?? 1) === 1);
    if (snapshotRows.length === 0) {
      const { data: fallback, error } = await admin.from("revenue_daily_snapshots")
        .select("stay_date,rooms_sold,rooms_available,occupancy_pct,revenue_eur,adr_eur,captured_at")
        .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonDate)
        .order("captured_at", { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      snapshotRows = [];
      for (const row of (fallback ?? []) as any[]) {
        if (seen.has(row.stay_date)) continue;
        seen.add(row.stay_date);
        snapshotRows.push(row);
      }
    }

    const snapByDate = new Map<string, any>();
    for (const row of snapshotRows) if (!snapByDate.has(row.stay_date)) snapByDate.set(row.stay_date, row);

    const currentByDate = new Map<string, number>();
    for (const row of (minStayRes.data ?? []) as any[]) currentByDate.set(row.stay_date, Math.max(1, Number(row.min_nights) || 1));

    const pickupByDate = new Map<string, Set<string>>();
    for (const row of (pickupRes.data ?? []) as any[]) {
      const set = pickupByDate.get(row.stay_date) ?? new Set<string>();
      set.add(String(row.reservation_id ?? ""));
      pickupByDate.set(row.stay_date, set);
    }

    const eventByDate = new Map<string, EventSignal>();
    for (const ev of (eventRes.data ?? []) as any[]) {
      if (ev.approved === false || Number(ev.confidence ?? 1) < 0.6) continue;
      const from = String(ev.event_date ?? "");
      if (!from || from > horizonDate) continue;
      const to = String(ev.end_date ?? ev.event_date ?? from);
      for (let d = from; d <= to && d <= horizonDate; d = addDays(d, 1)) {
        if (d < today) continue;
        const candidate: EventSignal = { impact: String(ev.expected_impact ?? "").toLowerCase() as EventSignal["impact"], title: ev.title ?? null };
        const existing = eventByDate.get(d);
        if (!existing || eventStrength(candidate.impact) > eventStrength(existing.impact)) eventByDate.set(d, candidate);
      }
    }

    const monthTotals = new Map<string, { sold: number; avail: number }>();
    for (const row of snapshotRows) {
      const sold = Math.max(0, Number(row.rooms_sold ?? 0));
      const avail = Math.max(0, Number(row.rooms_available ?? 0));
      const key = monthKey(String(row.stay_date));
      const total = monthTotals.get(key) ?? { sold: 0, avail: 0 };
      total.sold += sold;
      total.avail += avail;
      monthTotals.set(key, total);
    }
    const monthOcc = new Map<string, number>();
    for (const [key, t] of monthTotals) if (t.avail > 0) monthOcc.set(key, (100 * t.sold) / t.avail);

    const lastAppliedAt = new Map<string, number>();
    for (const row of (recentDecisionRes.data ?? []) as any[]) {
      if (!lastAppliedAt.has(row.stay_date)) lastAppliedAt.set(row.stay_date, Date.parse(row.created_at));
    }

    const decisions: any[] = [];
    const changes: Array<{ stayDate: string; current: number; target: number; reason: string }> = [];
    for (let d = today; d <= horizonDate; d = addDays(d, 1)) {
      const daysOut = daysBetween(today, d);
      const snap = snapByDate.get(d);
      if (!snap) continue;
      const current = currentByDate.get(d) ?? 1;
      const sold = Number(snap.rooms_sold);
      const avail = Number(snap.rooms_available);
      const left = Number.isFinite(sold) && Number.isFinite(avail) ? Math.max(0, avail - sold) : null;
      const occupancy = snap.occupancy_pct == null ? null : Number(snap.occupancy_pct);
      const facts: DecisionFacts = {
        stayDate: d, daysOut, current, occupancy, roomsLeft: left,
        pickup24h: pickupByDate.get(d)?.size ?? 0,
        monthOcc: monthOcc.get(monthKey(d)) ?? null,
        event: eventByDate.get(d) ?? { impact: null, title: null },
      };
      const decision = decideMinStay(facts, maxNights);
      const changed = decision.target !== current;
      const lastAt = lastAppliedAt.get(d) ?? 0;
      const inCooldown = changed && cooldownHours > 0 && lastAt > 0 && now.getTime() - lastAt < cooldownHours * 3_600_000;
      const releaseOverride = daysOut <= 7 && decision.target === 1 && current > 1;
      const status = !changed ? "unchanged" : (inCooldown && !releaseOverride ? "cooldown" : "pending");
      decisions.push({
        run_id: runId, hotel_id: hotelId, organization_slug: rule.organization_slug,
        stay_date: d, days_out: daysOut, current_min_stay: current, target_min_stay: decision.target,
        occupancy_pct: occupancy, rooms_left: left, pickup_24h: facts.pickup24h,
        month_occupancy_pct: facts.monthOcc, event_impact: facts.event.impact, event_title: facts.event.title,
        reason: decision.reason, status,
      });
      if (status === "pending") changes.push({ stayDate: d, current, target: decision.target, reason: decision.reason });
    }

    for (let i = 0; i < decisions.length; i += 250) {
      const { error } = await admin.from("revenue_min_stay_decisions").insert(decisions.slice(i, i + 250));
      if (error) throw error;
    }

    const ordered = changes.slice().sort((a, b) => a.stayDate.localeCompare(b.stayDate));
    const groups: Array<{ from: string; to: string; target: number; dates: string[] }> = [];
    for (const change of ordered) {
      const last = groups[groups.length - 1];
      if (last && last.target === change.target && addDays(last.to, 1) === change.stayDate) {
        last.to = change.stayDate;
        last.dates.push(change.stayDate);
      } else {
        groups.push({ from: change.stayDate, to: change.stayDate, target: change.target, dates: [change.stayDate] });
      }
    }

    let applied = 0;
    let failed = 0;
    const groupResults: any[] = [];
    for (const group of groups) {
      let allOk = true;
      const errors: string[] = [];
      for (const mapping of uniqueMappings) {
        const result = await writeMinStay({
          apiKey, pmsHotelId: String(cfg.pms_hotel_id), obkId: mapping.obkId, prlId: mapping.prlId,
          from: group.from, to: group.to, minStay: group.target,
        });
        if (!result.ok) {
          allOk = false;
          errors.push(`${mapping.obkId}: ${result.message}`);
        }
      }

      if (allOk) {
        const rows = group.dates.map((stayDate) => ({
          hotel_id: hotelId, organization_slug: rule.organization_slug, stay_date: stayDate,
          min_nights: group.target, notes: "automation: smart minimum stay", updated_at: new Date().toISOString(),
        }));
        const { error } = await admin.from("min_stay_rules").upsert(rows, { onConflict: "hotel_id,stay_date" });
        if (error) throw error;
        await admin.from("revenue_min_stay_decisions").update({ status: "applied" }).eq("run_id", runId).in("stay_date", group.dates);
        applied += group.dates.length;
      } else {
        const error = errors.join("; ").slice(0, 1000);
        await admin.from("revenue_min_stay_decisions").update({ status: "failed", error }).eq("run_id", runId).in("stay_date", group.dates);
        failed += group.dates.length;
      }
      groupResults.push({ from: group.from, to: group.to, target: group.target, ok: allOk, error: errors[0] ?? null });
    }

    const summary = {
      today, horizon_date: horizonDate, evaluated: decisions.length, attempted: changes.length, applied, failed,
      groups: groupResults,
      one_night_target_dates: decisions.filter((d) => d.target_min_stay === 1).length,
      two_night_target_dates: decisions.filter((d) => d.target_min_stay === 2).length,
    };
    await admin.from("revenue_min_stay_automation_runs").update({
      status: failed > 0 ? "completed_with_errors" : "completed",
      finished_at: new Date().toISOString(), dates_evaluated: decisions.length,
      changes_attempted: changes.length, changes_applied: applied, changes_failed: failed, summary,
    }).eq("id", runId);

    return json({ ok: failed === 0, run_id: runId, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (runId) {
      await admin.from("revenue_min_stay_automation_runs").update({
        status: "failed", finished_at: new Date().toISOString(), summary: { error: message.slice(0, 1000) },
      }).eq("id", runId);
    }
    console.error("revenue-minstay-automation failed", message);
    return json({ ok: false, error: message }, 500);
  }
});
