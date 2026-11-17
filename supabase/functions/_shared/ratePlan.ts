// Mira rate plan: the pricing review for a date range, with every signal a
// revenue manager looks at per night, shaped for the approval card.
//
// The euro steps come from pricingReview.ts (never from the language model).
// One step moves every room type and occupancy of that night together, so the
// room-type ladder stays intact. Approving a plan runs the existing
// adjust_revenue_prices path per range (stale-price check, floors, ladder and
// manual-hold rules, Previo publishing queue).
//
// Pure TypeScript so vitest covers it.

import type { PricingReview, ReviewStance } from "./pricingReview.ts";

export type RatePlanSignal = {
  score: number | null;
  band: string | null;
  action: string | null;
  pickup24h: number | null;
  pickup7d: number | null;
  paceTargetPct: number | null;
  drivers: string[];
};

export type RatePlanDay = {
  date: string;
  weekday: string;
  daysOut: number;
  occupancyPct: number | null;
  expectedOccupancyPct: number;
  roomsLeft: number | null;
  roomsAvailable: number | null;
  pickup7d: number | null;
  pickup24h: number | null;
  adr: number | null;
  entryRate: number | null;
  marketMedian: number | null;
  marketCount: number;
  positionVsMarketPct: number | null;
  events: string[];
  eventImpact: "high" | "medium" | "low" | "none";
  signal: RatePlanSignal | null;
  stance: ReviewStance;
  deltaEur: number;
  proposedEntryRate: number | null;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

export type RatePlan = {
  version: 1;
  kind: "rate_plan";
  hotelId: string;
  hotelName: string;
  currency: string;
  from: string;
  to: string;
  generatedAt: string;
  dataAsOf: string | null;
  minimumRate: number | null;
  marketScanAgeHours: number | null;
  days: RatePlanDay[];
  summary: {
    nights: number;
    changedNights: number;
    raise: number;
    lower: number;
    hold: number;
    protect: number;
    insufficientData: number;
    averageDeltaEur: number;
    highImpactEventNights: number;
  };
  notes: string[];
};

export type RatePlanRange = { fromDate: string; toDate: string; deltaEur: number; nights: number };

/** adjust_revenue_prices limits (assistantActions.ts). */
export const MAX_RANGE_NIGHTS = 7;
export const MAX_STEP_EUR = 20;

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function buildRatePlan(params: {
  review: PricingReview;
  hotelId: string;
  hotelName: string;
  currency: string;
  generatedAt: string;
  dataAsOf: string | null;
  minimumRate: number | null;
  marketScanAgeHours: number | null;
  adrByDate: Record<string, number | null>;
  roomsAvailableByDate: Record<string, number | null>;
  signalsByDate: Record<string, RatePlanSignal>;
  notes?: string[];
}): RatePlan {
  const days: RatePlanDay[] = params.review.dates.map((d) => {
    const signal = params.signalsByDate[d.stay_date] ?? null;
    return {
      date: d.stay_date,
      weekday: d.weekday,
      daysOut: d.days_out,
      occupancyPct: d.occupancy_pct,
      expectedOccupancyPct: d.expected_occupancy_pct,
      roomsLeft: d.rooms_left,
      roomsAvailable: params.roomsAvailableByDate[d.stay_date] ?? null,
      pickup7d: d.net_pickup ?? signal?.pickup7d ?? null,
      pickup24h: signal?.pickup24h ?? null,
      adr: params.adrByDate[d.stay_date] ?? null,
      entryRate: d.entry_rate,
      marketMedian: d.competitor_median,
      marketCount: d.competitor_count,
      positionVsMarketPct: d.position_vs_competitors_pct,
      events: d.events,
      eventImpact: d.event_impact,
      signal,
      stance: d.stance,
      deltaEur: Math.max(-MAX_STEP_EUR, Math.min(MAX_STEP_EUR, Math.round(d.suggested_delta_eur))),
      proposedEntryRate: d.suggested_entry_rate,
      confidence: d.confidence,
      reasons: d.reasons.slice(0, 4),
    };
  });
  const changed = days.filter((d) => d.deltaEur !== 0);
  return {
    version: 1,
    kind: "rate_plan",
    hotelId: params.hotelId,
    hotelName: params.hotelName,
    currency: params.currency,
    from: days[0]?.date ?? params.review.from,
    to: days.at(-1)?.date ?? params.review.to,
    generatedAt: params.generatedAt,
    dataAsOf: params.dataAsOf,
    minimumRate: params.minimumRate,
    marketScanAgeHours: params.marketScanAgeHours,
    days,
    summary: {
      nights: days.length,
      changedNights: changed.length,
      raise: days.filter((d) => d.stance === "raise").length,
      lower: days.filter((d) => d.stance === "lower").length,
      hold: days.filter((d) => d.stance === "hold").length,
      protect: days.filter((d) => d.stance === "protect").length,
      insufficientData: days.filter((d) => d.stance === "insufficient_data").length,
      averageDeltaEur: changed.length ? Math.round((changed.reduce((s, d) => s + d.deltaEur, 0) / changed.length) * 10) / 10 : 0,
      highImpactEventNights: days.filter((d) => d.eventImpact === "high").length,
    },
    notes: params.notes ?? [],
  };
}

/**
 * The publishing ranges for the nights the person kept: consecutive nights
 * with the same step become one range of at most seven nights.
 */
export function ratePlanRanges(days: Pick<RatePlanDay, "date" | "deltaEur">[], included: ReadonlySet<string>): RatePlanRange[] {
  const ranges: RatePlanRange[] = [];
  let open: RatePlanRange | null = null;
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const delta = Math.round(day.deltaEur);
    if (!delta || !included.has(day.date)) { open = null; continue; }
    if (open && open.deltaEur === delta && nextDay(open.toDate) === day.date && open.nights < MAX_RANGE_NIGHTS) {
      open.toDate = day.date;
      open.nights += 1;
    } else {
      open = { fromDate: day.date, toDate: day.date, deltaEur: delta, nights: 1 };
      ranges.push(open);
    }
  }
  return ranges;
}

/** JSON with sorted keys, so the same plan always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 of the canonical plan: printed on the consent receipt. */
export async function planHash(plan: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(plan));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The sentence the person agrees to; stored word for word with the decision. */
export function rateConsentText(plan: Pick<RatePlan, "hotelName" | "currency">, ranges: RatePlanRange[]): string {
  const nights = ranges.reduce((s, r) => s + r.nights, 0);
  const parts = ranges.map((r) => `${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate}–${r.toDate}`} ${r.deltaEur > 0 ? "+" : ""}${r.deltaEur} ${plan.currency}`);
  return `I approve changing ${plan.hotelName} prices for ${nights} night${nights === 1 ? "" : "s"} (${parts.join("; ")}), every room type and occupancy, through HotelCare's safe publishing queue.`.slice(0, 1000);
}
