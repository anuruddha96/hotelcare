import { fetchGeminiFirstChat } from "../_shared/geminiFirstChat.ts";
// Process Purchase Invoice — OCR + structured extraction (Gemini-first routing with OpenAI fallback).
// Hungarian VAT aware, deterministic checks, no invented VAT, idempotent job claims.
// Request:  { invoiceId, force? }  (user JWT)   or   { mode: "worker" }  (x-worker-secret)
// Response: { success: true, data } | { success: false, error_code?, error? }

import { authorizeCaller, corsHeaders, json, serviceDb, type Db } from "../_shared/purchaseInvoices/piAuth.ts";
import {
  needsSecondPass, validateExtractedInvoice, type ExtractedInvoiceInput, type ValidationResult,
} from "../_shared/purchaseInvoices/invoiceValidation.ts";
import { companyNameSimilarity, normalizeCompanyName, taxCore8 } from "../_shared/purchaseInvoices/normalize.ts";
import { runReconciliation, budapestToday } from "../_shared/purchaseInvoices/reconcileRunner.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const OCR_VERSION = "pi-ocr-2026.11";
const STARTED_AT = () => Date.now();

const ERROR_CODES = {
  ERR_BLURRY: { title: "Image too blurry", tips: ["Hold camera steady", "Use better lighting", "Retake the photo"] },
  ERR_DARK: { title: "Image too dark", tips: ["Move to a brighter area", "Turn on flash", "Avoid shadows"] },
  ERR_PARTIAL: { title: "Document is cut off", tips: ["Include all edges", "Capture the whole invoice"] },
  ERR_NOT_INVOICE: { title: "Not an invoice", tips: ["Upload an invoice or receipt only"] },
  ERR_UNREADABLE: { title: "Cannot read text", tips: ["Avoid glare and reflections", "Flatten the document"] },
  ERR_MISSING_DATA: { title: "Missing key fields", tips: ["Ensure total, date and merchant are visible"] },
  ERR_PDF_TOO_LARGE: { title: "PDF too large", tips: ["Compress or split the PDF", "Re-upload pages as images"] },
  ERR_FILE_TOO_LARGE: { title: "File too large", tips: ["Use a smaller photo or compress the file"] },
  ERR_MULTIPLE_INVOICES: { title: "Several invoices in one file", tips: ["Upload each invoice as a separate file"] },
} as const;
type ErrorCode = keyof typeof ERROR_CODES;

const UPLOAD_ROLES = ["admin", "top_management", "top_management_manager", "control_finance", "back_office", "reception", "front_office",
  "manager", "back_office_manager", "control_manager"];
const RETRYABLE = new Set(["AI_RATE_LIMIT", "AI_UNAVAILABLE", "AI_TIMEOUT", "STORAGE_UNAVAILABLE"]);

class ProcessingError extends Error {
  constructor(message: string, readonly code: string, readonly httpStatus = 502) { super(message); }
}

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  return btoa(s);
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const nullableNumber = { type: ["number", "null"] };
const nullableString = { type: ["string", "null"] };

