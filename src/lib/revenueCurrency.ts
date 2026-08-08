/**
 * The Revenue module stores whatever currency the PMS publishes (SLNT's Previo
 * profiles quote HUF, Ottofiori quotes EUR). Everything used to be printed with
 * a hardcoded "€", which turned 33 000 Ft into "€33,000".
 *
 * This module holds two things:
 *  - the BASE currency: what the stored numbers actually are (from the PMS);
 *  - the DISPLAY currency: what the user wants to read right now.
 *
 * Values are always whole numbers — no decimals anywhere in Revenue.
 */

import { useEffect, useState } from "react";

export interface RevenueCurrencyConfig {
  /** ISO code as published by the PMS, e.g. "HUF" or "EUR". */
  code: string;
  /** How many units of `code` make one euro (e.g. 395 for HUF). */
  eurRate: number | null;
  /** Where the rate came from, shown in the tooltip. */
  eurRateSource: string | null;
  /** What the user reads on screen — base currency, or "EUR" when converted. */
  displayCode: string;
}

let current: RevenueCurrencyConfig = {
  code: "EUR",
  eurRate: 1,
  eurRateSource: null,
  displayCode: "EUR",
};

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const prefKey = (hotelId: string) => `revenue.displayCurrency.${hotelId}`;

export function setRevenueCurrency(cfg: Partial<RevenueCurrencyConfig> & { hotelId?: string }) {
  const code = (cfg.code || current.code || "EUR").toUpperCase();
  const eurRate = cfg.eurRate ?? (code === "EUR" ? 1 : null);
  let displayCode = (cfg.displayCode || code).toUpperCase();

  if (cfg.hotelId && !cfg.displayCode) {
    try {
      const stored = localStorage.getItem(prefKey(cfg.hotelId));
      if (stored) displayCode = stored.toUpperCase();
    } catch { /* private mode */ }
  }
  // Never display euros without a trustworthy rate.
  if (displayCode === "EUR" && code !== "EUR" && (!eurRate || eurRate <= 0)) displayCode = code;
  if (displayCode !== "EUR" && displayCode !== code) displayCode = code;

  current = { code, eurRate, eurRateSource: cfg.eurRateSource ?? null, displayCode };
  notify();
}

/** User flips the Ft / € switch. Persisted per hotel. */
export function setDisplayCurrency(displayCode: string, hotelId?: string | null) {
  const next = displayCode.toUpperCase();
  if (next === "EUR" && current.code !== "EUR" && (!current.eurRate || current.eurRate <= 0)) return;
  current = { ...current, displayCode: next };
  if (hotelId) {
    try { localStorage.setItem(prefKey(hotelId), next); } catch { /* ignore */ }
  }
  notify();
}

export function getRevenueCurrency(): RevenueCurrencyConfig {
  return current;
}

/** Re-render on currency / rate / display changes. */
export function useRevenueCurrency(): RevenueCurrencyConfig {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return current;
}

const SYMBOLS: Record<string, string> = { EUR: "€", HUF: "Ft", CZK: "Kč", USD: "$", GBP: "£" };

export function currencySymbol(code = current.displayCode): string {
  return SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

/** Convert a stored (base-currency) amount into the display currency. */
export function convert(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (current.displayCode === current.code) return value;
  if (current.displayCode === "EUR") {
    if (!current.eurRate || current.eurRate <= 0) return null;
    return value / current.eurRate;
  }
  return value;
}

/**
 * Format a stored amount for the screen: converted if needed, always a whole
 * number with thousands separators. `digits` is accepted for call-site
 * compatibility but ignored — Revenue never shows decimals.
 */
export function money(value: number | null | undefined, _digits?: number): string {
  const v = convert(value);
  if (v === null) return "—";
  const rounded = Math.round(v);
  const n = rounded.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const code = current.displayCode;
  return code === "EUR" ? `€${n}` : `${n} ${currencySymbol(code)}`;
}

/** The euro equivalent of a stored amount, or null without a trustworthy rate. */
export function toEur(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (current.code === "EUR") return value;
  if (!current.eurRate || current.eurRate <= 0) return null;
  return value / current.eurRate;
}

/**
 * Secondary line. Shows the euro equivalent while reading in the local
 * currency, and the local amount while reading in euros.
 */
export function eurEquivalent(value: number | null | undefined): string {
  if (current.code === "EUR") return "";
  if (current.displayCode === "EUR") {
    if (value === null || value === undefined || !Number.isFinite(value)) return "";
    const n = Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
    return `= ${n} ${currencySymbol(current.code)}`;
  }
  const v = toEur(value);
  if (v === null) return "";
  return `≈ €${Math.round(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** True when the PMS quotes something other than euros. */
export function isForeignCurrency(): boolean {
  return current.code !== "EUR";
}

/**
 * Format an amount in the hotel's OWN currency, never converted. Used wherever
 * the number is a price that goes back to the PMS (rate edits, drafts).
 */
export function moneyBase(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const n = Math.round(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return current.code === "EUR" ? `€${n}` : `${n} ${currencySymbol(current.code)}`;
}
