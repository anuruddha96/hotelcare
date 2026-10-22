/**
 * Previo's exact-date daily overview is reservation-based, so a verified
 * snapshot can legitimately contain fewer rows than the physical inventory.
 * The data layer validates freshness/authority first; this UI helper only
 * confirms that the exact rows displayed are the same rows that were verified.
 */
export function isVerifiedSparseTomorrowSnapshot(args: {
  hotelId: string;
  roomCount: number;
  verifiedRowCount: number;
  exactDayRowCount: number;
  authoritative: boolean;
}): boolean {
  return args.authoritative === true
    && !!args.hotelId
    && args.roomCount > 0
    && args.verifiedRowCount > 0
    && args.verifiedRowCount < args.roomCount
    && args.exactDayRowCount === args.verifiedRowCount;
}

/**
 * A Previo daily overview is a reservation roster, not full physical room
 * inventory. An empty or malformed response cannot be silently reused, but
 * genuine vacancies must not trigger repeated full PMS refreshes.
 */
export function isReusableTomorrowReservationBatch(args: {
  roomCount: number;
  rows: Array<{
    room_label: string | null;
    room_number: string | null;
    captured_at: string | null;
  }>;
  freshnessMs: number;
  now?: number;
}): boolean {
  const { roomCount, rows, freshnessMs, now = Date.now() } = args;
  if (!Number.isFinite(roomCount) || roomCount <= 0
    || !Number.isFinite(freshnessMs) || freshnessMs <= 0
    || rows.length === 0 || rows.length > roomCount) return false;

  const identities = new Set<string>();
  let oldest = Infinity;
  let newest = -Infinity;
  for (const row of rows) {
    const identity = String(row.room_label || row.room_number || '').trim().toLowerCase();
    const captured = Date.parse(row.captured_at || '');
    if (!identity || identities.has(identity) || !Number.isFinite(captured)) return false;
    identities.add(identity);
    oldest = Math.min(oldest, captured);
    newest = Math.max(newest, captured);
  }
  return oldest <= now
    && now - oldest <= freshnessMs
    && newest <= now + 60_000
    && newest - oldest <= 60_000;
}
