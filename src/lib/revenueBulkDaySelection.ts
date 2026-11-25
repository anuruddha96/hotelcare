/**
 * The bulk editor must use one tenant-aware definition of weekend days in
 * both the month and date-range views. Do not use locale-based isWeekend here:
 * RD Hotels Budapest intentionally treats Friday + Saturday as its weekend.
 */
export type RevenueDayPreset = "all" | "weekdays" | "weekends";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const NORMAL_WEEKDAYS = [1, 2, 3, 4, 5];
const NORMAL_WEEKENDS = [0, 6];
const RD_WEEKDAYS = [1, 2, 3, 4];
const RD_WEEKENDS = [5, 6];

export function isRdHotelsRevenueOrganization(organizationSlug?: string | null): boolean {
  return (organizationSlug ?? "").trim().toLowerCase().replace(/[-_]/g, "") === "rdhotels";
}

export function revenueDaysForPreset(
  organizationSlug: string | null | undefined,
  preset: RevenueDayPreset,
): Set<number> {
  if (preset === "all") return new Set(ALL_DAYS);
  const rdHotels = isRdHotelsRevenueOrganization(organizationSlug);
  return new Set(preset === "weekends"
    ? (rdHotels ? RD_WEEKENDS : NORMAL_WEEKENDS)
    : (rdHotels ? RD_WEEKDAYS : NORMAL_WEEKDAYS));
}

export function hasRevenueDayPreset(
  selectedDays: ReadonlySet<number>,
  organizationSlug: string | null | undefined,
  preset: RevenueDayPreset,
): boolean {
  const expected = revenueDaysForPreset(organizationSlug, preset);
  return selectedDays.size === expected.size && [...expected].every((day) => selectedDays.has(day));
}
