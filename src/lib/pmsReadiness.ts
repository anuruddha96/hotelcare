import { todayBudapest } from "@/lib/budapestTime";

const dateOnly = (value: unknown): string | null => {
  if (!value) return null;
  const raw = String(value);
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split("T")[0];
};

/**
 * A checkout room is "ready to clean" only when PMS confirmed the departure
 * TODAY and the room is still unclean. The readyToClean / checkedOutToday
 * flags in pms_metadata are sticky, so without the date guard a room that
 * departed on an earlier day keeps showing RTC while the current guest is
 * still in-house. Likewise, once live Previo housekeeping reports Clean,
 * RTC must disappear: the room is already clean, not merely ready for it.
 *
 * Managers/reception may also release a checkout manually. That path stores
 * manualReadyToCleanAt instead of the PMS readyToClean flags, so treat the
 * timestamp itself as an RTC signal while keeping the same today-only guard.
 */
export const isPmsRtcToday = (meta: Record<string, any> | null | undefined): boolean => {
  if (!meta) return false;

  // Previo room-clean status: 2/3 = clean/verified clean. A room that is
  // already clean must never keep an RTC badge just because its checkout flag
  // is still true for today.
  const cleanStatusId = Number(meta.previoRoomCleanStatusId ?? 0);
  if (cleanStatusId === 2 || cleanStatusId === 3) return false;

  const manuallyReleased = !!meta.manualReadyToCleanAt;
  const flagged = meta.checkedOutToday === true || meta.readyToClean === true || manuallyReleased;
  if (!flagged) return false;
  const stamp = dateOnly(meta.readyToCleanDate ?? meta.checkedOutAt ?? meta.manualReadyToCleanAt);
  if (!stamp) return false;
  const today = todayBudapest();
  return stamp === today || stamp === new Date().toISOString().split("T")[0];
};
