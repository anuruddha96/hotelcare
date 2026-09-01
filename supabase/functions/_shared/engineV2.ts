// Public Revenue Engine V2 entry point.
//
// The original, fully tested decision engine lives in engineV2Core.ts and is
// re-exported unchanged. This policy layer adds two deliberately narrow rules:
//   1) ARRIVAL TODAY: sell remaining inventory aggressively until 15:00, but
//      only after a full 30-minute period without a genuine pickup.
//   2) TOMORROW / DAY+2: keep the existing final-three-day sell-out priority.
//
// A dedicated same-day Edge Function performs the exact 30-minute current-date
// checks and is authorised to work down to the €100 same-day floor. The normal
// hourly engine still passes through this layer, so it can never contradict the
// same-day policy by raising today's rate after a pickup or after the 15:00
// handover time.

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

function budapestMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Arrival-today markdown step. More unsold rooms means more urgency. */
export function sameDayUrgencyStep(localMinutes: number, roomsRemaining: number): number {
  let base = 3;
  if (localMinutes >= 14 * 60 + 30) base = 10;
  else if (localMinutes >= 14 * 60) base = 8;
  else if (localMinutes >= 13 * 60) base = 7;
  else if (localMinutes >= 12 * 60) base = 6;
  else if (localMinutes >= 10 * 60) base = 5;
  else if (localMinutes >= 8 * 60) base = 4;

  if (roomsRemaining >= 4) base += 2;
  else if (roomsRemaining === 1) base = Math.max(3, base - 2);
  return whole(base);
}

/** Arrival is today/tomorrow/day+2 and at least one room remains unsold. */
export function isFinalSelloutWindow(input: DecisionInput): boolean {
  return input.daysOut >= 0
    && input.daysOut <= 2
    && input.roomsRemaining != null
    && Number.isFinite(input.roomsRemaining)
    && input.roomsRemaining > 0;
}

/** Existing tomorrow/day+2 sell-out step. */
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

/**
 * Current-day policy used by the normal hourly engine as a safety alignment.
 * The dedicated same-day function is the exact 30-minute runner and may work
 * down to €100. Here we honour the existing cell floors because runV2 validates
 * every room-rate cell against those bounds before publishing anyway.
 */
function decideArrivalToday(input: DecisionInput, settings: DecisionSettings): Decision {
  const safety = commonSafetyHold(input, settings);
  if (safety) return safety;

  const localMinutes = budapestMinutes(settings.now);
  if (localMinutes >= 15 * 60) {
    return blocked(
      input,
      settings,
      "same_day_cutoff",
      "Arrival-day sell-out automation stops at 15:00 local time; management takes over from here.",
    );
  }

  // A genuine pickup inside the current 30-minute observation window means the
  // current price is working. Hold this cycle, then reassess at the next check.
  if (input.hoursSinceLastPickup != null && input.hoursSinceLastPickup < 0.5) {
    return blocked(
      input,
      settings,
      "same_day_recent_pickup",
      `A genuine booking arrived ${Math.max(1, Math.round(input.hoursSinceLastPickup * 60))} minutes ago; hold this rate for the current 30-minute cycle.`,
    );
  }

  // Prevent an hourly engine run landing immediately after the dedicated
  // 30-minute sell-out tick from cutting the same date twice in one interval.
  const sinceDecision = hoursSince(input.lastDecisionAt, settings.now);
  if (sinceDecision != null && sinceDecision < 25 / 60) {
    return blocked(
      input,
      settings,
      "same_day_wait_next_check",
      `Today's rate was evaluated ${Math.max(1, Math.round(sinceDecision * 60))} minutes ago; waiting for the next 30-minute sell-out check.`,
    );
  }

  const current = whole(input.currentPrice!);
  const requestedStep = sameDayUrgencyStep(localMinutes, input.roomsRemaining ?? 1);
  const floor = whole(input.minPrice!);
  const target = Math.max(current - requestedStep, floor);
  const movement = target - current;
  if (movement >= 0 || Math.abs(movement) < settings.minMovementEur) {
    return blocked(
      input,
      settings,
      "same_day_floor_reached",
      `Today's hourly engine cannot safely move lower inside the standard room-rate floor. The dedicated same-day sell-out runner owns the authorised €100 handover floor.`,
    );
  }

  return {
    stayDate: input.stayDate,
    daysOut: 0,
    windowId: "same_day_00_15",
    direction: "decrease",
    movement,
    currentPrice: current,
    targetPrice: target,
    paceTargetPct: null,
    paceGapPct: null,
    reason: "same_day_sellout",
    reasonDetail: `${input.roomsRemaining} room${input.roomsRemaining === 1 ? "" : "s"} left; no genuine pickup in the last 30 minutes. Arrival-day sell-out mode lowers €${Math.abs(movement)} and will reassess in 30 minutes, until 15:00.`,
    capApplied: target !== current - requestedStep ? floor : null,
    blocked: false,
  };
}

/** Tomorrow/day+2 policy retained from the previous final-three-day change. */
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
  if (input.daysOut === 0) return decideArrivalToday(input, settings);
  return decideNextTwoDays(input, settings);
}