const SYSTEM_PROMPT = `You are an OCR + invoice parsing engine specialized in Hungarian invoices and receipts.
You MUST call the tool 'return_invoice' with the extracted structured data. Never reply with free text.

Extract BOTH parties exactly as printed:
- MERCHANT / SELLER (Eladó / Szállító): merchant_name, merchant_tax_id (adószám, e.g. 12345678-2-42), merchant_address, merchant_bank_account.
- BUYER / CUSTOMER (Vevő): buyer_name, buyer_tax_id, buyer_address. Never guess the buyer from context.

Document kind (document_kind): normal_invoice (számla), receipt (nyugta / blokk), proforma (díjbekérő / proforma),
advance_invoice (előlegszámla), final_invoice (végszámla), corrective_invoice (módosító / helyesbítő számla),
credit_note (jóváíró számla), cancellation (sztornó / érvénytelenítő számla). Use reference_invoice_number for the
original invoice a corrective/credit/cancellation/final invoice refers to.

Amounts: copy printed values only. NEVER invent a VAT rate or VAT amount. If the VAT breakdown is not printed, return
an empty vat_lines array. Hungarian rates: 27%, 18%, 5%, 0%, AAM (alanyi adómentes), TAM, KBAET/EU (intra-EU), FAD
(reverse charge, fordított adózás). Receipt VAT codes A=5% B=18% C=27% only when the code is printed.
Hungarian number format: "1 234 567,50" means 1234567.50. Report total_amount as the invoice gross total
(bruttó végösszeg), and amount_due separately when the payable amount differs (previous balance, advance deducted,
discount, rounding). Credit notes and cancellations: amounts negative.
Currency: the ISO code printed on the document; return null if no currency is printed (do not assume HUF).
Dates: ISO YYYY-MM-DD; service_period_start/end for teljesítési időszak.
field_confidence: your confidence 0..1 for each key field you returned.
If the file contains several separate invoices, set contains_multiple_invoices=true.
If not an invoice → document_type='not_invoice', error_code='ERR_NOT_INVOICE'.
If unreadable → document_type='unreadable' + ERR_BLURRY/ERR_DARK/ERR_PARTIAL/ERR_UNREADABLE.
If critical fields are missing → ERR_MISSING_DATA.`;

const VAT_LINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vat_kind", "vat_rate", "vat_base", "vat_amount"],
  properties: {
    vat_kind: { type: "string", enum: ["standard_27", "reduced_18", "reduced_5", "zero", "aam_exempt", "exempt", "kba_reverse", "eu_intra", "export", "foreign"] },
    vat_rate: nullableNumber,
    vat_base: { type: "number" },
    vat_amount: { type: "number" },
    country: nullableString,
  },
};

const EXTRACT_TOOL = {
  type: "function",
  function: {
    name: "return_invoice",
    description: "Return the parsed invoice structure",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["document_type", "document_kind", "confidence_score", "currency", "vat_lines", "items", "field_confidence"],
      properties: {
        document_type: { type: "string", enum: ["invoice", "receipt", "not_invoice", "unreadable"] },
        document_kind: { type: "string", enum: ["normal_invoice", "receipt", "proforma", "advance_invoice", "final_invoice", "corrective_invoice", "credit_note", "cancellation", "unknown"] },
        error_code: { type: ["string", "null"], enum: ["ERR_BLURRY", "ERR_DARK", "ERR_PARTIAL", "ERR_NOT_INVOICE", "ERR_UNREADABLE", "ERR_MISSING_DATA", null] },
        contains_multiple_invoices: { type: "boolean" },
        confidence_score: { type: "number", minimum: 0, maximum: 1 },
        needs_review: { type: "boolean" },
        extraction_notes: nullableString,
        raw_text: nullableString,
        merchant_name: nullableString, merchant_tax_id: nullableString, merchant_address: nullableString,
        merchant_country: nullableString, merchant_bank_account: nullableString,
        buyer_name: nullableString, buyer_tax_id: nullableString, buyer_address: nullableString,
        invoice_number: nullableString, reference_invoice_number: nullableString,
        invoice_date: nullableString, due_date: nullableString, performance_date: nullableString,
        service_period_start: nullableString, service_period_end: nullableString,
        currency: nullableString,
        total_amount: nullableNumber, net_amount: nullableNumber, total_vat_amount: nullableNumber, amount_due: nullableNumber,
        previous_balance: nullableNumber, advance_paid_amount: nullableNumber, discount_amount: nullableNumber, rounding_amount: nullableNumber,
        bottle_deposit_amount: nullableNumber,
        payment_method: nullableString, expense_category: nullableString,
        field_confidence: {
          type: "object",
          additionalProperties: false,
          required: ["merchant_tax_id", "buyer_tax_id", "invoice_number", "invoice_date", "currency", "total_amount", "net_amount", "total_vat_amount"],
          properties: {
            merchant_tax_id: nullableNumber, buyer_tax_id: nullableNumber, invoice_number: nullableNumber, invoice_date: nullableNumber,
            currency: nullableNumber, total_amount: nullableNumber, net_amount: nullableNumber, total_vat_amount: nullableNumber,
          },
        },
        vat_lines: { type: "array", items: VAT_LINE_SCHEMA },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name_original"],
            properties: {
              name_original: { type: "string" }, name_english: nullableString, item_code: nullableString, item_type: nullableString,
              quantity: nullableNumber, unit_price: nullableNumber, total_price: nullableNumber, vat_rate: nullableNumber,
            },
          },
        },
      },
    },
  },
};

