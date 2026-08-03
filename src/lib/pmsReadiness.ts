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
 * TODAY. The readyToClean / checkedOutToday flags in pms_metadata are sticky,
 * so without this date guard a room that departed on an earlier day keeps
 * showing up as RTC while the current guest is still in-house.
 */
export const isPmsRtcToday = (meta: Record<string, any> | null | undefined): boolean => {
  if (!meta) return false;
  const flagged = meta.checkedOutToday === true || meta.readyToClean === true;
  if (!flagged) return false;
  const stamp = dateOnly(meta.readyToCleanDate ?? meta.checkedOutAt);
  if (!stamp) return false;
  const today = todayBudapest();
  return stamp === today || stamp === new Date().toISOString().split("T")[0];
};
