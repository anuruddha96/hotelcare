/**
 * Deterministic normalization helpers shared by OCR validation, NAV sync and
 * reconciliation. Pure functions only.
 */

/** 8-digit core of a Hungarian tax number ("HU12345678", "12345678-2-42"). */
export function taxCore8(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const huVat = text.match(/^HU\s*(\d{8})$/i);
  if (huVat) return huVat[1];
  // Foreign VAT ids start with a two-letter country code other than HU.
  if (/^[A-Z]{2}/i.test(text) && !/^HU/i.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  return digits.length === 8 || digits.length === 11 ? digits.slice(0, 8) : null;
}

/** Hungarian tax number core check digit (weights 9,7,3,1,9,7,3). */
export function isValidHuTaxCore(core: string | null | undefined): boolean {
  if (!core || !/^\d{8}$/.test(core)) return false;
  const weights = [9, 7, 3, 1, 9, 7, 3];
  const sum = weights.reduce((s, w, i) => s + w * Number(core[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(core[7]);
}

/** True when the identifier looks like a non-Hungarian VAT/tax id. */
export function looksForeignTaxId(raw: string | null | undefined): boolean {
  const text = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{2,14}$/.test(text.replace(/[\s.-]/g, "")) && !text.startsWith("HU");
}

/** Strict invoice-number form: case/whitespace/dash-variant insensitive. */
export function invoiceNumberStrict(raw: string | null | undefined): string | null {
  const text = String(raw ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, "");
  return text || null;
}

/** Loose form: letters and digits only (tolerates OCR separator misreads). */
export function invoiceNumberLoose(raw: string | null | undefined): string | null {
  const strict = invoiceNumberStrict(raw);
  if (!strict) return null;
  const loose = strict.normalize("NFKD").replace(/[^A-Z0-9]/g, "");
  return loose || null;
}

export function levenshtein(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

const LEGAL_FORMS = /\b(kft|zrt|nyrt|bt|kkt|ev|e\.v|rt|kht|nonprofit|ltd|limited|llc|inc|gmbh|ag|sa|srl|sro|s\.r\.o|spa|bv|plc|korlatolt|felelossegu|tarsasag|reszvenytarsasag|betéti|beteti)\b/g;

export function normalizeCompanyName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token Jaccard similarity of two company names (0..1). Supporting evidence only. */
export function companyNameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = new Set(normalizeCompanyName(a).split(" ").filter((t) => t.length > 1));
  const tb = new Set(normalizeCompanyName(b).split(" ").filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / new Set([...ta, ...tb]).size;
}

/**
 * Parse money written in Hungarian or international formats:
 * "1 234 567,89", "1.234.567,89 Ft", "1,234,567.89", "-12 500", "12500.5", "(1 000)".
 * Returns null when the value cannot be interpreted unambiguously.
 */
export function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value).trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  text = text.replace(/\b(HUF|Ft|EUR|USD|GBP|CHF|forint)\b\.?/gi, "").replace(/[\u20ac$\u00a3]/g, "").trim();
  if (text.startsWith("-") || text.startsWith("\u2212")) { negative = true; text = text.slice(1); }
  if (text.endsWith("-")) { negative = true; text = text.slice(0, -1); }
  text = text.replace(/[\s\u00a0\u202f']/g, "");
  if (!/^[0-9.,]+$/.test(text)) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // The right-most separator is the decimal separator.
    normalized = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = text.length - lastComma - 1;
    const commas = (text.match(/,/g) ?? []).length;
    // "12,5" / "1 234,56" → decimal comma; "1,234,567" → thousands separators.
    normalized = commas === 1 && decimals !== 3 ? text.replace(",", ".") : commas > 1 ? text.replace(/,/g, "") : decimals === 3 ? text.replace(",", "") : text.replace(",", ".");
  } else if (lastDot >= 0) {
    const decimals = text.length - lastDot - 1;
    const dots = (text.match(/\./g) ?? []).length;
    normalized = dots > 1 ? text.replace(/\./g, "") : decimals === 3 ? text.replace(".", "") : text;
  } else {
    normalized = text;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Normalize dates printed as 2026.11.17, 2026-11-17, 17.11.2026, 2026. 11. 17. */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = String(raw).trim();
  let m = text.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?$/);
  if (m) return validDate(m[1], m[2], m[3]);
  m = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m) return validDate(m[3], m[2], m[1]);
  return null;
}

function validDate(y: string, mo: string, d: string): string | null {
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function daysBetweenDates(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Currencies HotelCare accepts on purchase invoices (ISO 4217). */
export const KNOWN_CURRENCIES = new Set([
  "HUF", "EUR", "USD", "GBP", "CHF", "CZK", "PLN", "RON", "SEK", "NOK", "DKK", "JPY",
  "CNY", "CAD", "AUD", "HRK", "BGN", "RSD", "UAH", "TRY", "ILS", "AED",
]);

export function normalizeCurrency(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim().toUpperCase();
  if (!text) return null;
  if (text === "FT" || text === "FORINT") return "HUF";
  if (text === "€") return "EUR";
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

export function moneyTolerance(currency: string | null | undefined, settings?: { huf?: number; foreign?: number }): number {
  return (currency ?? "HUF").toUpperCase() === "HUF" ? (settings?.huf ?? 1) : (settings?.foreign ?? 0.01);
}