const TOTALS_TOOL = {
  type: "function",
  function: {
    name: "return_totals",
    description: "Return only the invoice totals and VAT summary, re-read carefully",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["currency", "vat_lines"],
      properties: {
        document_kind: { type: "string", enum: ["normal_invoice", "receipt", "proforma", "advance_invoice", "final_invoice", "corrective_invoice", "credit_note", "cancellation", "unknown"] },
        currency: nullableString,
        total_amount: nullableNumber, net_amount: nullableNumber, total_vat_amount: nullableNumber, amount_due: nullableNumber,
        previous_balance: nullableNumber, advance_paid_amount: nullableNumber, discount_amount: nullableNumber, rounding_amount: nullableNumber,
        vat_lines: { type: "array", items: VAT_LINE_SCHEMA },
        amount_confidence: nullableNumber,
      },
    },
  },
};

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- model output is validated field by field
type Parsed = Record<string, any>;

async function callModel(documentPart: unknown, system: string, userText: string, tool: typeof EXTRACT_TOOL | typeof TOTALS_TOOL, timeoutMs: number) {
  const res = await fetchGeminiFirstChat("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "text", text: userText }, documentPart] },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: tool.function.name } },
    }),
  }, { containsSensitiveData: true, timeoutMs });
  if (!res.ok) {
    const status = res.status;
    await res.text().catch(() => "");
    if (status === 429) throw new ProcessingError("AI rate limit — retry later", "AI_RATE_LIMIT", 429);
    if (status === 402) throw new ProcessingError("AI credits exhausted", "AI_CREDITS", 402);
    if (status >= 500) throw new ProcessingError(`AI service error (${status}) — retry later`, "AI_UNAVAILABLE");
    throw new ProcessingError(`AI rejected the document (${status}). It may be an unsupported or corrupt file.`, "AI_REJECTED");
  }
  const provider = res.headers.get("x-hotelcare-ai-provider") ?? "openai";
  const body = await res.json();
  const call = body?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new ProcessingError("The AI did not return structured invoice data", "AI_NO_DATA");
  try {
    return { parsed: JSON.parse(call.function.arguments) as Parsed, provider, model: typeof body?.model === "string" ? body.model : null };
  } catch {
    throw new ProcessingError("The AI returned invalid structured data", "AI_NO_DATA");
  }
}

const materialFailures = (r: ValidationResult) =>
  r.checks.filter((c) => c.status === "fail" && ["net_vat_gross", "vat_breakdown_totals", "gross_missing", "credit_sign", "amount_due"].includes(c.id)).length;

function toInput(p: Parsed): ExtractedInvoiceInput {
  return {
    document_kind: p.document_kind, document_type: p.document_type, currency: p.currency, net_amount: p.net_amount,
    total_vat_amount: p.total_vat_amount, total_amount: p.total_amount, amount_due: p.amount_due, previous_balance: p.previous_balance,
    advance_paid_amount: p.advance_paid_amount, discount_amount: p.discount_amount, rounding_amount: p.rounding_amount,
    vat_lines: Array.isArray(p.vat_lines) ? p.vat_lines : [], invoice_date: p.invoice_date, performance_date: p.performance_date,
    due_date: p.due_date, service_period_start: p.service_period_start, service_period_end: p.service_period_end,
    merchant_tax_id: p.merchant_tax_id, merchant_country: p.merchant_country, buyer_tax_id: p.buyer_tax_id,
  };
}

interface ProcessResult { status: number; body: Record<string, unknown> }

