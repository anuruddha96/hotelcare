/**
 * The Revenue module stores whatever currency the PMS publishes (SLNT's Previo
 * profiles quote HUF, Ottofiori quotes EUR). Everything used to be printed with
 * a hardcoded "€", which turned 33 000 Ft into "€33,000". This module holds the
 * currency of the hotel currently on screen and formats through it.
 */

export interface RevenueCurrencyConfig {
  /** ISO code as published by the PMS, e.g. "HUF" or "EUR". */
  code: string;
  /** How many units of `code` make one euro (e.g. 395 for HUF). */
  eurRate: number | null;
  /** Where the rate came from, shown in the tooltip. */
  eurRateSource: string | null;
}

let current: RevenueCurrencyConfig = { code: "EUR", eurRate: 1, eurRateSource: null };

export function setRevenueCurrency(cfg: Partial<RevenueCurrencyConfig>) {
  current = {
    code: (cfg.code || current.code || "EUR").toUpperCase(),
    eurRate: cfg.eurRate ?? (cfg.code?.toUpperCase() === "EUR" ? 1 : null),
    eurRateSource: cfg.eurRateSource ?? null,
  };
}

export function getRevenueCurrency(): RevenueCurrencyConfig {
  return current;
}

const SYMBOLS: Record<string, string> = { EUR: "€", HUF: "Ft", CZK: "Kč", USD: "$", GBP: "£" };

export function currencySymbol(code = current.code): string {
  return SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

/** Format an amount in the hotel's own currency. */
export function money(value: number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const code = current.code;
  // Forint is never quoted with decimals.
  const d = digits ?? (code === "HUF" ? 0 : 0);
  const n = value.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  return code === "EUR" ? `€${n}` : `${n} ${currencySymbol(code)}`;
}

/** The euro equivalent, or null when we have no trustworthy rate. */
export function toEur(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (current.code === "EUR") return value;
  if (!current.eurRate || current.eurRate <= 0) return null;
  return value / current.eurRate;
}

/** "≈ €84" secondary line, empty string for euro hotels or missing rate. */
export function eurEquivalent(value: number | null | undefined): string {
  if (current.code === "EUR") return "";
  const v = toEur(value);
  if (v === null) return "";
  return `≈ €${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function isForeignCurrency(): boolean {
  return current.code !== "EUR";
}
