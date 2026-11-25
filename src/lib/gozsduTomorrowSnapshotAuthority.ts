import { TOMORROW_PMS_REUSE_MS } from './nextDayAutoAssignBridgeCore';

export type GozsduTomorrowSnapshotRow = {
  business_date: string | null;
  room_label: string | null;
  room_number: string | null;
  captured_at: string | null;
};

/**
 * Gozsdu's exact-day Previo roster is authoritative even when a configured
 * room is absent. This validates the feed itself, not the static inventory.
 * Never interpret an empty, mixed-date, duplicate or stale feed as a plan.
 */
export function verifyGozsduTomorrowSnapshot(
  rows: GozsduTomorrowSnapshotRow[],
  selectedDate: string,
  now = Date.now(),
): { capturedAt: string; rowCount: number } | null {
  if (rows.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return null;

  const roomNames = new Set<string>();
  let oldest = Infinity;
  let newest = -Infinity;
  for (const row of rows) {
    if (row.business_date !== selectedDate) return null;
    const name = String(row.room_label || row.room_number || '').trim().toLocaleLowerCase();
    if (!name || roomNames.has(name)) return null;
    roomNames.add(name);

    const captured = Date.parse(row.captured_at || '');
    if (!Number.isFinite(captured)) return null;
    oldest = Math.min(oldest, captured);
    newest = Math.max(newest, captured);
  }

  // All rooms must belong to the same recent synchronization batch.
  if (oldest > now + 60_000 || now - oldest > TOMORROW_PMS_REUSE_MS || newest - oldest > 60_000) {
    return null;
  }
  return { capturedAt: new Date(newest).toISOString(), rowCount: rows.length };
}
