/**
 * NAV sync engine for one legal company's connection (server-side only).
 *
 *  initial     – historical issue-date windows from sync_from_date (resumable)
 *  incremental – insDate windows from the cursor (60-minute overlap)
 *  backfill    – once a day, re-reads the last N issue days for late reports
 *  details     – budgeted /queryInvoiceData for VAT breakdowns and parties
 *
 * Idempotent: every NAV data report is upserted by (company, environment,
 * source_key). A per-connection lock prevents overlapping runs, failures
 * back off by category, and NAV failures never touch uploaded documents.
 */
import { NavClient, type NavClientEvent } from "./navClient.ts";
import { NavApiError, navSourceKey, type NavDigest, type NavInvoiceDetail } from "./navResponse.ts";
import { NavConfigError, softwareFromEnv, type NavEnvironment } from "./navRequest.ts";
import { decryptNavCredentials } from "./navCredentials.ts";
import { nextRetryDelayMs, planBackfillWindows, planIncrementalWindows, planInitialWindows, type DateWindow } from "./navSyncPlan.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped service-role client
type Db = any;

export interface NavConnectionRow {
  id: string;
  organization_slug: string;
  company_id: string;
  environment: NavEnvironment;
  tax_number: string;
  enabled: boolean;
  sync_from_date: string | null;
  initial_sync_through: string | null;
  initial_sync_completed_at: string | null;
  ins_date_cursor: string | null;
  last_backfill_at: string | null;
  consecutive_failures: number;
}

