/**
 * Field-provenance rules for completing uploaded documents from NAV data.
 *
 *  - Only matched pairs are considered. Verified matches (exact/manual/chain)
 *    may FILL empty fields; probable matches only PROPOSE values.
 *  - A value already on the document is NEVER overwritten. When NAV disagrees,
 *    the field is flagged as a CONFLICT for controlling.
 *  - The original OCR value, the NAV value and the final value are all kept.
 *  - NAV holds reported tax data, not the invoice PDF; nothing here implies
 *    that NAV is the source of the document image.
 */
import { companyNameSimilarity, invoiceNumberLoose, moneyTolerance, taxCore8 } from "./normalize.ts";
import { navVatRateToKind, type NavVatRate } from "./navResponse.ts";

export type ProvenanceAction = "fill" | "propose" | "conflict" | "equivalent";

export interface FieldProvenance {
  field: string;
  documentValue: string | number | null;
  navValue: string | number | null;
  finalValue: string | number | null;
  action: ProvenanceAction;
  rule: string;
  material: boolean;
}

export interface GapFillDocument {
  merchant_name: string | null;
  merchant_tax_id: string | null;
  merchant_address: string | null;
  merchant_bank_account?: string | null;
  buyer_name: string | null;
  buyer_tax_id: string | null;
  buyer_company_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  performance_date: string | null;
  due_date: string | null;
  payment_method: string | null;
  currency: string | null;
  currency_detected?: boolean;
  net_amount: number | null;
  total_vat_amount: number | null;
  total_amount: number | null;
  vat_line_count: number;
}

export interface GapFillNavVatLine {
  vatRate: NavVatRate;
  net: number | null;
  vat: number | null;
}

export interface GapFillNav {
  companyId: string;
  supplierTaxNumber: string;
  supplierName: string | null;
  supplierAddress?: string | null;
  supplierBankAccount?: string | null;
  customerTaxNumber: string | null;
  customerName?: string | null;
  invoiceNumber: string;
  issueDate: string | null;
  deliveryDate: string | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  currency: string | null;
  netAmount: number | null;
  vatAmount: number | null;
  grossAmount: number | null;
  vatSummary?: GapFillNavVatLine[] | null;
}

export interface GapFillPlan {
  fields: FieldProvenance[];
  /** Values to write (only empty document fields, verified matches only). */
  fills: Record<string, string | number>;
  /** VAT lines to insert when the document has none (verified matches only). */
  vatLines: Array<{ vat_kind: string; vat_rate: number | null; vat_base: number; vat_amount: number; source: "nav" }> | null;
  proposedVatLines: Array<{ vat_kind: string; vat_rate: number | null; vat_base: number; vat_amount: number }> | null;
  materialConflicts: number;
}

const VERIFIED = new Set(["exact_match", "manual_resolution", "correction_chain"]);
const MATCHED = new Set([...VERIFIED, "probable_match"]);

export const NAV_PAYMENT_METHODS: Record<string, string> = {
  TRANSFER: "bank_transfer", CASH: "cash", CARD: "card", VOUCHER: "voucher", OTHER: "other",
};

function empty(value: unknown): boolean {
  return value == null || (typeof value === "string" && !value.trim());
}

type Comparator = (doc: string | number, nav: string | number) => boolean;

const equalText: Comparator = (a, b) => String(a).trim().toUpperCase() === String(b).trim().toUpperCase();

