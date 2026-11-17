/**
 * Parsers for NAV Online Számla v3.0 responses (read operations only).
 * Field names follow invoiceApi.xsd / invoiceData.xsd exactly.
 *
 * NAV returns HTTP 200 for every correctly-formed request, including business
 * errors; failures carry funcCode=ERROR plus an errorCode (GeneralErrorResponse)
 * and technical failures may arrive as GeneralExceptionResponse.
 */
import { booleanAt, child, children, descendant, numberAt, parseXml, textAt, type XmlNode } from "./xml.ts";

export type NavErrorCategory = "auth" | "config" | "transient" | "maintenance" | "query" | "unknown";

const AUTH_CODES = new Set([
  "INVALID_SECURITY_USER", "NOT_REGISTERED_CUSTOMER", "INVALID_CUSTOMER",
  "INVALID_USER_RELATION", "FORBIDDEN", "INVALID_PREDECESSOR_TAX_NUMBER",
]);
const CONFIG_CODES = new Set([
  "INVALID_REQUEST_SIGNATURE", "INVALID_PASSWORD_HASH_CRYPTO", "INVALID_REQUEST_SIGNATURE_HASH_CRYPTO",
  "INVALID_REQUEST_VERSION", "INVALID_HEADER_VERSION", "REQUEST_VERSION_NOT_ALLOWED", "INVALID_REQUEST",
]);
const TRANSIENT_CODES = new Set(["OPERATION_FAILED", "REQUEST_ID_NOT_UNIQUE", "INVALID_TIMESTAMP", "NETWORK_ERROR", "TIMEOUT"]);
const QUERY_CODES = new Set([
  "MULTIPLE_QUERY_RESULT_FOUND", "BAD_QUERY_PARAM_OVERLAP", "BAD_QUERY_PARAM_RANGE_EXCEEDED",
  "BAD_QUERY_PARAM_EQ_NOT_STANDALONE", "BAD_QUERY_PARAM_OPERATOR_COLLISION",
  "BAD_QUERY_PARAM_SUPPLIER_NOT_EXPECTED", "BAD_QUERY_PARAM_SUPPLIER_EXPECTED", "NOT_ALLOWED_EXCEPTION",
]);

export function classifyNavError(code: string | null, httpStatus: number | null): { category: NavErrorCategory; retryable: boolean } {
  if (code === "MAINTENANCE_MODE" || httpStatus === 503 || httpStatus === 527) return { category: "maintenance", retryable: true };
  if (code && AUTH_CODES.has(code)) return { category: "auth", retryable: false };
  if (code && CONFIG_CODES.has(code)) return { category: "config", retryable: false };
  if (code && TRANSIENT_CODES.has(code)) return { category: "transient", retryable: true };
  if (code && QUERY_CODES.has(code)) return { category: "query", retryable: false };
  if (httpStatus === 429 || httpStatus === 408 || (httpStatus != null && httpStatus >= 500)) return { category: "transient", retryable: true };
  if (httpStatus === 401) return { category: "auth", retryable: false };
  return { category: "unknown", retryable: false };
}

/** User-facing explanations keyed by NAV errorCode. Never include secrets. */
export const NAV_ERROR_HINTS: Record<string, string> = {
  INVALID_SECURITY_USER: "NAV rejected the technical user login or password. Re-enter the technical user credentials.",
  NOT_REGISTERED_CUSTOMER: "The tax number is not registered in NAV Online Számla.",
  INVALID_CUSTOMER: "The tax number is invalid or not allowed to use invoice services.",
  INVALID_USER_RELATION: "The technical user does not belong to this company's tax number.",
  FORBIDDEN: "The technical user lacks the 'query invoices' permission in NAV Online Számla.",
  INVALID_REQUEST_SIGNATURE: "NAV rejected the request signature. Check the XML signing key (aláírókulcs).",
  INVALID_TIMESTAMP: "The request clock differs from NAV by more than one day.",
  MAINTENANCE_MODE: "NAV Online Számla is under maintenance. HotelCare will retry automatically.",
  OPERATION_FAILED: "NAV reported a temporary processing error. HotelCare will retry automatically.",
  BAD_QUERY_PARAM_RANGE_EXCEEDED: "The NAV query window exceeded 35 days.",
  MULTIPLE_QUERY_RESULT_FOUND: "NAV holds more than one valid data report for this invoice number.",
};