export interface SyncOptions {
  trigger: "manual" | "schedule" | "initial" | "backfill";
  requestedBy?: string | null;
  /** Epoch ms after which no new NAV call is started (Edge time limit). */
  deadlineMs: number;
  backfillDays?: number;
  detailBudget?: number;
  forceBackfill?: boolean;
  fetchImpl?: typeof fetch;
  getEnv?: (name: string) => string | undefined;
  /** Test hook: replaces the NAV pacing/back-off sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncOutcome {
  connectionId: string;
  status: "completed" | "partial" | "failed" | "skipped";
  runId: string | null;
  digests: number;
  pages: number;
  upserted: number;
  details: number;
  detailsFailed: number;
  error?: { code: string | null; category: string; message: string };
}

const nowIso = () => new Date().toISOString();

function digestRow(conn: NavConnectionRow, d: NavDigest, hotelId: string | null, runId: string) {
  return {
    organization_slug: conn.organization_slug,
    company_id: conn.company_id,
    connection_id: conn.id,
    environment: conn.environment,
    source_key: navSourceKey(d),
    hotel_id: hotelId,
    supplier_tax_number: d.supplierTaxNumber,
    supplier_group_member_tax_number: d.supplierGroupMemberTaxNumber,
    supplier_name: d.supplierName,
    customer_tax_number: d.customerTaxNumber,
    customer_group_member_tax_number: d.customerGroupMemberTaxNumber,
    customer_name: d.customerName,
    invoice_number: d.invoiceNumber,
    invoice_operation: d.invoiceOperation,
    invoice_category: d.invoiceCategory,
    invoice_issue_date: d.invoiceIssueDate,
    invoice_delivery_date: d.invoiceDeliveryDate,
    payment_date: d.paymentDate,
    payment_method: d.paymentMethod,
    invoice_appearance: d.invoiceAppearance,
    nav_source: d.source,
    currency: d.currency,
    net_amount: d.invoiceNetAmount,
    vat_amount: d.invoiceVatAmount,
    gross_amount: d.grossAmount,
    net_amount_huf: d.invoiceNetAmountHUF,
    vat_amount_huf: d.invoiceVatAmountHUF,
    gross_amount_huf: d.grossAmountHUF,
    original_invoice_number: d.originalInvoiceNumber,
    modification_index: d.modificationIndex,
    batch_index: d.batchIndex,
    transaction_id: d.transactionId,
    report_index: d.index,
    ins_date: d.insDate,
    completeness_indicator: d.completenessIndicator,
    raw_digest: d,
    last_seen_at: nowIso(),
    last_sync_run_id: runId,
  };
}

export function detailPatch(detail: NavInvoiceDetail) {
  return {
    supplier_tax_number_full: detail.supplier.taxNumber,
    supplier_address: detail.supplier.address,
    supplier_bank_account: detail.supplier.bankAccountNumber,
    ...(detail.customer?.name ? { customer_name: detail.customer.name } : {}),
    invoice_delivery_date: detail.deliveryDate,
    payment_date: detail.paymentDate,
    payment_method: detail.paymentMethod,
    exchange_rate: detail.exchangeRate,
    ...(detail.grossAmount != null ? { gross_amount: detail.grossAmount } : {}),
    ...(detail.grossAmountHUF != null ? { gross_amount_huf: detail.grossAmountHUF } : {}),
    vat_breakdown: detail.vatSummary,
    line_items: detail.lines.slice(0, 500),
    detail_status: "detail_fetched",
    detail_fetched_at: nowIso(),
    detail_error: null,
  };
}

async function companyHotel(db: Db, companyId: string): Promise<string | null> {
  const { data } = await db.from("invoice_company_properties").select("hotel_id").eq("company_id", companyId);
  const hotels = [...new Set((data ?? []).map((r: { hotel_id: string }) => r.hotel_id))];
  return hotels.length === 1 ? String(hotels[0]) : null;
}

export async function syncConnection(db: Db, conn: NavConnectionRow, options: SyncOptions): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { connectionId: conn.id, status: "skipped", runId: null, digests: 0, pages: 0, upserted: 0, details: 0, detailsFailed: 0 };
  const lockToken = crypto.randomUUID();
  const { data: locked } = await db.rpc("pi_claim_nav_sync", { _connection_id: conn.id, _lock_token: lockToken, _minutes: 15 });
  if (locked !== true) return outcome; // pi_claim_nav_sync also stamps last_attempt_at

  const events: Array<{ level: string; event: string; detail: Record<string, unknown> }> = [];
  const log = (level: "info" | "warn" | "error", event: string, detail: Record<string, unknown> = {}) => {
    if (events.length < 300) events.push({ level, event, detail });
  };
  const startedAt = new Date();
  const timeLeft = () => Date.now() < options.deadlineMs;
  const mode = !conn.initial_sync_completed_at && conn.sync_from_date ? "initial" : "incremental";

  const { data: run, error: runError } = await db.from("pi_nav_sync_runs").insert({
    organization_slug: conn.organization_slug, company_id: conn.company_id, connection_id: conn.id,
    environment: conn.environment, trigger: options.trigger, mode, requested_by: options.requestedBy ?? null,
  }).select("id").single();
  if (runError || !run) {
    await db.rpc("pi_release_nav_sync", { _connection_id: conn.id, _lock_token: lockToken });
    throw new Error("Could not start a NAV sync run");
  }
  outcome.runId = run.id;

  let partial = false;
  try {
    const { data: secret } = await db.from("pi_nav_connection_secrets")
      .select("credential_ciphertext, credential_iv").eq("connection_id", conn.id).maybeSingle();
    if (!secret) throw new NavConfigError("No NAV credentials are stored for this connection");
    const credentials = await decryptNavCredentials(secret, conn.id, db);
    const software = softwareFromEnv(options.getEnv ?? ((k) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k)));
    const client = new NavClient({
      environment: conn.environment,
      auth: { login: credentials.login, password: credentials.password, signingKey: credentials.signingKey, taxNumber: conn.tax_number },
      software,
      fetchImpl: options.fetchImpl,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      onEvent: (e: NavClientEvent) => {
        if (e.outcome !== "ok") log(e.outcome === "retry" ? "warn" : "error", `nav_${e.operation}_${e.outcome}`, { attempt: e.attempt, http: e.httpStatus, code: e.errorCode });
      },
    });
    const hotelId = await companyHotel(db, conn.company_id);

    const pull = async (window: DateWindow, kind: "issueDate" | "insDate") => {
      const { digests, pages } = await client.queryInvoiceDigestAll(kind === "issueDate" ? { issueDate: window } : { insDate: window });
      outcome.digests += digests.length;
      outcome.pages += pages;
      if (digests.length) {
        for (let i = 0; i < digests.length; i += 200) {
          const rows = digests.slice(i, i + 200).map((d) => digestRow(conn, d, hotelId, run.id));
          const { error } = await db.from("pi_nav_invoices").upsert(rows, { onConflict: "company_id,environment,source_key" });
          if (error) throw new Error(`Saving NAV invoices failed: ${error.message}`);
          outcome.upserted += rows.length;
        }
      }
      log("info", "window_synced", { kind, from: window.from, to: window.to, pages, invoices: digests.length });
    };

    if (mode === "initial") {
      // The cursor is pinned at the first initial run so reports that arrive
      // while history is still loading are caught by the incremental pass.
      if (!conn.ins_date_cursor) {
        await db.from("pi_nav_connections").update({ ins_date_cursor: startedAt.toISOString() }).eq("id", conn.id);
      }
      for (const window of planInitialWindows(conn.sync_from_date as string, conn.initial_sync_through, startedAt)) {
        if (!timeLeft()) { partial = true; break; }
        await pull(window, "issueDate");
        await db.from("pi_nav_connections").update({ initial_sync_through: window.to }).eq("id", conn.id);
      }
      if (!partial) {
        await db.from("pi_nav_connections").update({ initial_sync_completed_at: nowIso(), last_backfill_at: nowIso() }).eq("id", conn.id);
        log("info", "initial_sync_completed", { from: conn.sync_from_date });
      }
    } else {
      for (const window of planIncrementalWindows({ cursor: conn.ins_date_cursor, now: startedAt, overlapMinutes: 60 })) {
        if (!timeLeft()) { partial = true; break; }
        await pull(window, "insDate");
        await db.from("pi_nav_connections").update({ ins_date_cursor: window.to }).eq("id", conn.id);
      }
      const backfillDue = options.forceBackfill || !conn.last_backfill_at ||
        Date.now() - Date.parse(conn.last_backfill_at) > 24 * 3_600_000;
      if (!partial && backfillDue) {
        for (const window of planBackfillWindows(startedAt, options.backfillDays ?? 45)) {
          if (!timeLeft()) { partial = true; break; }
          await pull(window, "issueDate");
        }
        if (!partial) await db.from("pi_nav_connections").update({ last_backfill_at: nowIso() }).eq("id", conn.id);
      }
    }

    // Detail enrichment (VAT breakdown, addresses, bank account) within budget.
    const { data: pending } = await db.from("pi_nav_invoices")
      .select("id, invoice_number, supplier_tax_number, batch_index, detail_attempts")
      .eq("connection_id", conn.id).in("detail_status", ["digest_only", "detail_failed"]).lt("detail_attempts", 3)
      .order("ins_date", { ascending: false }).limit(options.detailBudget ?? 40);
    for (const row of pending ?? []) {
      if (!timeLeft()) { partial = true; break; }
      try {
        const result = await client.queryInvoiceData({ invoiceNumber: row.invoice_number, supplierTaxNumber: row.supplier_tax_number, batchIndex: row.batch_index });
        const patch = result ? detailPatch(result.detail) : { detail_status: "detail_unavailable", detail_fetched_at: nowIso(), detail_error: null };
        await db.from("pi_nav_invoices").update({ ...patch, detail_attempts: (row.detail_attempts ?? 0) + 1 }).eq("id", row.id);
        if (result) outcome.details++;
      } catch (cause) {
        if (cause instanceof NavApiError && (cause.category === "auth" || cause.category === "config" || cause.category === "maintenance")) throw cause;
        const message = cause instanceof NavApiError ? cause.safeSummary().message : "Invoice detail could not be read";
        outcome.detailsFailed++;
        await db.from("pi_nav_invoices").update({ detail_status: "detail_failed", detail_attempts: (row.detail_attempts ?? 0) + 1, detail_error: message.slice(0, 300) }).eq("id", row.id);
        log("warn", "detail_failed", { nav_invoice_id: row.id, code: cause instanceof NavApiError ? cause.code : null });
      }
    }

    outcome.status = partial ? "partial" : "completed";
    await db.from("pi_nav_sync_runs").update({
      status: outcome.status, pages_fetched: outcome.pages, digests_received: outcome.digests, records_upserted: outcome.upserted,
      details_fetched: outcome.details, details_failed: outcome.detailsFailed, finished_at: nowIso(),
    }).eq("id", run.id);
    await db.from("pi_nav_connections").update({
      last_success_at: nowIso(), last_sync_state: partial ? "partial" : "full", consecutive_failures: 0,
      next_retry_at: null, last_error_code: null, last_error_category: null, last_error_message: null, status: "active",
    }).eq("id", conn.id);
  } catch (cause) {
    const navError = cause instanceof NavApiError ? cause : null;
    const category = navError?.category ?? (cause instanceof NavConfigError ? "config" : "unknown");
    const message = navError ? navError.safeSummary().message : (cause instanceof Error ? cause.message : "NAV sync failed").slice(0, 300);
    const failures = (conn.consecutive_failures ?? 0) + 1;
    outcome.status = "failed";
    outcome.error = { code: navError?.code ?? null, category, message };
    log("error", "sync_failed", { code: navError?.code ?? null, category });
    await db.from("pi_nav_sync_runs").update({
      status: "failed", pages_fetched: outcome.pages, digests_received: outcome.digests, records_upserted: outcome.upserted,
      details_fetched: outcome.details, details_failed: outcome.detailsFailed,
      error_code: navError?.code ?? null, error_category: category, error_message: message, finished_at: nowIso(),
    }).eq("id", run.id);
    await db.from("pi_nav_connections").update({
      consecutive_failures: failures,
      next_retry_at: new Date(Date.now() + nextRetryDelayMs(failures, category === "unknown" ? "transient" : category)).toISOString(),
      last_error_code: navError?.code ?? null, last_error_category: category, last_error_message: message,
      last_sync_state: "failed", status: category === "auth" || category === "config" ? "error" : "active",
    }).eq("id", conn.id);
  } finally {
    if (events.length) {
      await db.from("pi_nav_sync_events").insert(events.map((e) => ({ ...e, run_id: run.id, organization_slug: conn.organization_slug })));
    }
    await db.rpc("pi_release_nav_sync", { _connection_id: conn.id, _lock_token: lockToken });
  }
  return outcome;
}
