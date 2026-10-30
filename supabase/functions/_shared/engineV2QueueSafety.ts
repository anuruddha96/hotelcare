/**
 * Never enqueue DB-prohibited V2 proactive ladder repairs.
 *
 * The production BEFORE INSERT trigger intentionally returns NULL for
 * intent_source=ladder_repair. Treating those missing INSERT RETURNING rows as
 * an entire automation failure stopped hourly pricing. Keep the engine's
 * independent date-decision intents; a ladder repair requires a separately
 * authorized project and must not alter the uniform 13-cell movement.
 */
export type EngineV2IntentRef = {
  stay_date: string;
  room_type_name: string;
  occupancy: number;
  intent_source?: string | null;
};

export function publishableEngineV2Intents<T extends EngineV2IntentRef>(
  intents: readonly T[],
): T[] {
  return intents.filter((intent) => intent.intent_source !== "ladder_repair");
}

const cellKey = (intent: EngineV2IntentRef): string =>
  `${intent.stay_date}|${intent.room_type_name}|${intent.occupancy}`;

/**
 * A safety trigger can suppress rows (RETURN NULL). Hold the entire affected
 * stay date without throwing away independent dates that were inserted.
 * Count occurrences rather than using a Set so duplicate return rows cannot
 * incorrectly certify a complete date.
 */
export function incompleteInsertDates<T extends EngineV2IntentRef>(
  requested: readonly T[],
  returned: readonly EngineV2IntentRef[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const item of returned) {
    const key = cellKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const affected = new Set<string>();
  for (const item of requested) {
    const key = cellKey(item);
    const remaining = counts.get(key) ?? 0;
    if (remaining < 1) affected.add(item.stay_date);
    else counts.set(key, remaining - 1);
  }
  return affected;
}

/** A demand-led V2 decision must move EVERY mapped price by exactly one
 * whole-euro amount. Historical room hierarchy inversions are neither fixed
 * nor deepened by adding the same amount to every cell. Do not let a second
 * safety pass rewrite a single child price behind the date decision's back.
 */
export type EngineV2MoveCell = EngineV2IntentRef & {
  obk_id?: string | null;
  old_price: unknown;
  new_price: unknown;
};

export function validEngineV2DateMovement(
  cells: readonly EngineV2MoveCell[],
  manifest?: { movement?: unknown; expected_cells?: unknown } | null,
): boolean {
  const delta = Number(manifest?.movement);
  const expected = Number(manifest?.expected_cells);
  if (!Number.isInteger(delta) || delta === 0 || !Number.isInteger(expected) || expected < 1 || cells.length !== expected) {
    return false;
  }
  const keys = new Set<string>();
  for (const cell of cells) {
    const oldPrice = Number(cell.old_price);
    const newPrice = Number(cell.new_price);
    const guestCount = Number(cell.occupancy);
    const obk = String(cell.obk_id ?? "").trim();
    if (!obk || !Number.isInteger(guestCount) || guestCount < 1 ||
        !Number.isInteger(oldPrice) || !Number.isInteger(newPrice) ||
        oldPrice <= 0 || newPrice <= 0 || newPrice - oldPrice !== delta) {
      return false;
    }
    const key = `${cell.stay_date}|${obk}|${cell.room_type_name}|${guestCount}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}
