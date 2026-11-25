/**
 * Optional historical import of an existing purchase-invoice register
 * (e.g. an accounting export), so that NAV invoices already booked before
 * HotelCare are matched instead of being reported as missing documents.
 *
 * Imported rows are marked source = 'historical_import', keep no file, are
 * never approved automatically and are de-duplicated by a row hash. Rows that
 * already exist as uploaded documents are skipped. Organization admins only.
 */
import { authorizeCaller, corsHeaders, InputError, json, serviceDb } from "../_shared/purchaseInvoices/piAuth.ts";
import {
  invoiceNumberLoose, isValidHuTaxCore, looksForeignTaxId, normalizeCurrency, normalizeDate, parseMoney, round2, taxCore8,
} from "../_shared/purchaseInvoices/normalize.ts";
import { normalizeDocumentKind, REDUCING_KINDS } from "../_shared/purchaseInvoices/invoiceValidation.ts";
import { sha512HexUpper } from "../_shared/purchaseInvoices/navCrypto.ts";
import { runReconciliation } from "../_shared/purchaseInvoices/reconcileRunner.ts";

const MAX_ROWS = 5000;

interface RowResult {
  row: number;
  status: "ok" | "error" | "duplicate_in_file" | "already_imported" | "already_uploaded";
  errors: string[];
  record?: Record<string, unknown>;
}

