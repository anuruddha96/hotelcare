// Public Revenue Engine V2 entry point.
//
// The fully tested decision engine lives in engineV2Core.ts. This policy layer
// adds the near-arrival sell-out rules that must outrank portfolio ADR guarding:
//   • ARRIVAL TODAY is owned exclusively by revenue-same-day-sellout, which
//     checks the current stay date every 30 minutes until 15:00.
//   • DAY+1..DAY+7 are a dedicated occupancy-first sell-out window. While any
//     room remains, the engine may only hold or reduce the price — pickup,
//     events, ADR floors and scarcity may slow a markdown, but never turn the
//     last unsold rooms into an automatic increase.
//   • DAY+8..DAY+90 keeps the normal smart engine and gets a market-rebalance
//     retry when validated competitor evidence says the hotel's reference rate
//     is materially above the comp set, occupancy is soft, inventory remains
//     and there has been no net pickup.
//
// Keeping today's normal hourly engine out of the rate is deliberate: two
// independent clocks must never compete over the same arrival-day price.

export * from "./engineV2Core.ts";
export { sameDayUrgencyStep } from "./sameDaySellout.ts";

import {
  decideDate as decideDateCore,
  paceTargetFor,
  windowFor,
  type Decision,
  type DecisionInput,
  type DecisionSettings,
  type PaceBand,
} from "./engineV2Core.ts";

const whole = (value: number): number => Math.round(value);

const hoursSince = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return (now.getTime() - parsed) / 3_600_000;
};

function localMinutes(now: Date, timeZone = "Europe/Budapest"): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Arrival is today/tomorrow/day+2 and at least one room remains unsold. */
export function isFinalSelloutWindow(input: DecisionInput): boolean {
  return input.daysOut >= 0
    && input.daysOut <= 2
    && input.roomsRemaining != null
    && Number.isFinite(input.roomsRemaining)
    && input.roomsRemaining > 0;
}

/**
 * Final-seven-day occupancy priority.
 *
 * Once arrival is within seven days, an unsold room is still an unsold room at
 * 70%, 95% or with only one room left. Scarcity must therefore never disable
 * the occupancy-first policy. If room inventory is known it is authoritative;
 * otherwise occupancy below 100% is enough to keep the date in sell-out mode.
 */
export function isCloseInSelloutPriority(input: DecisionInput): boolean {
  if (input.daysOut < 1 || input.daysOut > 7) return false;

  const roomsKnown = input.roomsRemaining != null && Number.isFinite(Number(input.roomsRemaining));
  if (roomsKnown) return Number(input.roomsRemaining) > 0;

  const occupancyKnown = input.occupancyPct != null && Number.isFinite(Number(input.occupancyPct));
  if (occupancyKnown) return Number(input.occupancyPct) < 100;

  return false;
}

/**
 * In D+1..D+7 ADR remains a KPI, not a close-in price floor. Strip ADR-derived
 * floors/freezes while preserving real safety boundaries such as the configured
 * minimum price, the campaign markdown budget, explicit manager locks and the
 * cancellation cooldown.
 */
export function withoutCloseInAdrProtection(input: DecisionInput): DecisionInput {
  if (!isCloseInSelloutPriority(input)) return input;
  return {
    ...input,
    adrFloor: null,
    hardAdrFloor: null,
    monthFloor: null,
    monthMarkdownsFrozen: false,
  };
}

/**
 * Whole-euro final-week step. More unsold inventory or softer occupancy makes
 * the step stronger; pickup can soften it, never reverse it. One or two last
 * rooms still take a meaningful €3 step instead of being frozen by scarcity.
 */