async function processInvoice(db: Db, invoiceId: string, options: { force: boolean; deadline: number }): Promise<ProcessResult> {
  const lockToken = crypto.randomUUID();
  const { data: claimRows, error: claimError } = await db.rpc("pi_claim_processing_job", { _invoice_id: invoiceId, _lock_token: lockToken, _force: options.force });
  if (claimError) throw new Error(claimError.message);
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim?.claimed) {
    const state = claim?.status ?? "unknown";
    if (state === "succeeded") return { status: 200, body: { success: true, already_processed: true } };
    return { status: 409, body: { success: false, error: state === "running" ? "This invoice is already being processed" : "Processing is scheduled; retry shortly", status: state } };
  }
  const finish = (ok: boolean, code: string | null = null, message: string | null = null) =>
    db.rpc("pi_finish_processing_job", { _invoice_id: invoiceId, _lock_token: lockToken, _ok: ok, _error_code: code, _error: message });

  const { data: invoice } = await db.from("purchase_invoices")
    .select("id, file_path, file_mime, uploaded_by, organization_slug, hotel_id, approval_status, is_verified, source, ocr_original, cost_centre_id, expense_category_id, file_sha256")
    .eq("id", invoiceId).maybeSingle();
  if (!invoice) { await finish(true); return { status: 404, body: { success: false, error: "Invoice not found" } }; }
  if (invoice.approval_status === "approved") { await finish(true); return { status: 409, body: { success: false, error: "Approved invoices are locked and are not re-processed" } }; }
  if (invoice.is_verified) { await finish(true); return { status: 409, body: { success: false, error: "This invoice was verified by a person; reprocessing would overwrite verified data" } }; }
  if (!invoice.file_path) { await finish(true); return { status: 409, body: { success: false, error: "This record has no document file" } }; }

  await db.from("purchase_invoices").update({ status: "processing" }).eq("id", invoiceId);
  const fail = async (code: ErrorCode | null, note: string, extra: Record<string, unknown> = {}) => {
    await db.from("purchase_invoices").update({
      status: "failed", processing_notes: note.slice(0, 500),
      ...(code ? { error_code: code, error_details: ERROR_CODES[code] } : {}), ...extra,
    }).eq("id", invoiceId);
  };

  try {
    const { data: fileBlob, error: dlErr } = await db.storage.from("purchase-invoices").download(invoice.file_path);
    if (dlErr || !fileBlob) throw new ProcessingError("The uploaded file could not be read from storage", "STORAGE_UNAVAILABLE");
    const isPdf = (invoice.file_mime || "").toLowerCase().includes("pdf") || invoice.file_path.toLowerCase().endsWith(".pdf");
    const buf = await fileBlob.arrayBuffer();
    if (isPdf && buf.byteLength > 7_500_000) {
      await fail("ERR_PDF_TOO_LARGE", "PDF too large to process");
      await finish(true);
      return { status: 200, body: { success: false, error_code: "ERR_PDF_TOO_LARGE" } };
    }
    if (!isPdf && buf.byteLength > 15_000_000) {
      await fail("ERR_FILE_TOO_LARGE", "Image too large to process");
      await finish(true);
      return { status: 200, body: { success: false, error_code: "ERR_FILE_TOO_LARGE" } };
    }
    const fileHash = await sha256Hex(buf);
    const mime = isPdf ? "application/pdf" : (invoice.file_mime || "image/jpeg");
    const dataUrl = `data:${mime};base64,${ab2b64(buf)}`;
    // PDFs must go in as a file part — image_url only accepts images.
    const documentPart = isPdf
      ? { type: "file", file: { filename: (invoice.file_path.split("/").pop() || "invoice").replace(/[^\w.-]/g, "_"), file_data: dataUrl } }
      : { type: "image_url", image_url: { url: dataUrl } };

    // ---- Pass 1: full extraction -------------------------------------------------
    const first = await callModel(documentPart, SYSTEM_PROMPT, "Extract structured invoice data and call return_invoice.", EXTRACT_TOOL, 85_000);
    const parsed = first.parsed;
    const ocrOriginal = { ...parsed, raw_text: undefined, _provider: first.provider, _model: first.model, _version: OCR_VERSION, _at: new Date().toISOString() };

    if (parsed.document_type === "not_invoice" || parsed.document_type === "unreadable" || parsed.error_code) {
      const code = (parsed.error_code ?? (parsed.document_type === "not_invoice" ? "ERR_NOT_INVOICE" : "ERR_UNREADABLE")) as ErrorCode;
      await fail(code, ERROR_CODES[code]?.title ?? "Document could not be read", {
        document_type: parsed.document_type, raw_text: parsed.raw_text ?? null, extraction_notes: parsed.extraction_notes ?? null,
        confidence_score: parsed.confidence_score ?? null, ocr_provider: first.provider, ocr_model: first.model, ocr_version: OCR_VERSION,
        extraction_passes: 1, file_sha256: invoice.file_sha256 ?? fileHash,
        ...(invoice.ocr_original ? {} : { ocr_original: ocrOriginal }),
      });
      await finish(true);
      return { status: 200, body: { success: false, error_code: code, error_details: ERROR_CODES[code] ?? null } };
    }
    if (parsed.contains_multiple_invoices === true) {
      await fail("ERR_MULTIPLE_INVOICES", "The file contains several invoices", { ocr_provider: first.provider, ocr_model: first.model, ocr_version: OCR_VERSION, extraction_passes: 1 });
      await finish(true);
      return { status: 200, body: { success: false, error_code: "ERR_MULTIPLE_INVOICES", error_details: ERROR_CODES.ERR_MULTIPLE_INVOICES } };
    }

    const today = budapestToday();
    let validation = validateExtractedInvoice(toInput(parsed), { today });
    let passes = 1;
    const amountConfidence = Math.min(
      ...["total_amount", "net_amount", "total_vat_amount"].map((k) => Number(parsed.field_confidence?.[k] ?? 1)).filter(Number.isFinite),
    );

    // ---- Pass 2: focused re-read of totals when deterministic checks fail ----------
    if (needsSecondPass(validation, Number.isFinite(amountConfidence) ? amountConfidence : null) && options.deadline - Date.now() > 45_000) {
      try {
        const failing = validation.checks.filter((c) => c.status === "fail").map((c) => c.message).join(" ");
        const second = await callModel(documentPart,
          "You re-read Hungarian invoice totals with extreme care. Copy printed values only; never invent VAT. Call return_totals.",
          `The first extraction failed these checks: ${failing || "low confidence on amounts"}. Re-read the totals block and the VAT summary (ÁFA összesítő) and call return_totals.`,
          TOTALS_TOOL, 40_000);
        passes = 2;
        const merged = { ...parsed, ...Object.fromEntries(Object.entries(second.parsed).filter(([k, v]) => v !== undefined && k !== "amount_confidence")) };
        const secondValidation = validateExtractedInvoice(toInput(merged), { today });
        if (materialFailures(secondValidation) < materialFailures(validation)) {
          Object.assign(parsed, merged);
          validation = secondValidation;
        }
      } catch (cause) {
        console.warn("second OCR pass skipped", cause instanceof Error ? cause.message : "unknown");
      }
    }
    const n = validation.normalized;
    const checks = [...validation.checks];

    // ---- Legal company (buyer): matched to configured companies only ---------------
    const { data: companies } = await db.from("invoice_buyer_companies")
      .select("id, name, legal_name, tax_id, is_active, default_cost_centre_id, default_category_id").eq("organization_slug", invoice.organization_slug);
    const buyerCore = taxCore8(parsed.buyer_tax_id);
    let buyerCompany = buyerCore ? (companies ?? []).find((c: { tax_id: string | null }) => taxCore8(c.tax_id) === buyerCore) ?? null : null;
    if (buyerCore && !buyerCompany) {
      checks.push({ id: "buyer_company_unknown", status: "warn", message: "The buyer tax number on the document is not a configured legal company. An administrator must add it; it was not created automatically.", detail: { buyer_tax_core: buyerCore } });
    }
    if (!buyerCore && parsed.buyer_name) {
      const { data: aliases } = await db.from("invoice_company_aliases").select("company_id, alias_name").eq("organization_slug", invoice.organization_slug);
      const target = normalizeCompanyName(parsed.buyer_name);
      const aliasHit = (aliases ?? []).find((a: { alias_name: string }) => normalizeCompanyName(a.alias_name) === target);
      const nameHit = (companies ?? []).find((c: { name: string; legal_name: string | null }) =>
        companyNameSimilarity(String(c.legal_name || c.name), parsed.buyer_name) >= 0.9);
      const companyId = aliasHit?.company_id ?? nameHit?.id ?? null;
      buyerCompany = companyId ? (companies ?? []).find((c: { id: string }) => c.id === companyId) ?? null : null;
      checks.push(buyerCompany
        ? { id: "buyer_company_by_name", status: "warn", message: "The buyer was matched by name only (no tax number on the document). Please confirm the legal company." }
        : { id: "buyer_company_missing", status: "warn", message: "No buyer tax number found on the document. Select the legal company during verification." });
    }
    if (buyerCompany && invoice.hotel_id) {
      const { data: mapped } = await db.from("invoice_company_properties").select("hotel_id").eq("company_id", buyerCompany.id);
      const hotels = (mapped ?? []).map((m: { hotel_id: string }) => m.hotel_id);
      if (hotels.length && !hotels.includes(invoice.hotel_id)) {
        checks.push({ id: "company_property_mismatch", status: "warn", message: "The legal company on the invoice is not linked to the property it was uploaded for. The company on the invoice was kept.", detail: { hotel_id: invoice.hotel_id } });
      }
    }

    // ---- Duplicates: supplier tax core + normalized number, and identical file -------
    const normNumber = parsed.invoice_number ? String(parsed.invoice_number).toUpperCase().replace(/[^0-9A-Z]/g, "") || null : null;
    const supplierCore = taxCore8(parsed.merchant_tax_id);
    let duplicateOf: string | null = null;
    let duplicateStatus = "none";
    let duplicateReason: string | null = null;
    if (normNumber) {
      const { data: candidates } = await db.from("purchase_invoices")
        .select("id, merchant_tax_id, invoice_number, is_credit_note, document_kind, created_at")
        .eq("organization_slug", invoice.organization_slug).eq("normalized_invoice_number", normNumber).neq("id", invoiceId)
        .order("created_at", { ascending: true }).limit(20);
      const same = (candidates ?? []).filter((c: { merchant_tax_id: string | null }) => supplierCore && taxCore8(c.merchant_tax_id) === supplierCore);
      const original = same.find((c: { is_credit_note: boolean | null }) => !!c.is_credit_note === n.is_credit_note) ?? null;
      if (original) { duplicateOf = original.id; duplicateStatus = "suspected"; duplicateReason = "same supplier tax number and invoice number"; }
      else if (same.length && n.is_credit_note) { duplicateOf = same[0].id; duplicateStatus = "credit_note"; }
    }
    if (duplicateStatus === "none") {
      const { data: sameFile } = await db.from("purchase_invoices").select("id").eq("organization_slug", invoice.organization_slug)
        .eq("file_sha256", fileHash).neq("id", invoiceId).limit(1);
      if (sameFile?.length) { duplicateOf = sameFile[0].id; duplicateStatus = "suspected"; duplicateReason = "identical file uploaded before"; }
    }
    if (duplicateReason) checks.push({ id: "duplicate", status: "warn", message: `Possible duplicate: ${duplicateReason}.`, detail: { duplicate_of: duplicateOf } });

    // ---- Defaults (only where nothing is set) ---------------------------------------
    const { data: settings } = await db.from("pi_module_settings").select("auto_reconcile, default_cost_centre_id, default_category_id")
      .eq("organization_slug", invoice.organization_slug).maybeSingle();
    const defaults: Record<string, unknown> = {};
    if (!invoice.cost_centre_id) defaults.cost_centre_id = buyerCompany?.default_cost_centre_id ?? settings?.default_cost_centre_id ?? null;
    if (!invoice.expense_category_id) defaults.expense_category_id = buyerCompany?.default_category_id ?? settings?.default_category_id ?? null;
    for (const k of Object.keys(defaults)) if (defaults[k] == null) delete defaults[k];

    const hasError = checks.some((c) => c.status === "fail");
    const hasWarn = checks.some((c) => c.status === "warn");
    const validationStatus = hasError ? "error" : hasWarn ? "warning" : "ok";
    const needsReview = validation.needsReview || hasWarn || duplicateStatus === "suspected" || parsed.needs_review === true ||
      Number(parsed.confidence_score ?? 0) < 0.75;

    const { error: saveError } = await db.from("purchase_invoices").update({
      status: "processed",
      document_type: parsed.document_type === "receipt" || n.document_kind === "receipt" ? "receipt" : "invoice",
      document_kind: n.document_kind,
      error_code: null, error_details: null, processing_notes: null,
      confidence_score: parsed.confidence_score ?? null,
      needs_review: needsReview,
      raw_text: parsed.raw_text ?? null,
      extraction_notes: parsed.extraction_notes ?? null,
      merchant_name: parsed.merchant_name ?? null,
      merchant_tax_id: parsed.merchant_tax_id ?? null,
      merchant_address: parsed.merchant_address ?? null,
      merchant_country: parsed.merchant_country ?? (n.merchant_is_foreign ? null : "HU"),
      merchant_bank_account: parsed.merchant_bank_account ?? null,
      buyer_name: parsed.buyer_name ?? null,
      buyer_tax_id: parsed.buyer_tax_id ?? null,
      buyer_address: parsed.buyer_address ?? null,
      buyer_company_id: buyerCompany?.id ?? null,
      is_credit_note: n.is_credit_note,
      duplicate_of: duplicateOf,
      duplicate_status: duplicateStatus,
      invoice_number: parsed.invoice_number ?? null,
      reference_invoice_number: parsed.reference_invoice_number ?? null,
      invoice_date: n.invoice_date,
      due_date: n.due_date,
      performance_date: n.performance_date,
      service_period_start: n.service_period_start,
      service_period_end: n.service_period_end,
      // currency is NOT NULL: an undetected currency keeps the HUF default but is flagged as such.
      currency: n.currency_detected ? n.currency : "HUF",
      currency_source: n.currency_detected ? "document" : "default",
      total_amount: n.total_amount,
      net_amount: n.net_amount,
      total_vat_amount: n.total_vat_amount,
      amount_due: n.amount_due,
      previous_balance: n.previous_balance,
      advance_paid_amount: n.advance_paid_amount,
      discount_amount: n.discount_amount,
      bottle_deposit_amount: parsed.bottle_deposit_amount ?? 0,
      payment_method: parsed.payment_method ?? null,
      expense_category: parsed.expense_category ?? null,
      field_confidence: parsed.field_confidence ?? {},
      validation_status: validationStatus,
      validation_results: checks,
      ocr_provider: first.provider,
      ocr_model: first.model,
      ocr_version: OCR_VERSION,
      extraction_passes: passes,
      file_sha256: invoice.file_sha256 ?? fileHash,
      ...(invoice.ocr_original ? {} : { ocr_original: ocrOriginal }),
      ...defaults,
    }).eq("id", invoiceId);
    if (saveError) throw new ProcessingError(`Saving the extracted data failed: ${saveError.message}`, "SAVE_FAILED", 500);

    // VAT lines: printed (or derived from printed totals) only — never a 27% default.
    await db.from("purchase_invoice_vat_lines").delete().eq("invoice_id", invoiceId);
    if (n.vat_lines.length) {
      await db.from("purchase_invoice_vat_lines").insert(n.vat_lines.map((v) => ({
        invoice_id: invoiceId, vat_kind: v.vat_kind, vat_rate: v.vat_rate ?? 0, vat_base: v.vat_base, vat_amount: v.vat_amount, country: v.country ?? null,
      })));
    }
    await db.from("purchase_invoice_items").delete().eq("invoice_id", invoiceId);
    const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 300) : [];
    if (items.length) {
      await db.from("purchase_invoice_items").insert(items.map((it: Parsed, idx: number) => ({
        invoice_id: invoiceId, position: idx, name_original: it.name_original, name_english: it.name_english ?? null,
        item_code: it.item_code ?? null, item_type: it.item_type ?? null, quantity: it.quantity ?? null,
        unit_price: it.unit_price ?? null, total_price: it.total_price ?? null, vat_rate: it.vat_rate ?? null,
      })));
    }
    await finish(true);

    // NAV reconciliation in the background; the upload never waits for NAV.
    if (settings?.auto_reconcile !== false) {
      const task = runReconciliation(db, invoice.organization_slug).catch((e) => console.warn("background reconciliation failed", e instanceof Error ? e.message : e));
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(task);
    }
    return {
      status: 200,
      body: {
        success: true,
        data: {
          ...parsed, raw_text: undefined, document_kind: n.document_kind, currency: n.currency, currency_detected: n.currency_detected,
          total_amount: n.total_amount, net_amount: n.net_amount, total_vat_amount: n.total_vat_amount,
          invoice_date: n.invoice_date, validation_status: validationStatus, checks, duplicate_status: duplicateStatus,
          buyer_company_id: buyerCompany?.id ?? null, extraction_passes: passes,
        },
      },
    };
  } catch (cause) {
    const err = cause instanceof ProcessingError ? cause : new ProcessingError(cause instanceof Error ? cause.message : String(cause), "UNKNOWN");
    console.error("process-purchase-invoice processing error", err.code, err.message);
    await fail(null, err.message);
    // Transient provider/storage errors are re-queued with back-off for the worker.
    await finish(!RETRYABLE.has(err.code), err.code, err.message);
    return { status: err.httpStatus === 429 || err.httpStatus === 402 ? err.httpStatus : 502, body: { success: false, error: err.message, retry_scheduled: RETRYABLE.has(err.code) } };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = STARTED_AT();
  try {
    if (req.method !== "POST") return json({ success: false, error: "POST required" }, 405);
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { body = {}; }
    if (!Deno.env.get("OPENAI_API_KEY") && !Deno.env.get("GEMINI_API_KEY")) return json({ success: false, error: "No AI provider is configured" }, 500);
    const db = serviceDb();
    const caller = await authorizeCaller(req, db, { allowWorker: true });
    if (caller instanceof Response) return caller;
    const deadline = started + 140_000;

    if (caller.kind === "worker") {
      // Recovery: uploads whose browser session ended before OCR finished, and re-queued transient failures.
      const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
      const { data: jobs } = await db.from("pi_processing_jobs").select("invoice_id")
        .eq("status", "queued").lte("next_attempt_at", new Date().toISOString()).lt("created_at", twoMinutesAgo)
        .order("next_attempt_at", { ascending: true }).limit(3);
      const results: Array<Record<string, unknown>> = [];
      for (const job of jobs ?? []) {
        if (deadline - Date.now() < 60_000) break;
        const r = await processInvoice(db, job.invoice_id, { force: false, deadline });
        results.push({ invoice_id: job.invoice_id, status: r.status, success: r.body.success });
      }
      return json({ success: true, processed: results });
    }

    const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId : undefined;
    if (!invoiceId || typeof invoiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(invoiceId)) return json({ success: false, error: "Missing or invalid invoiceId" }, 400);
    const { data: invoice } = await db.from("purchase_invoices").select("id, organization_slug, uploaded_by").eq("id", invoiceId).maybeSingle();
    if (!invoice || invoice.organization_slug !== caller.organizationSlug) return json({ success: false, error: "Invoice not found" }, 404);
    if (!UPLOAD_ROLES.includes(caller.role) && invoice.uploaded_by !== caller.userId) return json({ success: false, error: "Forbidden" }, 403);
    const result = await processInvoice(db, invoiceId, { force: body.force === true, deadline });
    return json(result.body, result.status);
  } catch (e) {
    console.error("process-purchase-invoice error", e instanceof Error ? e.message : "unknown");
    return json({ success: false, error: "Invoice processing failed. Please retry." }, 500);
  }
});
