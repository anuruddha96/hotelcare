import { decideDate as coreDecision, paceTargetFor, windowFor, type Decision, type DecisionInput, type DecisionSettings } from "./engineV2Core.ts";
import { decideDate as legacyDecision } from "./engineV2.ts";

export interface RevenueDirectorContext {
  targetAdr: number;
  minimumAdr: number;
  projectedAdr: number | null;
  requiredRemainingAdr: number | null;
  netRateFactor: number;
  confirmedHighEvent: boolean;
  /** Explicit Ottofiori-only, live-config opt-in for measured €1 tests. */
  microPriceTestEnabled?: boolean;
}

/** Only delivered/currently committed proposals consume a cooldown. */
export const MOVEMENT_HISTORY_STATUSES = ["queued", "accepted", "confirmed", "published", "partial"] as const;
export function committedMovement(row: { status?: string; movement?: unknown; direction?: string }): boolean {
  return (MOVEMENT_HISTORY_STATUSES as readonly string[]).includes(String(row.status))
    && row.direction !== "hold" && Math.abs(Number(row.movement)) > 0;
}

/** Ottofiori's ADR is a hotel KPI; it is not the minimum sell price of every night. */
export function decideRevenueDirector(input: DecisionInput, settings: DecisionSettings, context: RevenueDirectorContext): Decision {
  const pace = paceTargetFor(input.daysOut, settings.paceBands);
  const hold = (reason: string, detail: string): Decision => ({
    stayDate: input.stayDate, daysOut: input.daysOut,
    windowId: windowFor(input.daysOut, settings.windowRules).id,
    direction: "hold", movement: 0, currentPrice: input.currentPrice, targetPrice: input.currentPrice,
    paceTargetPct: pace, paceGapPct: pace == null || input.occupancyPct == null ? null : input.occupancyPct - pace,
    reason, reasonDetail: detail, capApplied: null, blocked: true,
  });
  if (input.daysOut === 0) return legacyDecision(input, settings);
  if (input.manualHoldUntil && Date.parse(input.manualHoldUntil) > settings.now.getTime()) {
    return hold(input.holdKind === "hard" ? "manual_lock" : "manual_hold", "A manager price remains protected until its recorded expiry.");
  }
  if (input.occupancyPct == null || input.roomsRemaining == null) return hold("no_occupancy", "Fresh occupancy and remaining-room evidence are required.");
  const netPickup = Math.max(0, input.pickup24h - input.cancellations24h);
  const strong = input.occupancyPct >= 85 || input.roomsRemaining <= 2
    || (netPickup >= 2 && input.occupancyPct >= Math.max(50, (pace ?? 70) - 5));
  const effective: DecisionInput = {
    ...input,
    // A portfolio ADR deficit must not force an unsellable price on a soft night.
    hardAdrFloor: null, adrFloor: null, monthFloor: null, monthMarkdownsFrozen: false,
    // Events inform demand. They never add an unconditional repeated surcharge.
    pendingEventUplift: 0,
  };
  const policy: DecisionSettings = {
    ...settings,
    respectConfiguredWindows: true,
    fill: { ...settings.fill!, enabled: true, windowDays: 93, maxTotalDropPct: settings.fill?.maxTotalDropPct ?? 20 },
    raiseOnAnyPickup: true,
    microPriceTests: context.microPriceTestEnabled === true && !context.confirmedHighEvent,
    occupancyLiftEnabled: strong,
    occupancyLiftLadder: strong
      ? [{ min_occupancy_pct: 90, min_days_out: 0, pct: 3, min_eur: 5 }, ...(settings.occupancyLiftLadder ?? [])]
      : settings.occupancyLiftLadder,
  };
  let decision = coreDecision(effective, policy);
  if (input.dataStale || decision.reason === "sold_out" || decision.reason === "no_price" || decision.reason.startsWith("bounds_")) return decision;

  // Pickup is already a successful conversion. Do not reward one isolated sale
  // on a soft night with a rise, and do not cut below the guest who just booked.
  if (!strong && netPickup > 0) return hold("pickup_conversion_hold", `${netPickup} net pickup in 24h with ${input.occupancyPct}% occupancy: hold the converting offer and watch velocity.`);
  if (strong && decision.direction === "decrease") return hold("strong_demand_protected", "High occupancy or scarce remaining inventory protects ADR; wait for genuine renewed pickup before another yield move.");
  if (decision.direction === "decrease" && context.confirmedHighEvent && input.occupancyPct >= 60) {
    return hold("event_demand_protected", "A confirmed major event and established occupancy protect this date from a no-pickup markdown.");
  }
  if (decision.direction === "decrease" && input.daysOut > 7
    && context.projectedAdr != null && context.projectedAdr < context.minimumAdr
    && context.requiredRemainingAdr != null
    && Number(input.currentPrice) * context.netRateFactor <= context.requiredRemainingAdr) {
    return hold("portfolio_adr_budget", `Projected hotel ADR €${Math.round(context.projectedAdr)} is below €${context.minimumAdr}; this offer is already below the remaining ADR need. Protect it and harvest stronger nights.`);
  }
  if (!decision.blocked) {
    const paceText = pace == null ? "pace unavailable" : `${input.occupancyPct}% occupied versus ${pace}% target`;
    decision = { ...decision, reason: decision.direction === "increase" ? "revenue_director_yield" : "revenue_director_fill",
      reasonDetail: `${decision.reasonDetail} ${paceText}; ${input.roomsRemaining} rooms left; ${netPickup} net pickup/24h. Sell-through goal 95–100% by D-7; hotel ADR target €${context.targetAdr}${context.requiredRemainingAdr == null ? "" : `, remaining ADR need €${Math.round(context.requiredRemainingAdr)}`}.` };
  }
  return decision;
}