export function finalSelloutStep(input: DecisionInput): number {
  const netPickup = Math.max(0, input.pickup24h - input.cancellations24h);
  const occ = input.occupancyPct;
  const remaining = input.roomsRemaining ?? 0;

  let step = input.daysOut === 1 ? 4 : 3;
  if ((occ != null && occ < 70) || remaining >= 6) step = Math.max(step, 5);
  else if ((occ != null && occ < 85) || remaining >= 3) step = Math.max(step, 4);

  // Pickup proves the current offer can convert, so slow the cut by one euro,
  // but do not raise/freeze an unsold date inside the final seven days.
  if (netPickup > 0) step = Math.max(3, step - 1);

  // With only one/two rooms or 90%+ occupancy preserve some scarcity value,
  // while still making a conversion move toward a full house.
  if (remaining > 0 && remaining <= 2) step = Math.min(step, 3);
  if (occ != null && occ >= 90) step = Math.min(step, 3);

  return whole(step);
}

function blocked(
  input: DecisionInput,
  settings: DecisionSettings,
  reason: string,
  detail: string,
): Decision {
  const win = windowFor(input.daysOut, settings.windowRules);
  const paceTarget = paceTargetFor(input.daysOut, settings.paceBands);
  const gap = paceTarget != null && input.occupancyPct != null
    ? Math.round((input.occupancyPct - paceTarget) * 10) / 10
    : null;
  return {
    stayDate: input.stayDate,
    daysOut: input.daysOut,
    windowId: win.id,
    direction: "hold",
    movement: 0,
    currentPrice: input.currentPrice,
    targetPrice: input.currentPrice,
    paceTargetPct: paceTarget,
    paceGapPct: gap,
    reason,
    reasonDetail: detail,
    capApplied: null,
    blocked: true,
  };
}

function commonSafetyHold(input: DecisionInput, settings: DecisionSettings): Decision | null {
  const { now } = settings;
  if (input.dataStale) {
    return blocked(input, settings, "stale_data", "The PMS feed is stale; no price may change.");
  }
  if (input.currentPrice == null || !(input.currentPrice > 0)) {
    return blocked(input, settings, "no_price", "No current price on file for this date.");
  }
  if (input.minPrice == null || input.maxPrice == null
    || !Number.isFinite(input.minPrice) || !Number.isFinite(input.maxPrice)) {
    return blocked(input, settings, "bounds_missing", "No resolvable minimum and maximum price for this date.");
  }
  if (input.maxPrice < input.minPrice) {
    return blocked(input, settings, "bounds_invalid", `Maximum €${input.maxPrice} is below minimum €${input.minPrice}.`);
  }

  const holdActive = Boolean(input.manualHoldUntil && Date.parse(input.manualHoldUntil) > now.getTime());
  if (holdActive && input.holdKind === "hard") {
    return blocked(input, settings, "manual_lock", "A manager locked this date; automation leaves it alone.");
  }
  if (holdActive) {
    return blocked(input, settings, "manual_hold", "A manual price change is protected for now; no automatic sell-out markdown.");
  }

  const sinceCancellation = hoursSince(input.lastCancellationAt, now);
  if (sinceCancellation != null && sinceCancellation * 60 < settings.cancellationWaitMinutes) {
    return blocked(input, settings, "cancellation_cooldown", "A cancellation just landed; waiting briefly before the sell-out markdown.");
  }
  return null;
}

/**
 * D+1..D+7 occupancy-first policy. This branch deliberately bypasses normal
 * pickup/event/ADR lifts and normal high-occupancy/low-inventory holds. It still
 * keeps the hard safety stack: manual protection, cancellation cooldown,
 * direction-change cooldown, daily markdown count/budget and the configured
 * minimum/campaign floor.
 */
