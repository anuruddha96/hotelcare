/**
 * Számlázz.hu Számla Agent XML builders and response parsing.
 *
 * Pure module: no Deno/Node APIs, so the same file is unit-tested from vitest
 * (src/lib/szamlazz/agentXml.test.ts) and imported by the szamlazz-invoice
 * edge function.
 *
 * Protocol: one multipart/form-data POST per action to https://www.szamlazz.hu/szamla/
 * with the XML document as a file field whose NAME selects the action:
 *   action-xmlagentxmlfile   create invoice / proforma (xmlszamla)
 *   action-szamla_agent_st   reverse (storno) an invoice (xmlszamlast)
 *   action-szamla_agent_kifiz  register a payment (xmlszamlakifiz)
 *   action-szamla_agent_pdf  download the PDF of an invoice (xmlszamlapdf)
 * Success/failure is reported in response HTTP headers (szlahu_*).
 */

export type VatKey =
  | "27" | "18" | "5" | "0"
  | "AAM"   // alanyi adómentes (subject-exempt)
  | "TAM"   // tárgyi adómentes / tax-exempt activity
  | "EU" | "EUK" // intra-EU supply (taxable person / non-taxable)
  | "MAA"   // reverse charge (fordított adózás)
  | "F.AFA" // reverse charge VAT
  | "K.AFA" // outside-scope VAT
  | "TEHK"  // outside the territorial scope
  | "THK"   // outside the material scope (e.g. local tourist tax when passed through)
  | "KBAET" | "KBAUK" | "NAM" | "HO";

export const VAT_KEYS: readonly VatKey[] = [
  "27", "18", "5", "0", "AAM", "TAM", "EU", "EUK", "MAA", "F.AFA", "K.AFA", "TEHK", "THK", "KBAET", "KBAUK", "NAM", "HO",
] as const;

/** VAT keys that carry no VAT amount. */
const ZERO_VAT_KEYS = new Set<string>(["0", "AAM", "TAM", "EU", "EUK", "MAA", "F.AFA", "K.AFA", "TEHK", "THK", "KBAET", "KBAUK", "NAM", "HO"]);

export function vatRateFor(key: VatKey): number {
  if (ZERO_VAT_KEYS.has(key)) return 0;
  const n = Number(key);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`Unsupported VAT key: ${key}`);
  return n;
}

