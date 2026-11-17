// Purchase invoice OCR v3 — HotelCare Invoice Intelligence
//
// Design goal: extraction may be probabilistic; money controls must not be.
// The first AI pass extracts the document, then deterministic arithmetic resolves
// the payable amount. A focused second AI pass is only used when the amount is
// ambiguous or inconsistent. The final decision and evidence are persisted so
// finance users can audit why HotelCare chose a value.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OCR_VERSION = "invoice-intelligence-v3";
const FINANCE_ROLES = [
  "admin", "top_management", "top_management_manager", "control_finance",
  "back_office", "reception", "front_office",
];

const ERROR_CODES = {
  ERR_BLURRY: { title: "Image too blurry", tips: ["Hold camera steady", "Use better lighting", "Retake the photo"] },
  ERR_DARK: { title: "Image too dark", tips: ["Move to a brighter area", "Turn on flash", "Avoid shadows"] },
  ERR_PARTIAL: { title: "Document is cut off", tips: ["Include all edges", "Capture the whole invoice"] },
  ERR_NOT_INVOICE: { title: "Not an invoice", tips: ["Upload an invoice or receipt only"] },
  ERR_UNREADABLE: { title: "Cannot read text", tips: ["Avoid glare and reflections", "Flatten the document"] },
  ERR_MISSING_DATA: { title: "Missing key fields", tips: ["Ensure total, date and merchant are visible"] },
  ERR_PDF_TOO_LARGE: { title: "PDF too large", tips: ["Compress or split the PDF", "Re-upload pages as images"] },
} as const;

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(s);
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function normalizeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? t : null;
}

function money(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number"
    ? value
    : Number(String(value).replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, "."));
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toleranceFor(value: number | null, currency = "HUF"): number {
  const abs = Math.abs(value ?? 0);
  // HUF invoices commonly have whole-forint rounding. Foreign-currency invoices
  // need cent-level tolerance, while still allowing tiny OCR/calculation noise.
  return currency.toUpperCase() === "HUF"
    ? Math.max(2, abs * 0.0002)
    : Math.max(0.03, abs * 0.0002);
}

function vatFromGross(gross: number, rate: number) {
  const vat = roundMoney((gross * rate) / (100 + rate));
  return { base: roundMoney(gross - vat), vat };
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTaxId(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 11);
}

