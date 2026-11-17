/**
 * Deterministic, explainable NAV ↔ document reconciliation.
 *
 * Matching hierarchy (each step is recorded in the explanation trace):
 *   1. Buyer legal-company tax number (hard scope — never crosses companies)
 *   2. Supplier tax number
 *   3. Normalized supplier invoice number
 *   4. Invoice type and correction references
 *   5. Currency and gross amount
 *   6. Net amount and VAT
 *   7. Issue / performance dates
 *   8. Supplier name similarity (supporting evidence only)
 *
 * Two records are NEVER matched on supplier name + amount alone: an
 * identifier (supplier tax number or invoice number) is always required.
 * The engine is a pure function: same input → same output.
 */
import {
  addDays, companyNameSimilarity, daysBetweenDates, invoiceNumberLoose, invoiceNumberStrict, levenshtein,
  moneyTolerance, normalizeDate, round2, taxCore8,
} from "./normalize.ts";
import type { DocumentKind } from "./invoiceValidation.ts";

export type ReconStatus =
  | "exact_match"
  | "probable_match"
  | "nav_only"
  | "document_only"
  | "data_mismatch"
  | "duplicate_document"
  | "competing_nav_candidates"
  | "correction_chain"
  | "nav_sync_pending"
  | "not_expected"
  | "manual_resolution";

/** Statuses that must block approval until controlling resolves them. */
export const BLOCKING_RECON_STATUSES: ReadonlySet<string> = new Set([
  "data_mismatch", "duplicate_document", "competing_nav_candidates", "correction_chain",
]);

export interface ReconCompany {
  id: string;
  taxNumber: string | null;
  /** First issue date from which NAV data is complete for this company. */
  navCoverageFrom: string | null;
  /** insDate cursor (UTC ISO) of the last fully successful NAV sync. */
  navSyncedThrough: string | null;
}

export interface ReconDocument {
  id: string;
  companyId: string | null;
  buyerTaxNumber: string | null;
  supplierTaxNumber: string | null;
  supplierCountry: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  documentKind: DocumentKind | string | null;
  referenceInvoiceNumber?: string | null;
  currency: string | null;
  grossAmount: number | null;
  netAmount: number | null;
  vatAmount: number | null;
  issueDate: string | null;
  performanceDate?: string | null;
  /** Processing status: only processed/verified documents participate. */
  status: string;
  approvalStatus?: string | null;
  isVerified?: boolean;
  fileSha256?: string | null;
  createdAt: string;
  manual?: { status: "matched" | "not_expected" | "unmatched"; navInvoiceId?: string | null; reason?: string | null } | null;
}

export interface ReconNavInvoice {
  id: string;
  companyId: string;
  customerTaxNumber: string | null;
  supplierTaxNumber: string;
  supplierName: string | null;
  invoiceNumber: string;
  operation: "CREATE" | "MODIFY" | "STORNO" | string;
  originalInvoiceNumber: string | null;
  batchIndex?: number | null;
  currency: string | null;
  grossAmount: number | null;
  netAmount: number | null;
  vatAmount: number | null;
  issueDate: string | null;
  deliveryDate?: string | null;
  transactionId: string | null;
  insDate: string;
  manual?: { status: "not_expected"; reason?: string | null } | null;
}

export interface ReconSettings {
  amountToleranceHuf: number;
  amountToleranceForeign: number;
  dateToleranceDays: number;
  /** Days to wait after the issue date before concluding NAV has no record. */
  reportingDelayDays: number;
  /**
   * Go-live cut-off: unmatched NAV invoices issued before this date are not
   * expected to have an uploaded document (they pre-date HotelCare), so they
   * never raise missing-document follow-ups. Matching still runs for them.
   */
  reconciliationStartDate?: string | null;
}

export const DEFAULT_RECON_SETTINGS: ReconSettings = {
  amountToleranceHuf: 1,
  amountToleranceForeign: 0.01,
  dateToleranceDays: 3,
  reportingDelayDays: 5,
  reconciliationStartDate: null,
};

export interface RuleStep {
  rule: string;
  result: "pass" | "fail" | "info" | "skip";
  detail: string;
}

export interface FieldDifference {
  field: string;
  document: string | number | null;
  nav: string | number | null;
  delta?: number | null;
  material: boolean;
}

export interface DocumentOutcome {
  documentId: string;
  companyId: string | null;
  status: ReconStatus | "not_checked";
  navInvoiceId: string | null;
  duplicateOfDocumentId: string | null;
  candidateNavIds: string[];
  score: number;
  explanation: RuleStep[];
  differences: FieldDifference[];
  reason: string | null;
}