function decideFinalSevenDays(input: DecisionInput, settings: DecisionSettings): Decision {
  const safety = commonSafetyHold(input, settings);
  if (safety) return safety;

  if (input.roomsRemaining != null && input.roomsRemaining <= 0) {
    return blocked(input, settings, "sold_out", "The date is sold out; the closing price stays.");
  }

  const win = windowFor(input.daysOut, settings.windowRules);
  const paceTarget = paceTargetFor(input.daysOut, settings.paceBands);
  const gap = paceTarget != null && input.occupancyPct != null
    ? Math.round((input.occupancyPct - paceTarget) * 10) / 10
    : null;
  const current = whole(input.currentPrice!);

  // Avoid an immediate up/down oscillation if a prior hourly run raised the
  // date just before it entered this policy. After the short configured
  // direction cooldown, occupancy-first selling resumes automatically.
  const sinceLast = hoursSince(input.lastDecisionAt, settings.now);
  if (input.lastDirection === "increase"
    && sinceLast != null
    && sinceLast < Math.max(0, settings.directionChangeHours)) {
    return blocked(
      input,
      settings,
      "direction_cooldown",
      `This date went up ${Math.round(sinceLast * 10) / 10}h ago; final-week sell-out waits ${settings.directionChangeHours}h before reversing direction.`,
    );
  }

  const maxMarkdowns = Math.max(0, settings.maxMarkdownsPerDay ?? 0);
  if (maxMarkdowns > 0 && (input.markdownsToday ?? 0) >= maxMarkdowns) {
    return blocked(
      input,
      settings,
      "markdown_limit",
      `Final-week sell-out has already lowered this date ${input.markdownsToday} time(s) today; the limit is ${maxMarkdowns}.`,
    );
  }

  if (win.min_hours_between_decreases > 0) {
    const sinceDecrease = hoursSince(input.lastDecreaseAt, settings.now);
    if (sinceDecrease != null && sinceDecrease < win.min_hours_between_decreases) {
      return blocked(
        input,
        settings,
        "decrease_frequency",
        `This date was already lowered ${Math.round(sinceDecrease * 10) / 10}h ago; ${win.min_hours_between_decreases}h must pass.`,
      );
    }
  }

  const requestedStep = finalSelloutStep(input);
  const dailyBudget = Math.max(0, win.max_daily_decrease - Math.abs(input.movedDownTodayEur));
  if (dailyBudget <= 0) {
    return blocked(
      input,
      settings,
      "daily_budget_spent",
      `Final-week sell-out has already used its €${win.max_daily_decrease} decrease allowance for this date today.`,
    );
  }
  const step = Math.min(requestedStep, dailyBudget);

  // In the final week the only commercial floor above the configured absolute
  // minimum is the fill campaign's total-drop budget. ADR/month floors and the
  // generic recent-peak depth guard are intentionally not allowed to strand an
  // unsold room this close to arrival.
  const fill = settings.fill?.enabled ? settings.fill : null;
  const inFillWindow = fill != null && input.daysOut <= Math.max(0, fill.windowDays);
  const campaignFloor = inFillWindow
    && input.campaignStartPrice != null && Number.isFinite(input.campaignStartPrice)
    && input.campaignStartPrice > 0
    ? whole(input.campaignStartPrice * (1 - Math.max(0, fill!.maxTotalDropPct) / 100))
    : null;
  const safetyFloor = Math.max(whole(input.minPrice!), campaignFloor ?? 0);

  const unclampedTarget = whole(current - step);
  const target = Math.max(unclampedTarget, safetyFloor);
  const movement = target - current;

  if (target >= current) {
    return blocked(
      input,
      settings,
      "price_floor_protected",
      `No price change: €${current} is already at or below the protected final-week floor of €${safetyFloor}. Automation is still checking the date.`,
    );
  }

  if (Math.abs(movement) < settings.minMovementEur) {
    return blocked(
      input,
      settings,
      "below_min_movement",
      `Final-week sell-out wanted to lower €${requestedStep}, but the remaining safe movement is under €${settings.minMovementEur} (floor €${safetyFloor}).`,
    );
  }

  const netPickup = Math.max(0, input.pickup24h - input.cancellations24h);
  const occupancyText = input.occupancyPct == null ? "occupancy unknown" : `${Math.round(input.occupancyPct)}% sold`;
  const arrivalText = input.daysOut === 1 ? "arrival tomorrow" : `arrival in ${input.daysOut} days`;
  const pickupText = netPickup > 0
    ? `${netPickup} net booking${netPickup === 1 ? "" : "s"} in 24h softened the markdown, but cannot raise an unsold final-week date`
    : "no net pickup in 24h";
  const roomsText = input.roomsRemaining == null
    ? "inventory still available"
    : `${input.roomsRemaining} room${input.roomsRemaining === 1 ? "" : "s"} left`;

  return {
    stayDate: input.stayDate,
    daysOut: input.daysOut,
    windowId: win.id,
    direction: "decrease",
    movement,
    currentPrice: current,
    targetPrice: target,
    paceTargetPct: paceTarget,
    paceGapPct: gap,
    reason: "final_7_day_fill",
    reasonDetail: `${roomsText}, ${occupancyText}, ${arrivalText}; ${pickupText}. Occupancy-first sell-out lowers €${Math.abs(movement)} toward 100% occupancy.`,
    capApplied: target !== unclampedTarget ? safetyFloor : step !== requestedStep ? dailyBudget : null,
    blocked: false,
  };
}