export class NavApiError extends Error {
  readonly code: string | null;
  readonly httpStatus: number | null;
  readonly category: NavErrorCategory;
  readonly retryable: boolean;
  readonly validationMessages: string[];
  constructor(message: string, code: string | null, httpStatus: number | null, validationMessages: string[] = []) {
    super(message);
    this.name = "NavApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    const c = classifyNavError(code, httpStatus);
    this.category = c.category;
    this.retryable = c.retryable;
    this.validationMessages = validationMessages;
  }
  /** Safe, credential-free summary for logs and UI. */
  safeSummary(): { code: string | null; httpStatus: number | null; category: NavErrorCategory; message: string } {
    return {
      code: this.code,
      httpStatus: this.httpStatus,
      category: this.category,
      message: (this.code && NAV_ERROR_HINTS[this.code]) || this.message.slice(0, 300),
    };
  }
}

export interface NavResultInfo {
  funcCode: string | null;
  errorCode: string | null;
  message: string | null;
}

export function parseNavEnvelope(xml: string, httpStatus: number | null = 200): { root: XmlNode; result: NavResultInfo } {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (error) {
    throw new NavApiError(`NAV returned a non-XML response${httpStatus ? ` (HTTP ${httpStatus})` : ""}`, null, httpStatus);
  }
  const resultNode = root.local === "GeneralExceptionResponse" ? root : child(root, "result");
  const result: NavResultInfo = {
    funcCode: textAt(resultNode, "funcCode"),
    errorCode: textAt(resultNode, "errorCode"),
    message: textAt(resultNode, "message"),
  };
  const isError = root.local === "GeneralErrorResponse" || root.local === "GeneralExceptionResponse" ||
    result.funcCode === "ERROR" || (httpStatus != null && httpStatus >= 400);
  if (isError) {
    const validation = children(root, "technicalValidationMessages")
      .map((m) => [textAt(m, "validationErrorCode"), textAt(m, "message")].filter(Boolean).join(": "))
      .filter(Boolean);
    throw new NavApiError(result.message || `NAV request failed${result.errorCode ? ` (${result.errorCode})` : ""}`,
      result.errorCode, httpStatus, validation);
  }
  return { root, result };
}

export type NavInvoiceOperation = "CREATE" | "MODIFY" | "STORNO";

