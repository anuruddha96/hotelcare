import { decideDate as coreDecision, paceTargetFor, windowFor, pickupLadderFor, pickupStep, type Decision, type DecisionInput, type DecisionSettings } from "./engineV2Core.ts";

/**
 * Policy (owner instruction, 14 Nov 2026): sell every room at the highest
 * possible ADR by selling out LATE. A date that is full a week early was
 * underpriced. Therefore:
 *  - every genuine booking earns the full lead-time ladder step (no €1–2 cap);
 *  - scarce inventory (≤ SCARCE_ROOMS left) and strong occupancy are never
 *    marked down; only genuine fresh pickup can justify a rise;
 *  - markdowns are reserved for genuinely soft dates after a quiet window.
 */
export const SCARCE_ROOMS = 3;
function hoursBetween(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : null;
}

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

/** The local-hour, demand-sensitive step for genuinely unsold arrival-day inventory. */
export function sameDayMarkdownStep(localMinutes: number, roomsRemaining: number): number {
  if (localMinutes < 15 * 60) return roomsRemaining >= 3 ? 3 : 2;
  if (localMinutes < 18 * 60) return roomsRemaining >= 3 ? 5 : 4;
  return roomsRemaining >= 3 ? 6 : 5;
}

function budapestMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const at = (name: string) => Number(parts.find((part) => part.type === name)?.value ?? 0);
  return at("hour") * 60 + at("minute");
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
  // Arrival-day rooms are perishable. Keep only today on this hourly sell-out
  // path: every future date retains its separate pacing, event and ADR strategy.
  if (input.daysOut === 0) {
    const minute = budapestMinutes(settings.now);
    if (minute < 8 * 60 || minute >= 23 * 60) {
      return hold("same_day_outside_selling_hours", "Automatic arrival-day markdowns run from 08:00 to 23:00 Budapest time.");
    }
    if (input.roomsRemaining != null && input.roomsRemaining <= 0) {
      return hold("sold_out", "No rooms remain; keep the last selling price.");
    }
    if (context.confirmedHighEvent && minute < 18 * 60 && (input.occupancyPct ?? 0) >= 85) {
      return hold("verified_event_protected", "A verified high-impact event protects scarce inventory until the evening selling window.");
    }
    // Strong arrival-day occupancy holds its price until the evening: the last
    // one or two rooms are worth more than an hourly discount.
    if ((input.occupancyPct ?? 0) >= 90 && minute < 20 * 60) {
      return hold("same_day_strong_occupancy", `${input.occupancyPct}% sold today; the last rooms keep their price until 20:00.`);
    }
    if ((input.hoursSinceLastPickup != null && input.hoursSinceLastPickup <= 2)
      || input.pickup1h > 0 || (input.observedPickup6h ?? 0) >= 2) {
      return hold("same_day_pickup_observation", "A recent booking or strong six-hour pickup justifies observing conversion rather than discounting again.");
    }
    const step = sameDayMarkdownStep(minute, input.roomsRemaining ?? 0);
    const hourlyWindow = {
      ...win, min_days_out: 0, max_days_out: 0,
      no_pickup_wait_hours: 1, min_hours_between_decreases: 1,
      max_daily_decrease: 140,
    };
    const sameDayPolicy: DecisionSettings = {
      ...settings, respectConfiguredWindows: true, windowRules: [hourlyWindow, ...settings.windowRules],
      maxMarkdownsPerDay: 24, minMovementEur: 1, maxMarkdownDepthPct: 0,
      soldOutOccupancyPct: 101, occupancyLiftEnabled: false, microPriceTests: false,
      allowSameDayReversal: true, fill: { enabled: true, windowDays: 0, maxTotalDropPct: 100 },
      // The ordinary cancellation and manager protections remain in coreDecision.
      bookedDateBrakeHours: 0,
    };
    const sameDayInput: DecisionInput = {
      ...input, adrFloor: null, hardAdrFloor: null, monthFloor: null,
      monthMarkdownsFrozen: false, pendingEventUplift: 0,
      commercialIntent: {
        raw: -step,
        reason: "same_day_hourly_sellout",
        detail: `Arrival today, ${input.roomsRemaining} room(s) unsold; no recent converting pickup. Budapest local time ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}; test a €${step} markdown this hour, stopping at the €75 same-day safety floor.`,
      },
    };
    return coreDecision(sameDayInput, sameDayPolicy);
  }

  const effective: DecisionInput = {
    ...input, hardAdrFloor: null, adrFloor: null, monthFloor: null, monthMarkdownsFrozen: false,
    pendingEventUplift: 0,
  };
  const policy: DecisionSettings = {
    ...settings, respectConfiguredWindows: true,
    fill: { ...settings.fill!, enabled: true, windowDays: settings.fill?.windowDays ?? 14, maxTotalDropPct: settings.fill?.maxTotalDropPct ?? 15 },
    // Only genuinely fresh unconsumed pickup may raise a price. Static occupancy
    // and event evidence protect an offer but never create another increase.
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
  const left = input.roomsRemaining;
  const quietHours = Math.max(1, win.no_pickup_wait_hours ?? 6);
  const hoursQuiet = input.hoursSinceLastPickup;
  const netUnspent = Math.max(0, input.pickup24h - input.cancellations24h);
  const recentUnspent = input.unspentPickupInQuietWindow
    ?? (hoursQuiet != null && hoursQuiet < quietHours ? netUnspent : 0);
  const pickup = Math.min(netUnspent, Math.max(0, recentUnspent));
  const observed6h = Math.max(0, input.observedPickup6h ?? input.pickup6h);
  const scarce = left <= SCARCE_ROOMS;
  // Strong = the date is ahead of where it should be for its lead time, or the
  // inventory is already scarce. Strong dates are never marked down.
  const strong = occ >= 85 || scarce
    || (input.daysOut > 7 && occ >= Math.max(50, (pace ?? 70) + 10));
  const waited = hoursQuiet == null || hoursQuiet >= quietHours;
  const behind = gap == null ? 0 : Math.max(0, -gap);
  let raw = 0;
  let reason = "awaiting_no_pickup_window";
  let detail = `Observe ${quietHours} hours without a new booking before reducing this offer.`;

  if (pickup > 0) {
    // Every genuine booking earns the full lead-time ladder step. Scarce
    // inventory earns more: the remaining rooms are the most valuable ones.
    const band = pickupLadderFor(input.daysOut, settings.pickupLadder ?? undefined);
    raw = pickupStep(band, pickup, occ, settings.strongOccupancyPct ?? 85);
    if (left <= 1) raw = Math.round(raw * 1.5);
    else if (scarce) raw = Math.round(raw * 1.25);
    reason = "pickup_yield";
    detail = `${pickup} fresh net booking(s) inside ${quietHours}h (${observed6h} in six hours), ${left} room(s) left: demand-led increase from the ${band.min_days_out}+ day ladder.`;
  } else if (context.confirmedHighEvent) {
      reason = "event_demand_protected";
      detail = "A verified high-impact event protects this date; no markdown.";
    } else if (strong) {
      reason = "strong_demand_protected";
      detail = scarce
        ? `${left} room(s) left (${occ}% sold): scarce inventory is never discounted.`
        : `${occ}% occupancy versus ${pace ?? "unknown"}% pace supports the current offer; no markdown.`;
    } else if (observed6h >= 2) {
      reason = "recent_pickup_protected";
      detail = `${observed6h} active bookings in six hours protect the converting offer.`;
    } else if (waited) {
      // Genuinely soft: quiet for the whole window, not strong, not scarce.
      // Step sizes are at least the publishable minimum (€3).
      let step = 0;
      if (input.daysOut <= 3) step = occ < 60 ? 8 : 5;
      else if (input.daysOut <= 7) step = occ < 70 ? 6 : 4;
      else if (input.daysOut <= 30) step = behind >= 20 ? 5 : behind >= 5 || occ < 60 ? 3 : 0;
      else step = behind >= 15 ? 4 : behind >= 8 ? 3 : 0;
      // A seasonal anchor is context, not proof of demand. Quiet, unsold dates
      // that are behind pace may test lower through the ordinary guarded path;
      // floors, budgets, cooldowns, events and manager edits still apply.
      if (step === 0) {
        reason = "on_pace";
        detail = `${occ}% sold versus ${pace ?? "unknown"}% pace ${input.daysOut} days out: on pace, the price holds.`;
      } else {
        raw = -Math.max(0, Math.min(step, current - input.minPrice));
        reason = raw < 0 ? "quiet_demand_test" : "price_floor";
        detail = raw < 0
          ? `${hoursQuiet == null ? "No active booking in the observation history" : `No booking for ${Math.floor(hoursQuiet)}h`}; ${left} rooms unsold, ${occ}% occupied versus ${pace ?? "unknown"}% pace. Test a lower offer by €${Math.abs(raw)}; a new booking reverses it upward.`
          : "The offer is at its absolute hotel price floor; no further reduction is permitted.";
      }
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
    decision.reasonDetail += ` ${occ}% occupied versus ${pace ?? "unknown"}% pace; ${left} rooms left. Goal: sell out late at the highest ADR; monthly ADR target €${context.targetAdr}${context.requiredRemainingAdr == null ? "" : `, remaining ADR need €${Math.round(context.requiredRemainingAdr)}`}.`;
  }
  return decision;
}