/**
 * Robust market ceiling used only to decide whether a soft date deserves a
 * second, market-aware evaluation. The displayed calendar may show an average,
 * but automation deliberately uses the validated median so one bad scrape can
 * never drag the hotel upward or downward.
 */
export function marketRebalanceCap(input: DecisionInput, settings: DecisionSettings): number | null {
  const market = input.market;
  if (market.median == null || !(Number(market.median) > 0)) return null;
  if (market.sampleSize < settings.marketValidation.min_competitors) return null;
  if (market.ageHours == null || market.ageHours > settings.marketValidation.max_age_hours) return null;

  const occ = input.occupancyPct == null ? 0 : Number(input.occupancyPct);
  const configuredLow = Number(settings.marketValidation.median_cap_low_occ_pct) || 110;
  const configuredHigh = Number(settings.marketValidation.median_cap_high_occ_pct) || 125;
  const pct = occ < 75
    ? configuredLow
    : Math.min(configuredHigh, 120);
  return whole(Number(input.market.median) * pct / 100);
}

export function isMarketRebalanceCandidate(input: DecisionInput, settings: DecisionSettings): boolean {
  if (input.daysOut < 8 || input.daysOut > 90) return false;
  if (input.currentPrice == null || !(input.currentPrice > 0)) return false;
  if (input.occupancyPct == null || !Number.isFinite(Number(input.occupancyPct))) return false;
  if (Number(input.occupancyPct) >= 85) return false;
  if (input.roomsRemaining == null || input.roomsRemaining <= 2) return false;
  if (Math.max(0, input.pickup24h - input.cancellations24h) > 0) return false;

  const cap = marketRebalanceCap(input, settings);
  if (cap == null) return false;
  return whole(input.currentPrice) - cap >= settings.minMovementEur;
}

/**
 * Re-evaluate an overpriced soft date as though pace were materially behind.
 * This does NOT bypass the core safety stack: no-pickup waiting, cancellation
 * and rebook protection, one-way-day logic, decrease cooldown, daily budget,
 * absolute floors, campaign depth and direction cooldown are still enforced by
 * decideDateCore. Only the monthly ADR freeze/floor is relaxed, because keeping
 * an empty room merely to defend a theoretical monthly ADR cannot beat a fresh,
 * validated market signal.
 */
function marketPressureRetry(input: DecisionInput, settings: DecisionSettings): Decision | null {
  if (!isMarketRebalanceCandidate(input, settings)) return null;
  const cap = marketRebalanceCap(input, settings)!;
  const current = whole(input.currentPrice!);
  const excessPct = cap > 0 ? ((current - cap) / cap) * 100 : 0;
  const requiredGap = excessPct >= 25 ? 20 : 15;
  const occ = Number(input.occupancyPct);
  const pressuredTarget = Math.min(100, occ + requiredGap);

  let replaced = false;
  const pressuredBands: PaceBand[] = settings.paceBands.map((band) => {
    if (input.daysOut < band.min_days_out || input.daysOut > band.max_days_out) return band;
    replaced = true;
    return {
      ...band,
      target_occupancy_pct: Math.max(Number(band.target_occupancy_pct), pressuredTarget),
    };
  });
  if (!replaced) {
    pressuredBands.push({
      min_days_out: input.daysOut,
      max_days_out: input.daysOut,
      target_occupancy_pct: pressuredTarget,
    });
  }

  const retry = decideDateCore(
    {
      ...input,
      monthFloor: null,
      monthMarkdownsFrozen: false,
    },
    {
      ...settings,
      paceBands: pressuredBands,
    },
  );

  if (retry.direction !== "decrease" || retry.blocked) return null;
  return {
    ...retry,
    reason: "market_rebalance",
    reasonDetail:
      `Validated competitor median €${whole(Number(input.market.median))}; `
      + `soft-occupancy market ceiling €${cap}, while Ottofiori is €${current} with ${input.roomsRemaining} rooms left and no net pickup. `
      + `${retry.reasonDetail}`,
  };
}

