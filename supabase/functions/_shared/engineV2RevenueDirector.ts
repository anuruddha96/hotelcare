import { decideDate as coreDecision, paceTargetFor, windowFor, pickupLadderFor, pickupStep, type Decision, type DecisionInput, type DecisionSettings } from "./engineV2Core.ts";

export interface RevenueDirectorContext {
  targetAdr: number;
  minimumAdr: number;
  projectedAdr: number | null;
  requiredRemainingAdr: number | null;
  netRateFactor: number;
  confirmedHighEvent: boolean;
  microPriceTestEnabled?: boolean;
}

/** Only delivered/currently committed proposals consume a cooldown. */
export const MOVEMENT_HISTORY_STATUSES = ["queued", "accepted", "confirmed", "published", "partial"] as const;
export function committedMovement(row: { status?: string; movement?: unknown; direction?: string }): boolean {
  return (MOVEMENT_HISTORY_STATUSES as readonly string[]).includes(String(row.status))
    && row.direction !== "hold" && Math.abs(Number(row.movement)) > 0;
}

/** Ottofiori's commercial planner. Core safety checks remain the final authority. */
export function decideRevenueDirector(input: DecisionInput, settings: DecisionSettings, context: RevenueDirectorContext): Decision {
  const win = windowFor(input.daysOut, settings.windowRules);
  const pace = paceTargetFor(input.daysOut, settings.paceBands);
  const gap = pace == null || input.occupancyPct == null ? null : input.occupancyPct - pace;
  const hold = (reason: string, detail: string): Decision => ({
    stayDate: input.stayDate, daysOut: input.daysOut, windowId: win.id,
    direction: "hold", movement: 0, currentPrice: input.currentPrice, targetPrice: input.currentPrice,
    paceTargetPct: pace, paceGapPct: gap, reason, reasonDetail: detail, capApplied: null, blocked: true,
  });
  if (input.holdKind === "hard" && input.manualHoldUntil && Date.parse(input.manualHoldUntil) > settings.now.getTime()) {
    return hold("manual_lock", "A manager locked this date; no automatic changes are permitted.");
  }
  const effective: DecisionInput = {
    ...input, hardAdrFloor: null, adrFloor: null, monthFloor: null, monthMarkdownsFrozen: false,
    pendingEventUplift: 0,
  };
  const policy: DecisionSettings = {
    ...settings, respectConfiguredWindows: true,
    fill: { ...settings.fill!, enabled: true, windowDays: settings.fill?.windowDays ?? 120, maxTotalDropPct: settings.fill?.maxTotalDropPct ?? 25 },
    occupancyLiftEnabled: false, microPriceTests: false,
    // A cancelled room must be resold, especially after the free-cancellation deadline.
    rebookWindowHours: Math.min(settings.rebookWindowHours ?? 12, input.daysOut <= 7 ? 2 : 12),
  };
  // Let core return the precise freshness, price, bounds and sold-out failures.
  if (input.dataStale || input.currentPrice == null || input.minPrice == null || input.maxPrice == null
    || input.roomsRemaining === 0 || (input.occupancyPct ?? 0) >= settings.soldOutOccupancyPct) {
    return coreDecision(effective, policy);
  }
  if (input.occupancyPct == null || input.roomsRemaining == null) return hold("no_occupancy", "Fresh occupancy and remaining-room evidence are required.");
  const current = input.currentPrice;
  const occ = input.occupancyPct;
  const pickup = Math.max(0, input.pickup24h - input.cancellations24h);
  const fastPickup = input.pickup6h >= 2 && pickup >= 2;
  const marketValid = input.market.median != null && input.market.median > 0
    && input.market.sampleSize >= settings.marketValidation.min_competitors
    && input.market.ageHours != null && input.market.ageHours <= settings.marketValidation.max_age_hours;
  const anchor = input.anchorPrice != null && input.anchorPrice > 0 ? input.anchorPrice : null;
  const strong = occ >= 85 || (input.daysOut > 7 && occ >= Math.max(50, (pace ?? 70) + 10));
  const waited = win.no_pickup_wait_hours != null
    && (input.hoursSinceLastPickup == null || input.hoursSinceLastPickup >= win.no_pickup_wait_hours);
  let raw = 0;
  let reason = "on_pace";
  let detail = "The offer is on pace; wait for new demand evidence.";

  if (pickup > 0) {
    const band = pickupLadderFor(input.daysOut, settings.pickupLadder ?? undefined);
    raw = pickupStep(band, pickup, occ, settings.strongOccupancyPct ?? 85);
    // One conversion on a soft date earns a small test, not a large price jump.
    if (!strong && !fastPickup) raw = Math.min(raw, input.daysOut <= 7 ? 1 : 2);
    reason = "pickup_yield";
    detail = `${pickup} unconsumed net booking(s), ${input.pickup6h} in six hours: measured demand-led increase.`;
  } else {
    // Occupancy and major events set a finite asking target. Once reached,
    // unchanged occupancy/event evidence cannot compound another hourly rise.
    const yieldTarget = anchor == null ? null : Math.round(anchor * (strong
      ? occ >= 90 ? 1.5 : occ >= 80 ? 1.35 : 1.2
      : context.confirmedHighEvent && input.daysOut > 7 ? 1.2 : 1));
    if ((strong || (context.confirmedHighEvent && input.daysOut > 7)) && yieldTarget != null && current < yieldTarget
      && (input.daysOut > 7 || (input.hoursSinceLastPickup != null && input.hoursSinceLastPickup < 6))) {
      raw = Math.min(yieldTarget - current, Math.max(2, Math.round(current * .03)));
      reason = context.confirmedHighEvent ? "event_positioning" : "occupancy_positioning";
      detail = `Position toward €${yieldTarget} from the seasonal anchor and ${context.confirmedHighEvent ? "confirmed event" : "early occupancy"}; no repeated surcharge above that target.`;
    } else if (!waited) {
      reason = "awaiting_no_pickup_window";
      detail = `Observe ${win.no_pickup_wait_hours} hours without pickup before a reduction.`;
    } else {
      const behind = gap == null ? null : -gap;
      // Every unsold final-week room remains eligible, including the last room.
      // Further out, scarce inventory protects ADR unless the offer is overpriced.
      const overpriced = marketValid && current > Math.ceil(input.market.median! * 1.12);
      const weak = input.daysOut <= 7 || (behind != null && behind >= 5);
      if ((weak && (!strong || input.daysOut <= 7)) || (!strong && overpriced && behind != null && behind >= 0)) {
        const step = input.roomsRemaining <= 2 ? 1
          : input.daysOut <= 2 ? (occ < 60 ? 6 : 4)
          : input.daysOut <= 7 ? (occ < 70 ? 5 : 3)
          : input.daysOut <= 30 ? (behind != null && behind >= 20 ? 5 : 3)
          : (behind != null && behind >= 25 ? 4 : 2);
        // Protect value with a seasonal reserve, not an unsellable portfolio ADR floor.
        // A high event preserves a premium far out, but cannot freeze empty rooms forever.
        const reserve = anchor == null ? input.minPrice : Math.max(input.minPrice,
          Math.round(anchor * (input.daysOut <= 7 ? .8 : context.confirmedHighEvent ? 1.2 : .9)));
        raw = -Math.max(0, Math.min(step, current - reserve));
        reason = raw < 0 ? "pace_sell_down" : "value_reserve";
        detail = raw < 0
          ? `${input.roomsRemaining} rooms unsold, ${Math.round(behind ?? 0)} points behind pace; test a lower offer while preserving the €${reserve} seasonal reserve.`
          : `The offer reached its €${reserve} seasonal reserve; require new market or demand evidence.`;
      } else if (strong) {
        reason = "strong_demand_protected";
        detail = "Early occupancy supports the present rate; wait for fresh pickup before another yield step.";
      }
    }
  }
  if (raw === 0) return hold(reason, detail);
  effective.commercialIntent = { raw, reason, detail };
  const decision = coreDecision(effective, policy);
  if (!decision.blocked) {
    decision.reason = decision.direction === "increase" ? "revenue_director_yield" : "revenue_director_fill";
    decision.reasonDetail += ` ${occ}% occupied versus ${pace ?? "unknown"}% pace; ${input.roomsRemaining} rooms left. Goal: 100% occupancy, sell early by D-7; monthly ADR target €${context.targetAdr}${context.requiredRemainingAdr == null ? "" : `, remaining ADR need €${Math.round(context.requiredRemainingAdr)}`}.`;
  }
  return decision;
}