export interface NavDigest {
  invoiceNumber: string;
  batchIndex: number | null;
  invoiceOperation: NavInvoiceOperation;
  invoiceCategory: string | null;
  invoiceIssueDate: string | null;
  supplierTaxNumber: string;
  supplierGroupMemberTaxNumber: string | null;
  supplierName: string | null;
  customerTaxNumber: string | null;
  customerGroupMemberTaxNumber: string | null;
  customerName: string | null;
  paymentMethod: string | null;
  paymentDate: string | null;
  invoiceAppearance: string | null;
  source: string | null;
  invoiceDeliveryDate: string | null;
  currency: string | null;
  invoiceNetAmount: number | null;
  invoiceNetAmountHUF: number | null;
  invoiceVatAmount: number | null;
  invoiceVatAmountHUF: number | null;
  /** Derived: net + VAT in invoice currency (the digest has no gross field). */
  grossAmount: number | null;
  grossAmountHUF: number | null;
  transactionId: string | null;
  index: number | null;
  originalInvoiceNumber: string | null;
  modificationIndex: number | null;
  insDate: string;
  completenessIndicator: boolean | null;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum2(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : round2(a + b);
}

export function parseDigestNode(node: XmlNode): NavDigest {
  const op = (textAt(node, "invoiceOperation") ?? "CREATE").toUpperCase();
  const net = numberAt(node, "invoiceNetAmount");
  const vat = numberAt(node, "invoiceVatAmount");
  const netHuf = numberAt(node, "invoiceNetAmountHUF");
  const vatHuf = numberAt(node, "invoiceVatAmountHUF");
  const invoiceNumber = textAt(node, "invoiceNumber");
  const supplierTaxNumber = textAt(node, "supplierTaxNumber");
  const insDate = textAt(node, "insDate");
  if (!invoiceNumber || !supplierTaxNumber || !insDate) {
    throw new NavApiError("NAV digest item is missing mandatory fields", "INVALID_DIGEST", 200);
  }
  return {
    invoiceNumber,
    batchIndex: numberAt(node, "batchIndex"),
    invoiceOperation: (["CREATE", "MODIFY", "STORNO"].includes(op) ? op : "CREATE") as NavInvoiceOperation,
    invoiceCategory: textAt(node, "invoiceCategory"),
    invoiceIssueDate: textAt(node, "invoiceIssueDate"),
    supplierTaxNumber,
    supplierGroupMemberTaxNumber: textAt(node, "supplierGroupMemberTaxNumber"),
    supplierName: textAt(node, "supplierName"),
    customerTaxNumber: textAt(node, "customerTaxNumber"),
    customerGroupMemberTaxNumber: textAt(node, "customerGroupMemberTaxNumber"),
    customerName: textAt(node, "customerName"),
    paymentMethod: textAt(node, "paymentMethod"),
    paymentDate: textAt(node, "paymentDate"),
    invoiceAppearance: textAt(node, "invoiceAppearance"),
    source: textAt(node, "source"),
    invoiceDeliveryDate: textAt(node, "invoiceDeliveryDate"),
    currency: textAt(node, "currency"),
    invoiceNetAmount: net,
    invoiceNetAmountHUF: netHuf,
    invoiceVatAmount: vat,
    invoiceVatAmountHUF: vatHuf,
    grossAmount: sum2(net, vat),
    grossAmountHUF: sum2(netHuf, vatHuf),
    transactionId: textAt(node, "transactionId"),
    index: numberAt(node, "index"),
    originalInvoiceNumber: textAt(node, "originalInvoiceNumber"),
    modificationIndex: numberAt(node, "modificationIndex"),
    insDate,
    completenessIndicator: booleanAt(node, "completenessIndicator"),
  };
}

export interface DigestPage {
  currentPage: number;
  availablePage: number;
  digests: NavDigest[];
}

export function parseInvoiceDigestResponse(xml: string, httpStatus = 200): DigestPage {
  const { root } = parseNavEnvelope(xml, httpStatus);
  const result = child(root, "invoiceDigestResult");
  if (!result) throw new NavApiError("NAV digest response has no invoiceDigestResult", "INVALID_RESPONSE", httpStatus);
  return {
    currentPage: numberAt(result, "currentPage") ?? 0,
    availablePage: numberAt(result, "availablePage") ?? 0,
    digests: children(result, "invoiceDigest").map(parseDigestNode),
  };
}

/**
 * Stable identity of one NAV data report. NAV may list the same invoice
 * number more than once when a supplier reported it twice (separate
 * transactions), so transactionId/index/insDate are part of the key.
 */
export function navSourceKey(d: Pick<NavDigest, "supplierTaxNumber" | "invoiceNumber" | "batchIndex" | "transactionId" | "index" | "insDate">): string {
  return [
    d.supplierTaxNumber,
    d.invoiceNumber.trim().toUpperCase(),
    d.batchIndex ?? "",
    d.transactionId ?? "",
    d.index ?? "",
    d.insDate,
  ].join("|");
}

export interface InvoiceDataResult {
  invoiceDataBase64: string;
  compressed: boolean;
  audit: {
    insDate: string | null;
    insCusUser: string | null;
    source: string | null;
    transactionId: string | null;
    index: number | null;
    batchIndex: number | null;
    originalRequestVersion: string | null;
  };
}

/** Returns null when NAV found no single valid instance (empty OK response). */
export function parseInvoiceDataResponse(xml: string, httpStatus = 200): InvoiceDataResult | null {
  const { root } = parseNavEnvelope(xml, httpStatus);
  const result = child(root, "invoiceDataResult");
  if (!result) return null;
  const data = textAt(result, "invoiceData");
  if (!data) return null;
  const audit = child(result, "auditData");
  return {
    invoiceDataBase64: data.replace(/\s+/g, ""),
    compressed: booleanAt(result, "compressedContentIndicator") === true,
    audit: {
      insDate: textAt(audit, "insdate") ?? textAt(audit, "insDate"),
      insCusUser: textAt(audit, "insCusUser"),
      source: textAt(audit, "source"),
      transactionId: textAt(audit, "transactionId"),
      index: numberAt(audit, "index"),
      batchIndex: numberAt(audit, "batchIndex"),
      originalRequestVersion: textAt(audit, "originalRequestVersion"),
    },
  };
}

const MAX_INVOICE_XML_BYTES = 20 * 1024 * 1024;

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const source = new Response(bytes).body;
  if (!source) throw new NavApiError("Compressed NAV invoice data is empty", "INVALID_INVOICE_DATA", 200);
  const buffer = await new Response(source.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return new Uint8Array(buffer);
}

/** BASE64 → (optional gzip) → UTF-8 invoice XML, as described in spec 1.6.5. */
export async function decodeInvoiceData(base64: string, compressed: boolean): Promise<string> {
  let bytes = base64ToBytes(base64);
  if (compressed) bytes = await gunzip(bytes);
  if (bytes.length > MAX_INVOICE_XML_BYTES) throw new NavApiError("Decoded NAV invoice exceeds the safe size limit", "INVOICE_TOO_LARGE", 200);
  return new TextDecoder("utf-8").decode(bytes);
}

export interface NavVatRate {
  /** percentage | content | exemption | out_of_scope | domestic_reverse_charge | margin_scheme | vat_amount_mismatch | no_vat_charge */
  kind: string;
  /** Percentage points (27 for 27 %) when kind is percentage/content. */
  rate: number | null;
  case: string | null;
  reason: string | null;
}

export interface NavVatSummaryLine {
  vatRate: NavVatRate;
  net: number | null;
  netHUF: number | null;
  vat: number | null;
  vatHUF: number | null;
  gross: number | null;
  grossHUF: number | null;
}

export interface NavInvoiceLine {
  lineNumber: number | null;
  description: string | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  unitPrice: number | null;
  net: number | null;
  vat: number | null;
  gross: number | null;
  vatRate: NavVatRate | null;
  advanceIndicator: boolean | null;
  lineOperation: string | null;
}

export interface NavParty {
  taxNumber: string | null;
  taxpayerId: string | null;
  communityVatNumber: string | null;
  thirdStateTaxId: string | null;
  name: string | null;
  address: string | null;
  countryCode: string | null;
  bankAccountNumber: string | null;
  vatStatus: string | null;
}

export interface NavInvoiceDetail {
  invoiceNumber: string | null;
  issueDate: string | null;
  completenessIndicator: boolean | null;
  reference: { originalInvoiceNumber: string; modifyWithoutMaster: boolean | null; modificationIndex: number | null } | null;
  supplier: NavParty;
  customer: NavParty | null;
  category: string | null;
  deliveryDate: string | null;
  deliveryPeriodStart: string | null;
  deliveryPeriodEnd: string | null;
  currency: string | null;
  exchangeRate: number | null;
  paymentMethod: string | null;
  paymentDate: string | null;
  appearance: string | null;
  cashAccounting: boolean | null;
  smallBusiness: boolean | null;
  selfBilling: boolean | null;
  netAmount: number | null;
  netAmountHUF: number | null;
  vatAmount: number | null;
  vatAmountHUF: number | null;
  grossAmount: number | null;
  grossAmountHUF: number | null;
  vatSummary: NavVatSummaryLine[];
  lines: NavInvoiceLine[];
  batchIndex: number | null;
}

// Simplified-invoice VAT content ratios → standard rates.
const VAT_CONTENT_TO_RATE: Array<[number, number]> = [[0.2126, 27], [0.1525, 18], [0.0476, 5]];

export function parseVatRate(node: XmlNode | undefined): NavVatRate | null {
  if (!node) return null;
  const pct = numberAt(node, "vatPercentage");
  if (pct != null) return { kind: "percentage", rate: round2(pct * 100), case: null, reason: null };
  const content = numberAt(node, "vatContent");
  if (content != null) {
    const match = VAT_CONTENT_TO_RATE.find(([c]) => Math.abs(c - content) < 0.0005);
    return { kind: "content", rate: match ? match[1] : null, case: String(content), reason: null };
  }
  const exemption = child(node, "vatExemption");
  if (exemption) return { kind: "exemption", rate: 0, case: textAt(exemption, "case"), reason: textAt(exemption, "reason") };
  const outOfScope = child(node, "vatOutOfScope");
  if (outOfScope) return { kind: "out_of_scope", rate: 0, case: textAt(outOfScope, "case"), reason: textAt(outOfScope, "reason") };
  if (child(node, "vatDomesticReverseCharge")) return { kind: "domestic_reverse_charge", rate: 0, case: null, reason: null };
  if (child(node, "marginSchemeIndicator")) return { kind: "margin_scheme", rate: null, case: textAt(node, "marginSchemeIndicator"), reason: null };
  const mismatch = child(node, "vatAmountMismatch");
  if (mismatch) return { kind: "vat_amount_mismatch", rate: numberAt(mismatch, "vatRate") != null ? round2((numberAt(mismatch, "vatRate") ?? 0) * 100) : null, case: textAt(mismatch, "case"), reason: null };
  if (child(node, "noVatCharge")) return { kind: "no_vat_charge", rate: 0, case: null, reason: null };
  return { kind: "unknown", rate: null, case: null, reason: null };
}

/** Map a NAV VAT rate to HotelCare's purchase_invoice_vat_lines.vat_kind values. */
export function navVatRateToKind(rate: NavVatRate | null): string {
  if (!rate) return "unknown";
  if (rate.kind === "percentage" || rate.kind === "content") {
    if (rate.rate === 27) return "standard_27";
    if (rate.rate === 18) return "reduced_18";
    if (rate.rate === 5) return "reduced_5";
    if (rate.rate === 0) return "zero";
    return "other_rate";
  }
  if (rate.kind === "exemption") return rate.case === "AAM" ? "aam_exempt" : "exempt";
  if (rate.kind === "out_of_scope") {
    if (rate.case === "EUFAD37" || rate.case === "EUFADE" || rate.case === "EUE") return "eu_intra";
    if (rate.case === "HO") return "export";
    return "out_of_scope";
  }
  if (rate.kind === "domestic_reverse_charge") return "kba_reverse";
  return rate.kind;
}

function formatTaxNumber(node: XmlNode | undefined): { full: string | null; core: string | null } {
  if (!node) return { full: null, core: null };
  const core = textAt(node, "taxpayerId");
  const vat = textAt(node, "vatCode");
  const county = textAt(node, "countyCode");
  if (!core) return { full: null, core: null };
  return { full: [core, vat, county].filter(Boolean).join("-"), core };
}

function formatAddress(node: XmlNode | undefined): { text: string | null; country: string | null } {
  const inner = child(node, "simpleAddress") ?? child(node, "detailedAddress");
  if (!inner) return { text: null, country: null };
  const country = textAt(inner, "countryCode");
  const parts = inner.local === "simpleAddress"
    ? [textAt(inner, "postalCode"), textAt(inner, "city"), textAt(inner, "additionalAddressDetail")]
    : [textAt(inner, "postalCode"), textAt(inner, "city"),
      [textAt(inner, "streetName"), textAt(inner, "publicPlaceCategory"), textAt(inner, "number")].filter(Boolean).join(" "),
      [textAt(inner, "building"), textAt(inner, "staircase"), textAt(inner, "floor"), textAt(inner, "door")].filter(Boolean).join(" ")];
  const text = parts.filter((p) => p && String(p).trim()).join(", ");
  return { text: text || null, country };
}

function parseInvoiceNode(invoice: XmlNode, batchIndex: number | null, headerNumber: string | null, headerDate: string | null, completeness: boolean | null): NavInvoiceDetail {
  const reference = child(invoice, "invoiceReference");
  const head = child(invoice, "invoiceHead");
  const supplierInfo = child(head, "supplierInfo");
  const customerInfo = child(head, "customerInfo");
  const detail = child(head, "invoiceDetail");
  const summary = child(invoice, "invoiceSummary");
  const normal = child(summary, "summaryNormal");
  const grossData = child(summary, "summaryGrossData");

  const supplierTax = formatTaxNumber(child(supplierInfo, "supplierTaxNumber"));
  const supplierAddr = formatAddress(child(supplierInfo, "supplierAddress"));
  const supplier: NavParty = {
    taxNumber: supplierTax.full,
    taxpayerId: supplierTax.core,
    communityVatNumber: textAt(supplierInfo, "communityVatNumber"),
    thirdStateTaxId: null,
    name: textAt(supplierInfo, "supplierName"),
    address: supplierAddr.text,
    countryCode: supplierAddr.country,
    bankAccountNumber: textAt(supplierInfo, "supplierBankAccountNumber"),
    vatStatus: null,
  };

  let customer: NavParty | null = null;
  if (customerInfo) {
    const vatData = child(customerInfo, "customerVatData");
    const customerTax = formatTaxNumber(child(vatData, "customerTaxNumber"));
    const customerAddr = formatAddress(child(customerInfo, "customerAddress"));
    customer = {
      taxNumber: customerTax.full,
      taxpayerId: customerTax.core,
      communityVatNumber: textAt(vatData, "communityVatNumber"),
      thirdStateTaxId: textAt(vatData, "thirdStateTaxId"),
      name: textAt(customerInfo, "customerName"),
      address: customerAddr.text,
      countryCode: customerAddr.country,
      bankAccountNumber: textAt(customerInfo, "customerBankAccountNumber"),
      vatStatus: textAt(customerInfo, "customerVatStatus"),
    };
  }

  const vatSummary: NavVatSummaryLine[] = normal
    ? children(normal, "summaryByVatRate").map((s) => ({
      vatRate: parseVatRate(child(s, "vatRate")) ?? { kind: "unknown", rate: null, case: null, reason: null },
      net: numberAt(s, "vatRateNetData", "vatRateNetAmount"),
      netHUF: numberAt(s, "vatRateNetData", "vatRateNetAmountHUF"),
      vat: numberAt(s, "vatRateVatData", "vatRateVatAmount"),
      vatHUF: numberAt(s, "vatRateVatData", "vatRateVatAmountHUF"),
      gross: numberAt(s, "vatRateGrossData", "vatRateGrossAmount"),
      grossHUF: numberAt(s, "vatRateGrossData", "vatRateGrossAmountHUF"),
    }))
    : children(summary, "summarySimplified").map((s) => ({
      vatRate: parseVatRate(child(s, "vatRate")) ?? { kind: "unknown", rate: null, case: null, reason: null },
      net: null, netHUF: null, vat: null, vatHUF: null,
      gross: numberAt(s, "vatContentGrossAmount"),
      grossHUF: numberAt(s, "vatContentGrossAmountHUF"),
    }));

  const lines: NavInvoiceLine[] = children(child(invoice, "invoiceLines"), "line").map((line) => {
    const normalAmounts = child(line, "lineAmountsNormal");
    const simplified = child(line, "lineAmountsSimplified");
    return {
      lineNumber: numberAt(line, "lineNumber"),
      description: textAt(line, "lineDescription"),
      quantity: numberAt(line, "quantity"),
      unitOfMeasure: textAt(line, "unitOfMeasureOwn") ?? textAt(line, "unitOfMeasure"),
      unitPrice: numberAt(line, "unitPrice"),
      net: numberAt(normalAmounts, "lineNetAmountData", "lineNetAmount"),
      vat: numberAt(normalAmounts, "lineVatData", "lineVatAmount"),
      gross: numberAt(normalAmounts, "lineGrossAmountData", "lineGrossAmountNormal") ?? numberAt(simplified, "lineGrossAmountSimplified"),
      vatRate: parseVatRate(child(normalAmounts, "lineVatRate") ?? child(simplified, "lineVatRate")),
      advanceIndicator: booleanAt(line, "advanceData", "advanceIndicator"),
      lineOperation: textAt(line, "lineModificationReference", "lineOperation"),
    };
  });

  const netAmount = numberAt(normal, "invoiceNetAmount");
  const vatAmount = numberAt(normal, "invoiceVatAmount");
  const grossAmount = numberAt(grossData, "invoiceGrossAmount") ?? sum2(netAmount, vatAmount) ??
    (vatSummary.length && vatSummary.every((v) => v.gross != null) ? round2(vatSummary.reduce((s, v) => s + (v.gross ?? 0), 0)) : null);
  const netAmountHUF = numberAt(normal, "invoiceNetAmountHUF");
  const vatAmountHUF = numberAt(normal, "invoiceVatAmountHUF");

  return {
    invoiceNumber: headerNumber,
    issueDate: headerDate,
    completenessIndicator: completeness,
    reference: reference && textAt(reference, "originalInvoiceNumber")
      ? {
        originalInvoiceNumber: textAt(reference, "originalInvoiceNumber") as string,
        modifyWithoutMaster: booleanAt(reference, "modifyWithoutMaster"),
        modificationIndex: numberAt(reference, "modificationIndex"),
      }
      : null,
    supplier,
    customer,
    category: textAt(detail, "invoiceCategory"),
    deliveryDate: textAt(detail, "invoiceDeliveryDate"),
    deliveryPeriodStart: textAt(detail, "invoiceDeliveryPeriodStart"),
    deliveryPeriodEnd: textAt(detail, "invoiceDeliveryPeriodEnd"),
    currency: textAt(detail, "currencyCode"),
    exchangeRate: numberAt(detail, "exchangeRate"),
    paymentMethod: textAt(detail, "paymentMethod"),
    paymentDate: textAt(detail, "paymentDate"),
    appearance: textAt(detail, "invoiceAppearance"),
    cashAccounting: booleanAt(detail, "cashAccountingIndicator"),
    smallBusiness: booleanAt(detail, "smallBusinessIndicator"),
    selfBilling: booleanAt(detail, "selfBillingIndicator"),
    netAmount,
    netAmountHUF,
    vatAmount,
    vatAmountHUF,
    grossAmount,
    grossAmountHUF: numberAt(grossData, "invoiceGrossAmountHUF") ?? sum2(netAmountHUF, vatAmountHUF),
    vatSummary,
    lines,
    batchIndex,
  };
}

/**
 * Parse decoded InvoiceData XML (data namespace). For batch modifications the
 * entry matching batchIndex is returned (or the first one when not given).
 */
export function parseInvoiceDataXml(invoiceXml: string, batchIndex: number | null = null): NavInvoiceDetail {
  const root = parseXml(invoiceXml);
  if (root.local !== "InvoiceData") throw new NavApiError("Decoded NAV invoice is not an InvoiceData document", "INVALID_INVOICE_DATA", 200);
  const headerNumber = textAt(root, "invoiceNumber");
  const headerDate = textAt(root, "invoiceIssueDate");
  const completeness = booleanAt(root, "completenessIndicator");
  const main = child(root, "invoiceMain");
  const single = child(main, "invoice");
  if (single) return parseInvoiceNode(single, null, headerNumber, headerDate, completeness);
  const batches = children(main, "batchInvoice");
  if (!batches.length) throw new NavApiError("NAV invoice contains no invoice body", "INVALID_INVOICE_DATA", 200);
  const chosen = batches.find((b) => numberAt(b, "batchIndex") === batchIndex) ?? batches[0];
  const inner = child(chosen, "invoice") ?? descendant(chosen, "invoice");
  if (!inner) throw new NavApiError("NAV batch invoice has no invoice body", "INVALID_INVOICE_DATA", 200);
  return parseInvoiceNode(inner, numberAt(chosen, "batchIndex"), headerNumber, headerDate, completeness);
}

export interface TaxpayerResult {
  valid: boolean | null;
  name: string | null;
  shortName: string | null;
  taxpayerId: string | null;
  taxNumber: string | null;
  incorporation: string | null;
}

export function parseTaxpayerResponse(xml: string, httpStatus = 200): TaxpayerResult {
  const { root } = parseNavEnvelope(xml, httpStatus);
  const data = child(root, "taxpayerData");
  const tax = formatTaxNumber(child(data, "taxNumberDetail"));
  return {
    valid: booleanAt(root, "taxpayerValidity"),
    name: textAt(data, "taxpayerName"),
    shortName: textAt(data, "taxpayerShortName"),
    taxpayerId: tax.core,
    taxNumber: tax.full,
    incorporation: textAt(data, "incorporation"),
  };
}

export interface ChainElement {
  invoiceNumber: string;
  batchIndex: number | null;
  invoiceOperation: string;
  supplierTaxNumber: string | null;
  customerTaxNumber: string | null;
  insDate: string | null;
  originalInvoiceNumber: string | null;
  modificationIndex: number | null;
}

export function parseInvoiceChainDigestResponse(xml: string, httpStatus = 200): { currentPage: number; availablePage: number; elements: ChainElement[] } {
  const { root } = parseNavEnvelope(xml, httpStatus);
  const result = child(root, "invoiceChainDigestResult");
  return {
    currentPage: numberAt(result, "currentPage") ?? 0,
    availablePage: numberAt(result, "availablePage") ?? 0,
    elements: children(result, "invoiceChainElement").map((el) => {
      const digest = child(el, "invoiceChainDigest");
      const ref = child(el, "invoiceReferenceData");
      return {
        invoiceNumber: textAt(digest, "invoiceNumber") ?? "",
        batchIndex: numberAt(digest, "batchIndex"),
        invoiceOperation: textAt(digest, "invoiceOperation") ?? "CREATE",
        supplierTaxNumber: textAt(digest, "supplierTaxNumber"),
        customerTaxNumber: textAt(digest, "customerTaxNumber"),
        insDate: textAt(digest, "insDate"),
        originalInvoiceNumber: textAt(ref, "originalInvoiceNumber"),
        modificationIndex: numberAt(ref, "modificationIndex"),
      };
    }),
  };
}
