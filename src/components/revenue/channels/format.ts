import { currencySymbol } from "@/lib/revenueCurrency";

export function monthLabel(month: string, locale: string, short = false): string {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString(locale, {
    month: short ? "short" : "long", year: short ? undefined : "numeric", timeZone: "UTC",
  });
}

export function pct(value: number | null | undefined, locale: string, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Axis ticks: €12K / 12K Ft. */
export function compactMoney(value: number, locale: string): string {
  const n = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const symbol = currencySymbol();
  return symbol === "€" ? `€${n}` : `${n} ${symbol}`;
}

export function dayLabel(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
