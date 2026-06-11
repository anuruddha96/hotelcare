// Process Purchase Invoice — OCR + structured extraction via Lovable AI Gateway
// Hungarian VAT aware. Returns structured error codes for unreadable docs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ERROR_CODES = {
  ERR_BLURRY: { title: "Image too blurry", tips: ["Hold camera steady", "Use better lighting", "Retake the photo"] },
  ERR_DARK: { title: "Image too dark", tips: ["Move to a brighter area", "Turn on flash", "Avoid shadows"] },
  ERR_PARTIAL: { title: "Document is cut off", tips: ["Include all edges", "Capture the whole invoice"] },
  ERR_NOT_INVOICE: { title: "Not an invoice", tips: ["Upload an invoice or receipt only"] },
  ERR_UNREADABLE: { title: "Cannot read text", tips: ["Avoid glare and reflections", "Flatten the document"] },
  ERR_MISSING_DATA: { title: "Missing key fields", tips: ["Ensure total, date and merchant are visible"] },
  ERR_PDF_TOO_LARGE: { title: "PDF too large", tips: ["Compress or split the PDF", "Re-upload pages as images"] },
} as const;

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(s);
}

function normalizeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  return null;
}

function vatFromGross(gross: number, rate: number) {
  const vat = Math.round((gross * rate) / (100 + rate) * 100) / 100;
  return { base: Math.round((gross - vat) * 100) / 100, vat };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // v2 — force redeploy + input validation
  try {
    let body: any = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    const invoiceId: string | undefined = body?.invoiceId;
    if (!invoiceId || typeof invoiceId !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid invoiceId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch invoice row + role check
    const { data: invoice, error: invErr } = await supabase
      .from("purchase_invoices")
      .select("id, file_path, file_mime, uploaded_by, organization_slug")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) throw new Error("Invoice not found");

    const { data: profile } = await supabase
      .from("profiles").select("role, organization_slug").eq("id", user.id).single();
    if (!profile || profile.organization_slug !== invoice.organization_slug) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allowed = ["admin","top_management","top_management_manager","control_finance","back_office","reception","front_office"];
    if (!allowed.includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("purchase_invoices").update({ status: "processing" }).eq("id", invoiceId);

    // Fetch the file
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("purchase-invoices").download(invoice.file_path);
    if (dlErr || !fileBlob) throw new Error("Failed to download file: " + (dlErr?.message ?? "unknown"));

    const isPdf = (invoice.file_mime || "").toLowerCase().includes("pdf") ||
                  invoice.file_path.toLowerCase().endsWith(".pdf");
    const buf = await fileBlob.arrayBuffer();

    if (isPdf && buf.byteLength > 7_500_000) {
      await supabase.from("purchase_invoices").update({
        status: "failed", error_code: "ERR_PDF_TOO_LARGE",
        error_details: ERROR_CODES.ERR_PDF_TOO_LARGE,
        processing_notes: "PDF too large to process",
      }).eq("id", invoiceId);
      return new Response(JSON.stringify({ success: false, error_code: "ERR_PDF_TOO_LARGE" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const b64 = ab2b64(buf);
    const mime = isPdf ? "application/pdf" : (invoice.file_mime || "image/jpeg");
    const dataUrl = `data:${mime};base64,${b64}`;

    const systemPrompt = `You are an OCR + invoice parsing engine specialized in Hungarian invoices and receipts.
You MUST call the tool 'return_invoice' with the extracted structured data. Never reply with free text.

Extract BOTH parties:
- MERCHANT / SELLER (Eladó / Szállító): the company issuing the invoice → merchant_name, merchant_tax_id, merchant_address.
- BUYER / CUSTOMER (Vevő / Számlafogadó): the company being billed → buyer_name, buyer_tax_id, buyer_address.
The buyer is typically the hotel company on the invoice (e.g. "RD Hotel Kft", "Gózsdu Hotel Kft"). Use the Hungarian adószám for buyer_tax_id.

Hungarian VAT rules:
- Standard 27% / Reduced 18% (hotel acc.) / Reduced 5% / 0% AAM / KBA reverse-charge / EU 0% / Foreign VAT
- Receipt codes A=5% B=18% C=27%
If only gross shown: vat_base = gross / (1 + rate); vat_amount = gross - vat_base.

Credit notes / storno (sztornó / helyesbítő számla): when the document is a credit/correction invoice, the total_amount must be NEGATIVE.

If not an invoice → document_type='not_invoice', error_code='ERR_NOT_INVOICE'.
If unreadable → document_type='unreadable' + ERR_BLURRY/ERR_DARK/ERR_PARTIAL/ERR_UNREADABLE.
If critical fields missing → ERR_MISSING_DATA.

Dates ISO YYYY-MM-DD. Amounts as numbers. Default currency HUF.`;

    const tool = {
      type: "function",
      function: {
        name: "return_invoice",
        description: "Return the parsed invoice structure",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["document_type","confidence_score","currency","vat_lines","items"],
          properties: {
            document_type: { type: "string", enum: ["invoice","receipt","not_invoice","unreadable"] },
            error_code: { type: ["string","null"], enum: ["ERR_BLURRY","ERR_DARK","ERR_PARTIAL","ERR_NOT_INVOICE","ERR_UNREADABLE","ERR_MISSING_DATA", null] },
            confidence_score: { type: "number", minimum: 0, maximum: 1 },
            needs_review: { type: "boolean" },
            extraction_notes: { type: ["string","null"] },
            raw_text: { type: ["string","null"] },
            merchant_name: { type: ["string","null"] },
            merchant_tax_id: { type: ["string","null"] },
            merchant_address: { type: ["string","null"] },
            merchant_country: { type: ["string","null"] },
            buyer_name: { type: ["string","null"], description: "Customer / vevő name (the company being billed)" },
            buyer_tax_id: { type: ["string","null"], description: "Customer Hungarian tax id (adószám)" },
            buyer_address: { type: ["string","null"] },
            invoice_number: { type: ["string","null"] },
            invoice_date: { type: ["string","null"] },
            due_date: { type: ["string","null"] },
            performance_date: { type: ["string","null"] },
            currency: { type: "string" },
            total_amount: { type: ["number","null"] },
            net_amount: { type: ["number","null"] },
            total_vat_amount: { type: ["number","null"] },
            bottle_deposit_amount: { type: ["number","null"] },
            payment_method: { type: ["string","null"] },
            expense_category: { type: ["string","null"] },
            vat_lines: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["vat_kind","vat_rate","vat_base","vat_amount"],
                properties: {
                  vat_kind: { type: "string", enum: ["standard_27","reduced_18","reduced_5","zero","aam_exempt","kba_reverse","eu_intra","export","foreign"] },
                  vat_rate: { type: "number" },
                  vat_base: { type: "number" },
                  vat_amount: { type: "number" },
                  country: { type: ["string","null"] },
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
                  name_original: { type: "string" },
                  name_english: { type: ["string","null"] },
                  item_code: { type: ["string","null"] },
                  item_type: { type: ["string","null"] },
                  quantity: { type: ["number","null"] },
                  unit_price: { type: ["number","null"] },
                  total_price: { type: ["number","null"] },
                  vat_rate: { type: ["number","null"] },
                },
              },
            },
          },
        },
      },
    };

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract structured invoice data and call return_invoice." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "return_invoice" } },
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI gateway error", aiRes.status, txt);
      if (aiRes.status === 429 || aiRes.status === 402) {
        await supabase.from("purchase_invoices").update({
          status: "failed",
          processing_notes: aiRes.status === 429 ? "AI rate limit" : "AI credits exhausted",
        }).eq("id", invoiceId);
        return new Response(JSON.stringify({ error: aiRes.status === 429 ? "Rate limited, retry later." : "AI credits exhausted." }), {
          status: aiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway: ${aiRes.status}`);
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI returned no tool call");
    const parsed = JSON.parse(toolCall.function.arguments);

    // Normalize dates
    parsed.invoice_date = normalizeDate(parsed.invoice_date);
    parsed.due_date = normalizeDate(parsed.due_date);
    parsed.performance_date = normalizeDate(parsed.performance_date);

    // Handle unreadable / not-invoice early
    if (parsed.document_type === "not_invoice" || parsed.document_type === "unreadable" || parsed.error_code) {
      const code = parsed.error_code ?? (parsed.document_type === "not_invoice" ? "ERR_NOT_INVOICE" : "ERR_UNREADABLE");
      const details = (ERROR_CODES as any)[code] ?? null;
      await supabase.from("purchase_invoices").update({
        status: "failed",
        document_type: parsed.document_type,
        error_code: code,
        error_details: details,
        raw_text: parsed.raw_text,
        extraction_notes: parsed.extraction_notes,
        confidence_score: parsed.confidence_score,
      }).eq("id", invoiceId);
      return new Response(JSON.stringify({ success: false, error_code: code, error_details: details }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback: derive VAT lines if missing but total + obvious single-rate
    let vatLines = Array.isArray(parsed.vat_lines) ? parsed.vat_lines : [];
    if (vatLines.length === 0 && parsed.total_amount) {
      const { base, vat } = vatFromGross(parsed.total_amount, 27);
      vatLines = [{ vat_kind: "standard_27", vat_rate: 27, vat_base: base, vat_amount: vat, country: null }];
      parsed.needs_review = true;
      parsed.extraction_notes = (parsed.extraction_notes || "") +
        " [VAT auto-defaulted to 27% — please verify]";
    }

    // --- Buyer company resolution (auto-register unseen buyers) ---
    let buyerCompanyId: string | null = null;
    if (parsed.buyer_tax_id || parsed.buyer_name) {
      const taxId = (parsed.buyer_tax_id || "").trim() || null;
      const name = (parsed.buyer_name || "").trim() || "Unknown buyer";
      if (taxId) {
        const { data: existing } = await supabase
          .from("invoice_buyer_companies")
          .select("id")
          .eq("organization_slug", invoice.organization_slug)
          .eq("tax_id", taxId)
          .maybeSingle();
        if (existing?.id) {
          buyerCompanyId = existing.id;
        } else {
          const { data: created } = await supabase
            .from("invoice_buyer_companies")
            .insert({ organization_slug: invoice.organization_slug, name, tax_id: taxId })
            .select("id").single();
          buyerCompanyId = created?.id ?? null;
        }
      }
    }

    // --- Duplicate detection & credit-note classification ---
    let isCreditNote = (parsed.total_amount != null && Number(parsed.total_amount) < 0);
    let duplicateOf: string | null = null;
    let duplicateStatus = "none";
    if (parsed.invoice_number && parsed.merchant_tax_id) {
      const { data: prior } = await supabase
        .from("purchase_invoices")
        .select("id, total_amount, is_credit_note")
        .eq("organization_slug", invoice.organization_slug)
        .eq("merchant_tax_id", parsed.merchant_tax_id)
        .eq("invoice_number", parsed.invoice_number)
        .neq("id", invoiceId)
        .order("created_at", { ascending: true })
        .limit(1);
      const original = prior?.[0];
      if (original) {
        duplicateOf = original.id;
        if (isCreditNote) {
          duplicateStatus = "credit_note";
        } else if (original.is_credit_note) {
          // Original was a credit; new positive invoice — keep as standalone
          duplicateStatus = "none";
          duplicateOf = null;
        } else {
          duplicateStatus = "suspected";
        }
      }
    }

    // Persist
    await supabase.from("purchase_invoices").update({
      status: "processed",
      document_type: parsed.document_type,
      error_code: null,
      error_details: null,
      confidence_score: parsed.confidence_score,
      needs_review: (parsed.needs_review ?? false) || duplicateStatus === "suspected",
      raw_text: parsed.raw_text,
      extraction_notes: parsed.extraction_notes,
      merchant_name: parsed.merchant_name,
      merchant_tax_id: parsed.merchant_tax_id,
      merchant_address: parsed.merchant_address,
      merchant_country: parsed.merchant_country ?? "HU",
      buyer_name: parsed.buyer_name ?? null,
      buyer_tax_id: parsed.buyer_tax_id ?? null,
      buyer_address: parsed.buyer_address ?? null,
      buyer_company_id: buyerCompanyId,
      is_credit_note: isCreditNote,
      duplicate_of: duplicateOf,
      duplicate_status: duplicateStatus,
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date,
      due_date: parsed.due_date,
      performance_date: parsed.performance_date,
      currency: parsed.currency || "HUF",
      total_amount: parsed.total_amount,
      net_amount: parsed.net_amount,
      total_vat_amount: parsed.total_vat_amount,
      bottle_deposit_amount: parsed.bottle_deposit_amount ?? 0,
      payment_method: parsed.payment_method,
      expense_category: parsed.expense_category,
    }).eq("id", invoiceId);

    // Replace VAT lines
    await supabase.from("purchase_invoice_vat_lines").delete().eq("invoice_id", invoiceId);
    if (vatLines.length > 0) {
      await supabase.from("purchase_invoice_vat_lines").insert(
        vatLines.map((v: any) => ({ invoice_id: invoiceId, ...v }))
      );
    }

    // Replace items
    await supabase.from("purchase_invoice_items").delete().eq("invoice_id", invoiceId);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    if (items.length > 0) {
      await supabase.from("purchase_invoice_items").insert(
        items.map((it: any, idx: number) => ({
          invoice_id: invoiceId, position: idx,
          name_original: it.name_original,
          name_english: it.name_english,
          item_code: it.item_code,
          item_type: it.item_type,
          quantity: it.quantity,
          unit_price: it.unit_price,
          total_price: it.total_price,
          vat_rate: it.vat_rate,
        }))
      );
    }

    return new Response(JSON.stringify({ success: true, data: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-purchase-invoice error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
