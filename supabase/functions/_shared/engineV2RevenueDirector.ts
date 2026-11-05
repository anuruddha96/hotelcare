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

const AUTHORITATIVE_EVENT_HOSTS = [
  "budapestarena.hu",
  "mvm-dome.hu",
  "hungexpo.hu",
  "livenation.hu",
  "iata.org",
  "fashionweekhungary.com",
] as const;

/**
 * A high label alone is not proof of citywide compression. Event-only markdown
 * protection requires a human-curated event or an organizer/venue source.
 */
export function confirmedHighImpactEvent(row: {
  expected_impact?: unknown;
  confidence?: unknown;
  approved?: unknown;
  url?: unknown;
  source?: unknown;
}): boolean {
  if (String(row.expected_impact ?? "").toLowerCase() !== "high"
    || row.approved !== true || Number(row.confidence ?? 0) < 0.8
    || typeof row.url !== "string" || !row.url.trim()) return false;
  if (String(row.source ?? "").toLowerCase() === "manual") return true;
  try {
    const host = new URL(row.url).hostname.toLowerCase().replace(/^www\./, "");
    return AUTHORITATIVE_EVENT_HOSTS.some((domain) => host === domain || host.endsWith("." + domain));
  } catch {
    return false;
  }
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
    occupancyLiftEnabled: false, microPriceTests: false, allowSameDayReversal: true,
    // A cancelled room must be resold, especially after the free-cancellation deadline.
    rebookWindowHours: Math.min(settings.rebookWindowHours ?? 4, input.daysOut <= 7 ? 2 : 4),
    bookedDateBrakeHours: Math.min(settings.bookedDateBrakeHours ?? 4, win.no_pickup_wait_hours ?? 4),
  };
  // Let core return the precise freshness, price, bounds and sold-out failures.
  if (input.dataStale || input.currentPrice == null || input.minPrice == null || input.maxPrice == null
    || input.roomsRemaining === 0 || (input.occupancyPct ?? 0) >= settings.soldOutOccupancyPct) {
    return coreDecision(effective, policy);
  }
  if (input.occupancyPct == null || input.roomsRemaining == null) return hold("no_occupancy", "Fresh occupancy and remaining-room evidence are required.");
  const current = input.currentPrice;
  const occ = input.occupancyPct;
  const quietHours = Math.max(1, win.no_pickup_wait_hours ?? 6);
  const hoursQuiet = input.hoursSinceLastPickup;
  const netUnspent = Math.max(0, input.pickup24h - input.cancellations24h);
  const recentUnspent = input.unspentPickupInQuietWindow
    ?? (hoursQuiet != null && hoursQuiet < quietHours ? netUnspent : 0);
  const pickup = Math.min(netUnspent, Math.max(0, recentUnspent));
  const observed6h = Math.max(0, input.observedPickup6h ?? input.pickup6h);
  const fastPickup = input.pickup6h >= 2 && pickup >= 2;
  const strong = occ >= 85 || (input.daysOut > 7 && occ >= Math.max(50, (pace ?? 70) + 10));
  const waited = hoursQuiet == null || hoursQuiet >= quietHours;
  let raw = 0;
  let reason = "awaiting_no_pickup_window";
  let detail = `Observe ${quietHours} hours without a new booking before reducing this offer.`;

  if (pickup > 0) {
    const band = pickupLadderFor(input.daysOut, settings.pickupLadder ?? undefined);
    raw = pickupStep(band, pickup, occ, settings.strongOccupancyPct ?? 85);
    if (!strong && !fastPickup) raw = Math.min(raw, input.daysOut <= 7 ? 1 : 2);
    reason = "pickup_yield";
    detail = `${pickup} fresh unconsumed net booking(s) inside ${quietHours}h; ${observed6h} active booking(s) in six hours: demand-led increase, consumed once.`;
  } else if (context.confirmedHighEvent) {
    reason = "event_demand_protected";
    detail = "A verified high-impact event protects this date; no markdown and no event-only repeated increase.";
  } else if (strong) {
    reason = "strong_demand_protected";
    detail = `${occ}% occupancy supports the current offer; only a fresh booking can justify another increase.`;
  } else if (observed6h >= 2) {
    reason = "recent_pickup_protected";
    detail = `${observed6h} active bookings in six hours protect the converting offer, including bookings already consumed for an increase.`;
  } else if (waited) {
    // Quiet demand is itself a reason to test a lower offer. Being nominally
    // on pace or having raised earlier today must not freeze a soft date.
    const behind = gap == null ? 0 : Math.max(0, -gap);
    const step = input.roomsRemaining <= 2 ? 1
      : input.daysOut <= 2 ? (occ < 60 ? 6 : 4)
      : input.daysOut <= 7 ? (occ < 70 ? 5 : 3)
      : input.daysOut <= 30 ? (behind >= 20 ? 4 : 2)
      : 2;
    raw = -Math.max(0, Math.min(step, current - input.minPrice));
    reason = raw < 0 ? "quiet_demand_test" : "price_floor";
    detail = raw < 0
      ? `${hoursQuiet == null ? "No active booking in the observation history" : `No booking for ${Math.floor(hoursQuiet)}h`}; ${input.roomsRemaining} rooms unsold, ${occ}% occupied. Test a lower offer by €${Math.abs(raw)}; reassess conversion before another step. An earlier rise does not prohibit a later reduction.`
      : "The offer is at its absolute hotel price floor; no further reduction is permitted.";
  }
  if (raw === 0) return hold(reason, detail);
  effective.commercialIntent = { raw, reason, detail };
  const decision = coreDecision(effective, policy);
  if (!decision.blocked) {
    if (reason === "quiet_demand_test" && decision.direction === "decrease" && decision.movement !== raw) {
      decision.reasonDetail = decision.reasonDetail.replace(
        `Test a lower offer by €${Math.abs(raw)}`,
        `Test a lower offer by €${Math.abs(decision.movement)}`,
      );
    }
    decision.reason = decision.direction === "increase" ? "revenue_director_yield" : "revenue_director_fill";
    decision.reasonDetail += ` ${occ}% occupied versus ${pace ?? "unknown"}% pace; ${input.roomsRemaining} rooms left. Goal: 100% occupancy, sell early by D-7; monthly ADR target €${context.targetAdr}${context.requiredRemainingAdr == null ? "" : `, remaining ADR need €${Math.round(context.requiredRemainingAdr)}`}.`;
  }
  return decision;
}
