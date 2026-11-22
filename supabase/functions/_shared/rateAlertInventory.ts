/**
 * A published price is only an urgent pricing risk when its exact Previo room
 * type, rate plan and stay date can still be sold.
 *
 * Do not use hotel-wide occupancy: another room type might be open even when
 * the flagged room type is sold out. An unverified/stale inventory row is not
 * evidence of sellable inventory.
 */
export interface RateAlertCandidate {
  stay_date: string;
  obk_id: string | null;
  rate_plan_id: string | null;
  closed_to_arrival?: boolean | null;
}

export interface RoomInventoryObservation {
  stay_date: string;
  obk_id: string | null;
  availability: number | string | null;
  captured_at: string | null;
}

// Previo calendar availability is refreshed during the revenue sync. Refuse
// to email on stale or missing evidence rather than guess that rooms can sell.
export const MAX_RATE_ALERT_INVENTORY_AGE_MS = 6 * 60 * 60 * 1000;

const id = (value: unknown) => String(value ?? "").trim();
const key = (date: string, obkId: string) => `${date}|${obkId}`;
const planKey = (obkId: string, planId: string) => `${obkId}|${planId}`;

export interface RateAlertInventoryResult<T> {
  sellable: T[];
  soldOut: number;
  unverified: number;
  closedPlan: number;
}

/** Pure filtering function, shared with tests; never modifies live rates. */
export function filterRatesBySellableInventory<T extends RateAlertCandidate>(
  candidates: readonly T[],
  observations: readonly RoomInventoryObservation[],
  nowMs: number = Date.now(),
  inactivePlans: ReadonlySet<string> = new Set(),
): RateAlertInventoryResult<T> {
  const latest = new Map<string, { availability: number | null; capturedAt: number }>();
  for (const row of observations) {
    const room = id(row.obk_id);
    if (!room || !row.stay_date) continue;
    const capturedAt = Date.parse(String(row.captured_at ?? ""));
    if (!Number.isFinite(capturedAt)) continue;
    const raw = row.availability;
    const parsed = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    const availability = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    const k = key(row.stay_date, room);
    const old = latest.get(k);
    if (!old || capturedAt > old.capturedAt) {
      latest.set(k, { availability, capturedAt });
    }
  }

  const result: RateAlertInventoryResult<T> = {
    sellable: [],
    soldOut: 0,
    unverified: 0,
    closedPlan: 0,
  };
  for (const rate of candidates) {
    const room = id(rate.obk_id);
    const plan = id(rate.rate_plan_id);
    // Missing exact identifiers must never borrow availability from a
    // different room type or rate plan.
    if (!room || !plan) {
      result.unverified++;
      continue;
    }
    // Closed-to-arrival does not mean unsellable: this date may still be
    // booked as a stay-through night. Only an explicitly inactive plan can
    // suppress an alert while matched inventory remains positive.
    if (inactivePlans.has(planKey(room, plan))) {
      result.closedPlan++;
      continue;
    }
    const current = latest.get(key(rate.stay_date, room));
    if (
      !current ||
      current.availability === null ||
      current.capturedAt > nowMs + 5 * 60_000 ||
      nowMs - current.capturedAt > MAX_RATE_ALERT_INVENTORY_AGE_MS
    ) {
      result.unverified++;
      continue;
    }
    if (current.availability <= 0) {
      result.soldOut++;
      continue;
    }
    result.sellable.push(rate);
  }
  return result;
}

export function makeRateAlertPlanKey(obkId: string, ratePlanId: string): string {
  return planKey(id(obkId), id(ratePlanId));
}
