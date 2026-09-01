// Public Revenue Engine V2 entry point.
//
// The original, fully tested decision engine now lives in engineV2Core.ts and
// is re-exported unchanged. This thin policy layer adds one deliberately narrow
// business priority: when arrival is today/tomorrow/day+2 AND rooms are still
// unsold, reaching 100% occupancy outranks pickup surcharges and ADR-derived
// price lifts. All dates outside that final sell-out window use the core engine
// exactly as before.

export * from "./engineV2Core.ts";

import {
  decideDate as decideDateCore,
  paceTargetFor,
  windowFor,
  type Decision,
  type DecisionInput,
  type DecisionSettings,
} from "./engineV2Core.ts";

const whole = (value: number): number => Math.round(value);

const hoursSince = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return (now.getTime() - parsed) / 3_600_000;
};

/**
 * The hotel's final sell-out window: arrival is no more than two days away and
 * at least one room is still available. A sold-out date never enters this path.
 */
export function isFinalSelloutWindow(input: DecisionInput): boolean {
  return input.daysOut >= 0
    && input.daysOut <= 2
    && input.roomsRemaining != null
    && Number.isFinite(input.roomsRemaining)
    && input.roomsRemaining > 0;
}

/**
 * Smart whole-euro markdown for the final three days.
 *
 * Urgency sets the starting cut: today €5, tomorrow €4, day+2 €3. Strong recent
 * pickup / strong occupancy / only one or two rooms left makes the cut smaller,
 * but NEVER turns it into an increase while inventory remains. This preserves
 * demand information without sacrificing the 100% occupancy objective.
 */
export function finalSelloutStep(input: DecisionInput): number {
  const netPickup = Math.max(0, input.pickup24h - input.cancellations24h);
  const occ = input.occupancyPct;
  const remaining = input.roomsRemaining ?? 0;
  let step = input.daysOut <= 0 ? 5 : input.daysOut === 1 ? 4 : 3;

  if (netPickup >= 2 || (occ != null && occ >= 85) || remaining <= 2) {
    step = 3;
  } else if (netPickup === 1 || (occ != null && occ >= 75)) {
    step = Math.max(3, step - 1);
  }
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

/**
 * Decide one stay date.
 *
 * Outside the final three days this is a transparent pass-through to the core
 * Engine V2. Inside the final window, if inventory remains, the sell-out policy
 * deliberately bypasses:
 *   - pickup-driven increases;
 *   - hard/net/month ADR lifts and ADR markdown freezes;
 *   - the 24h rebooking hold after the short cancellation safety wait;
 *   - one-markdown-per-day / same-day one-way / direction-reversal holds.
 *
 * It still respects stale-data protection, explicit price bounds, manager/manual
 * holds, the cancellation safety wait, the absolute room-rate floor, campaign
 * max-drop protection, recent-peak markdown depth and the €15/day final-window
 * decrease budget. Once roomsRemaining reaches zero, the normal sold-out logic
 * in the core engine takes over again.
 */
export function decideDate(input: DecisionInput, settings: DecisionSettings): Decision {
  if (!isFinalSelloutWindow(input)) return decideDateCore(input, settings);

  const { now } = settings;
  const win = windowFor(input.daysOut, settings.windowRules);
  const paceTarget = paceTargetFor(input.daysOut, settings.paceBands);
  const gap = paceTarget != null && input.occupancyPct != null
    ? Math.round((input.occupancyPct - paceTarget) * 10) / 10
    : null;

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
  // A soft hand-set price remains protected. The sell-out rule should be
  // automatic and assertive, but it must never silently undo an explicit human
  // price choice while that protection is active.
  if (holdActive) {
    return blocked(input, settings, "manual_hold", "A manual price change is protected for now; no automatic sell-out markdown.");
  }

  const sinceCancellation = hoursSince(input.lastCancellationAt, now);
  if (sinceCancellation != null && sinceCancellation * 60 < settings.cancellationWaitMinutes) {
    return blocked(input, settings, "cancellation_cooldown", "A cancellation just landed; waiting briefly before the final sell-out markdown.");
  }

  const current = whole(input.currentPrice);
  const requestedStep = finalSelloutStep(input);
  const dailyBudget = Math.max(0, win.max_daily_decrease - Math.abs(input.movedDownTodayEur));
  if (dailyBudget <= 0) {
    return blocked(
      input,
      settings,
      "daily_budget_spent",
      `Final sell-out mode has already used its €${win.max_daily_decrease} decrease allowance for this date today.`,
    );
  }

  const step = Math.min(requestedStep, dailyBudget);

  // Final sell-out deliberately waives ADR-derived floors. Empty rooms earn
  // zero, so in the last three days occupancy takes precedence over the ADR
  // target. Genuine safety rails remain: absolute configured floor, campaign
  // max-drop protection and recent-peak markdown depth.
  const fill = settings.fill?.enabled ? settings.fill : null;
  const inFillWindow = fill != null && input.daysOut <= Math.max(0, fill.windowDays);
  const campaignFloor = inFillWindow
    && input.campaignStartPrice != null && Number.isFinite(input.campaignStartPrice)
    && input.campaignStartPrice > 0
    ? whole(input.campaignStartPrice * (1 - Math.max(0, fill!.maxTotalDropPct) / 100))
    : null;
  const depthPct = Math.max(0, settings.maxMarkdownDepthPct ?? 0);
  const depthFloor = depthPct > 0 && input.recentPeakPrice != null
    && Number.isFinite(input.recentPeakPrice) && Number(input.recentPeakPrice) > 0
    ? whole(Number(input.recentPeakPrice) * (1 - depthPct / 100))
    : null;
  const safetyFloor = Math.max(
    whole(input.minPrice),
    campaignFloor ?? 0,
    depthFloor ?? 0,
  );

  const unclampedTarget = whole(current - step);
  const target = Math.max(unclampedTarget, safetyFloor);
  const movement = target - current;
  if (Math.abs(movement) < settings.minMovementEur) {
    return blocked(
      input,
      settings,
      "below_min_movement",
      `Final sell-out mode wanted to lower €${requestedStep}, but the remaining safe movement is under €${settings.minMovementEur} (safety floor €${safetyFloor}).`,
    );
  }

  const netPickup = Math.max(0, input.pickup24h - input.cancellations24h);
  const occupancyText = input.occupancyPct == null ? "occupancy unknown" : `${Math.round(input.occupancyPct)}% sold`;
  const arrivalText = input.daysOut === 0 ? "arrival today" : input.daysOut === 1 ? "arrival tomorrow" : "arrival in 2 days";
  const pickupText = netPickup > 0
    ? `${netPickup} net booking${netPickup === 1 ? "" : "s"} in 24h; pickup reduced the cut but cannot raise an unsold final-3-day date`
    : "no net pickup in 24h";

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
    reason: "final_3_day_fill",
    reasonDetail: `${input.roomsRemaining} room${input.roomsRemaining === 1 ? "" : "s"} left, ${occupancyText}, ${arrivalText}; ${pickupText}. Sell-out priority lowers €${Math.abs(movement)} toward 100% occupancy.`,
    capApplied: target !== unclampedTarget ? safetyFloor : step !== requestedStep ? dailyBudget : null,
    blocked: false,
  };
}
