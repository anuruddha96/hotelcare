/**
 * Final-state guard for SLNT checkout RTC.
 *
 * The Previo checkout poll can confirm a departure before a housekeeping
 * assignment is created/recreated later in the same minute. In that race the
 * room metadata remains authoritative (checked out + RTC) while the newer
 * assignment can still be waiting with ready_to_clean=false.
 *
 * This predicate is intentionally conservative: it only heals a current-day,
 * explicitly checked-out, still-dirty room. Already-clean rooms and stale
 * previous-day checkout metadata are never released.
 */
export interface SlntRtcInvariantRoom {
  status?: string | null;
  checkout_time?: string | null;
  pms_metadata?: Record<string, unknown> | null;
}

const dateOnly = (raw: unknown): string => {
  const value = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
};

export function shouldHealSlntCheckoutRtc(
  room: SlntRtcInvariantRoom,
  businessDate: string,
): boolean {
  if (room.status === "clean") return false;

  const meta = room.pms_metadata ?? {};
  const previoCleanStatus = Number(meta.previoRoomCleanStatusId ?? 0);
  if (previoCleanStatus === 2 || previoCleanStatus === 3) return false;

  // Never infer checkout from a scheduled departure, dirty status, or clock.
  // We require the explicit physical-departure state written by the Previo poll.
  if (meta.checkedOutToday !== true || meta.readyToClean !== true) return false;

  const releaseDate = dateOnly(
    meta.readyToCleanDate ?? meta.checkedOutAt ?? room.checkout_time,
  );
  return releaseDate === businessDate;
}
