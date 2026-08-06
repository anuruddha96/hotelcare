// Safety-net colour coding for the Rate & pickup calendar.
//
// One place decides what "too cheap", "healthy occupancy" or "strong pickup"
// means, so the grid, the charts and the alert job can never disagree.

export interface RevenueThresholds {
  /** Amber below this nightly rate. */
  rateWarnBelowEur: number;
  /** Red below this nightly rate — treated as a likely human error. */
  rateCriticalBelowEur: number;
  /** Red above this nightly rate — a fat-finger on the high side. */
  rateMaxSaneEur: number;
  occupancyLowPct: number;
  occupancyHighPct: number;
  /** Pickup at or above this counts as "strong". */
  pickupStrongThreshold: number;
}

export const DEFAULT_THRESHOLDS: RevenueThresholds = {
  rateWarnBelowEur: 60,
  rateCriticalBelowEur: 40,
  rateMaxSaneEur: 900,
  occupancyLowPct: 40,
  occupancyHighPct: 85,
  pickupStrongThreshold: 3,
};

export type Severity = "critical" | "warn" | "ok" | "none";

export interface Tone {
  severity: Severity;
  /** Tailwind classes (semantic-safe: state colours, not brand colours). */
  className: string;
  label: string;
}

const NONE: Tone = { severity: "none", className: "text-muted-foreground", label: "no data" };

/** Colour a published nightly rate against the hotel's safety net. */
export function rateTone(price: number | null | undefined, t: RevenueThresholds): Tone {
  if (price === null || price === undefined || !Number.isFinite(price)) return NONE;
  if (price <= 0) {
    return { severity: "critical", className: "bg-destructive/15 text-destructive font-semibold", label: "no price published" };
  }
  if (price < t.rateCriticalBelowEur) {
    return { severity: "critical", className: "bg-destructive/15 text-destructive font-semibold", label: "suspiciously low" };
  }
  if (price > t.rateMaxSaneEur) {
    return { severity: "critical", className: "bg-destructive/15 text-destructive font-semibold", label: "suspiciously high" };
  }
  if (price < t.rateWarnBelowEur) {
    return { severity: "warn", className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100", label: "below target" };
  }
  return { severity: "ok", className: "", label: "healthy" };
}

/** Colour occupancy: low = act now, high = room to push rate. */
export function occupancyTone2(pct: number | null | undefined, t: RevenueThresholds): Tone {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || pct === 0) return NONE;
  if (pct < t.occupancyLowPct) {
    return { severity: "critical", className: "bg-destructive/10 text-destructive", label: "soft demand" };
  }
  if (pct >= t.occupancyHighPct) {
    return { severity: "ok", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100", label: "nearly full" };
  }
  return { severity: "warn", className: "bg-amber-50 text-amber-900 dark:bg-amber-900/25 dark:text-amber-100", label: "building" };
}

/** Colour net pickup: negative = losing rooms, strong = demand spike. */
export function pickupTone(pickup: number | null | undefined, t: RevenueThresholds): Tone {
  if (pickup === null || pickup === undefined) return NONE;
  if (pickup < 0) {
    return { severity: "critical", className: "bg-sky-200 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100", label: "net cancellations" };
  }
  if (pickup === 0) return { severity: "none", className: "text-muted-foreground", label: "no movement" };
  if (pickup >= t.pickupStrongThreshold) {
    return { severity: "ok", className: "bg-emerald-500 text-white dark:bg-emerald-600", label: "strong pickup" };
  }
  return { severity: "warn", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100", label: "light pickup" };
}

/** Room-type name in the user's language, falling back to the PMS name. */
export function localizedRoomTypeName(
  name: string,
  translations: Record<string, string> | null | undefined,
  language: string,
): string {
  const map = translations ?? {};
  return map[language] || map[language.split("-")[0]] || map.en || name;
}
