// Deterministic pricing review for the HotelCare AI workspace.
//
// The assistant is asked things like "check the next 30 days, find the events
// and tell me which prices to change". The language model must not invent the
// euro amounts for that. This module turns the same evidence a revenue manager
// would read — occupancy against the booking window, pickup, the fresh
// competitor set and demand events — into a per-date stance and a bounded
// whole-euro step. The model explains and proposes; the numbers come from here.
//
// A proposal is still only a proposal: it is applied through the existing
// `adjust_revenue_prices` action, which re-reads the published calendar and
// goes through the Revenue safety queue (floors, ladder, manual holds).
//
// Intentionally free of Deno APIs so it can be unit-tested from vitest.

export type ReviewDay = {
  stay_date: string;
  occupancyPct: number;
  roomsLeft: number;
  roomsAvailable: number;
  netPickup: number | null;
  hasData: boolean;
};

export type ReviewRate = { stay_date: string; price: number | null };
export type ReviewCompetitorRate = { stay_date: string; rate: number | null };
export type ReviewEvent = {
  title: string;
  event_date: string;
  end_date?: string | null;
  expected_impact?: string | null;
  approved?: boolean | null;
};

export type ReviewStance = "raise" | "lower" | "hold" | "protect" | "insufficient_data";
export type EventImpact = "high" | "medium" | "low" | "none";

