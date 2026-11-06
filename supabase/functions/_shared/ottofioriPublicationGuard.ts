/** Validate the complete stored intent again after database draft triggers ran.
 * A held decision can retain a non-zero movement: direction alone is unsafe.
 * This contract is deliberately scoped to Ottofiori's mapped 13-cell column.
 */
export interface PublicationDecision {
  id: string;
  hotel_id: string;
  stay_date: string;
  status: string;
  direction: string;
  movement: number | string | null;
  cells_simulated: number | null;
  pickup_24h?: number | null;
  cancellations_24h?: number | null;
  occupancy_pct?: number | string | null;
  pace_target_pct?: number | string | null;
  rooms_remaining?: number | null;
  days_out?: number | null;
  decision_reason?: string | null;
}

export interface PublicationDraft {
  id: string;
  stay_date: string;
  obk_id: string | null;
  occupancy: number;
  old_price: number | string | null;
  new_price: number | string;
  decision_id?: string | null;
  intent_source?: string | null;
  decision_reason?: string | null;
  currency?: string | null;
}

export interface PublicationCell {
  stay_date: string;
  obk_id: string | null;
  occupancy: number;
  price: number | string;
}

export function isDecisionPublicationDraft(draft: PublicationDraft): boolean {
  return Boolean(draft.decision_id) ||
    String(draft.intent_source ?? "").startsWith("automation") ||
    String(draft.decision_reason ?? "").startsWith("ai_");
}

export function activePublicationDecision(
  decision: PublicationDecision | undefined,
  stayDate: string,
): boolean {
  if (!decision || decision.hotel_id !== "ottofiori" || decision.stay_date !== stayDate ||
      decision.status !== "queued") return false;
  const move = Number(decision.movement);
  return Number.isInteger(move) && move !== 0 &&
    ((decision.direction === "increase" && move > 0) ||
     (decision.direction === "decrease" && move < 0));
}

const cellKey = (cell: { obk_id: string | null; occupancy: number }) =>
  `${cell.obk_id ?? ""}|${cell.occupancy}`;

export function guardOttofioriPublication<T extends PublicationDraft>(params: {
  hotelId: string;
  drafts: T[];
  decisions: PublicationDecision[];
  mappedCells: PublicationCell[];
  manifest: Record<string, { decision_id?: string | null; expected_cells?: number }> | null;
  protectedDates?: Set<string>;
  hardLockedDates?: Set<string>;
}): { allowed: T[]; blocked: Array<{ stayDate: string; reason: string; drafts: T[] }> } {
  if (params.hotelId !== "ottofiori") return { allowed: params.drafts, blocked: [] };
  const dates = new Map<string, T[]>();
  for (const draft of params.drafts) {
    const rows = dates.get(draft.stay_date) ?? [];
    rows.push(draft);
    dates.set(draft.stay_date, rows);
  }
  const allowed: T[] = [];
  const blocked: Array<{ stayDate: string; reason: string; drafts: T[] }> = [];
  for (const [stayDate, drafts] of dates) {
    // A normal human edit is independent of automated decision publication.
    if (!drafts.some(isDecisionPublicationDraft)) { allowed.push(...drafts); continue; }
    const reject = (reason: string) => blocked.push({ stayDate, reason, drafts });
    const decisionIds = new Set(drafts.map((d) => d.decision_id));
    const id = drafts[0].decision_id;
    const decision = params.decisions.find((d) => d.id === id);
    if (decisionIds.size !== 1 || !id || !activePublicationDecision(decision, stayDate)) {
      reject("Whole date blocked: its stored pricing decision is missing, held, terminal or inconsistent.");
      continue;
    }
    const genuinePickupRise = decision?.direction === "increase"
      && Number(decision.pickup_24h ?? 0) - Number(decision.cancellations_24h ?? 0) > 0;
    if (params.hardLockedDates?.has(stayDate) || (params.protectedDates?.has(stayDate) && !genuinePickupRise)) {
      reject("Whole date blocked: an active manager lock or protected human price prevents this movement.");
      continue;
    }
    // Apply the same measured-pickup rule before the external PMS write.
    // Strong early occupancy is not a soft date: it is at least 50% and ten
    // points ahead of the saved lead-time pace target.
    const occupancy = Number(decision?.occupancy_pct ?? 0);
    const paceTarget = Number(decision?.pace_target_pct ?? 100);
    const strongOccupancy = occupancy >= 85 ||
      (occupancy >= 50 && Number.isFinite(paceTarget) && occupancy >= paceTarget + 10);
    const netPickup24h = Math.max(0,
      Number(decision?.pickup_24h ?? 0) - Number(decision?.cancellations_24h ?? 0));
    const movement = Number(decision!.movement);
    const singleBookingSoftRise = decision?.direction === "increase" &&
      netPickup24h === 1 && !strongOccupancy &&
      Number(decision?.rooms_remaining ?? 99) > 2;
    const measuredSingleBookingLimit = Number(decision?.days_out ?? 999) <= 7 ? 1 : 2;
    if (singleBookingSoftRise && !(
      ["revenue_director_yield", "ai_supervisor"].includes(String(decision?.decision_reason)) &&
      movement > 0 && movement <= measuredSingleBookingLimit
    )) {
      reject("Whole date blocked before PMS write: one net booking with soft occupancy is not enough for this increase.");
      continue;
    }
    const manifest = params.manifest?.[stayDate];
    const cells = params.mappedCells.filter((c) => c.stay_date === stayDate);
    const mirror = new Map(cells.map((c) => [cellKey(c), c]));
    const keys = new Set(drafts.map(cellKey));
    // Fail closed if configuration changes or a bounded read loses any cell.
    // Do not infer completeness from the surviving draft count after a trigger.
    if (manifest?.decision_id !== id || manifest?.expected_cells !== 13 ||
        decision?.cells_simulated !== 13 || drafts.length !== 13 || keys.size !== 13 ||
        cells.length !== 13 || mirror.size !== 13 ||
        drafts.some((d) => !d.obk_id || !Number.isInteger(d.occupancy) ||
          d.occupancy < 1 || !mirror.has(cellKey(d)))) {
      reject("Whole date blocked: the exact mapped 13-cell price column is incomplete or duplicated.");
      continue;
    }
    if (drafts.some((d) => {
      const old = Number(d.old_price);
      const target = Number(d.new_price);
      const live = Number(mirror.get(cellKey(d))?.price);
      return d.old_price == null || d.currency !== "EUR" || !Number.isFinite(live) ||
        !Number.isInteger(old) || !Number.isInteger(target) || old <= 0 || target <= 0 ||
        Math.abs(old - live) > 0.01 || target - old !== movement;
    })) {
      reject("Whole date blocked: a price is stale or does not preserve the decision's uniform whole-euro movement.");
      continue;
    }
    allowed.push(...drafts);
  }
  return { allowed, blocked };
}
