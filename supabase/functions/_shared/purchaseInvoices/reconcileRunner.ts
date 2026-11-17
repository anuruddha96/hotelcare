/**
 * Server-side reconciliation orchestration for one organization:
 * load documents + NAV records → pure engine → bulk writers (RPCs).
 * Only NAV data from connections marked use_for_reconciliation is used, so
 * sandbox (test) data never raises production missing-document alerts.
 */
import { reconcile, type ReconCompany, type ReconDocument, type ReconNavInvoice } from "./reconciliation.ts";
import { planGapFill, type GapFillNav } from "./gapFill.ts";
import { taxCore8 } from "./normalize.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped service-role client
type Db = any;

export function budapestToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function fetchAll(query: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const DOC_COLUMNS = [
  "id", "buyer_company_id", "buyer_tax_id", "buyer_name", "merchant_tax_id", "merchant_country", "merchant_name", "merchant_address",
  "merchant_bank_account", "invoice_number", "document_kind", "reference_invoice_number", "currency", "currency_source",
  "total_amount", "net_amount", "total_vat_amount", "invoice_date", "performance_date", "due_date", "payment_method", "status",
  "approval_status", "is_verified", "file_sha256", "created_at", "nav_manual_status", "nav_manual_nav_invoice_id", "nav_manual_reason",
].join(",");

const NAV_COLUMNS = [
  "id", "company_id", "connection_id", "customer_tax_number", "customer_group_member_tax_number", "customer_name", "supplier_tax_number",
  "supplier_tax_number_full", "supplier_name", "supplier_address", "supplier_bank_account", "invoice_number", "invoice_operation",
  "original_invoice_number", "batch_index", "currency", "net_amount", "vat_amount", "gross_amount", "invoice_issue_date",
  "invoice_delivery_date", "payment_date", "payment_method", "transaction_id", "ins_date", "vat_breakdown", "detail_status",
  "manual_status", "manual_reason",
].join(",");

export interface ReconcileRunSummary {
  organizationSlug: string;
  documents: number;
  navInvoices: number;
  summary: Record<string, number>;
  applied: Record<string, unknown>;
  gapFill: Record<string, unknown>;
}

export async function reconcileOrganization(db: Db, organizationSlug: string, options: { today?: string } = {}): Promise<ReconcileRunSummary> {
  const today = options.today ?? budapestToday();
  const { data: settings } = await db.from("pi_module_settings").select("*").eq("organization_slug", organizationSlug).maybeSingle();
  const { data: companyRows, error: companyError } = await db.from("invoice_buyer_companies")
    .select("id, tax_id, is_active").eq("organization_slug", organizationSlug);
  if (companyError) throw new Error(companyError.message);
  const { data: connectionRows } = await db.from("pi_nav_connections")
    .select("id, company_id, environment, sync_from_date, initial_sync_completed_at, ins_date_cursor, use_for_reconciliation")
    .eq("organization_slug", organizationSlug).eq("use_for_reconciliation", true);

  // One reconciliation source per company; production wins over test.
  const sourceByCompany = new Map<string, Record<string, unknown>>();
  for (const c of connectionRows ?? []) {
    const current = sourceByCompany.get(c.company_id);
    if (!current || (current.environment !== "production" && c.environment === "production")) sourceByCompany.set(c.company_id, c);
  }
  const companies: ReconCompany[] = (companyRows ?? []).filter((c: Record<string, unknown>) => c.is_active !== false).map((c: Record<string, unknown>) => {
    const source = sourceByCompany.get(String(c.id));
    const complete = !!source?.initial_sync_completed_at;
    return {
      id: String(c.id),
      taxNumber: (c.tax_id as string) ?? null,
      navCoverageFrom: complete ? (source?.sync_from_date as string) ?? null : null,
      navSyncedThrough: complete ? (source?.ins_date_cursor as string) ?? null : null,
    };
  });
  const companyTax = new Map(companies.map((c) => [c.id, taxCore8(c.taxNumber)]));
  const sourceIds = [...sourceByCompany.values()].map((s) => String(s.id));

  const navRows = sourceIds.length
    ? await fetchAll((from, to) => db.from("pi_nav_invoices").select(NAV_COLUMNS).eq("organization_slug", organizationSlug)
      .in("connection_id", sourceIds).order("id").range(from, to))
    : [];
  const docRows = await fetchAll((from, to) => db.from("purchase_invoices").select(DOC_COLUMNS)
    .eq("organization_slug", organizationSlug).order("id").range(from, to));

  const navInvoices: ReconNavInvoice[] = navRows.map((r) => {
    const company = companyTax.get(String(r.company_id));
    const member = taxCore8(r.customer_group_member_tax_number as string);
    return {
      id: String(r.id),
      companyId: String(r.company_id),
      customerTaxNumber: member && member === company ? member : (r.customer_tax_number as string) ?? null,
      supplierTaxNumber: String(r.supplier_tax_number),
      supplierName: (r.supplier_name as string) ?? null,
      invoiceNumber: String(r.invoice_number),
      operation: String(r.invoice_operation),
      originalInvoiceNumber: (r.original_invoice_number as string) ?? null,
      batchIndex: num(r.batch_index),
      currency: (r.currency as string) ?? null,
      grossAmount: num(r.gross_amount),
      netAmount: num(r.net_amount),
      vatAmount: num(r.vat_amount),
      issueDate: (r.invoice_issue_date as string) ?? null,
      deliveryDate: (r.invoice_delivery_date as string) ?? null,
      transactionId: (r.transaction_id as string) ?? null,
      insDate: String(r.ins_date),
      manual: r.manual_status === "not_expected" ? { status: "not_expected", reason: (r.manual_reason as string) ?? null } : null,
    };
  });
  const documents: ReconDocument[] = docRows.map((r) => ({
    id: String(r.id),
    companyId: (r.buyer_company_id as string) ?? null,
    buyerTaxNumber: (r.buyer_tax_id as string) ?? null,
    supplierTaxNumber: (r.merchant_tax_id as string) ?? null,
    supplierCountry: (r.merchant_country as string) ?? null,
    supplierName: (r.merchant_name as string) ?? null,
    invoiceNumber: (r.invoice_number as string) ?? null,
    documentKind: (r.document_kind as string) ?? "unknown",
    referenceInvoiceNumber: (r.reference_invoice_number as string) ?? null,
    currency: r.currency_source === "default" ? null : (r.currency as string) ?? null,
    grossAmount: num(r.total_amount),
    netAmount: num(r.net_amount),
    vatAmount: num(r.total_vat_amount),
    issueDate: (r.invoice_date as string) ?? null,
    performanceDate: (r.performance_date as string) ?? null,
    status: r.is_verified ? "verified" : String(r.status),
    approvalStatus: (r.approval_status as string) ?? null,
    isVerified: r.is_verified === true,
    fileSha256: (r.file_sha256 as string) ?? null,
    createdAt: String(r.created_at),
    manual: r.nav_manual_status === "matched" || r.nav_manual_status === "not_expected"
      ? { status: r.nav_manual_status as "matched" | "not_expected", navInvoiceId: (r.nav_manual_nav_invoice_id as string) ?? null, reason: (r.nav_manual_reason as string) ?? null }
      : null,
  }));

  const result = reconcile({
    companies,
    documents,
    navInvoices,
    today,
    settings: {
      amountToleranceHuf: num(settings?.amount_tolerance_huf) ?? 1,
      amountToleranceForeign: num(settings?.amount_tolerance_foreign) ?? 0.01,
      dateToleranceDays: num(settings?.date_tolerance_days) ?? 3,
      reportingDelayDays: num(settings?.reporting_delay_days) ?? 5,
      reconciliationStartDate: (settings?.reconciliation_start_date as string) ?? null,
    },
  });

  const docPayload = result.documents.map((d) => ({
    id: d.documentId, status: d.status, nav_invoice_id: d.navInvoiceId, score: d.score, reason: d.reason,
    explanation: d.explanation, differences: d.differences, duplicate_of: d.duplicateOfDocumentId, company_id: d.companyId,
  }));
  const navPayload = result.navInvoices.map((n) => ({
    id: n.navInvoiceId, status: n.status, document_id: n.documentId, score: n.status === "nav_only" ? 0 : null, reason: n.reason,
    explanation: n.explanation, duplicate_document_ids: n.duplicateDocumentIds,
  }));
  const applied: Record<string, number> = { documents_changed: 0, nav_changed: 0, followups_opened: 0, followups_closed: 0 };
  for (let i = 0; i < Math.max(docPayload.length, navPayload.length); i += 300) {
    const { data, error } = await db.rpc("pi_apply_reconciliation", {
      _organization_slug: organizationSlug, _documents: docPayload.slice(i, i + 300), _nav: navPayload.slice(i, i + 300),
    });
    if (error) throw new Error(`Applying reconciliation failed: ${error.message}`);
    for (const [k, v] of Object.entries(data ?? {})) applied[k] = (applied[k] ?? 0) + Number(v);
  }

  // Gap filling with provenance for matched pairs.
  const matched = result.documents.filter((d) => d.navInvoiceId && ["exact_match", "probable_match", "manual_resolution", "correction_chain"].includes(d.status));
  const vatCounts = new Map<string, number>();
  for (let i = 0; i < matched.length; i += 200) {
    const ids = matched.slice(i, i + 200).map((d) => d.documentId);
    const { data } = await db.from("purchase_invoice_vat_lines").select("invoice_id").in("invoice_id", ids);
    for (const row of data ?? []) vatCounts.set(row.invoice_id, (vatCounts.get(row.invoice_id) ?? 0) + 1);
  }
  const docsById = new Map(docRows.map((r) => [String(r.id), r]));
  const navById = new Map(navRows.map((r) => [String(r.id), r]));
  const autoApply = settings?.auto_apply_gap_fill !== false;
  const items = [];
  for (const outcome of matched) {
    const doc = docsById.get(outcome.documentId);
    const nav = navById.get(String(outcome.navInvoiceId));
    if (!doc || !nav) continue;
    const gapNav: GapFillNav = {
      companyId: String(nav.company_id),
      supplierTaxNumber: String(nav.supplier_tax_number_full ?? nav.supplier_tax_number),
      supplierName: (nav.supplier_name as string) ?? null,
      supplierAddress: (nav.supplier_address as string) ?? null,
      supplierBankAccount: (nav.supplier_bank_account as string) ?? null,
      customerTaxNumber: (nav.customer_tax_number as string) ?? null,
      customerName: (nav.customer_name as string) ?? null,
      invoiceNumber: String(nav.invoice_number),
      issueDate: (nav.invoice_issue_date as string) ?? null,
      deliveryDate: (nav.invoice_delivery_date as string) ?? null,
      paymentDate: (nav.payment_date as string) ?? null,
      paymentMethod: (nav.payment_method as string) ?? null,
      currency: (nav.currency as string) ?? null,
      netAmount: num(nav.net_amount),
      vatAmount: num(nav.vat_amount),
      grossAmount: num(nav.gross_amount),
      vatSummary: nav.detail_status === "detail_fetched" && Array.isArray(nav.vat_breakdown) ? nav.vat_breakdown as GapFillNav["vatSummary"] : null,
    };
    const plan = planGapFill({
      merchant_name: (doc.merchant_name as string) ?? null,
      merchant_tax_id: (doc.merchant_tax_id as string) ?? null,
      merchant_address: (doc.merchant_address as string) ?? null,
      merchant_bank_account: (doc.merchant_bank_account as string) ?? null,
      buyer_name: (doc.buyer_name as string) ?? null,
      buyer_tax_id: (doc.buyer_tax_id as string) ?? null,
      buyer_company_id: (doc.buyer_company_id as string) ?? null,
      invoice_number: (doc.invoice_number as string) ?? null,
      invoice_date: (doc.invoice_date as string) ?? null,
      performance_date: (doc.performance_date as string) ?? null,
      due_date: (doc.due_date as string) ?? null,
      payment_method: (doc.payment_method as string) ?? null,
      currency: (doc.currency as string) ?? null,
      currency_detected: doc.currency_source !== "default",
      net_amount: num(doc.net_amount),
      total_vat_amount: num(doc.total_vat_amount),
      total_amount: num(doc.total_amount),
      vat_line_count: vatCounts.get(outcome.documentId) ?? 0,
    }, gapNav, outcome.status);
    if (!plan.fields.length) continue;
    const fields = autoApply ? plan.fields : plan.fields.map((f) => (f.action === "fill" ? { ...f, action: "propose" as const, finalValue: null } : f));
    items.push({
      invoice_id: outcome.documentId,
      nav_invoice_id: outcome.navInvoiceId,
      fills: autoApply ? plan.fills : {},
      vat_lines: autoApply ? plan.vatLines : null,
      provenance: fields,
    });
  }
  const gapFill: Record<string, number> = { applied: 0, skipped_approved: 0 };
  for (let i = 0; i < items.length; i += 100) {
    const { data, error } = await db.rpc("pi_apply_gap_fill", { _organization_slug: organizationSlug, _items: items.slice(i, i + 100) });
    if (error) throw new Error(`Applying NAV gap fill failed: ${error.message}`);
    for (const [k, v] of Object.entries(data ?? {})) gapFill[k] = (gapFill[k] ?? 0) + Number(v);
  }

  return { organizationSlug, documents: documents.length, navInvoices: navInvoices.length, summary: result.summary, applied, gapFill };
}

export interface SerializedRunResult {
  status: "completed" | "failed" | "busy";
  runs: number;
  result?: ReconcileRunSummary;
  error?: string;
}

/**
 * Serialized entry point: one run per organization at a time. A request that
 * arrives during a run is coalesced into one follow-up run, so uploads in
 * quick succession never produce racing writes.
 */
export async function runReconciliation(db: Db, organizationSlug: string, options: { maxRuns?: number; today?: string } = {}): Promise<SerializedRunResult> {
  const maxRuns = options.maxRuns ?? 3;
  let runs = 0;
  let last: ReconcileRunSummary | undefined;
  while (runs < maxRuns) {
    const token = crypto.randomUUID();
    const { data: claimed, error: claimError } = await db.rpc("pi_claim_reconcile", { _organization_slug: organizationSlug, _lock_token: token, _minutes: 10 });
    if (claimError) return { status: "failed", runs, error: claimError.message };
    if (claimed !== true) return { status: runs ? "completed" : "busy", runs, result: last };
    runs++;
    try {
      last = await reconcileOrganization(db, organizationSlug, { today: options.today });
      const { data: pending } = await db.rpc("pi_release_reconcile", {
        _organization_slug: organizationSlug, _lock_token: token, _status: "completed",
        _summary: { ...last.summary, applied: last.applied, gap_fill: last.gapFill, documents: last.documents, nav_invoices: last.navInvoices },
        _error: null,
      });
      if (pending !== true) break;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await db.rpc("pi_release_reconcile", { _organization_slug: organizationSlug, _lock_token: token, _status: "failed", _summary: {}, _error: message });
      return { status: "failed", runs, error: message };
    }
  }
  return { status: "completed", runs, result: last };
}
