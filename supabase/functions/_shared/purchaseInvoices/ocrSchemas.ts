/**
 * Purchase-invoice OCR prompt and structured-output schemas, shared by process-purchase-invoice and its tests.
 * The tool schemas are JSON Schema (OpenAI tool calls); ocrProviders.ts converts them for Gemini's responseSchema.
 */

const nullableNumber = { type: ["number", "null"] };
const nullableString = { type: ["string", "null"] };

export const SYSTEM_PROMPT = `You are an OCR + invoice parsing engine specialized in Hungarian invoices and receipts.
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

export const EXTRACT_TOOL = {
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

export const TOTALS_TOOL = {
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