export function isVatKey(value: string): value is VatKey {
  return (VAT_KEYS as readonly string[]).includes(value);
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface AgentLineInput {
  description: string;
  quantity: number;
  unit: string;            // "éj", "db", "item"…
  grossUnitPrice: number;  // user-facing price, VAT inclusive
  vatKey: VatKey;
  comment?: string;
}

export interface AgentLine extends AgentLineInput {
  netUnitPrice: number;
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
}

/** Derive net/VAT/gross from a gross unit price the receptionist sees. */
export function computeLine(input: AgentLineInput): AgentLine {
  if (!input.description.trim()) throw new Error("Line description is required");
  if (!(input.quantity > 0)) throw new Error("Line quantity must be positive");
  if (!Number.isFinite(input.grossUnitPrice)) throw new Error("Line price must be a number");
  if (!isVatKey(input.vatKey)) throw new Error(`Unsupported VAT key: ${input.vatKey}`);
  const rate = vatRateFor(input.vatKey);
  const grossTotal = round2(input.grossUnitPrice * input.quantity);
  const netTotal = rate === 0 ? grossTotal : round2(grossTotal / (1 + rate / 100));
  const vatTotal = round2(grossTotal - netTotal);
  const netUnitPrice = round2(input.quantity === 0 ? 0 : netTotal / input.quantity);
  return { ...input, netUnitPrice, netTotal, vatTotal, grossTotal };
}

export function sumLines(lines: AgentLine[]): { net: number; vat: number; gross: number } {
  return {
    net: round2(lines.reduce((a, l) => a + l.netTotal, 0)),
    vat: round2(lines.reduce((a, l) => a + l.vatTotal, 0)),
    gross: round2(lines.reduce((a, l) => a + l.grossTotal, 0)),
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const tag = (name: string, value: string | number | boolean | undefined | null): string => {
  if (value === undefined || value === null || value === "") return "";
  const text = typeof value === "boolean" ? String(value) : typeof value === "number" ? formatNumber(value) : escapeXml(value);
  return `<${name}>${text}</${name}>`;
};

/** Számlázz.hu accepts dot-decimal numbers; avoid exponent notation. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error("Amount is not finite");
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export const PAYMENT_METHODS = ["átutalás", "készpénz", "bankkártya", "csekk", "utánvét", "ajándékutalvány", "barion", "barter", "csoportos beszedés", "OTP Simple", "kompenzáció", "kupon", "PayPal", "PayU", "SZÉP kártya", "utalvány"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface Buyer {
  name: string;
  zip: string;
  city: string;
  address: string;
  email?: string;
  taxNumber?: string;   // adószám, companies only
  sendEmail?: boolean;  // let Számlázz.hu email the invoice to the buyer
  comment?: string;
}

export interface Seller {
  bank?: string;
  bankAccount?: string;
  emailReplyTo?: string;
  emailSubject?: string;
  emailBody?: string;
}

export interface InvoiceOptions {
  agentKey: string;
  eInvoice?: boolean;       // default false → PDF invoice
  downloadPdf?: boolean;    // default false; PDF fetched on demand via buildPdfQueryXml
  proforma?: boolean;       // díjbekérő
  invoiceNumberPrefix?: string;
  issueDate: string;        // YYYY-MM-DD
  fulfillmentDate: string;  // teljesítés
  dueDate: string;          // fizetési határidő
  paymentMethod: PaymentMethod;
  currency: string;         // HUF, EUR…
  language?: "hu" | "en" | "de" | "it" | "ro" | "sk" | "hr" | "fr" | "es" | "cz" | "pl";
  comment?: string;
  exchangeBank?: string;    // required for non-HUF, e.g. "MNB"
  exchangeRate?: number;
  paid?: boolean;           // mark as settled at issue time
  seller?: Seller;
  buyer: Buyer;
  lines: AgentLine[];
}

export function buildInvoiceXml(o: InvoiceOptions): string {
  if (!o.agentKey) throw new Error("Agent key is required");
  if (o.lines.length === 0) throw new Error("At least one invoice line is required");
  const nonHuf = o.currency.toUpperCase() !== "HUF";
  if (nonHuf && !o.exchangeBank) throw new Error("exchangeBank (e.g. MNB) is required for non-HUF invoices");
  const items = o.lines.map((l) =>
    "<tetel>" +
    tag("megnevezes", l.description) +
    tag("mennyiseg", l.quantity) +
    tag("mennyisegiEgyseg", l.unit) +
    tag("nettoEgysegar", l.netUnitPrice) +
    tag("afakulcs", l.vatKey) +
    tag("nettoErtek", l.netTotal) +
    tag("afaErtek", l.vatTotal) +
    tag("bruttoErtek", l.grossTotal) +
    tag("megjegyzes", l.comment) +
    "</tetel>"
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">` +
    "<beallitasok>" +
    tag("szamlaagentkulcs", o.agentKey) +
    tag("eszamla", o.eInvoice === true) +
    tag("szamlaLetoltes", o.downloadPdf === true) +
    tag("valaszVerzio", 1) +
    "</beallitasok>" +
    "<fejlec>" +
    tag("keltDatum", o.issueDate) +
    tag("teljesitesDatum", o.fulfillmentDate) +
    tag("fizetesiHataridoDatum", o.dueDate) +
    tag("fizmod", o.paymentMethod) +
    tag("penznem", o.currency.toUpperCase()) +
    tag("szamlaNyelve", o.language ?? "hu") +
    tag("megjegyzes", o.comment) +
    tag("arfolyamBank", nonHuf ? o.exchangeBank : undefined) +
    tag("arfolyam", nonHuf ? o.exchangeRate : undefined) +
    tag("dijbekero", o.proforma === true) +
    tag("szamlaszamElotag", o.invoiceNumberPrefix) +
    tag("fizetve", o.paid === true) +
    "</fejlec>" +
    "<elado>" +
    tag("bank", o.seller?.bank) +
    tag("bankszamlaszam", o.seller?.bankAccount) +
    tag("emailReplyto", o.seller?.emailReplyTo) +
    tag("emailTargy", o.seller?.emailSubject) +
    tag("emailSzoveg", o.seller?.emailBody) +
    "</elado>" +
    "<vevo>" +
    tag("nev", o.buyer.name) +
    tag("irsz", o.buyer.zip) +
    tag("telepules", o.buyer.city) +
    tag("cim", o.buyer.address) +
    tag("email", o.buyer.email) +
    tag("sendEmail", o.buyer.sendEmail === true) +
    tag("adoszam", o.buyer.taxNumber) +
    tag("megjegyzes", o.buyer.comment) +
    "</vevo>" +
    `<tetelek>${items}</tetelek>` +
    "</xmlszamla>";
}

export function buildStornoXml(agentKey: string, invoiceNumber: string, eInvoice = false): string {
  if (!invoiceNumber) throw new Error("Invoice number is required");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<xmlszamlast xmlns="http://www.szamlazz.hu/xmlszamlast" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlast https://www.szamlazz.hu/szamla/docs/xsds/agentst/xmlszamlast.xsd">` +
    "<beallitasok>" +
    tag("szamlaagentkulcs", agentKey) +
    tag("eszamla", eInvoice) +
    tag("szamlaLetoltes", false) +
    "</beallitasok>" +
    "<fejlec>" +
    tag("szamlaszam", invoiceNumber) +
    "</fejlec>" +
    "</xmlszamlast>";
}

export function buildPdfQueryXml(agentKey: string, invoiceNumber: string): string {
  if (!invoiceNumber) throw new Error("Invoice number is required");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<xmlszamlapdf xmlns="http://www.szamlazz.hu/xmlszamlapdf" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlapdf https://www.szamlazz.hu/szamla/docs/xsds/agentpdf/xmlszamlapdf.xsd">` +
    tag("felhasznalo", "") +
    tag("jelszo", "") +
    tag("szamlaagentkulcs", agentKey) +
    tag("szamlaszam", invoiceNumber) +
    tag("valaszVerzio", 1) +
    "</xmlszamlapdf>";
}

export interface PaymentEntry {
  date: string;          // YYYY-MM-DD
  title: PaymentMethod | string;
  amount: number;
  comment?: string;
}

export function buildPaymentXml(agentKey: string, invoiceNumber: string, payments: PaymentEntry[], additive = false): string {
  if (!invoiceNumber) throw new Error("Invoice number is required");
  if (payments.length === 0 || payments.length > 5) throw new Error("1–5 payment entries are required");
  const items = payments.map((p) =>
    "<kifizetes>" + tag("datum", p.date) + tag("jogcim", p.title) + tag("osszeg", p.amount) + tag("megjegyzes", p.comment) + "</kifizetes>"
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<xmlszamlakifiz xmlns="http://www.szamlazz.hu/xmlszamlakifiz" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlakifiz https://www.szamlazz.hu/szamla/docs/xsds/agentkifiz/xmlszamlakifiz.xsd">` +
    tag("szamlaagentkulcs", agentKey) +
    tag("szamlaszam", invoiceNumber) +
    tag("additiv", additive) +
    items +
    "</xmlszamlakifiz>";
}

/** Field name that selects the Agent action in the multipart POST. */
export const ACTION_FIELDS = {
  invoice: "action-xmlagentxmlfile",
  storno: "action-szamla_agent_st",
  payment: "action-szamla_agent_kifiz",
  pdf: "action-szamla_agent_pdf",
} as const;

export interface AgentResult {
  ok: boolean;
  invoiceNumber: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  netTotal: number | null;
  grossTotal: number | null;
}

/** Success/failure travels in szlahu_* response headers (latin-1, URL-encoded message). */
export function parseAgentHeaders(get: (name: string) => string | null): AgentResult {
  const errorCode = get("szlahu_error_code");
  const rawError = get("szlahu_error");
  let errorMessage: string | null = null;
  if (rawError) {
    try { errorMessage = decodeURIComponent(rawError.replace(/\+/g, " ")); }
    catch { errorMessage = rawError; }
  }
  const num = (v: string | null) => (v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    ok: !errorCode,
    invoiceNumber: get("szlahu_szamlaszam"),
    errorCode,
    errorMessage,
    netTotal: num(get("szlahu_nettovegosszeg")),
    grossTotal: num(get("szlahu_bruttovegosszeg")),
  };
}