export function planGapFill(doc: GapFillDocument, nav: GapFillNav, matchStatus: string): GapFillPlan {
  const plan: GapFillPlan = { fields: [], fills: {}, vatLines: null, proposedVatLines: null, materialConflicts: 0 };
  if (!MATCHED.has(matchStatus)) return plan;
  const verified = VERIFIED.has(matchStatus);
  const tol = moneyTolerance(nav.currency ?? doc.currency);
  const money: Comparator = (a, b) => Math.abs(Number(a) - Number(b)) <= tol || Math.abs(Math.abs(Number(a)) - Math.abs(Number(b))) <= tol;

  const consider = (field: string, docValue: string | number | null, navValue: string | number | null, compare: Comparator, material: boolean, rule: string) => {
    if (empty(navValue)) return;
    if (empty(docValue)) {
      const action: ProvenanceAction = verified ? "fill" : "propose";
      plan.fields.push({ field, documentValue: null, navValue, finalValue: verified ? navValue : null, action, rule, material });
      if (verified) plan.fills[field] = navValue as string | number;
      return;
    }
    if (compare(docValue as string | number, navValue as string | number)) {
      plan.fields.push({ field, documentValue: docValue, navValue, finalValue: docValue, action: "equivalent", rule, material });
      return;
    }
    plan.fields.push({ field, documentValue: docValue, navValue, finalValue: docValue, action: "conflict", rule: "document_and_nav_differ", material });
    if (material) plan.materialConflicts++;
  };

  consider("merchant_tax_id", doc.merchant_tax_id, nav.supplierTaxNumber, (a, b) => taxCore8(String(a)) === taxCore8(String(b)), true, "verified_supplier_tax_number");
  consider("merchant_name", doc.merchant_name, nav.supplierName, (a, b) => equalText(a, b) || companyNameSimilarity(String(a), String(b)) >= 0.5, false, "nav_supplier_name");
  consider("merchant_address", doc.merchant_address, nav.supplierAddress ?? null, () => true, false, "nav_supplier_address");
  if (doc.merchant_bank_account !== undefined) {
    consider("merchant_bank_account", doc.merchant_bank_account, nav.supplierBankAccount ?? null, (a, b) => String(a).replace(/\D/g, "") === String(b).replace(/\D/g, ""), true, "nav_supplier_bank_account");
  }
  consider("buyer_tax_id", doc.buyer_tax_id, nav.customerTaxNumber, (a, b) => taxCore8(String(a)) === taxCore8(String(b)), true, "verified_buyer_tax_number");
  consider("buyer_company_id", doc.buyer_company_id, nav.companyId, equalText, true, "legal_company_from_buyer_tax_number");
  consider("buyer_name", doc.buyer_name, nav.customerName ?? null, (a, b) => equalText(a, b) || companyNameSimilarity(String(a), String(b)) >= 0.5, false, "nav_customer_name");
  consider("invoice_number", doc.invoice_number, nav.invoiceNumber, (a, b) => invoiceNumberLoose(String(a)) === invoiceNumberLoose(String(b)), true, "nav_invoice_number");
  consider("invoice_date", doc.invoice_date, nav.issueDate, equalText, true, "nav_issue_date");
  consider("performance_date", doc.performance_date, nav.deliveryDate, equalText, true, "nav_performance_date");
  consider("due_date", doc.due_date, nav.paymentDate, equalText, false, "nav_payment_date");
  consider("payment_method", doc.payment_method, nav.paymentMethod ? NAV_PAYMENT_METHODS[nav.paymentMethod] ?? nav.paymentMethod.toLowerCase() : null,
    (a, b) => String(a).toLowerCase().replace(/[^a-z]/g, "").includes(String(b).toLowerCase().replace(/[^a-z]/g, "").slice(0, 4)), false, "nav_payment_method");
  // A defaulted (undetected) currency is treated as missing, not as a value.
  consider("currency", doc.currency_detected === false ? null : doc.currency, nav.currency, equalText, true, "nav_currency");
  consider("net_amount", doc.net_amount, nav.netAmount, money, true, "nav_net_amount");
  consider("total_vat_amount", doc.total_vat_amount, nav.vatAmount, money, true, "nav_vat_amount");
  consider("total_amount", doc.total_amount, nav.grossAmount, money, true, "nav_gross_amount");

  if (doc.vat_line_count === 0 && nav.vatSummary?.length) {
    const lines = nav.vatSummary
      .filter((l) => l.net != null || l.vat != null)
      .map((l) => ({
        vat_kind: navVatRateToKind(l.vatRate),
        vat_rate: l.vatRate.rate,
        vat_base: l.net ?? 0,
        vat_amount: l.vat ?? 0,
      }));
    if (lines.length) {
      if (verified) plan.vatLines = lines.map((l) => ({ ...l, source: "nav" as const }));
      else plan.proposedVatLines = lines;
      plan.fields.push({ field: "vat_breakdown", documentValue: null, navValue: `${lines.length} VAT line(s)`, finalValue: verified ? `${lines.length} VAT line(s)` : null, action: verified ? "fill" : "propose", rule: "nav_vat_summary", material: true });
    }
  }
  return plan;
}