function normalizeInvoiceNo(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

type AmountCandidate = {
  value: number;
  label: string;
  kind: string;
  page?: number | null;
  score?: number;
  source?: string;
};

type AmountResolution = {
  total: number | null;
  confidence: number;
  method: string;
  balanceDelta: number | null;
  requiresVerifier: boolean;
  candidates: AmountCandidate[];
  checks: Record<string, unknown>;
};

function resolveAmount(parsed: any): AmountResolution {
  const currency = String(parsed.currency || "HUF").toUpperCase();
  const net = money(parsed.net_amount);
  const vat = money(parsed.total_vat_amount);
  const firstPassTotal = money(parsed.total_amount);
  const payableAmount = money(parsed.payable_amount);
  const amountDue = money(parsed.amount_due);
  const isCredit = parsed.is_credit_note === true || parsed.document_subtype === "credit_note" ||
    (firstPassTotal != null && firstPassTotal < 0);

  const vatLines = Array.isArray(parsed.vat_lines) ? parsed.vat_lines : [];
  const vatBaseSum = vatLines.length
    ? roundMoney(vatLines.reduce((s: number, v: any) => s + (money(v.vat_base) ?? 0), 0))
    : null;
  const vatAmountSum = vatLines.length
    ? roundMoney(vatLines.reduce((s: number, v: any) => s + (money(v.vat_amount) ?? 0), 0))
    : null;
  const vatGross = vatBaseSum != null && vatAmountSum != null
    ? roundMoney(vatBaseSum + vatAmountSum)
    : null;
  const headerGross = net != null && vat != null ? roundMoney(net + vat) : null;

  const candidates: AmountCandidate[] = [];
  const push = (value: unknown, label: string, kind: string, source: string, page?: number | null) => {
    const x = money(value);
    if (x == null) return;
    const signed = isCredit && x > 0 ? -x : x;
    // Collapse the same value/label combination but preserve materially different totals.
    const duplicate = candidates.some(c => Math.abs(c.value - signed) < 0.001 && c.kind === kind);
    if (!duplicate) candidates.push({ value: signed, label, kind, source, page: page ?? null });
  };

  push(payableAmount, "payable_amount", "payable", "first_pass");
  push(amountDue, "amount_due", "amount_due", "first_pass");
  push(firstPassTotal, "total_amount", "gross", "first_pass");
  for (const c of (Array.isArray(parsed.amount_candidates) ? parsed.amount_candidates : [])) {
    push(c?.value, String(c?.label || "candidate"), String(c?.kind || "other"), "document_candidate", c?.page ?? null);
  }
  push(headerGross, "net + VAT", "calculated_gross", "arithmetic");
  push(vatGross, "VAT breakdown gross", "calculated_gross", "vat_lines");

  const expected = headerGross ?? vatGross;
  const tol = toleranceFor(expected ?? firstPassTotal, currency);
  const strongPositive = /(fizetend|mindösszesen|mindosszesen|brutt[oó].*össz|brutto.*ossz|grand total|amount due|payable|total due|végösszeg|vegosszeg)/i;
  const strongNegative = /(nett[oó]|áfa|afa|vat only|tax amount|subtotal|részösszeg|reszosszeg|adóalap|adoalap|unit price|egységár|egysegar)/i;

  for (const c of candidates) {
    let score = 0;
    const kind = c.kind.toLowerCase();
    const label = c.label.toLowerCase();
    if (kind === "payable") score += 45;
    else if (kind === "amount_due") score += 40;
    else if (kind === "gross" || kind === "grand_total") score += 28;
    else if (kind === "calculated_gross") score += 22;
    else if (kind === "subtotal") score -= 18;
    else if (kind === "net" || kind === "vat" || kind === "tax") score -= 30;
    else if (kind === "paid" || kind === "payment") score -= 12;
    if (strongPositive.test(label)) score += 25;
    if (strongNegative.test(label)) score -= 35;

    if (headerGross != null && Math.abs(c.value - headerGross) <= toleranceFor(headerGross, currency)) score += 34;
    if (vatGross != null && Math.abs(c.value - vatGross) <= toleranceFor(vatGross, currency)) score += 30;
    if (firstPassTotal != null && Math.abs(c.value - (isCredit && firstPassTotal > 0 ? -firstPassTotal : firstPassTotal)) <= tol) score += 10;
    c.score = score;
  }

  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const best = candidates[0] || null;
  const second = candidates[1] || null;
  const total = best?.value ?? firstPassTotal;
  const balanceDelta = total != null && expected != null ? roundMoney(total - (isCredit && expected > 0 ? -expected : expected)) : null;
  const balanced = balanceDelta == null || Math.abs(balanceDelta) <= toleranceFor(total, currency);
  const margin = best && second ? (best.score ?? 0) - (second.score ?? 0) : 30;
  const aiConfidence = clamp(Number(parsed.confidence_score ?? 0));
  const confidence = clamp(
    aiConfidence * 0.45 +
    (balanced ? 0.35 : 0.05) +
    (margin >= 20 ? 0.15 : margin >= 8 ? 0.09 : 0.03) +
    (best && (best.score ?? 0) >= 60 ? 0.05 : 0),
  );

  const uniqueMaterialValues = [...new Set(candidates.map(c => Math.round(c.value * 100) / 100))];
  const requiresVerifier = total == null || !balanced || confidence < 0.92 ||
    (uniqueMaterialValues.length > 1 && margin < 15);

  return {
    total,
    confidence,
    method: best?.source === "arithmetic" || best?.source === "vat_lines"
      ? "deterministic_arithmetic"
      : "scored_document_total",
    balanceDelta,
    requiresVerifier,
    candidates: candidates.slice(0, 12),
    checks: {
      currency,
      first_pass_total: firstPassTotal,
      header_net_plus_vat: headerGross,
      vat_breakdown_gross: vatGross,
      balanced,
      tolerance: tol,
      candidate_margin: margin,
    },
  };
}

async function callOpenAI(apiKey: string, body: Record<string, unknown>) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`AI provider error ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

function parseToolArguments(payload: any, functionName: string) {
  const calls = payload?.choices?.[0]?.message?.tool_calls ?? [];
  const call = calls.find((x: any) => x?.function?.name === functionName) ?? calls[0];
  if (!call?.function?.arguments) throw new Error(`AI did not return ${functionName}`);
  try { return JSON.parse(call.function.arguments); }
  catch { throw new Error(`AI returned invalid ${functionName} JSON`); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let invoiceId = "";
  let admin: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : "";
    if (!invoiceId) return jsonResponse({ error: "Missing or invalid invoiceId" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) return jsonResponse({ error: "OPENAI_API_KEY is not configured" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

    admin = createClient(supabaseUrl, serviceKey);
    const { data: invoice, error: invErr } = await admin
      .from("purchase_invoices")
      .select("id, file_path, file_mime, uploaded_by, organization_slug, hotel_id")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) return jsonResponse({ error: "Invoice not found" }, 404);

    const { data: profile } = await admin
      .from("profiles").select("role, organization_slug").eq("id", user.id).single();
    if (!profile || profile.organization_slug !== invoice.organization_slug || !FINANCE_ROLES.includes(profile.role)) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    await admin.from("purchase_invoices").update({
      status: "processing", processing_notes: `Processing with ${OCR_VERSION}`,
    }).eq("id", invoiceId);

    const markFailed = async (note: string, code?: string) => {
      const details = code ? ((ERROR_CODES as any)[code] ?? null) : null;
      await admin.from("purchase_invoices").update({
        status: "failed",
        processing_notes: note.slice(0, 500),
        error_code: code || null,
        error_details: details,
        ocr_version: OCR_VERSION,
      }).eq("id", invoiceId);
    };

    try {
      const { data: fileBlob, error: dlErr } = await admin.storage
        .from("purchase-invoices").download(invoice.file_path);
      if (dlErr || !fileBlob) throw new Error("Failed to download file: " + (dlErr?.message ?? "unknown"));

      const isPdf = (invoice.file_mime || "").toLowerCase().includes("pdf") ||
        String(invoice.file_path).toLowerCase().endsWith(".pdf");
      const buf = await fileBlob.arrayBuffer();
      if (isPdf && buf.byteLength > 7_500_000) {
        await markFailed("PDF too large to process", "ERR_PDF_TOO_LARGE");
        return jsonResponse({ success: false, error_code: "ERR_PDF_TOO_LARGE" });
      }

      const documentHash = await sha256Hex(buf);
      const b64 = ab2b64(buf);
      const mime = isPdf ? "application/pdf" : (invoice.file_mime || "image/jpeg");
      const dataUrl = `data:${mime};base64,${b64}`;
      const documentPart: any = isPdf
        ? {
            type: "file",
            file: {
              filename: (String(invoice.file_path).split("/").pop() || "invoice").replace(/[^\w.\-]/g, "_"),
              file_data: dataUrl,
            },
          }
        : { type: "image_url", image_url: { url: dataUrl, detail: "high" } };

      // Keep category classification constrained to the organization's real master data.
      const { data: categories } = await admin
        .from("purchase_invoice_categories")
        .select("id, code, label")
        .eq("organization_slug", invoice.organization_slug)
        .eq("is_active", true)
        .order("sort_order");
      const categoryList = (categories ?? []).map((c: any) => `${c.code}: ${c.label}`).join("\n") || "other: Other / Uncategorized";

      const extractionTool: any = {
        type: "function",
        function: {
          name: "return_invoice",
          description: "Return all structured invoice data and every plausible monetary total printed on the document.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["document_type", "document_subtype", "confidence_score", "currency", "vat_lines", "items", "amount_candidates"],
            properties: {
              document_type: { type: "string", enum: ["invoice", "receipt", "not_invoice", "unreadable"] },
              document_subtype: { type: "string", enum: ["standard", "credit_note", "advance", "final", "receipt", "unknown"] },
              is_credit_note: { type: "boolean" },
              error_code: { type: ["string", "null"], enum: ["ERR_BLURRY", "ERR_DARK", "ERR_PARTIAL", "ERR_NOT_INVOICE", "ERR_UNREADABLE", "ERR_MISSING_DATA", null] },
              confidence_score: { type: "number", minimum: 0, maximum: 1 },
              needs_review: { type: "boolean" },
              extraction_notes: { type: ["string", "null"] },
              raw_text: { type: ["string", "null"] },
              merchant_name: { type: ["string", "null"] },
              merchant_tax_id: { type: ["string", "null"] },
              merchant_address: { type: ["string", "null"] },
              merchant_country: { type: ["string", "null"] },
              buyer_name: { type: ["string", "null"] },
              buyer_tax_id: { type: ["string", "null"] },
              buyer_address: { type: ["string", "null"] },
              invoice_number: { type: ["string", "null"] },
              invoice_date: { type: ["string", "null"] },
              due_date: { type: ["string", "null"] },
              performance_date: { type: ["string", "null"] },
              currency: { type: "string" },
              total_amount: { type: ["number", "null"] },
              payable_amount: { type: ["number", "null"] },
              amount_due: { type: ["number", "null"] },
              amount_paid: { type: ["number", "null"] },
              net_amount: { type: ["number", "null"] },
              total_vat_amount: { type: ["number", "null"] },
              discount_amount: { type: ["number", "null"] },
              rounding_adjustment: { type: ["number", "null"] },
              bottle_deposit_amount: { type: ["number", "null"] },
              payment_method: { type: ["string", "null"] },
              expense_category: { type: ["string", "null"] },
              field_confidence: {
                type: "object",
                additionalProperties: false,
                properties: {
                  total_amount: { type: ["number", "null"] },
                  net_amount: { type: ["number", "null"] },
                  vat_amount: { type: ["number", "null"] },
                  invoice_number: { type: ["number", "null"] },
                  supplier_tax_id: { type: ["number", "null"] },
                },
              },
              amount_candidates: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "value", "kind"],
                  properties: {
                    label: { type: "string" },
                    value: { type: "number" },
                    kind: { type: "string", enum: ["payable", "amount_due", "gross", "grand_total", "subtotal", "net", "vat", "paid", "payment", "other"] },
                    page: { type: ["number", "null"] },
                  },
                },
              },
              vat_lines: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["vat_kind", "vat_rate", "vat_base", "vat_amount"],
                  properties: {
                    vat_kind: { type: "string", enum: ["standard_27", "reduced_18", "reduced_5", "zero", "aam_exempt", "kba_reverse", "eu_intra", "export", "foreign"] },
                    vat_rate: { type: "number" }, vat_base: { type: "number" }, vat_amount: { type: "number" },
                    country: { type: ["string", "null"] },
                  },
                },
              },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name_original"],
                  properties: {
                    name_original: { type: "string" }, name_english: { type: ["string", "null"] },
                    item_code: { type: ["string", "null"] }, item_type: { type: ["string", "null"] },
                    quantity: { type: ["number", "null"] }, unit_price: { type: ["number", "null"] },
                    total_price: { type: ["number", "null"] }, vat_rate: { type: ["number", "null"] },
                  },
                },
              },
            },
          },
        },
      };

      const systemPrompt = `You are HotelCare's invoice OCR engine, specialized in Hungarian and EU supplier invoices and receipts.
You MUST call return_invoice. Never reply with free text.

CRITICAL MONEY RULES:
1. Read every plausible total printed on the document and include it in amount_candidates with its exact nearby label and page.
2. total_amount means the final GROSS invoice total for accounting, not net, VAT, subtotal, unit price, bank transfer amount, previous balance, deposit balance or a line item.
3. payable_amount / amount_due mean what this document says is currently payable. Keep them separate from total_amount when an advance, prepayment, already-paid amount or carry-over balance exists.
4. Prefer labels such as Fizetendő, Mindösszesen, Végösszeg, Bruttó összesen, Grand Total, Amount Due, Total Due. Never treat Nettó, ÁFA/VAT, Adóalap, Részösszeg/Subtotal as gross.
5. Cross-check net + VAT = gross and VAT-breakdown base + VAT = gross. If they do not agree, set needs_review=true and explain briefly.
6. Hungarian decimal/thousands separators matter: '388 617 Ft' is 388617; '1.234,56 EUR' is 1234.56.
7. Credit/storno/correction invoices must have negative accounting values even if the printed layout shows positive figures with a storno marker.
8. Do not invent missing money. Use null and lower the relevant confidence.

PARTIES:
- merchant_* = seller / Eladó / Szállító (issuer)
- buyer_* = Vevő / customer (the HotelCare company being billed)
Use tax identifiers exactly from the document; do not swap seller and buyer.

DATES: ISO YYYY-MM-DD.
VAT: understand 27%, 18%, 5%, 0%, AAM, KBA/reverse charge, EU intra-community and foreign VAT.

EXPENSE CATEGORY: choose only one code from this organization's allowed list, or 'other' if unclear:
${categoryList}

If the capture is unusable, return the relevant ERR_* code instead of guessing.`;

      let firstPass: any;
      try {
        const aiJson = await callOpenAI(openAiKey, {
          model: "gpt-4o",
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: [{ type: "text", text: "Extract and cross-check this purchase invoice." }, documentPart] },
          ],
          tools: [extractionTool],
          tool_choice: { type: "function", function: { name: "return_invoice" } },
        });
        firstPass = parseToolArguments(aiJson, "return_invoice");
      } catch (e: any) {
        const status = Number(e?.status || 0);
        const note = status === 429 ? "AI rate limit — retry later"
          : status === 402 ? "AI credits exhausted"
          : status >= 500 ? `AI service error (${status}) — retry later`
          : e?.message || "AI extraction failed";
        await markFailed(note);
        return jsonResponse({ success: false, error: note }, status === 429 || status === 402 ? status : 502);
      }

      firstPass.invoice_date = normalizeDate(firstPass.invoice_date);
      firstPass.due_date = normalizeDate(firstPass.due_date);
      firstPass.performance_date = normalizeDate(firstPass.performance_date);
      firstPass.currency = String(firstPass.currency || "HUF").toUpperCase();

      if (firstPass.document_type === "not_invoice" || firstPass.document_type === "unreadable" || firstPass.error_code) {
        const code = firstPass.error_code ?? (firstPass.document_type === "not_invoice" ? "ERR_NOT_INVOICE" : "ERR_UNREADABLE");
        const details = (ERROR_CODES as any)[code] ?? null;
        await admin.from("purchase_invoices").update({
          status: "failed", document_type: firstPass.document_type, error_code: code, error_details: details,
          raw_text: firstPass.raw_text, extraction_notes: firstPass.extraction_notes,
          confidence_score: firstPass.confidence_score, document_hash: documentHash, ocr_version: OCR_VERSION,
        }).eq("id", invoiceId);
        return jsonResponse({ success: false, error_code: code, error_details: details });
      }

      // Normalize signs before resolution.
      const isCreditNote = firstPass.is_credit_note === true || firstPass.document_subtype === "credit_note" || money(firstPass.total_amount)! < 0;
      firstPass.is_credit_note = isCreditNote;
      if (isCreditNote) {
        for (const key of ["total_amount", "payable_amount", "amount_due", "net_amount", "total_vat_amount"]) {
          const x = money(firstPass[key]);
          if (x != null) firstPass[key] = -Math.abs(x);
        }
        if (Array.isArray(firstPass.vat_lines)) {
          firstPass.vat_lines = firstPass.vat_lines.map((v: any) => ({
            ...v,
            vat_base: money(v.vat_base) == null ? v.vat_base : -Math.abs(Number(v.vat_base)),
            vat_amount: money(v.vat_amount) == null ? v.vat_amount : -Math.abs(Number(v.vat_amount)),
          }));
        }
      }

      // Missing VAT lines are no longer silently trusted. We can derive a 27%
      // hypothesis for continuity, but force manual review because the VAT rate
      // itself was not evidenced by the document.
      let vatLines = Array.isArray(firstPass.vat_lines) ? firstPass.vat_lines : [];
      if (vatLines.length === 0 && money(firstPass.total_amount) != null) {
        const gross = Number(firstPass.total_amount);
        const { base, vat } = vatFromGross(Math.abs(gross), 27);
        const sign = gross < 0 ? -1 : 1;
        vatLines = [{ vat_kind: "standard_27", vat_rate: 27, vat_base: base * sign, vat_amount: vat * sign, country: null }];
        firstPass.needs_review = true;
        firstPass.extraction_notes = `${firstPass.extraction_notes || ""} [VAT rate was not readable; 27% is only a review hypothesis.]`.trim();
      }

      let resolution = resolveAmount({ ...firstPass, vat_lines: vatLines });
      let verifier: any = null;

      const { data: automation } = await admin
        .from("invoice_automation_settings")
        .select("amount_verifier_enabled, amount_auto_accept_confidence, require_amount_balance")
        .eq("organization_slug", invoice.organization_slug)
        .maybeSingle();
      const verifierEnabled = automation?.amount_verifier_enabled ?? true;
      const acceptThreshold = Number(automation?.amount_auto_accept_confidence ?? 0.94);
      const requireBalance = automation?.require_amount_balance ?? true;

      if (verifierEnabled && resolution.requiresVerifier) {
        const verifyTool: any = {
          type: "function",
          function: {
            name: "verify_invoice_amount",
            description: "Independently verify the exact accounting gross/payable amount from the document.",
            parameters: {
              type: "object", additionalProperties: false,
              required: ["verified_total_amount", "currency", "confidence", "evidence_label", "arithmetic_consistent"],
              properties: {
                verified_total_amount: { type: ["number", "null"] },
                verified_net_amount: { type: ["number", "null"] },
                verified_vat_amount: { type: ["number", "null"] },
                currency: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
                evidence_label: { type: ["string", "null"] }, evidence_page: { type: ["number", "null"] },
                arithmetic_consistent: { type: "boolean" },
                is_credit_note: { type: "boolean" },
                notes: { type: ["string", "null"] },
              },
            },
          },
        };
        const verifierPrompt = `You are the second-pass financial control for an invoice OCR system.
Ignore the first model's conclusion and independently inspect the source document.
Find the final accounting GROSS invoice total. Do not confuse it with net, VAT, subtotal, line totals, bank-transfer references, previous balances, deposits, paid amounts or amount due after a prepayment.
Return the exact nearby printed label and page. Cross-check net + VAT = gross and the VAT summary. If this is a storno/credit note, return negative values. If you cannot prove the total from the document, return null and low confidence.`;
        try {
          const verifyJson = await callOpenAI(openAiKey, {
            model: "gpt-4o", temperature: 0,
            messages: [
              { role: "system", content: verifierPrompt },
              { role: "user", content: [{ type: "text", text: "Verify the final gross invoice total independently." }, documentPart] },
            ],
            tools: [verifyTool],
            tool_choice: { type: "function", function: { name: "verify_invoice_amount" } },
          });
          verifier = parseToolArguments(verifyJson, "verify_invoice_amount");
          const verifiedTotalRaw = money(verifier.verified_total_amount);
          const verifiedTotal = verifiedTotalRaw == null ? null : (verifier.is_credit_note ? -Math.abs(verifiedTotalRaw) : verifiedTotalRaw);
          const verifierConfidence = clamp(Number(verifier.confidence ?? 0));
          if (verifiedTotal != null) {
            const current = resolution.total;
            const tol = toleranceFor(verifiedTotal, firstPass.currency);
            const agreement = current != null && Math.abs(current - verifiedTotal) <= tol;
            if (agreement) {
              resolution = {
                ...resolution,
                total: verifiedTotal,
                confidence: clamp(Math.max(resolution.confidence, verifierConfidence) + 0.04),
                method: "dual_pass_agreement",
                requiresVerifier: false,
              };
            } else if (verifierConfidence >= 0.9 && verifier.arithmetic_consistent === true) {
              resolution = {
                ...resolution,
                total: verifiedTotal,
                confidence: verifierConfidence,
                method: "second_pass_verified",
                balanceDelta: money(verifier.verified_net_amount) != null && money(verifier.verified_vat_amount) != null
                  ? roundMoney(verifiedTotal - (Number(verifier.verified_net_amount) + Number(verifier.verified_vat_amount)))
                  : resolution.balanceDelta,
                requiresVerifier: false,
              };
              firstPass.needs_review = true; // disagreement is visible even when verifier wins.
              firstPass.extraction_notes = `${firstPass.extraction_notes || ""} [Amount corrected by independent verifier.]`.trim();
            } else {
              firstPass.needs_review = true;
              firstPass.extraction_notes = `${firstPass.extraction_notes || ""} [Amount passes disagree; manual confirmation required.]`.trim();
            }
          }
        } catch (verifyError) {
          console.warn("Amount verifier failed; keeping deterministic first-pass resolution", verifyError);
          firstPass.needs_review = true;
        }
      }

      const finalTotal = resolution.total;
      const amountBalanced = resolution.balanceDelta == null ||
        Math.abs(resolution.balanceDelta) <= toleranceFor(finalTotal, firstPass.currency);
      const amountSafe = finalTotal != null && resolution.confidence >= acceptThreshold && (!requireBalance || amountBalanced);
      if (!amountSafe) firstPass.needs_review = true;

      // Buyer company resolution.
      let buyerCompanyId: string | null = null;
      const buyerTax = normalizeTaxId(firstPass.buyer_tax_id);
      if (buyerTax) {
        const { data: existingBuyer } = await admin
          .from("invoice_buyer_companies").select("id")
          .eq("organization_slug", invoice.organization_slug)
          .eq("normalized_tax_id", buyerTax)
          .maybeSingle();
        if (existingBuyer?.id) buyerCompanyId = existingBuyer.id;
        else {
          const { data: createdBuyer } = await admin.from("invoice_buyer_companies").insert({
            organization_slug: invoice.organization_slug,
            name: String(firstPass.buyer_name || "Unknown buyer"),
            legal_name: String(firstPass.buyer_name || "Unknown buyer"),
            tax_id: firstPass.buyer_tax_id || buyerTax,
          }).select("id").single();
          buyerCompanyId = createdBuyer?.id ?? null;
        }
      }

      // Resolve category id only from configured master data.
      const requestedCategory = String(firstPass.expense_category || "other").toLowerCase().trim();
      const category = (categories ?? []).find((c: any) =>
        String(c.code).toLowerCase() === requestedCategory || String(c.label).toLowerCase() === requestedCategory,
      ) || null;

      // Exact-file duplicate is stronger than OCR duplicate detection.
      let duplicateOf: string | null = null;
      let duplicateStatus = "none";
      const { data: hashDup } = await admin.from("purchase_invoices")
        .select("id, is_credit_note")
        .eq("organization_slug", invoice.organization_slug)
        .eq("document_hash", documentHash)
        .neq("id", invoiceId)
        .order("created_at", { ascending: true })
        .limit(1);
      if (hashDup?.[0]) {
        duplicateOf = hashDup[0].id;
        duplicateStatus = "exact";
      } else if (firstPass.invoice_number && firstPass.merchant_tax_id) {
        const merchantTax = normalizeTaxId(firstPass.merchant_tax_id);
        const invoiceNo = normalizeInvoiceNo(firstPass.invoice_number);
        const { data: possible } = await admin.from("purchase_invoices")
          .select("id, merchant_tax_id, invoice_number, total_amount, is_credit_note")
          .eq("organization_slug", invoice.organization_slug)
          .neq("id", invoiceId)
          .limit(200);
        const original = (possible ?? []).find((p: any) =>
          normalizeTaxId(p.merchant_tax_id) === merchantTax && normalizeInvoiceNo(p.invoice_number) === invoiceNo,
        );
        if (original) {
          duplicateOf = original.id;
          if (isCreditNote) duplicateStatus = "credit_note";
          else if (!original.is_credit_note) duplicateStatus = "suspected";
          else duplicateOf = null;
        }
      }

      if (duplicateStatus === "exact" || duplicateStatus === "suspected") firstPass.needs_review = true;

      const amountVerification = {
        version: OCR_VERSION,
        resolver: {
          final_total: finalTotal,
          confidence: resolution.confidence,
          method: resolution.method,
          balance_delta: resolution.balanceDelta,
          checks: resolution.checks,
          candidates: resolution.candidates,
        },
        verifier,
        field_confidence: firstPass.field_confidence || {},
        auto_safe: amountSafe,
        processed_at: new Date().toISOString(),
      };

      await admin.from("purchase_invoices").update({
        status: "processed",
        document_type: firstPass.document_type,
        error_code: null,
        error_details: null,
        confidence_score: firstPass.confidence_score,
        needs_review: !!firstPass.needs_review,
        raw_text: firstPass.raw_text,
        extraction_notes: firstPass.extraction_notes,
        merchant_name: firstPass.merchant_name,
        merchant_tax_id: firstPass.merchant_tax_id,
        merchant_address: firstPass.merchant_address,
        merchant_country: firstPass.merchant_country ?? "HU",
        buyer_name: firstPass.buyer_name ?? null,
        buyer_tax_id: firstPass.buyer_tax_id ?? null,
        buyer_address: firstPass.buyer_address ?? null,
        buyer_company_id: buyerCompanyId,
        is_credit_note: isCreditNote,
        duplicate_of: duplicateOf,
        duplicate_status: duplicateStatus,
        invoice_number: firstPass.invoice_number,
        invoice_date: firstPass.invoice_date,
        due_date: firstPass.due_date,
        performance_date: firstPass.performance_date,
        currency: firstPass.currency || "HUF",
        total_amount: finalTotal,
        net_amount: firstPass.net_amount,
        total_vat_amount: firstPass.total_vat_amount,
        bottle_deposit_amount: firstPass.bottle_deposit_amount ?? 0,
        payment_method: firstPass.payment_method,
        expense_category: category?.code ?? "other",
        expense_category_id: category?.id ?? null,
        document_hash: documentHash,
        ocr_version: OCR_VERSION,
        amount_confidence: resolution.confidence,
        amount_resolution_method: resolution.method,
        amount_balance_delta: resolution.balanceDelta,
        amount_verification: amountVerification,
        source_currency: firstPass.currency || "HUF",
        source_total_amount: money(firstPass.total_amount),
        source_net_amount: money(firstPass.net_amount),
        source_vat_amount: money(firstPass.total_vat_amount),
        processing_notes: amountSafe ? "Amount cross-check passed" : "Amount needs finance review",
      }).eq("id", invoiceId);

      await admin.from("purchase_invoice_vat_lines").delete().eq("invoice_id", invoiceId);
      if (vatLines.length) {
        await admin.from("purchase_invoice_vat_lines").insert(vatLines.map((v: any) => ({
          invoice_id: invoiceId,
          vat_kind: v.vat_kind,
          vat_rate: money(v.vat_rate) ?? 0,
          vat_base: money(v.vat_base) ?? 0,
          vat_amount: money(v.vat_amount) ?? 0,
          country: v.country ?? null,
        })));
      }

      await admin.from("purchase_invoice_items").delete().eq("invoice_id", invoiceId);
      const items = Array.isArray(firstPass.items) ? firstPass.items : [];
      if (items.length) {
        await admin.from("purchase_invoice_items").insert(items.map((it: any, idx: number) => ({
          invoice_id: invoiceId, position: idx + 1,
          name_original: it.name_original, name_english: it.name_english,
          item_code: it.item_code, item_type: it.item_type,
          quantity: money(it.quantity), unit_price: money(it.unit_price),
          total_price: money(it.total_price), vat_rate: money(it.vat_rate),
        })));
      }

      return jsonResponse({
        success: true,
        data: {
          ...firstPass,
          total_amount: finalTotal,
          amount_confidence: resolution.confidence,
          amount_resolution_method: resolution.method,
          amount_safe: amountSafe,
          duplicate_status: duplicateStatus,
        },
      });
    } catch (inner) {
      const msg = inner instanceof Error ? inner.message : String(inner);
      console.error("process-purchase-invoice processing error", msg);
      await markFailed(msg);
      return jsonResponse({ success: false, error: msg }, 502);
    }
  } catch (error) {
    console.error("process-purchase-invoice", error);
    if (admin && invoiceId) {
      try {
        await admin.from("purchase_invoices").update({
          status: "failed", processing_notes: String(error instanceof Error ? error.message : error).slice(0, 500),
          ocr_version: OCR_VERSION,
        }).eq("id", invoiceId);
      } catch (_) { /* do not mask the original error */ }
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
