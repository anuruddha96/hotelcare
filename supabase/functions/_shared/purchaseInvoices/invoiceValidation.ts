/**
 * Deterministic checks applied to AI-extracted invoice data.
 *
 * Extraction is probabilistic; money controls are not. These checks never
 * invent values: a missing VAT rate stays unknown (no fictitious 27 % line),
 * a missing currency is flagged rather than silently assumed, and the printed
 * invoice total is kept separate from the amount due.
 */
import {
  isValidHuTaxCore, KNOWN_CURRENCIES, looksForeignTaxId, moneyTolerance, normalizeCurrency, normalizeDate,
  parseMoney, round2, taxCore8, daysBetweenDates,
} from "./normalize.ts";

export const DOCUMENT_KINDS = [
  "normal_invoice", "receipt", "proforma", "advance_invoice", "final_invoice",
  "corrective_invoice", "credit_note", "cancellation", "unknown",
] as const;
export type DocumentKind = typeof DOCUMENT_KINDS[number];

/** Documents whose amounts reduce an earlier invoice. */
export const REDUCING_KINDS: ReadonlySet<DocumentKind> = new Set(["credit_note", "cancellation"]);

export function normalizeDocumentKind(raw: string | null | undefined, legacyType?: string | null): DocumentKind {
  const value = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((DOCUMENT_KINDS as readonly string[]).includes(value)) return value as DocumentKind;
  const aliases: Record<string, DocumentKind> = {
    invoice: "normal_invoice", szamla: "normal_invoice", "számla": "normal_invoice",
    nyugta: "receipt", receipt: "receipt", proforma: "proforma", dijbekero: "proforma", "díjbekérő": "proforma",
    elolegszamla: "advance_invoice", advance: "advance_invoice", vegszamla: "final_invoice", final: "final_invoice",
    helyesbito: "corrective_invoice", "helyesbítő": "corrective_invoice", modifying: "corrective_invoice",
    storno: "cancellation", "sztornó": "cancellation", sztorno: "cancellation", credit: "credit_note",
    jovairas: "credit_note", "jóváírás": "credit_note",
  };
  if (aliases[value]) return aliases[value];
  const legacy = String(legacyType ?? "").toLowerCase();
  if (legacy === "receipt") return "receipt";
  if (legacy === "invoice") return "normal_invoice";
  return "unknown";
}

export interface ExtractedVatLine {
  vat_kind?: string | null;
  vat_rate?: number | string | null;
  vat_base?: number | string | null;
  vat_amount?: number | string | null;
  country?: string | null;
}

export interface ExtractedInvoiceInput {
  document_kind?: string | null;
  document_type?: string | null;
  currency?: string | null;
  net_amount?: unknown;
  total_vat_amount?: unknown;
  total_amount?: unknown;
  amount_due?: unknown;
  previous_balance?: unknown;
  advance_paid_amount?: unknown;
  discount_amount?: unknown;
  rounding_amount?: unknown;
  vat_lines?: ExtractedVatLine[] | null;
  invoice_date?: string | null;
  performance_date?: string | null;
  due_date?: string | null;
  service_period_start?: string | null;
  service_period_end?: string | null;
  merchant_tax_id?: string | null;
  merchant_country?: string | null;
  buyer_tax_id?: string | null;
}

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface ValidationCheck {
  id: string;
  status: CheckStatus;
  message: string;
  detail?: Record<string, unknown>;
}

export interface NormalizedVatLine {
  vat_kind: string;
  vat_rate: number | null;
  vat_base: number;
  vat_amount: number;
  country: string | null;
  source: "document" | "derived_from_totals";
}

export interface NormalizedInvoice {
  document_kind: DocumentKind;
  currency: string | null;
  currency_detected: boolean;
  net_amount: number | null;
  total_vat_amount: number | null;
  total_amount: number | null;
  amount_due: number | null;
  previous_balance: number | null;
  advance_paid_amount: number | null;
  discount_amount: number | null;
  vat_lines: NormalizedVatLine[];
  invoice_date: string | null;
  performance_date: string | null;
  due_date: string | null;
  service_period_start: string | null;
  service_period_end: string | null;
  merchant_tax_core: string | null;
  merchant_is_foreign: boolean;
  is_credit_note: boolean;
}