export interface NavOutcome {
  navInvoiceId: string;
  companyId: string;
  status: ReconStatus;
  documentId: string | null;
  duplicateDocumentIds: string[];
  daysOutstanding: number | null;
  explanation: RuleStep[];
  reason: string | null;
}

export interface ReconInput {
  companies: ReconCompany[];
  documents: ReconDocument[];
  navInvoices: ReconNavInvoice[];
  settings?: Partial<ReconSettings>;
  today: string;
}

export interface ReconOutput {
  documents: DocumentOutcome[];
  navInvoices: NavOutcome[];
  summary: Record<string, number>;
}

const PARTICIPATING_STATUSES = new Set(["processed", "verified"]);
const NOT_EXPECTED_KINDS = new Set(["receipt", "proforma"]);

interface Comparison {
  grade: "exact" | "probable" | "mismatch";
  steps: RuleStep[];
  differences: FieldDifference[];
}

function fmtMoney(value: number | null, currency: string | null): string {
  if (value == null) return "—";
  return `${(currency ?? "").toUpperCase()} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
}

/** Compare amounts with sign normalization for credit documents. */
function amountsEqual(docValue: number, navValue: number, tolerance: number, allowSignFlip: boolean): { equal: boolean; signFlipped: boolean } {
  if (Math.abs(docValue - navValue) <= tolerance) return { equal: true, signFlipped: false };
  if (allowSignFlip && Math.abs(Math.abs(docValue) - Math.abs(navValue)) <= tolerance) return { equal: true, signFlipped: true };
  return { equal: false, signFlipped: false };
}

function compare(doc: ReconDocument, nav: ReconNavInvoice, settings: ReconSettings): Comparison {
  const steps: RuleStep[] = [];
  const differences: FieldDifference[] = [];
  let mismatch = false;
  let uncertain = false;
  const creditLike = ["credit_note", "cancellation", "corrective_invoice"].includes(String(doc.documentKind)) ||
    nav.operation === "STORNO" || nav.operation === "MODIFY";

  // Step 4: invoice type / correction references
  const docIsCorrection = ["credit_note", "cancellation", "corrective_invoice"].includes(String(doc.documentKind));
  const navIsCorrection = nav.operation === "STORNO" || nav.operation === "MODIFY";
  if (docIsCorrection === navIsCorrection) {
    steps.push({ rule: "invoice_type", result: "pass", detail: `Document ${doc.documentKind ?? "unknown"} ↔ NAV ${nav.operation}` });
  } else if (doc.documentKind === "unknown" || doc.documentKind == null) {
    steps.push({ rule: "invoice_type", result: "info", detail: `Document type unknown; NAV operation ${nav.operation}` });
  } else {
    steps.push({ rule: "invoice_type", result: "fail", detail: `Document ${doc.documentKind} but NAV reports ${nav.operation}` });
    differences.push({ field: "document_kind", document: String(doc.documentKind), nav: nav.operation, material: true });
    uncertain = true;
  }
  if (docIsCorrection && navIsCorrection && doc.referenceInvoiceNumber && nav.originalInvoiceNumber) {
    const same = invoiceNumberLoose(doc.referenceInvoiceNumber) === invoiceNumberLoose(nav.originalInvoiceNumber);
    steps.push({ rule: "correction_reference", result: same ? "pass" : "fail", detail: `Refers to ${doc.referenceInvoiceNumber} ↔ NAV ${nav.originalInvoiceNumber}` });
    if (!same) {
      differences.push({ field: "reference_invoice_number", document: doc.referenceInvoiceNumber, nav: nav.originalInvoiceNumber, material: true });
      uncertain = true;
    }
  }

  // Step 5: currency + gross
  const docCurrency = doc.currency ? doc.currency.toUpperCase() : null;
  const navCurrency = nav.currency ? nav.currency.toUpperCase() : null;
  const tolerance = moneyTolerance(navCurrency ?? docCurrency, { huf: settings.amountToleranceHuf, foreign: settings.amountToleranceForeign });
  if (docCurrency && navCurrency && docCurrency !== navCurrency) {
    steps.push({ rule: "currency", result: "fail", detail: `${docCurrency} vs NAV ${navCurrency}` });
    differences.push({ field: "currency", document: docCurrency, nav: navCurrency, material: true });
    mismatch = true;
  } else if (!docCurrency) {
    steps.push({ rule: "currency", result: "info", detail: `Document currency not detected; NAV ${navCurrency ?? "—"}` });
    uncertain = true;
  } else {
    steps.push({ rule: "currency", result: "pass", detail: docCurrency });
  }

  if (doc.grossAmount != null && nav.grossAmount != null) {
    const eq = amountsEqual(doc.grossAmount, nav.grossAmount, tolerance, creditLike);
    if (eq.equal) {
      steps.push({ rule: "gross_amount", result: "pass", detail: `${fmtMoney(doc.grossAmount, docCurrency ?? navCurrency)}${eq.signFlipped ? " (credit sign normalized)" : ""}` });
    } else {
      const delta = round2(doc.grossAmount - nav.grossAmount);
      steps.push({ rule: "gross_amount", result: "fail", detail: `${fmtMoney(doc.grossAmount, docCurrency)} vs NAV ${fmtMoney(nav.grossAmount, navCurrency)} (Δ ${delta})` });
      differences.push({ field: "total_amount", document: doc.grossAmount, nav: nav.grossAmount, delta, material: true });
      mismatch = true;
    }
  } else {
    steps.push({ rule: "gross_amount", result: "skip", detail: "Gross total missing on one side" });
    uncertain = true;
  }

  // Step 6: net + VAT
  for (const [field, docValue, navValue] of [
    ["net_amount", doc.netAmount, nav.netAmount],
    ["total_vat_amount", doc.vatAmount, nav.vatAmount],
  ] as const) {
    if (docValue == null || navValue == null) continue;
    const eq = amountsEqual(docValue, navValue, tolerance, creditLike);
    if (!eq.equal) {
      const delta = round2(docValue - navValue);
      steps.push({ rule: field, result: "fail", detail: `${fmtMoney(docValue, docCurrency)} vs NAV ${fmtMoney(navValue, navCurrency)} (Δ ${delta})` });
      differences.push({ field, document: docValue, nav: navValue, delta, material: true });
      mismatch = true;
    } else {
      steps.push({ rule: field, result: "pass", detail: fmtMoney(docValue, docCurrency ?? navCurrency) });
    }
  }

  // Step 7: dates (supporting; a far-off date downgrades to probable)
  if (doc.issueDate && nav.issueDate) {
    const days = Math.abs(daysBetweenDates(doc.issueDate, nav.issueDate));
    if (days === 0) steps.push({ rule: "issue_date", result: "pass", detail: doc.issueDate });
    else {
      const within = days <= settings.dateToleranceDays;
      steps.push({ rule: "issue_date", result: within ? "info" : "fail", detail: `${doc.issueDate} vs NAV ${nav.issueDate} (${days} days)` });
      differences.push({ field: "invoice_date", document: doc.issueDate, nav: nav.issueDate, material: !within });
      if (!within) uncertain = true;
    }
  } else {
    steps.push({ rule: "issue_date", result: "skip", detail: "Issue date missing on one side" });
  }
  if (doc.performanceDate && nav.deliveryDate && doc.performanceDate !== nav.deliveryDate) {
    differences.push({ field: "performance_date", document: doc.performanceDate, nav: nav.deliveryDate, material: false });
    steps.push({ rule: "performance_date", result: "info", detail: `${doc.performanceDate} vs NAV ${nav.deliveryDate}` });
  }

  // Step 8: supplier name similarity — supporting evidence only
  const similarity = companyNameSimilarity(doc.supplierName, nav.supplierName);
  steps.push({ rule: "supplier_name", result: "info", detail: `Name similarity ${similarity.toFixed(2)} (supporting evidence only)` });

  return { grade: mismatch ? "mismatch" : uncertain ? "probable" : "exact", steps, differences };
}

function docPriority(doc: ReconDocument, grade?: Comparison["grade"]): number[] {
  const gradeRank = grade === "exact" ? 0 : grade === "probable" ? 1 : grade === "mismatch" ? 2 : 3;
  return [
    gradeRank,
    doc.approvalStatus === "approved" ? 0 : 1,
    doc.isVerified || doc.status === "verified" ? 0 : 1,
    Date.parse(doc.createdAt) || 0,
  ];
}

function compareTuples(a: Array<number | string>, b: Array<number | string>): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function coverageConfirmed(company: ReconCompany | undefined, issueDate: string | null, settings: ReconSettings): { confirmed: boolean; reason: string } {
  if (!company?.navCoverageFrom || !company.navSyncedThrough) return { confirmed: false, reason: "NAV synchronization has not completed for this company" };
  if (!issueDate) return { confirmed: false, reason: "Issue date unknown, NAV completeness cannot be evaluated" };
  if (issueDate < company.navCoverageFrom) return { confirmed: false, reason: `NAV history is only synchronized from ${company.navCoverageFrom}` };
  const deadline = addDays(issueDate, settings.reportingDelayDays);
  const syncedDate = company.navSyncedThrough.slice(0, 10);
  if (syncedDate <= deadline) return { confirmed: false, reason: `Waiting for the ${settings.reportingDelayDays}-day NAV reporting window (until ${deadline})` };
  return { confirmed: true, reason: `NAV synchronized through ${syncedDate}, after the reporting window` };
}

export function reconcile(input: ReconInput): ReconOutput {
  const settings: ReconSettings = { ...DEFAULT_RECON_SETTINGS, ...(input.settings ?? {}) };
  const companies = new Map(input.companies.map((c) => [c.id, { ...c, taxNumber: taxCore8(c.taxNumber) }]));
  const companyByTax = new Map<string, string>();
  for (const c of companies.values()) if (c.taxNumber) companyByTax.set(c.taxNumber, c.id);

  const docs = [...input.documents].sort((a, b) => compareTuples([a.createdAt, a.id], [b.createdAt, b.id]));
  const navs = [...input.navInvoices].sort((a, b) => compareTuples([a.insDate, a.id], [b.insDate, b.id]));

  const docOut = new Map<string, DocumentOutcome>();
  const navOut = new Map<string, NavOutcome>();
  const navTaken = new Set<string>();
  /** NAV record id → document id that claimed it (manual or strong match). */
  const navTakenBy = new Map<string, string>();
  const navById = new Map(navs.map((n) => [n.id, n]));

  const outcome = (doc: ReconDocument, companyId: string | null, patch: Partial<DocumentOutcome>): DocumentOutcome => {
    const result: DocumentOutcome = {
      documentId: doc.id, companyId, status: "not_checked", navInvoiceId: null, duplicateOfDocumentId: null,
      candidateNavIds: [], score: 0, explanation: [], differences: [], reason: null, ...patch,
    };
    docOut.set(doc.id, result);
    return result;
  };

  // ---- Step 1: buyer legal-company scope ----------------------------------
  const scoped: Array<{ doc: ReconDocument; companyId: string | null; steps: RuleStep[] }> = [];
  for (const doc of docs) {
    if (!PARTICIPATING_STATUSES.has(doc.status)) continue; // OCR not finished: no reconciliation yet
    const steps: RuleStep[] = [];
    const buyerTax = taxCore8(doc.buyerTaxNumber);
    const byTax = buyerTax ? companyByTax.get(buyerTax) ?? null : null;
    let companyId: string | null = null;
    if (buyerTax && byTax) {
      companyId = byTax;
      steps.push({ rule: "buyer_company", result: "pass", detail: `Buyer tax ${buyerTax} identifies the legal company` });
      if (doc.companyId && doc.companyId !== byTax) {
        steps.push({ rule: "buyer_company_assignment", result: "fail", detail: "Assigned company differs from the buyer named on the invoice; the invoice's buyer is used" });
      }
    } else if (buyerTax && !byTax) {
      steps.push({ rule: "buyer_company", result: "fail", detail: `Buyer tax ${buyerTax} is not a configured legal company` });
      outcome(doc, null, { status: "not_checked", explanation: steps, reason: "Buyer company has no NAV connection in HotelCare" });
      continue;
    } else if (doc.companyId && companies.has(doc.companyId)) {
      companyId = doc.companyId;
      steps.push({ rule: "buyer_company", result: "info", detail: "Buyer tax not on the document; using the assigned legal company" });
    } else {
      steps.push({ rule: "buyer_company", result: "skip", detail: "Buyer company unknown; only an exact supplier-tax + invoice-number match can identify it" });
    }
    scoped.push({ doc, companyId, steps });
  }

  // ---- Manual decisions are authoritative ---------------------------------
  const remaining: typeof scoped = [];
  for (const entry of scoped) {
    const manual = entry.doc.manual;
    if (manual?.status === "not_expected") {
      outcome(entry.doc, entry.companyId, { status: "not_expected", explanation: [...entry.steps, { rule: "manual", result: "info", detail: manual.reason ?? "Marked as not expected in NAV" }], reason: manual.reason ?? "Manually marked as not expected in NAV", score: 1 });
      continue;
    }
    if (manual?.status === "matched" && manual.navInvoiceId && navById.has(manual.navInvoiceId)) {
      const nav = navById.get(manual.navInvoiceId)!;
      navTaken.add(nav.id);
      navTakenBy.set(nav.id, entry.doc.id);
      outcome(entry.doc, nav.companyId, { status: "manual_resolution", navInvoiceId: nav.id, score: 1, explanation: [...entry.steps, { rule: "manual", result: "pass", detail: manual.reason ?? "Matched manually by controlling" }], reason: manual.reason ?? null });
      continue;
    }
    remaining.push(entry);
  }
  for (const nav of navs) {
    if (nav.manual?.status === "not_expected") {
      navTaken.add(nav.id);
      navOut.set(nav.id, { navInvoiceId: nav.id, companyId: nav.companyId, status: "not_expected", documentId: null, duplicateDocumentIds: [], daysOutstanding: null, explanation: [{ rule: "manual", result: "info", detail: nav.manual.reason ?? "Marked as not expected" }], reason: nav.manual.reason ?? "Manually excluded" });
    }
  }

  // ---- Exclusions: receipts, pro formas, foreign suppliers ----------------
  const eligible: typeof scoped = [];
  for (const entry of remaining) {
    const { doc } = entry;
    const supplierCore = taxCore8(doc.supplierTaxNumber);
    const kind = String(doc.documentKind ?? "unknown");
    if (NOT_EXPECTED_KINDS.has(kind)) {
      outcome(doc, entry.companyId, { status: "not_expected", score: 1, explanation: [...entry.steps, { rule: "document_type", result: "info", detail: `${kind === "receipt" ? "Receipts (nyugta)" : "Pro forma documents"} are not reported to NAV Online Számla` }], reason: kind === "receipt" ? "receipt_not_reported" : "proforma_not_invoice" });
      continue;
    }
    const foreignCountry = doc.supplierCountry && doc.supplierCountry.toUpperCase() !== "HU";
    if (!supplierCore && (foreignCountry || /^[A-Z]{2}/i.test(String(doc.supplierTaxNumber ?? "").trim()) && !/^HU/i.test(String(doc.supplierTaxNumber ?? "").trim()))) {
      outcome(doc, entry.companyId, { status: "not_expected", score: 1, explanation: [...entry.steps, { rule: "supplier_tax", result: "info", detail: "Foreign supplier without a Hungarian tax number; not reported to NAV Online Számla" }], reason: "foreign_supplier" });
      continue;
    }
    eligible.push(entry);
  }

  // ---- Index NAV invoices per company by strong key -----------------------
  const navByKey = new Map<string, ReconNavInvoice[]>();
  const keyOf = (companyId: string, supplier: string | null, number: string | null) =>
    supplier && number ? `${companyId}|${supplier}|${number}` : null;
  for (const nav of navs) {
    if (navTaken.has(nav.id)) continue;
    const company = companies.get(nav.companyId);
    // NAV records must belong to the company they were fetched for; a record
    // naming another buyer is never matched against this company's documents.
    if (!company || (company.taxNumber && taxCore8(nav.customerTaxNumber) && taxCore8(nav.customerTaxNumber) !== company.taxNumber)) {
      navTaken.add(nav.id);
      navOut.set(nav.id, { navInvoiceId: nav.id, companyId: nav.companyId, status: "not_expected", documentId: null, duplicateDocumentIds: [], daysOutstanding: null, explanation: [{ rule: "buyer_company", result: "fail", detail: "NAV customer tax number does not belong to this legal company" }], reason: "customer_tax_mismatch" });
      continue;
    }
    const key = keyOf(nav.companyId, taxCore8(nav.supplierTaxNumber), invoiceNumberLoose(nav.invoiceNumber));
    if (!key) continue;
    const list = navByKey.get(key) ?? [];
    list.push(nav);
    navByKey.set(key, list);
  }

  // ---- Group documents that describe the same supplier invoice ------------
  const groups = new Map<string, typeof eligible>();
  const singles: typeof eligible = [];
  for (const entry of eligible) {
    const supplier = taxCore8(entry.doc.supplierTaxNumber);
    const number = invoiceNumberLoose(entry.doc.invoiceNumber);
    const groupKey = supplier && number ? `${entry.companyId ?? "?"}|${supplier}|${number}` : entry.doc.fileSha256 ? `sha:${entry.doc.fileSha256}` : null;
    if (!groupKey) { singles.push(entry); continue; }
    const list = groups.get(groupKey) ?? [];
    list.push(entry);
    groups.set(groupKey, list);
  }
  // Identical files are duplicates even when no invoice number was read.
  const shaSeen = new Map<string, string>();

  const strongMatches: Array<{ entry: typeof eligible[number]; nav: ReconNavInvoice; cmp: Comparison }> = [];
  const pendingFuzzy: typeof eligible = [...singles];

  // Documents naming their buyer are matched before unknown-buyer copies.
  const orderedGroups = [...groups.entries()].sort((a, b) => (a[1][0].companyId ? 0 : 1) - (b[1][0].companyId ? 0 : 1));
  for (const [, members] of orderedGroups) {
    const sample = members[0];
    const supplier = taxCore8(sample.doc.supplierTaxNumber);
    const number = invoiceNumberLoose(sample.doc.invoiceNumber);
    // Unknown-buyer documents look up the supplier invoice across all companies.
    const candidateKeys = sample.companyId
      ? [keyOf(sample.companyId, supplier, number)]
      : [...companies.keys()].map((cid) => keyOf(cid, supplier, number));
    const allCandidates = candidateKeys.flatMap((k) => (k ? navByKey.get(k) ?? [] : []));
    const candidates = allCandidates.filter((n) => !navTaken.has(n.id));

    // The supplier invoice was already claimed by another document → duplicates.
    const claimed = allCandidates.find((n) => navTakenBy.has(n.id));
    if (!candidates.length && claimed) {
      const owner = navTakenBy.get(claimed.id)!;
      members.forEach((entry) => {
        outcome(entry.doc, entry.companyId ?? claimed.companyId, {
          status: "duplicate_document", duplicateOfDocumentId: owner, navInvoiceId: claimed.id,
          explanation: [...entry.steps, { rule: "duplicate", result: "fail", detail: "This supplier invoice is already registered by another document" }],
          reason: "duplicate_upload",
        });
      });
      continue;
    }

    // Same invoice reported more than once to NAV (separate transactions).
    const byOperation = new Map<string, ReconNavInvoice[]>();
    for (const nav of candidates) {
      const k = `${nav.companyId}|${nav.operation}|${nav.batchIndex ?? ""}`;
      byOperation.set(k, [...(byOperation.get(k) ?? []), nav]);
    }
    const competing = [...byOperation.values()].find((list) => list.length > 1) ?? null;
    const distinctCompanies = new Set(candidates.map((c) => c.companyId));

    if (competing || distinctCompanies.size > 1) {
      const ids = (competing ?? candidates).map((n) => n.id);
      ids.forEach((id) => navTaken.add(id));
      const sorted = [...members].sort((a, b) => compareTuples(docPriority(a.doc), docPriority(b.doc)));
      sorted.forEach((entry, idx) => {
        outcome(entry.doc, entry.companyId ?? candidates[0]?.companyId ?? null, {
          status: idx === 0 ? "competing_nav_candidates" : "duplicate_document",
          duplicateOfDocumentId: idx === 0 ? null : sorted[0].doc.id,
          candidateNavIds: ids,
          explanation: [...entry.steps,
            { rule: "supplier_tax", result: "pass", detail: supplier ?? "" },
            { rule: "invoice_number", result: "pass", detail: invoiceNumberStrict(entry.doc.invoiceNumber) ?? "" },
            { rule: "nav_candidates", result: "fail", detail: `${ids.length} competing NAV data reports for the same invoice` }],
          reason: "NAV holds more than one valid report for this invoice; controlling must decide",
        });
      });
      for (const id of ids) {
        const nav = navById.get(id)!;
        navOut.set(id, { navInvoiceId: id, companyId: nav.companyId, status: "competing_nav_candidates", documentId: sorted[0].doc.id, duplicateDocumentIds: sorted.slice(1).map((e) => e.doc.id), daysOutstanding: null, explanation: [{ rule: "nav_candidates", result: "fail", detail: `Same invoice reported ${ids.length} times to NAV` }], reason: "duplicate_nav_report" });
      }
      continue;
    }

    if (candidates.length === 1) {
      const nav = candidates[0];
      const graded = members.map((entry) => ({ entry, cmp: compare(entry.doc, nav, settings) }))
        .sort((a, b) => compareTuples(docPriority(a.entry.doc, a.cmp.grade), docPriority(b.entry.doc, b.cmp.grade)));
      const primary = graded[0];
      navTaken.add(nav.id);
      navTakenBy.set(nav.id, primary.entry.doc.id);
      strongMatches.push({ entry: primary.entry, nav, cmp: primary.cmp });
      graded.slice(1).forEach(({ entry }) => {
        outcome(entry.doc, entry.companyId ?? nav.companyId, {
          status: "duplicate_document", duplicateOfDocumentId: primary.entry.doc.id, navInvoiceId: nav.id,
          explanation: [...entry.steps, { rule: "duplicate", result: "fail", detail: "Another document for the same supplier invoice is already registered" }],
          reason: "duplicate_upload",
        });
      });
      continue;
    }

    // No NAV record yet: still flag duplicate uploads among themselves.
    const sorted = [...members].sort((a, b) => compareTuples(docPriority(a.doc), docPriority(b.doc)));
    pendingFuzzy.push(sorted[0]);
    sorted.slice(1).forEach((entry) => {
      outcome(entry.doc, entry.companyId, {
        status: "duplicate_document", duplicateOfDocumentId: sorted[0].doc.id,
        explanation: [...entry.steps, { rule: "duplicate", result: "fail", detail: "Same supplier tax number and invoice number as another document" }],
        reason: "duplicate_upload",
      });
    });
  }

  // Duplicate files among unmatched singles.
  const fuzzyQueue: typeof eligible = [];
  for (const entry of pendingFuzzy) {
    const sha = entry.doc.fileSha256;
    if (sha && shaSeen.has(sha) && !docOut.has(entry.doc.id)) {
      outcome(entry.doc, entry.companyId, { status: "duplicate_document", duplicateOfDocumentId: shaSeen.get(sha)!, explanation: [...entry.steps, { rule: "duplicate", result: "fail", detail: "Identical file already uploaded" }], reason: "duplicate_file" });
      continue;
    }
    if (sha) shaSeen.set(sha, entry.doc.id);
    fuzzyQueue.push(entry);
  }

  // ---- Strong-key outcomes --------------------------------------------------
  for (const { entry, nav, cmp } of strongMatches) {
    const steps: RuleStep[] = [...entry.steps,
      { rule: "supplier_tax", result: "pass", detail: taxCore8(entry.doc.supplierTaxNumber) ?? "" },
      { rule: "invoice_number", result: "pass", detail: invoiceNumberStrict(entry.doc.invoiceNumber) === invoiceNumberStrict(nav.invoiceNumber) ? (nav.invoiceNumber) : `${entry.doc.invoiceNumber} ≈ ${nav.invoiceNumber} (separators normalized)` },
      ...cmp.steps];
    let status: ReconStatus = cmp.grade === "exact" ? "exact_match" : cmp.grade === "probable" ? "probable_match" : "data_mismatch";
    if (!entry.companyId && status === "exact_match") {
      status = "probable_match";
      steps.push({ rule: "buyer_company", result: "info", detail: "Buyer identified from NAV; confirm the legal company" });
    }
    // Correction chain: the base invoice was cancelled or modified later.
    const chain = navs.filter((n) => n.companyId === nav.companyId && n.operation !== "CREATE" && n.originalInvoiceNumber &&
      taxCore8(n.supplierTaxNumber) === taxCore8(nav.supplierTaxNumber) &&
      invoiceNumberLoose(n.originalInvoiceNumber) === invoiceNumberLoose(nav.invoiceNumber));
    if (nav.operation === "CREATE" && chain.length) {
      const cancelled = chain.some((n) => n.operation === "STORNO");
      steps.push({ rule: "correction_chain", result: cancelled ? "fail" : "info", detail: `${chain.length} later ${cancelled ? "cancellation/" : ""}modification document(s) reference this invoice in NAV` });
      if (cancelled && status === "exact_match") status = "correction_chain";
    }
    const score = status === "exact_match" || status === "correction_chain" ? 1 : status === "probable_match" ? 0.85 : 0.6;
    outcome(entry.doc, nav.companyId, { status, navInvoiceId: nav.id, score, explanation: steps, differences: cmp.differences, reason: status === "data_mismatch" ? "document_and_nav_differ" : null });
  }

  // ---- Fuzzy (still identifier-based) matching ------------------------------
  for (const entry of fuzzyQueue) {
    if (docOut.has(entry.doc.id)) continue;
    const { doc } = entry;
    const supplier = taxCore8(doc.supplierTaxNumber);
    const number = invoiceNumberLoose(doc.invoiceNumber);
    const docCurrency = doc.currency?.toUpperCase() ?? null;
    const pool = navs.filter((n) => !navTaken.has(n.id) && (entry.companyId ? n.companyId === entry.companyId : false));
    const tol = moneyTolerance(docCurrency, { huf: settings.amountToleranceHuf, foreign: settings.amountToleranceForeign });
    const grossMatches = (n: ReconNavInvoice) => doc.grossAmount != null && n.grossAmount != null &&
      amountsEqual(doc.grossAmount, n.grossAmount, tol, n.operation !== "CREATE").equal &&
      (!docCurrency || !n.currency || n.currency.toUpperCase() === docCurrency);

    let candidates: ReconNavInvoice[] = [];
    let ruleDetail = "";
    if (supplier && number) {
      candidates = pool.filter((n) => taxCore8(n.supplierTaxNumber) === supplier && grossMatches(n) &&
        number.length >= 5 && levenshtein(number, invoiceNumberLoose(n.invoiceNumber) ?? "", 1) <= 1);
      ruleDetail = "Invoice number differs by one character (possible OCR misread)";
    } else if (supplier && !number) {
      candidates = pool.filter((n) => taxCore8(n.supplierTaxNumber) === supplier && grossMatches(n) &&
        !!doc.issueDate && !!n.issueDate && Math.abs(daysBetweenDates(doc.issueDate, n.issueDate)) <= settings.dateToleranceDays);
      ruleDetail = "Invoice number not read; matched on supplier tax number, gross amount and issue date";
    } else if (!supplier && number) {
      candidates = pool.filter((n) => invoiceNumberLoose(n.invoiceNumber) === number && grossMatches(n));
      ruleDetail = "Supplier tax number not read; matched on invoice number and gross amount";
    }

    if (candidates.length === 1) {
      const nav = candidates[0];
      navTaken.add(nav.id);
      const cmp = compare(doc, nav, settings);
      const status: ReconStatus = cmp.grade === "mismatch" ? "data_mismatch" : "probable_match";
      outcome(doc, nav.companyId, {
        status, navInvoiceId: nav.id, score: status === "probable_match" ? 0.75 : 0.5,
        explanation: [...entry.steps, { rule: "identifier", result: "info", detail: ruleDetail }, ...cmp.steps],
        differences: cmp.differences, reason: "partial_identifier_match",
      });
      continue;
    }

    // Unmatched: either NAV truly has nothing (after coverage + delay) or we wait.
    const company = entry.companyId ? companies.get(entry.companyId) : undefined;
    const steps = [...entry.steps];
    if (!supplier && !number) steps.push({ rule: "identifier", result: "fail", detail: "Neither supplier tax number nor invoice number was read; name and amount alone are never used to match" });
    if (candidates.length > 1) steps.push({ rule: "identifier", result: "fail", detail: `${candidates.length} NAV invoices fit equally; not matched automatically` });
    if (!company) {
      outcome(doc, null, { status: "nav_sync_pending", explanation: steps, candidateNavIds: candidates.map((c) => c.id), reason: "Buyer company unknown; confirm the legal company to complete the NAV check" });
      continue;
    }
    if (!company.navCoverageFrom && !company.navSyncedThrough) {
      outcome(doc, company.id, { status: "not_checked", explanation: steps, reason: "No completed NAV synchronization for this company" });
      continue;
    }
    const coverage = coverageConfirmed(company, doc.issueDate, settings);
    steps.push({ rule: "nav_coverage", result: coverage.confirmed ? "fail" : "info", detail: coverage.reason });
    outcome(doc, company.id, {
      status: coverage.confirmed ? "document_only" : "nav_sync_pending",
      explanation: steps, candidateNavIds: candidates.map((c) => c.id),
      reason: coverage.confirmed ? "No matching NAV record after the reporting window" : coverage.reason,
    });
  }

  // ---- NAV-side outcomes ---------------------------------------------------
  const duplicatesByNav = new Map<string, string[]>();
  for (const d of docOut.values()) {
    if (d.status === "duplicate_document" && d.navInvoiceId) {
      duplicatesByNav.set(d.navInvoiceId, [...(duplicatesByNav.get(d.navInvoiceId) ?? []), d.documentId]);
    }
  }
  for (const d of docOut.values()) {
    if (!d.navInvoiceId || d.status === "duplicate_document" || d.status === "competing_nav_candidates") continue;
    const nav = navById.get(d.navInvoiceId);
    if (!nav) continue;
    navOut.set(nav.id, {
      navInvoiceId: nav.id, companyId: nav.companyId, status: d.status as ReconStatus, documentId: d.documentId,
      duplicateDocumentIds: duplicatesByNav.get(nav.id) ?? [], daysOutstanding: null,
      explanation: d.explanation.filter((s) => s.rule !== "buyer_company_assignment"), reason: d.reason,
    });
  }
  const startDate = normalizeDate(settings.reconciliationStartDate ?? null);
  for (const nav of navs) {
    if (navOut.has(nav.id)) continue;
    const reference = nav.operation !== "CREATE" && nav.originalInvoiceNumber ? ` (${nav.operation} of ${nav.originalInvoiceNumber})` : "";
    const issued = normalizeDate(nav.issueDate);
    if (startDate && issued && issued < startDate) {
      navOut.set(nav.id, {
        navInvoiceId: nav.id, companyId: nav.companyId, status: "not_expected", documentId: null, duplicateDocumentIds: [],
        daysOutstanding: null,
        explanation: [{ rule: "reconciliation_start", result: "info", detail: `Issued ${issued}, before the reconciliation start date ${startDate}; no uploaded document is expected` }],
        reason: "before_reconciliation_start",
      });
      continue;
    }
    navOut.set(nav.id, {
      navInvoiceId: nav.id, companyId: nav.companyId, status: "nav_only", documentId: null, duplicateDocumentIds: [],
      daysOutstanding: nav.issueDate ? Math.max(0, daysBetweenDates(nav.issueDate, input.today)) : null,
      explanation: [{ rule: "document", result: "fail", detail: `NAV invoice ${nav.invoiceNumber}${reference} has no document in HotelCare` }],
      reason: "document_missing",
    });
  }

  const summary: Record<string, number> = {};
  for (const d of docOut.values()) summary[`document_${d.status}`] = (summary[`document_${d.status}`] ?? 0) + 1;
  for (const n of navOut.values()) summary[`nav_${n.status}`] = (summary[`nav_${n.status}`] ?? 0) + 1;

  return {
    documents: [...docOut.values()].sort((a, b) => a.documentId.localeCompare(b.documentId)),
    navInvoices: [...navOut.values()].sort((a, b) => a.navInvoiceId.localeCompare(b.navInvoiceId)),
    summary,
  };
}