const text = (v: unknown, max = 300) => (v == null ? "" : String(v).trim().slice(0, max));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    const db = serviceDb();
    const caller = await authorizeCaller(req, db);
    if (caller instanceof Response) return caller;
    if (caller.kind !== "user" || !caller.isFinanceAdmin) return json({ ok: false, error: "Only an organization administrator can import historical invoices" }, 403);
    const p = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = p.action === "import" ? "import" : "preview";
    const rows = Array.isArray(p.rows) ? p.rows as Record<string, unknown>[] : [];
    if (!rows.length) throw new InputError("The file contains no rows");
    if (rows.length > MAX_ROWS) throw new InputError(`Import at most ${MAX_ROWS} rows at a time`);
    const defaultCurrency = p.default_currency ? normalizeCurrency(String(p.default_currency)) : null;

    const { data: companies } = await db.from("invoice_buyer_companies").select("id, tax_id, is_active").eq("organization_slug", caller.organizationSlug);
    const companyByCore = new Map<string, string>();
    for (const c of companies ?? []) { const core = taxCore8(c.tax_id); if (core) companyByCore.set(core, c.id); }
    const defaultCompany = p.company_id ? String(p.company_id) : null;
    if (defaultCompany && !(companies ?? []).some((c: { id: string }) => c.id === defaultCompany)) throw new InputError("Legal company not found", 404);
    const { data: hotels } = await db.from("hotel_configurations").select("hotel_id, organization_id").eq("is_active", true);
    const { data: org } = await db.from("organizations").select("id").eq("slug", caller.organizationSlug).maybeSingle();
    const orgHotels = new Set((hotels ?? []).filter((h: { organization_id: string }) => h.organization_id === org?.id).map((h: { hotel_id: string }) => h.hotel_id));

    const results: RowResult[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      const errors: string[] = [];
      const supplierTaxRaw = text(r.supplier_tax_number, 40);
      const supplierCore = taxCore8(supplierTaxRaw);
      const foreign = !supplierCore && looksForeignTaxId(supplierTaxRaw);
      if (supplierCore && !isValidHuTaxCore(supplierCore)) errors.push("Supplier tax number checksum is invalid");
      const supplierName = text(r.supplier_name, 200);
      if (!supplierCore && !foreign && !supplierName) errors.push("Supplier tax number or name is required");
      const invoiceNumber = text(r.invoice_number, 80);
      if (!invoiceNumber) errors.push("Invoice number is required");
      const issueDate = normalizeDate(text(r.issue_date, 20));
      if (!issueDate) errors.push("Issue date is missing or invalid");
      const currency = r.currency ? normalizeCurrency(String(r.currency)) : defaultCurrency;
      if (!currency) errors.push("Currency is missing (choose a default currency for the file if all rows share one)");
      const gross = parseMoney(r.gross_amount as string | number | null);
      if (gross == null) errors.push("Gross amount is missing or invalid");
      const net = parseMoney(r.net_amount as string | number | null);
      const vat = parseMoney(r.vat_amount as string | number | null);
      if (gross != null && net != null && vat != null && Math.abs(round2(net + vat) - gross) > (currency === "HUF" ? 1 : 0.01)) {
        errors.push("Net + VAT does not equal the gross amount");
      }
      const kind = normalizeDocumentKind(text(r.document_kind, 40) || null, null);
      const buyerCore = taxCore8(text(r.buyer_tax_number, 40));
      let companyId = defaultCompany;
      if (buyerCore) {
        // The legal company named on the invoice wins over the file default.
        companyId = companyByCore.get(buyerCore) ?? null;
        if (!companyId) errors.push("Buyer tax number does not belong to a configured legal company");
      }
      if (!companyId) errors.push("Choose the legal company (buyer) for these rows");
      const hotelId = text(r.hotel_id, 80) || null;
      if (hotelId && !orgHotels.has(hotelId)) errors.push("Unknown property");

      if (errors.length) { results.push({ row: i + 1, status: "error", errors }); continue; }
      const signedGross = REDUCING_KINDS.has(kind) && gross! > 0 ? -gross! : gross!;
      const hash = (await sha512HexUpper([caller.organizationSlug, companyId, supplierCore ?? (supplierTaxRaw ? supplierTaxRaw.toUpperCase() : supplierName.toLowerCase()),
        invoiceNumberLoose(invoiceNumber), kind, signedGross.toFixed(2), currency].join("|"))).slice(0, 40);
      if (seen.has(hash)) { results.push({ row: i + 1, status: "duplicate_in_file", errors: [] }); continue; }
      seen.add(hash);
      results.push({
        row: i + 1, status: "ok", errors: [],
        record: {
          organization_slug: caller.organizationSlug, uploaded_by: caller.userId, source: "historical_import", file_path: null,
          status: "processed", document_type: kind === "receipt" ? "receipt" : "invoice", document_kind: kind,
          buyer_company_id: companyId, buyer_tax_id: buyerCore ?? null, hotel_id: hotelId,
          merchant_name: supplierName || null, merchant_tax_id: supplierCore ?? (supplierTaxRaw || null), merchant_country: foreign ? null : "HU",
          invoice_number: invoiceNumber, invoice_date: issueDate, performance_date: normalizeDate(text(r.performance_date, 20)),
          due_date: normalizeDate(text(r.due_date, 20)), currency, currency_source: "import",
          total_amount: signedGross, net_amount: net == null ? null : (signedGross < 0 && net > 0 ? -net : net),
          total_vat_amount: vat == null ? null : (signedGross < 0 && vat > 0 ? -vat : vat),
          is_credit_note: signedGross < 0, import_row_hash: hash, payment_method: text(r.payment_method, 40) || null,
          notes: text(r.notes, 500) || null,
        },
      });
    }

    // Existing imports and uploaded documents with the same supplier + number are skipped.
    const ok = results.filter((r) => r.status === "ok");
    for (let i = 0; i < ok.length; i += 500) {
      const chunk = ok.slice(i, i + 500);
      const { data: existing } = await db.from("purchase_invoices").select("import_row_hash")
        .eq("organization_slug", caller.organizationSlug).in("import_row_hash", chunk.map((r) => r.record!.import_row_hash));
      const known = new Set((existing ?? []).map((e: { import_row_hash: string }) => e.import_row_hash));
      for (const r of chunk) if (known.has(r.record!.import_row_hash as string)) { r.status = "already_imported"; }
    }
    const { data: uploaded } = await db.from("purchase_invoices").select("merchant_tax_id, invoice_number")
      .eq("organization_slug", caller.organizationSlug).neq("source", "historical_import").not("invoice_number", "is", null).limit(20000);
    const uploadedKeys = new Set((uploaded ?? []).map((u: { merchant_tax_id: string | null; invoice_number: string }) => `${taxCore8(u.merchant_tax_id) ?? ""}|${invoiceNumberLoose(u.invoice_number)}`));
    for (const r of ok) {
      if (r.status !== "ok") continue;
      const key = `${taxCore8(r.record!.merchant_tax_id as string) ?? ""}|${invoiceNumberLoose(r.record!.invoice_number as string)}`;
      if (uploadedKeys.has(key)) r.status = "already_uploaded";
    }

    const counts = results.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
    if (action === "preview") {
      return json({ ok: true, counts, rows: results.map(({ record: _r, ...rest }) => rest).filter((r) => r.status !== "ok").slice(0, 500) });
    }

    const batchId = crypto.randomUUID();
    const toInsert = results.filter((r) => r.status === "ok").map((r) => ({ ...r.record, import_batch_id: batchId }));
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const { error, count } = await db.from("purchase_invoices").insert(toInsert.slice(i, i + 500), { count: "exact" });
      if (error) throw new Error(`Import stopped after ${inserted} rows: ${error.message}`);
      inserted += count ?? 0;
    }
    const reconciliation = inserted ? await runReconciliation(db, caller.organizationSlug) : null;
    return json({ ok: true, batch_id: batchId, inserted, counts, reconciliation: reconciliation ? { status: reconciliation.status } : null });
  } catch (cause) {
    if (cause instanceof InputError) return json({ ok: false, error: cause.message }, cause.status);
    console.error("pi-history-import failed", cause instanceof Error ? cause.message : "unknown error");
    return json({ ok: false, error: cause instanceof Error && cause.message.startsWith("Import stopped") ? cause.message : "Historical import failed" }, 500);
  }
});
