// Revenue Intelligence — deterministic metrics + OpenAI (customer's own API key).
// Metrics/forecasts are computed here in TypeScript. OpenAI only interprets them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "Europe/Budapest";
const HORIZON_DAYS = 90;

/* ------------------------------------------------------------------ dates */
function tzDay(iso: string | Date, tz = TZ): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}
function dow(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------------------------------------------------------------- helpers */
const OTA_HINTS = ["booking", "expedia", "agoda", "airbnb", "hotelbeds", "hrs", "trivago", "ota", "hostelworld", "despegar", "tripadvisor"];
const isDirect = (s: string | null) => !s || !OTA_HINTS.some((h) => s.toLowerCase().includes(h));

interface NightRow {
  stay_date: string; res_id: string; room_key: string | null; room_type_name: string | null;
  nightly_price_eur: number | null; created_at_pms: string | null; source_name: string | null;
  stay_from: string | null; stay_to: string | null; guests: number | null; status_id: number | null;
}

async function fetchAll<T>(q: (from: number, to: number) => Promise<{ data: unknown; error: unknown }>): Promise<T[]> {
  const page = 1000; const out: T[] = [];
  for (let off = 0; off < 40000; off += page) {
    const { data, error } = await q(off, off + page - 1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------ deterministic RM engine */
interface DayForecast {
  stay_date: string;
  dow: string;
  lead_time_days: number;
  rooms_available: number;
  rooms_sold: number;
  rooms_remaining: number;
  occupancy_pct: number;
  adr_eur: number | null;
  revpar_eur: number | null;
  room_revenue_eur: number;
  pickup_1d: number;
  pickup_3d: number;
  pickup_7d: number;
  pickup_14d: number;
  historical_pace_same_weekday: number | null;
  pace_variance_pct: number | null;
  forecast_occupancy_pct: number;
  forecast_adr_eur: number | null;
  forecast_room_revenue_eur: number | null;
  demand_score: number;
  demand_class: string;
  confidence: number;
  recommended_adr_min: number | null;
  recommended_adr_max: number | null;
  drivers: string[];
}

const DEMAND_WEIGHTS = { pickup: 0.30, pressure: 0.30, pace: 0.25, leadtime: 0.15 };

function buildForecasts(nights: NightRow[], today: string, roomsAvailable: number): DayForecast[] {
  const byDate = new Map<string, NightRow[]>();
  for (const n of nights) {
    if (!byDate.has(n.stay_date)) byDate.set(n.stay_date, []);
    byDate.get(n.stay_date)!.push(n);
  }
  // weekday averages across the whole loaded horizon = internal pace baseline
  const weekdaySold = new Map<number, number[]>();
  for (const [d, rows] of byDate) {
    const k = dow(d);
    if (!weekdaySold.has(k)) weekdaySold.set(k, []);
    weekdaySold.get(k)!.push(rows.length);
  }
  const weekdayAvg = new Map<number, number>();
  for (const [k, arr] of weekdaySold) weekdayAvg.set(k, arr.reduce((s, x) => s + x, 0) / arr.length);

  const out: DayForecast[] = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = addDays(today, i);
    const rows = byDate.get(date) ?? [];
    const sold = rows.length;
    const revenue = rows.reduce((s, r) => s + Number(r.nightly_price_eur ?? 0), 0);
    const adr = sold > 0 ? revenue / sold : null;
    const occ = roomsAvailable > 0 ? (sold / roomsAvailable) * 100 : 0;
    const remaining = Math.max(0, roomsAvailable - sold);
    const lead = diffDays(date, today);

    const pickupWithin = (days: number) =>
      rows.filter((r) => r.created_at_pms && diffDays(today, tzDay(r.created_at_pms)) < days).length;
    const p1 = pickupWithin(1), p3 = pickupWithin(3), p7 = pickupWithin(7), p14 = pickupWithin(14);

    const baseline = weekdayAvg.get(dow(date)) ?? null;
    const paceVar = baseline && baseline > 0 ? ((sold - baseline) / baseline) * 100 : null;

    // Forecast: remaining demand estimated from recent daily pickup rate, damped by lead time.
    const dailyPickup = p7 / 7;
    const damping = Math.min(1, lead / 60);
    const expectedExtra = Math.min(remaining, dailyPickup * lead * (0.35 + 0.65 * damping));
    const fcSold = Math.min(roomsAvailable, sold + expectedExtra);
    const fcOcc = roomsAvailable > 0 ? (fcSold / roomsAvailable) * 100 : 0;

    // Demand score (0-100), transparent components.
    const pickupComp = Math.min(100, dailyPickup * 25);
    const pressureComp = Math.min(100, occ + (remaining <= 3 ? 20 : 0));
    const paceComp = paceVar === null ? 50 : Math.max(0, Math.min(100, 50 + paceVar));
    const leadComp = Math.max(0, Math.min(100, 100 - Math.abs(lead - 21) * 2));
    const score = Math.round(
      pickupComp * DEMAND_WEIGHTS.pickup + pressureComp * DEMAND_WEIGHTS.pressure +
      paceComp * DEMAND_WEIGHTS.pace + leadComp * DEMAND_WEIGHTS.leadtime,
    );
    const cls = score >= 80 ? "very_high" : score >= 62 ? "high" : score >= 38 ? "normal" : score >= 20 ? "low" : "very_low";

    // Confidence: more history/pickup + closer horizon = higher.
    const confidence = Math.max(20, Math.min(95, Math.round(
      35 + Math.min(30, sold * 2) + Math.min(20, p7 * 4) + (lead <= 30 ? 10 : lead <= 60 ? 5 : 0),
    )));

    // Recommended ADR band derived from the day's own realised ADR and demand.
    let recMin: number | null = null, recMax: number | null = null;
    if (adr !== null) {
      const uplift = score >= 80 ? [0.08, 0.15] : score >= 62 ? [0.04, 0.09] : score >= 38 ? [0, 0.03] : [-0.10, -0.03];
      recMin = round(adr * (1 + uplift[0]));
      recMax = round(adr * (1 + uplift[1]));
    }

    const drivers: string[] = [];
    if (p1 > 0) drivers.push(`${p1} room-night(s) picked up in the last 24h`);
    if (p7 > 0) drivers.push(`${p7} room-night(s) picked up in the last 7 days`);
    if (remaining <= 3 && sold > 0) drivers.push(`only ${remaining} room(s) remaining`);
    if (paceVar !== null) drivers.push(`pace ${paceVar >= 0 ? "+" : ""}${round(paceVar, 0)}% vs comparable ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow(date)]}s`);

    out.push({
      stay_date: date,
      dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow(date)],
      lead_time_days: lead,
      rooms_available: roomsAvailable,
      rooms_sold: sold,
      rooms_remaining: remaining,
      occupancy_pct: round(occ, 1),
      adr_eur: adr === null ? null : round(adr),
      revpar_eur: roomsAvailable > 0 ? round(revenue / roomsAvailable) : null,
      room_revenue_eur: round(revenue),
      pickup_1d: p1, pickup_3d: p3, pickup_7d: p7, pickup_14d: p14,
      historical_pace_same_weekday: baseline === null ? null : round(baseline, 1),
      pace_variance_pct: paceVar === null ? null : round(paceVar, 1),
      forecast_occupancy_pct: round(fcOcc, 1),
      forecast_adr_eur: adr === null ? null : round(adr),
      forecast_room_revenue_eur: adr === null ? null : round(fcSold * adr),
      demand_score: score,
      demand_class: cls,
      confidence,
      recommended_adr_min: recMin,
      recommended_adr_max: recMax,
      drivers,
    });
  }
  return out;
}

interface DimStat { name: string; bookings: number; room_nights: number; revenue_eur: number; adr_eur: number | null }
function groupBy(rows: NightRow[], key: (r: NightRow) => string): DimStat[] {
  const m = new Map<string, { rn: number; rev: number; res: Set<string> }>();
  for (const r of rows) {
    const k = key(r) || "Unknown";
    if (!m.has(k)) m.set(k, { rn: 0, rev: 0, res: new Set() });
    const e = m.get(k)!;
    e.rn += 1; e.rev += Number(r.nightly_price_eur ?? 0); e.res.add(r.res_id);
  }
  return [...m.entries()]
    .map(([name, e]) => ({
      name, bookings: e.res.size, room_nights: e.rn,
      revenue_eur: round(e.rev), adr_eur: e.rn ? round(e.rev / e.rn) : null,
    }))
    .sort((a, b) => b.room_nights - a.room_nights)
    .slice(0, 12);
}

/* --------------------------------------------------------- OpenAI schema */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["executive_summary", "priority_recommendations", "demand_alerts", "adr_leakage", "monitoring_items", "data_quality"],
  properties: {
    executive_summary: {
      type: "object", additionalProperties: false,
      required: ["headline", "summary", "overall_status"],
      properties: {
        headline: { type: "string" },
        summary: { type: "string" },
        overall_status: { type: "string", enum: ["opportunity", "watch", "risk", "stable"] },
      },
    },
    priority_recommendations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "priority", "category", "arrival_date", "room_type", "headline", "action", "reason", "evidence", "expected_impact", "confidence", "urgency", "risk", "recommended_cta"],
        properties: {
          id: { type: "string" },
          priority: { type: "integer" },
          category: { type: "string", enum: ["pricing", "restriction", "promotion", "channel", "inventory", "marketing", "upsell", "monitoring"] },
          arrival_date: { type: ["string", "null"] },
          room_type: { type: ["string", "null"] },
          headline: { type: "string" },
          action: { type: "string" },
          reason: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              required: ["metric", "value", "comparison"],
              properties: { metric: { type: "string" }, value: { type: "string" }, comparison: { type: "string" } },
            },
          },
          expected_impact: {
            type: "object", additionalProperties: false,
            required: ["adr_change", "revenue_change", "occupancy_change", "currency", "method"],
            properties: {
              adr_change: { type: ["number", "null"] },
              revenue_change: { type: ["number", "null"] },
              occupancy_change: { type: ["number", "null"] },
              currency: { type: "string" },
              method: { type: "string" },
            },
          },
          confidence: { type: "integer" },
          urgency: { type: "string", enum: ["now", "today", "within_3_days", "monitor"] },
          risk: { type: "string" },
          recommended_cta: { type: "string" },
        },
      },
    },
    demand_alerts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["arrival_date", "demand_score", "confidence", "classification", "drivers", "recommended_adr_min", "recommended_adr_max"],
        properties: {
          arrival_date: { type: "string" },
          demand_score: { type: "integer" },
          confidence: { type: "integer" },
          classification: { type: "string", enum: ["very_low", "low", "normal", "high", "very_high"] },
          drivers: { type: "array", items: { type: "string" } },
          recommended_adr_min: { type: ["number", "null"] },
          recommended_adr_max: { type: ["number", "null"] },
        },
      },
    },
    adr_leakage: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["dimension", "name", "adr", "target_adr", "room_nights", "revenue_impact", "explanation", "recommended_action"],
        properties: {
          dimension: { type: "string", enum: ["channel", "promotion", "rate_plan", "room_type", "stay_date", "length_of_stay"] },
          name: { type: "string" },
          adr: { type: ["number", "null"] },
          target_adr: { type: ["number", "null"] },
          room_nights: { type: "integer" },
          revenue_impact: { type: ["number", "null"] },
          explanation: { type: "string" },
          recommended_action: { type: "string" },
        },
      },
    },
    monitoring_items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["signal", "current_value", "trigger", "next_review"],
        properties: {
          signal: { type: "string" }, current_value: { type: "string" },
          trigger: { type: "string" }, next_review: { type: "string" },
        },
      },
    },
    data_quality: {
      type: "object", additionalProperties: false,
      required: ["confidence", "missing_sources", "warnings"],
      properties: {
        confidence: { type: "integer" },
        missing_sources: { type: "array", items: { type: "string" } },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a senior hotel revenue-management analyst.
Analyse only the supplied verified data.
Your purpose is to help the hotel improve ADR, occupancy, RevPAR, net room revenue and total room revenue without blindly maximising one metric at the expense of another.
Identify early demand signals, unusual pickup, booking-pace changes, inventory pressure, low-rated business, high-value opportunities, channel inefficiency, promotion leakage and market-rate changes.
Prioritise recommendations by estimated financial impact, urgency, confidence and reversibility.
Never invent a statistic, competitor rate, event or causal relationship.
Clearly distinguish: observed fact, calculated metric, forecast, assumption, recommendation.
Do not recommend a price increase solely because pickup exists. Consider current occupancy, remaining inventory, lead time, historical pace, demand confidence, price position, room-type availability, cancellation risk, length-of-stay effect, channel commission, event signals and market comparisons.
Do not recommend advertising simply because ADR is below target. Recommend additional marketing spend only when there is evidence of profitable incremental demand, adequate net ADR, available inventory, suitable lead time and a measurable campaign opportunity.
Avoid generic advice. Every recommendation must cite the exact metrics supporting it. Where evidence is weak, say so. Where no action is warranted, recommend monitoring rather than making a change.
Return only the required structured JSON.`;

// Rough USD per 1M tokens for cost estimation only (input/output).
const COST_TABLE: Record<string, [number, number]> = {
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1": [2, 8],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gpt-5": [1.25, 10],
  "gpt-5-mini": [0.25, 2],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let hotelId = "";
  let orgSlug: string | null = null;
  let userId: string | null = null;
  let mode: "standard" | "deep" = "standard";
  let model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userRes?.user) throw new Error("Unauthorized");
    userId = userRes.user.id;

    const { data: profile } = await admin
      .from("profiles").select("role, organization_slug, assigned_hotel").eq("id", userId).single();
    if (!profile || !["admin", "top_management", "top_management_manager"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    orgSlug = profile.organization_slug ?? null;

    const body = await req.json().catch(() => ({}));
    hotelId = String(body.hotel_id ?? "");
    mode = body.mode === "deep" ? "deep" : "standard";
    const force = body.force === true;
    if (!hotelId) throw new Error("hotel_id required");

    // Property isolation: the hotel must belong to the caller's organization.
    const { data: hotelCfg } = await admin
      .from("hotel_configurations")
      .select("hotel_id, hotel_name, organization_slug")
      .eq("hotel_id", hotelId).maybeSingle();
    if (!hotelCfg) throw new Error("Unknown hotel");
    if (profile.role !== "admin" && orgSlug && hotelCfg.organization_slug && hotelCfg.organization_slug !== orgSlug) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = tzDay(new Date());
    const horizonEnd = addDays(today, HORIZON_DAYS);
    const historyStart = addDays(today, -365);

    /* ----------------------------------------------- verified data load */
    const [nights, cancelled, settingsRes, roomTypesRes, snapRes] = await Promise.all([
      fetchAll<NightRow>((f, t) => admin.from("revenue_booking_nights")
        .select("stay_date,res_id,room_key,room_type_name,nightly_price_eur,created_at_pms,source_name,stay_from,stay_to,guests,status_id")
        .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd)
        .order("stay_date").range(f, t)),
      fetchAll<{ stay_date: string; res_id: string; cancelled_at: string | null }>((f, t) =>
        admin.from("revenue_cancelled_nights").select("stay_date,res_id,cancelled_at")
          .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonEnd).range(f, t)),
      admin.from("hotel_revenue_settings").select("*").eq("hotel_id", hotelId).maybeSingle(),
      admin.from("room_types").select("name,num_rooms,is_sellable,counts_toward_inventory").eq("hotel_id", hotelId),
      admin.from("revenue_daily_snapshots").select("stay_date,captured_date,rooms_sold,rooms_available,adr_eur,revenue_eur")
        .eq("hotel_id", hotelId).gte("stay_date", historyStart).lte("stay_date", horizonEnd)
        .order("captured_date", { ascending: false }).limit(2000),
    ]);

    const settings = settingsRes.data as Record<string, unknown> | null;
    const roomTypes = (roomTypesRes.data ?? []) as { name: string; num_rooms: number; is_sellable: boolean | null; counts_toward_inventory: boolean | null }[];
    const inventory = roomTypes
      .filter((r) => r.is_sellable !== false && r.counts_toward_inventory !== false)
      .reduce((s, r) => s + (r.num_rooms || 0), 0);
    const roomsAvailable = Number(settings?.sellable_rooms ?? 0) || inventory ||
      Number((snapRes.data ?? [])[0]?.rooms_available ?? 0);

    if (!roomsAvailable) throw new Error("No sellable room inventory configured for this hotel");

    const forecasts = buildForecasts(nights, today, roomsAvailable);

    /* ------------------------------------------------ created-today KPIs */
    const createdToday = nights.filter((n) => n.created_at_pms && tzDay(n.created_at_pms) === today);
    const createdRev = createdToday.reduce((s, r) => s + Number(r.nightly_price_eur ?? 0), 0);
    const soldTotal = nights.length;
    const revTotal = nights.reduce((s, r) => s + Number(r.nightly_price_eur ?? 0), 0);
    const availTotal = roomsAvailable * HORIZON_DAYS;
    const targetAdr = Number(settings?.rate_warn_below_eur ?? 0) || (soldTotal ? revTotal / soldTotal : 0);

    const losByRes = new Map<string, number>();
    for (const n of nights) losByRes.set(n.res_id, (losByRes.get(n.res_id) ?? 0) + 1);
    const avgLos = losByRes.size ? [...losByRes.values()].reduce((s, x) => s + x, 0) / losByRes.size : 0;
    const leadTimes = nights.filter((n) => n.created_at_pms)
      .map((n) => diffDays(n.stay_date, tzDay(n.created_at_pms!)));
    const avgLead = leadTimes.length ? leadTimes.reduce((s, x) => s + x, 0) / leadTimes.length : 0;
    const cancelledRes = new Set(cancelled.map((c) => c.res_id)).size;
    const cancellationRate = losByRes.size + cancelledRes > 0
      ? (cancelledRes / (losByRes.size + cancelledRes)) * 100 : 0;

    const metrics = {
      property: {
        hotel_id: hotelId, hotel_name: hotelCfg.hotel_name ?? hotelId,
        timezone: TZ, currency: "EUR", rooms_available_per_night: roomsAvailable,
        room_types: roomTypes.map((r) => ({ name: r.name, rooms: r.num_rooms })),
      },
      analysis: { generated_at: new Date().toISOString(), data_through: today, horizon_days: HORIZON_DAYS, mode },
      goals: {
        target_adr_eur: round(targetAdr),
        floor_price_eur: settings?.floor_price_eur ?? null,
        max_daily_change_eur: settings?.max_daily_change_eur ?? null,
      },
      kpi_horizon: {
        room_nights_on_books: soldTotal,
        room_revenue_eur: round(revTotal),
        adr_eur: soldTotal ? round(revTotal / soldTotal) : null,
        occupancy_pct: round((soldTotal / availTotal) * 100, 1),
        revpar_eur: round(revTotal / availTotal),
        avg_length_of_stay: round(avgLos, 2),
        avg_lead_time_days: round(avgLead, 1),
        cancellation_rate_pct: round(cancellationRate, 1),
      },
      kpi_created_today: {
        bookings: new Set(createdToday.map((r) => r.res_id)).size,
        room_nights: createdToday.length,
        booking_value_eur: round(createdRev),
        adr_eur: createdToday.length ? round(createdRev / createdToday.length) : null,
      },
      channel_performance: groupBy(nights, (r) => r.source_name ?? "Direct"),
      direct_vs_ota: groupBy(nights, (r) => (isDirect(r.source_name) ? "Direct" : "OTA")),
      room_type_performance: groupBy(nights, (r) => r.room_type_name ?? "Unknown"),
      length_of_stay_mix: groupBy(nights, (r) => {
        const n = losByRes.get(r.res_id) ?? 1;
        return n === 1 ? "1 night" : n <= 3 ? "2-3 nights" : n <= 6 ? "4-6 nights" : "7+ nights";
      }),
      forecasts: forecasts.slice(0, mode === "deep" ? HORIZON_DAYS : 45),
      top_demand_dates: [...forecasts].sort((a, b) => b.demand_score - a.demand_score).slice(0, 10),
      weak_demand_dates: [...forecasts].filter((f) => f.lead_time_days <= 30)
        .sort((a, b) => a.demand_score - b.demand_score).slice(0, 8),
      demand_score_weights: DEMAND_WEIGHTS,
      data_quality: {
        market_rates: "unavailable — no market-rate provider configured",
        events: "unavailable — no event provider configured",
        rate_plans_and_promotions: "not exposed by the Previo reservation feed; channel is used as a proxy",
        history_days_loaded: Math.min(365, (snapRes.data ?? []).length ? 365 : 0),
      },
    };

    /* -------------------------------------------------- cache / debounce */
    const fingerprint = await sha256(JSON.stringify({
      m: mode,
      k: metrics.kpi_horizon,
      t: metrics.kpi_created_today,
      f: forecasts.map((f) => [f.stay_date, f.rooms_sold, f.adr_eur, f.demand_score]),
    }));

    const minMinutes = mode === "deep" ? 0 : 30;
    if (!force) {
      const { data: cachedRun } = await admin.from("rm_analysis_runs")
        .select("id, output, created_at, model, total_tokens, estimated_cost_usd")
        .eq("hotel_id", hotelId).eq("status", "ok").eq("data_fingerprint", fingerprint)
        .gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cachedRun) {
        return new Response(JSON.stringify({
          ok: true, cached: true, run_id: cachedRun.id, model: cachedRun.model,
          generated_at: cachedRun.created_at, metrics, output: cachedRun.output,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: recent } = await admin.from("rm_analysis_runs")
        .select("id, output, created_at, model")
        .eq("hotel_id", hotelId).eq("status", "ok")
        .gte("created_at", new Date(Date.now() - minMinutes * 60_000).toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (recent) {
        return new Response(JSON.stringify({
          ok: true, cached: true, throttled: true, run_id: recent.id, model: recent.model,
          generated_at: recent.created_at, metrics, output: recent.output,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Daily call budget per property.
    const { count: todayCalls } = await admin.from("rm_analysis_runs")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId).eq("cached", false)
      .gte("created_at", `${today}T00:00:00Z`);
    if ((todayCalls ?? 0) >= 40) throw new Error("Daily AI analysis limit reached for this property");

    /* ------------------------------------------------------ OpenAI call */
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OpenAI is not configured");

    const instruction = mode === "deep"
      ? "Deep analysis: return up to 15 prioritised recommendations and full channel, room-type and stay-date leakage."
      : "Standard analysis: return the five highest-impact recommendations for the next 90 arrival dates.";

    const callOpenAi = async () => {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          instructions: SYSTEM_PROMPT,
          input: [{
            role: "user",
            content: [{ type: "input_text", text: `${instruction}\n\nVERIFIED DATA (json):\n${JSON.stringify(metrics)}` }],
          }],
          text: { format: { type: "json_schema", name: "rm_intelligence", strict: true, schema: SCHEMA } },
          max_output_tokens: mode === "deep" ? 6000 : 3000,
        }),
      });
      return res;
    };

    let res = await callOpenAi();
    if (!res.ok && res.status !== 429 && res.status !== 401) res = await callOpenAi(); // one retry
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300).replace(/sk-[A-Za-z0-9_-]+/g, "***");
      throw new Error(`OpenAI ${res.status}: ${detail}`);
    }

    const json = await res.json();
    const textOut: string = json.output_text ??
      (json.output ?? []).flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
        .filter((c: { type: string }) => c.type === "output_text")
        .map((c: { text?: string }) => c.text ?? "").join("");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(textOut);
    } catch {
      throw new Error("AI returned a response that did not match the required schema");
    }

    const usage = json.usage ?? {};
    const inTok = Number(usage.input_tokens ?? 0), outTok = Number(usage.output_tokens ?? 0);
    const [inCost, outCost] = COST_TABLE[model] ?? [0.5, 2];
    const cost = (inTok / 1e6) * inCost + (outTok / 1e6) * outCost;

    const { data: run, error: runErr } = await admin.from("rm_analysis_runs").insert({
      hotel_id: hotelId, organization_slug: hotelCfg.organization_slug ?? orgSlug, mode, model,
      data_fingerprint: fingerprint, period_start: today, period_end: horizonEnd,
      metrics, output: parsed, status: "ok",
      prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok,
      estimated_cost_usd: round(cost, 5), created_by: userId,
    }).select("id, created_at").single();
    if (runErr) throw new Error(runErr.message);

    const recs = (parsed.priority_recommendations ?? []) as Record<string, unknown>[];
    if (recs.length) {
      await admin.from("rm_recommendations").insert(recs.map((r, i) => ({
        run_id: run.id, hotel_id: hotelId, organization_slug: hotelCfg.organization_slug ?? orgSlug,
        priority: Number(r.priority ?? i + 1),
        category: String(r.category ?? "monitoring"),
        arrival_date: (r.arrival_date as string) || null,
        room_type: (r.room_type as string) || null,
        headline: String(r.headline ?? "Recommendation"),
        action: String(r.action ?? ""),
        reason: String(r.reason ?? ""),
        evidence: r.evidence ?? [],
        expected_impact: r.expected_impact ?? {},
        confidence: Number(r.confidence ?? 0),
        urgency: String(r.urgency ?? "monitor"),
        risk: (r.risk as string) ?? null,
        recommended_cta: (r.recommended_cta as string) ?? null,
        expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
      })));
    }

    return new Response(JSON.stringify({
      ok: true, cached: false, run_id: run.id, model, generated_at: run.created_at,
      usage: { input_tokens: inTok, output_tokens: outTok, estimated_cost_usd: round(cost, 5) },
      metrics, output: parsed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).replace(/sk-[A-Za-z0-9_-]+/g, "***");
    console.error("generate-rm-intelligence failed:", message);
    if (hotelId) {
      await admin.from("rm_analysis_runs").insert({
        hotel_id: hotelId, organization_slug: orgSlug, mode, model,
        status: "error", error: message.slice(0, 500), created_by: userId,
      }).select("id").maybeSingle().catch(() => null);
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
