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