export type ReviewedDate = {
  stay_date: string;
  weekday: string;
  days_out: number;
  occupancy_pct: number | null;
  expected_occupancy_pct: number;
  rooms_left: number | null;
  net_pickup: number | null;
  entry_rate: number | null;
  competitor_median: number | null;
  competitor_count: number;
  position_vs_competitors_pct: number | null;
  events: string[];
  event_impact: EventImpact;
  stance: ReviewStance;
  suggested_delta_eur: number;
  suggested_entry_rate: number | null;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

export type ReviewProposal = {
  fromDate: string;
  toDate: string;
  deltaEur: number;
  nights: number;
  reason: string;
};

export type PricingReview = {
  from: string;
  to: string;
  dates: ReviewedDate[];
  proposals: ReviewProposal[];
  summary: {
    dates_reviewed: number;
    raise: number;
    lower: number;
    hold: number;
    protect: number;
    insufficient_data: number;
    high_impact_event_dates: string[];
    competitor_data: "fresh" | "stale" | "none";
  };
};

/** Largest single step the review will ever suggest, in whole euros. */
export const MAX_STEP_EUR = 20;
/** `adjust_revenue_prices` accepts at most a 7-night range per action. */
export const MAX_PROPOSAL_NIGHTS = 7;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Steps of 8 euros or more are tidied to a multiple of 5 so neighbouring nights
 * end up with the same step and can be confirmed together. A raise rounds to
 * the nearest 5; a cut rounds toward the smaller cut so it never overshoots.
 */
function tidyStep(step: number): number {
  const size = Math.abs(step);
  if (size < 8) return step;
  const tidy = step > 0 ? Math.round(size / 5) * 5 : Math.floor(size / 5) * 5;
  return Math.sign(step) * Math.min(MAX_STEP_EUR, tidy);
}

/**
 * Occupancy a healthy city hotel has normally built by this lead time. It is a
 * pace reference, not a target: being far above it means demand is ahead of
 * the curve, far below means the date is slow.
 */
export function expectedOccupancyPct(daysOut: number): number {
  if (daysOut <= 1) return 85;
  if (daysOut <= 3) return 78;
  if (daysOut <= 7) return 65;
  if (daysOut <= 14) return 50;
  if (daysOut <= 21) return 40;
  if (daysOut <= 30) return 32;
  if (daysOut <= 60) return 20;
  return 12;
}

export function classifyEventImpact(value: string | null | undefined): EventImpact {
  const impact = String(value ?? "").toLowerCase();
  if (/(very high|high|major|strong)/.test(impact)) return "high";
  if (/(medium|moderate)/.test(impact)) return "medium";
  if (/(low|minor|weak)/.test(impact)) return "low";
  return "none";
}

const IMPACT_RANK: Record<EventImpact, number> = { none: 0, low: 1, medium: 2, high: 3 };

function eventsOn(events: ReviewEvent[], date: string): { titles: string[]; impact: EventImpact } {
  let impact: EventImpact = "none";
  const titles: string[] = [];
  for (const event of events) {
    const start = String(event.event_date ?? "");
    const end = String(event.end_date || start);
    if (!start || date < start || date > end) continue;
    // A rejected suggestion is not evidence. `approved: null/undefined` is an
    // event a person entered directly, which counts.
    if (event.approved === false) continue;
    const level = classifyEventImpact(event.expected_impact);
    if (IMPACT_RANK[level] > IMPACT_RANK[impact]) impact = level;
    if (event.title && !titles.includes(event.title)) titles.push(event.title);
  }
  return { titles: titles.slice(0, 4), impact };
}

export function buildPricingReview(params: {
  today: string;
  days: ReviewDay[];
  rates: ReviewRate[];
  competitorRates: ReviewCompetitorRate[];
  /** False when the newest competitor scan is too old to price against. */
  competitorFresh: boolean;
  events: ReviewEvent[];
  /** Automation floor (minimum ADR). A suggested decrease never goes below it. */
  minimumRateEur?: number | null;
}): PricingReview {
  const { today, competitorFresh, events } = params;
  const floor = Number(params.minimumRateEur ?? 0) > 0 ? Number(params.minimumRateEur) : 0;

  const entryRate = new Map<string, number>();
  for (const rate of params.rates) {
    const price = Number(rate.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const previous = entryRate.get(rate.stay_date);
    if (previous === undefined || price < previous) entryRate.set(rate.stay_date, price);
  }

  const competitorByDate = new Map<string, number[]>();
  for (const row of params.competitorRates) {
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const list = competitorByDate.get(row.stay_date) ?? [];
    list.push(rate);
    competitorByDate.set(row.stay_date, list);
  }
  const anyCompetitor = competitorByDate.size > 0;

  const dates: ReviewedDate[] = [...params.days]
    .filter((day) => day.stay_date >= today)
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date))
    .map((day) => {
      const daysOut = dayDiff(today, day.stay_date);
      const expected = expectedOccupancyPct(daysOut);
      const entry = entryRate.get(day.stay_date) ?? null;
      const competitorSet = competitorByDate.get(day.stay_date) ?? [];
      const competitorMedianRaw = median(competitorSet);
      const usableMedian = competitorFresh && competitorSet.length >= 2 ? competitorMedianRaw : null;
      const position =
        usableMedian && entry ? Math.round(((entry - usableMedian) / usableMedian) * 1000) / 10 : null;
      const { titles, impact } = eventsOn(events, day.stay_date);
      const weekday = WEEKDAYS[new Date(`${day.stay_date}T00:00:00Z`).getUTCDay()];

      const base = {
        stay_date: day.stay_date,
        weekday,
        days_out: daysOut,
        occupancy_pct: day.hasData ? Math.round(day.occupancyPct * 10) / 10 : null,
        expected_occupancy_pct: expected,
        rooms_left: day.hasData ? day.roomsLeft : null,
        net_pickup: day.netPickup,
        entry_rate: entry,
        competitor_median: competitorMedianRaw === null ? null : Math.round(competitorMedianRaw),
        competitor_count: competitorSet.length,
        position_vs_competitors_pct: position,
        events: titles,
        event_impact: impact,
      };

      if (!day.hasData || entry === null) {
        return {
          ...base,
          stance: "insufficient_data" as const,
          suggested_delta_eur: 0,
          suggested_entry_rate: entry,
          confidence: "low" as const,
          reasons: [!day.hasData ? "No verified occupancy for this date." : "No published rate for this date."],
        };
      }

      const occupancy = day.occupancyPct;
      // A medium event lifts what "on pace" means a little; it does not by
      // itself justify a price move.
      const gap = occupancy - expected + (impact === "medium" ? 5 : 0);
      const pickup = Number(day.netPickup ?? 0);
      const reasons: string[] = [];
      let stance: ReviewStance = "hold";
      let delta = 0;
      let confidence: "high" | "medium" | "low" = "medium";

      const scarce = day.roomsLeft <= 3 || occupancy >= 90;

      if (scarce) {
        reasons.push(`Only ${day.roomsLeft} room${day.roomsLeft === 1 ? "" : "s"} left at ${Math.round(occupancy)}% occupancy.`);
        if (position !== null && position > 15) {
          stance = "protect";
          reasons.push(`Entry rate is already ${position}% above the competitor median, so hold and protect it.`);
          confidence = "high";
        } else {
          stance = "raise";
          delta = clamp(Math.round(entry * 0.08), 5, MAX_STEP_EUR);
          reasons.push("Last rooms should sell at a premium; never discount scarce inventory.");
          confidence = "high";
        }
      } else if (impact === "high") {
        reasons.push(`High-impact event: ${titles.join(", ") || "demand event"}.`);
        if (position !== null && position > 20) {
          stance = "protect";
          reasons.push(`Entry rate already carries an event premium (${position}% above the competitor median). Hold it and let pickup confirm before going higher.`);
          confidence = "high";
        } else if (gap >= 0 || pickup > 0) {
          const target = Math.max(entry * 1.1, usableMedian ? usableMedian * 1.05 : 0);
          delta = clamp(Math.round(target - entry), 5, MAX_STEP_EUR);
          stance = "raise";
          reasons.push(
            pickup > 0
              ? `Demand is confirming: ${pickup} net room${pickup === 1 ? "" : "s"} picked up, occupancy ${Math.round(occupancy)}% vs about ${expected}% normal for ${daysOut} days out.`
              : `Occupancy ${Math.round(occupancy)}% is at or above the about ${expected}% normal for ${daysOut} days out.`,
          );
          confidence = usableMedian ? "high" : "medium";
        } else {
          stance = "protect";
          reasons.push(
            `Occupancy ${Math.round(occupancy)}% is still below the about ${expected}% normal for ${daysOut} days out, but event demand usually books late. Hold the rate; do not discount.`,
          );
        }
      } else if (gap >= 15) {
        reasons.push(`Ahead of pace: ${Math.round(occupancy)}% vs about ${expected}% normal for ${daysOut} days out.`);
        if (position !== null && position > 5) {
          stance = "hold";
          reasons.push(`Entry rate is already ${position}% above the competitor median.`);
        } else if (position !== null || pickup > 0) {
          stance = "raise";
          delta = clamp(Math.round(entry * 0.05), 3, 15);
          reasons.push(
            position !== null
              ? `Entry rate is ${position}% vs the competitor median, so there is room to step up.`
              : `${pickup} net room${pickup === 1 ? "" : "s"} picked up recently.`,
          );
          confidence = position !== null ? "high" : "medium";
        } else {
          stance = "hold";
          reasons.push("No fresh competitor rates and no recent pickup to confirm a step up.");
          confidence = "low";
        }
      } else if (gap <= -15) {
        reasons.push(`Behind pace: ${Math.round(occupancy)}% vs about ${expected}% normal for ${daysOut} days out.`);
        if (position === null) {
          stance = "hold";
          reasons.push(
            anyCompetitor && !competitorFresh
              ? "Competitor rates are stale, so a price cut is not justified yet. Refresh the market scan first."
              : "No competitor rates for this date, so a price cut is not justified yet.",
          );
          confidence = "low";
        } else if (position > 5) {
          const target = Math.max(floor, Math.round((usableMedian as number) * 1.02));
          const maxCut = daysOut > 21 ? 5 : 15;
          const cut = clamp(Math.round(entry - target), 0, maxCut);
          if (cut >= 2) {
            stance = "lower";
            delta = -cut;
            reasons.push(
              `Entry rate €${Math.round(entry)} is ${position}% above the competitor median €${Math.round(usableMedian as number)}; step down toward the market, not below it.`,
            );
            confidence = "high";
          } else {
            stance = "hold";
            reasons.push(floor && entry - floor < 2 ? "The rate is already at the minimum-rate floor." : "The gap to the market is too small to matter.");
          }
        } else {
          stance = "hold";
          reasons.push(
            `Entry rate is already competitive (${position}% vs the competitor median). Price is not the lever: check visibility, restrictions and channel availability.`,
          );
        }
      } else {
        reasons.push(`On pace: ${Math.round(occupancy)}% vs about ${expected}% normal for ${daysOut} days out.`);
        if (position !== null && position < -12 && gap >= 0) {
          stance = "raise";
          delta = clamp(Math.round(entry * 0.04), 3, 10);
          reasons.push(`Entry rate is ${Math.abs(position)}% below the competitor median while demand is healthy.`);
        }
      }

      delta = tidyStep(delta);
      if (delta < 0 && floor && entry + delta < floor) {
        delta = Math.min(0, Math.round(floor - entry));
        if (delta === 0) {
          stance = "hold";
          reasons.push("A decrease would go below the minimum-rate floor.");
        }
      }

      return {
        ...base,
        stance,
        suggested_delta_eur: delta,
        suggested_entry_rate: Math.round(entry + delta),
        confidence,
        reasons,
      };
    });

  // Consecutive nights with the same step become one confirmable action.
  const proposals: ReviewProposal[] = [];
  let open: { from: string; to: string; delta: number; nights: number; reason: string } | null = null;
  const close = () => {
    if (!open) return;
    proposals.push({
      fromDate: open.from,
      toDate: open.to,
      deltaEur: open.delta,
      nights: open.nights,
      reason: open.reason,
    });
    open = null;
  };
  for (const date of dates) {
    const delta = date.suggested_delta_eur;
    if (!delta) {
      close();
      continue;
    }
    if (open && open.delta === delta && nextDay(open.to) === date.stay_date && open.nights < MAX_PROPOSAL_NIGHTS) {
      open.to = date.stay_date;
      open.nights += 1;
    } else {
      close();
      // The first night's evidence explains the range; the per-date table
      // carries the detail for the others.
      open = { from: date.stay_date, to: date.stay_date, delta, nights: 1, reason: date.reasons.slice(0, 2).join(" ") };
    }
  }
  close();

  const count = (stance: ReviewStance) => dates.filter((d) => d.stance === stance).length;
  return {
    from: dates[0]?.stay_date ?? today,
    to: dates.at(-1)?.stay_date ?? today,
    dates,
    proposals,
    summary: {
      dates_reviewed: dates.length,
      raise: count("raise"),
      lower: count("lower"),
      hold: count("hold"),
      protect: count("protect"),
      insufficient_data: count("insufficient_data"),
      high_impact_event_dates: dates.filter((d) => d.event_impact === "high").map((d) => d.stay_date),
      competitor_data: !anyCompetitor ? "none" : competitorFresh ? "fresh" : "stale",
    },
  };
}