export interface ValidationResult {
  status: "ok" | "warning" | "error";
  needsReview: boolean;
  checks: ValidationCheck[];
  normalized: NormalizedInvoice;
}

const STANDARD_RATES = [27, 18, 5, 0];

export function vatKindForRate(rate: number | null): string {
  if (rate === 27) return "standard_27";
  if (rate === 18) return "reduced_18";
  if (rate === 5) return "reduced_5";
  if (rate === 0) return "zero";
  return "other_rate";
}

const RATE_FOR_KIND: Record<string, number> = { standard_27: 27, reduced_18: 18, reduced_5: 5, zero: 0 };

function signed(value: number | null, negative: boolean): number | null {
  if (value == null) return null;
  return negative && value > 0 ? -value : value;
}

export function validateExtractedInvoice(input: ExtractedInvoiceInput, options: { today?: string; tolerance?: { huf?: number; foreign?: number } } = {}): ValidationResult {
  const checks: ValidationCheck[] = [];
  const add = (id: string, status: CheckStatus, message: string, detail?: Record<string, unknown>) =>
    checks.push({ id, status, message, ...(detail ? { detail } : {}) });

  const kind = normalizeDocumentKind(input.document_kind, input.document_type);
  const currencyRaw = normalizeCurrency(input.currency);
  const currencyDetected = !!currencyRaw && KNOWN_CURRENCIES.has(currencyRaw);
  if (!currencyRaw) add("currency", "warn", "Currency was not detected on the document; confirm it before approval.");
  else if (!KNOWN_CURRENCIES.has(currencyRaw)) add("currency", "warn", `Unrecognised currency code ${currencyRaw}.`, { currency: currencyRaw });
  else add("currency", "pass", `Currency ${currencyRaw}.`);
  const currency = currencyRaw;
  const tol = moneyTolerance(currency, options.tolerance);

  let net = parseMoney(input.net_amount);
  let vat = parseMoney(input.total_vat_amount);
  let gross = parseMoney(input.total_amount);
  let due = parseMoney(input.amount_due);
  const previous = parseMoney(input.previous_balance);
  const advance = parseMoney(input.advance_paid_amount);
  const discount = parseMoney(input.discount_amount);
  const rounding = parseMoney(input.rounding_amount);

  // Credit notes / cancellations carry negative values in HotelCare's ledger.
  const reducing = REDUCING_KINDS.has(kind);
  const anyNegative = [net, vat, gross].some((v) => v != null && v < 0);
  const anyPositive = [net, vat, gross].some((v) => v != null && v > 0);
  if (reducing && anyNegative && anyPositive) {
    add("credit_sign", "fail", "Credit note amounts have inconsistent signs (some positive, some negative).", { net, vat, gross });
  } else if (reducing && anyPositive && !anyNegative) {
    net = signed(net, true); vat = signed(vat, true); gross = signed(gross, true); due = signed(due, true);
    add("credit_sign", "pass", "Credit note amounts were normalized to negative values.");
  } else if (!reducing && kind !== "corrective_invoice" && anyNegative) {
    add("credit_sign", "warn", "Negative amounts on a document that is not marked as a credit note or cancellation.", { kind });
  }
  const isCredit = reducing || (kind === "corrective_invoice" && (gross ?? 0) < 0);

  // VAT breakdown — never invented.
  const vatLines: NormalizedVatLine[] = [];
  for (const line of input.vat_lines ?? []) {
    const base = parseMoney(line.vat_base);
    const amount = parseMoney(line.vat_amount);
    if (base == null && amount == null) continue;
    let rate = parseMoney(line.vat_rate);
    if (rate != null && rate > 0 && rate < 1) rate = round2(rate * 100); // 0.27 → 27
    const kindValue = String(line.vat_kind ?? "").trim() || (rate != null ? vatKindForRate(rate) : "unknown");
    if (rate == null && RATE_FOR_KIND[kindValue] != null) rate = RATE_FOR_KIND[kindValue];
    vatLines.push({
      vat_kind: kindValue,
      vat_rate: rate,
      vat_base: signed(base ?? 0, isCredit) ?? 0,
      vat_amount: signed(amount ?? 0, isCredit) ?? 0,
      country: line.country ?? null,
      source: "document",
    });
  }

  // Header arithmetic: net + VAT = gross.
  if (net != null && vat != null && gross != null) {
    const delta = round2(net + vat - gross);
    if (Math.abs(delta) <= tol) add("net_vat_gross", "pass", "Net + VAT equals the gross total.");
    else add("net_vat_gross", "fail", "Net + VAT does not equal the gross total.", { net, vat, gross, delta });
  } else if (net != null && gross != null && vat == null) {
    vat = round2(gross - net);
    add("net_vat_gross", "pass", "VAT derived as gross − net from printed totals.", { derived_vat: vat });
  } else if (vat != null && gross != null && net == null) {
    net = round2(gross - vat);
    add("net_vat_gross", "pass", "Net derived as gross − VAT from printed totals.", { derived_net: net });
  } else {
    add("net_vat_gross", "skip", "Not enough printed totals to verify net + VAT = gross.");
  }

  // VAT breakdown consistency with header totals.
  if (vatLines.length) {
    const baseSum = round2(vatLines.reduce((s, l) => s + l.vat_base, 0));
    const vatSum = round2(vatLines.reduce((s, l) => s + l.vat_amount, 0));
    const lineTol = tol * Math.max(1, vatLines.length);
    const baseOk = net == null || Math.abs(baseSum - net) <= lineTol;
    const vatOk = vat == null || Math.abs(vatSum - vat) <= lineTol;
    if (baseOk && vatOk) add("vat_breakdown_totals", "pass", "VAT breakdown matches the invoice totals.");
    else add("vat_breakdown_totals", "fail", "VAT breakdown does not add up to the invoice totals.", { baseSum, vatSum, net, vat });
    const rates = new Set(vatLines.map((l) => l.vat_rate ?? l.vat_kind));
    if (rates.size > 1) add("mixed_vat", "pass", `Mixed VAT rates on one invoice (${[...rates].join(", ")}).`);
    for (const line of vatLines) {
      if (line.vat_rate != null && line.vat_rate > 0 && line.vat_base !== 0) {
        const expected = round2((line.vat_base * line.vat_rate) / 100);
        const allowed = Math.max(tol, Math.abs(expected) * 0.002);
        if (Math.abs(expected - line.vat_amount) > allowed) {
          add("vat_line_rate", "warn", `VAT amount for the ${line.vat_rate}% line differs from base × rate.`, { base: line.vat_base, vat: line.vat_amount, expected });
        }
      }
      if (["aam_exempt", "kba_reverse", "eu_intra", "export", "zero", "exempt", "out_of_scope"].includes(line.vat_kind) && Math.abs(line.vat_amount) > tol) {
        add("vat_line_exempt", "fail", `A ${line.vat_kind} line must not carry VAT.`, { vat: line.vat_amount });
      }
    }
  } else if (net != null && vat != null && net !== 0) {
    // Derive a breakdown only when printed totals pin down a standard rate.
    const effective = round2((vat / net) * 100);
    const rate = STANDARD_RATES.find((r) => Math.abs(effective - r) <= 0.3);
    if (rate != null && (rate > 0 || Math.abs(vat) <= tol)) {
      vatLines.push({ vat_kind: vatKindForRate(rate), vat_rate: rate, vat_base: net, vat_amount: vat, country: null, source: "derived_from_totals" });
      add("vat_breakdown_totals", "pass", `Single ${rate}% VAT rate derived from printed net and VAT totals.`, { effective_rate: effective });
    } else {
      add("vat_breakdown_totals", "warn", "VAT rate could not be determined (mixed or non-standard rates); no breakdown was invented.", { effective_rate: effective });
    }
  } else {
    add("vat_breakdown_totals", "warn", "No VAT breakdown on the document; the VAT rate is unknown and was not assumed.");
  }

  // Printed total vs amount due (previous balances, advances, discounts).
  if (due != null && gross != null && Math.abs(due - gross) > tol) {
    const explained = round2(gross + (previous ?? 0) - (advance ?? 0) - (discount ?? 0) + (rounding ?? 0));
    if ((previous != null || advance != null || discount != null || rounding != null) && Math.abs(explained - due) <= tol) {
      add("amount_due", "pass", "Amount due differs from the invoice total, explained by previous balance/advance/discount/rounding.", { gross, due, previous, advance, discount, rounding });
    } else {
      add("amount_due", "warn", "Amount due differs from the invoice total; the invoice total is kept as the accounting value.", { gross, due });
    }
  } else if (due != null && gross != null) {
    add("amount_due", "pass", "Amount due equals the invoice total.");
  }

  if (gross === 0) add("zero_total", "warn", "The invoice total is zero.");
  if (gross == null && kind !== "proforma") add("gross_missing", "fail", "The invoice total could not be read.");

  // Dates.
  const issue = normalizeDate(input.invoice_date ?? null);
  const performance = normalizeDate(input.performance_date ?? null);
  const dueDate = normalizeDate(input.due_date ?? null);
  const periodStart = normalizeDate(input.service_period_start ?? null);
  const periodEnd = normalizeDate(input.service_period_end ?? null);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (!issue) add("issue_date", input.invoice_date ? "fail" : "warn", input.invoice_date ? "The issue date is not a valid date." : "The issue date could not be read.");
  else if (daysBetweenDates(today, issue) > 1) add("issue_date", "fail", "The issue date is in the future.", { issue, today });
  else if (daysBetweenDates(issue, today) > 3650) add("issue_date", "warn", "The issue date is more than ten years old.", { issue });
  else add("issue_date", "pass", "Issue date is plausible.");
  if (issue && dueDate && dueDate < issue) add("due_date", "warn", "The payment deadline is before the issue date.", { issue, due: dueDate });
  if (issue && performance && Math.abs(daysBetweenDates(issue, performance)) > 400) {
    add("performance_date", "warn", "Performance date is more than a year away from the issue date.", { issue, performance });
  }
  if (periodStart && periodEnd && periodEnd < periodStart) add("service_period", "fail", "Service period ends before it starts.", { periodStart, periodEnd });

  // Supplier identity.
  const merchantCore = taxCore8(input.merchant_tax_id ?? null);
  const foreign = (!merchantCore && looksForeignTaxId(input.merchant_tax_id)) ||
    (!!input.merchant_country && input.merchant_country.toUpperCase() !== "HU" && !merchantCore);
  if (merchantCore && !isValidHuTaxCore(merchantCore)) {
    add("supplier_tax_checksum", "warn", "The supplier tax number fails the Hungarian check digit; it may be misread.", { core: merchantCore });
  } else if (merchantCore) {
    add("supplier_tax_checksum", "pass", "Supplier tax number check digit is valid.");
  }
  const buyerCore = taxCore8(input.buyer_tax_id ?? null);
  if (buyerCore && !isValidHuTaxCore(buyerCore)) {
    add("buyer_tax_checksum", "warn", "The buyer tax number fails the Hungarian check digit; it may be misread.", { core: buyerCore });
  }

  const failed = checks.some((c) => c.status === "fail");
  const warned = checks.some((c) => c.status === "warn");
  return {
    status: failed ? "error" : warned ? "warning" : "ok",
    needsReview: failed || warned || !currencyDetected,
    checks,
    normalized: {
      document_kind: kind,
      currency,
      currency_detected: currencyDetected,
      net_amount: net,
      total_vat_amount: vat,
      total_amount: gross,
      amount_due: due,
      previous_balance: previous,
      advance_paid_amount: advance,
      discount_amount: discount,
      vat_lines: vatLines,
      invoice_date: issue,
      performance_date: performance,
      due_date: dueDate,
      service_period_start: periodStart,
      service_period_end: periodEnd,
      merchant_tax_core: merchantCore,
      merchant_is_foreign: foreign,
      is_credit_note: isCredit,
    },
  };
}

/** Pick the checks that need a focused second AI pass (material uncertainty). */
export function needsSecondPass(result: ValidationResult, amountConfidence: number | null): boolean {
  const material = new Set(["net_vat_gross", "vat_breakdown_totals", "gross_missing", "credit_sign"]);
  if (result.checks.some((c) => c.status === "fail" && material.has(c.id))) return true;
  return amountConfidence != null && amountConfidence < 0.7;
}