/**
 * A single booking is useful evidence outside the final seven days, but with
 * soft occupancy it is not enough to make an already-uncompetitive date more
 * expensive. Two bookings, scarcity or >=85% occupancy can still justify the
 * core engine's increase from day eight onward.
 */
function suppressWeakSinglePickupIncrease(
  input: DecisionInput,
  settings: DecisionSettings,
  decision: Decision,
): Decision {
  const netPickup = Math.max(0, input.pickup24h - input.cancellations24h);
  if (decision.direction !== "increase" || netPickup !== 1) return decision;
  if (!decision.reason.includes("genuine_pickup")) return decision;
  if ((input.occupancyPct ?? 0) >= 85) return decision;
  if (input.roomsRemaining != null && input.roomsRemaining <= 2) return decision;

  return blocked(
    input,
    settings,
    "single_pickup_hold",
    "One booking with soft occupancy is evidence to hold, not enough evidence to raise. Wait for a second net booking, >=85% occupancy, or scarcity before yielding upward.",
  );
}

export function decideDate(input: DecisionInput, settings: DecisionSettings): Decision {
  // A manager price change is authoritative for the full configured hold.
  // During the hold, neither pickup, ADR, events nor fill mode may alter the
  // date; a later run resumes from the manager's rate. Ordinary Ottofiori edits
  // are configured for one hour, while explicit manager locks keep their own
  // longer expiry.
  const manualHoldActive = Boolean(
    input.manualHoldUntil && Date.parse(input.manualHoldUntil) > settings.now.getTime(),
  );
  if (manualHoldActive) {
    return blocked(
      input,
      settings,
      input.holdKind === "hard" ? "manual_lock" : "manual_hold",
      input.holdKind === "hard"
        ? "A manager locked this date; automation leaves it alone."
        : "A manager changed this price; the manager's rate remains authoritative until the manual protection period ends.",
    );
  }

  // Arrival day remains exclusively owned by the dedicated 30-minute worker.
  if (input.daysOut === 0 && isFinalSelloutWindow(input)) {
    if (localMinutes(settings.now) >= 15 * 60) {
      return blocked(
        input,
        settings,
        "same_day_cutoff",
        "Arrival-day automatic sell-out pricing stops at 15:00 local time. Management owns the remaining inventory after the cutoff.",
      );
    }
    return blocked(
      input,
      settings,
      "same_day_dedicated",
      "Today's stay date is controlled by the dedicated 30-minute sell-out worker. The normal hourly engine deliberately leaves it alone.",
    );
  }

  // D+1..D+7: if anything remains unsold, conversion is the controlling goal.
  // Do not route these dates back through occupancy, scarcity, event or ADR
  // increases — that was the gap that stranded Ottofiori's final rooms.
  if (isCloseInSelloutPriority(input)) {
    return decideFinalSevenDays(withoutCloseInAdrProtection(input), settings);
  }

  let decision = decideDateCore(input, settings);

  // Do not overreact to one booking while a date is still soft.
  decision = suppressWeakSinglePickupIncrease(input, settings, decision);

  // From day eight onward, validated market evidence may request a second
  // evaluation of an overpriced soft date. The retry still passes through the
  // core safety stack and can legitimately remain a hold.
  if (decision.direction !== "decrease") {
    const marketRetry = marketPressureRetry(input, settings);
    if (marketRetry) decision = marketRetry;
  }

  return decision;
}
