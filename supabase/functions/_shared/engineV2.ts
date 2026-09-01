// Public Revenue Engine V2 entry point.
//
// The fully tested decision engine lives in engineV2Core.ts. This policy layer
// adds one narrow near-arrival rule:
//   • ARRIVAL TODAY is owned exclusively by revenue-same-day-sellout, which
//     checks the current stay date every 30 minutes until 15:00.
//   • TOMORROW / DAY+2 keep the final sell-out priority added previously.
//
// Keeping the normal hourly engine out of today's rate is deliberate: two
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

/** Smart whole-euro markdown retained for tomorrow and day+2. */
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

/** Tomorrow/day+2 policy retained from the previous sell-out change. */
function decideNextTwoDays(input: DecisionInput, settings: DecisionSettings): Decision {
  const safety = commonSafetyHold(input, settings);
  if (safety) return safety;

  const win = windowFor(input.daysOut, settings.windowRules);
  const paceTarget = paceTargetFor(input.daysOut, settings.paceBands);
  const gap = paceTarget != null && input.occupancyPct != null
    ? Math.round((input.occupancyPct - paceTarget) * 10) / 10
    : null;
  const current = whole(input.currentPrice!);
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
  const safetyFloor = Math.max(whole(input.minPrice!), campaignFloor ?? 0, depthFloor ?? 0);

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
  const arrivalText = input.daysOut === 1 ? "arrival tomorrow" : "arrival in 2 days";
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

export function decideDate(input: DecisionInput, settings: DecisionSettings): Decision {
  if (!isFinalSelloutWindow(input)) return decideDateCore(input, settings);

  if (input.daysOut === 0) {
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

  return decideNextTwoDays(input, settings);
}
