/**
 * Request XML builders for the read-only NAV Online Számla v3.0 operations
 * HotelCare uses. Element names, order and namespaces follow the official
 * invoiceApi.xsd (OSA 3.0) and common.xsd (NTCA 1.0):
 *   https://github.com/nav-gov-hu/Online-Invoice/tree/master/src/schemas
 *
 * Only INBOUND (customer-side) queries are built. manageInvoice,
 * manageAnnulment and tokenExchange are deliberately NOT implemented: this
 * integration never submits or annuls invoice data at NAV.
 */
import {
  navPasswordHash, navRequestSignature, navTimestamp, newNavRequestId,
  NAV_PASSWORD_CRYPTO, NAV_SIGNATURE_CRYPTO,
} from "./navCrypto.ts";
import { escapeXml } from "./xml.ts";

export const NS_API = "http://schemas.nav.gov.hu/OSA/3.0/api";
export const NS_COMMON = "http://schemas.nav.gov.hu/NTCA/1.0/common";
export const NAV_REQUEST_VERSION = "3.0";
export const NAV_HEADER_VERSION = "1.0";

export type NavEnvironment = "test" | "production";

export const NAV_BASE_URLS: Record<NavEnvironment, string> = {
  test: "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3",
  production: "https://api.onlineszamla.nav.gov.hu/invoiceService/v3",
};

export type NavReadOperation =
  | "queryInvoiceDigest"
  | "queryInvoiceData"
  | "queryInvoiceChainDigest"
  | "queryTaxpayer";

export interface NavSoftware {
  softwareId: string;
  softwareName: string;
  softwareOperation: "LOCAL_SOFTWARE" | "ONLINE_SERVICE";
  softwareMainVersion: string;
  softwareDevName: string;
  softwareDevContact: string;
  softwareDevCountryCode?: string;
  softwareDevTaxNumber?: string;
}

export interface NavAuth {
  login: string;
  password: string;
  signingKey: string;
  /** First 8 digits of the legal company's Hungarian tax number. */
  taxNumber: string;
}

export interface BuiltRequest {
  operation: NavReadOperation;
  requestId: string;
  timestamp: string;
  xml: string;
}

export class NavConfigError extends Error {}

export function validateSoftware(software: NavSoftware): void {
  if (!/^[0-9A-Z-]{18}$/.test(software.softwareId)) {
    throw new NavConfigError("NAV softwareId must be exactly 18 characters of 0-9, A-Z or '-'");
  }
  for (const [key, max] of [["softwareName", 50], ["softwareMainVersion", 15], ["softwareDevName", 512], ["softwareDevContact", 200]] as const) {
    const value = String(software[key] ?? "").trim();
    if (!value || value.length > max) throw new NavConfigError(`NAV software field ${key} is missing or too long`);
  }
  if (software.softwareDevCountryCode && !/^[A-Z]{2}$/.test(software.softwareDevCountryCode)) {
    throw new NavConfigError("NAV softwareDevCountryCode must be an ISO 3166 alpha-2 code");
  }
}

/** Build HotelCare's NAV software identity from server-side environment values. */
export function softwareFromEnv(get: (name: string) => string | undefined): NavSoftware {
  const devTax = (get("NAV_SOFTWARE_DEV_TAX_NUMBER") ?? "").replace(/\D/g, "").slice(0, 8);
  const explicitId = (get("NAV_SOFTWARE_ID") ?? "").trim().toUpperCase();
  const softwareId = explicitId || (devTax.length === 8 ? `HU${devTax}-HCARE01` : "");
  const software: NavSoftware = {
    softwareId,
    softwareName: (get("NAV_SOFTWARE_NAME") ?? "HotelCare").trim(),
    softwareOperation: "ONLINE_SERVICE",
    softwareMainVersion: (get("NAV_SOFTWARE_VERSION") ?? "1.0").trim(),
    softwareDevName: (get("NAV_SOFTWARE_DEV_NAME") ?? "").trim(),
    softwareDevContact: (get("NAV_SOFTWARE_DEV_CONTACT") ?? "").trim(),
    softwareDevCountryCode: "HU",
    softwareDevTaxNumber: devTax.length === 8 ? devTax : undefined,
  };
  if (!software.softwareId || !software.softwareDevName || !software.softwareDevContact) {
    throw new NavConfigError(
      "NAV software identity is not configured. Set NAV_SOFTWARE_DEV_TAX_NUMBER (or NAV_SOFTWARE_ID), NAV_SOFTWARE_DEV_NAME and NAV_SOFTWARE_DEV_CONTACT as Edge Function secrets.",
    );
  }
  validateSoftware(software);
  return software;
}

export function normalizeTaxNumber8(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/^\s*HU/i, "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : null;
}

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) {
    throw new NavConfigError(`${label} must be a YYYY-MM-DD date`);
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) {
    throw new NavConfigError(`${label} must be a UTC timestamp`);
  }
}

async function envelope(
  root: string,
  auth: NavAuth,
  software: NavSoftware,
  body: string,
  now: Date,
): Promise<{ xml: string; requestId: string; timestamp: string }> {
  if (!/^[0-9]{8}$/.test(auth.taxNumber)) throw new NavConfigError("NAV taxNumber must be the 8-digit core tax number");
  if (!/^[a-zA-Z0-9]{6,15}$/.test(auth.login)) throw new NavConfigError("NAV technical user login is invalid");
  validateSoftware(software);
  const requestId = newNavRequestId("HC", now);
  const timestamp = navTimestamp(now);
  const passwordHash = await navPasswordHash(auth.password);
  const signature = navRequestSignature(requestId, timestamp, auth.signingKey);
  const optional = (tag: string, value?: string) => (value ? `<${tag}>${escapeXml(value)}</${tag}>` : "");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${NS_API}" xmlns:common="${NS_COMMON}">
<common:header>
<common:requestId>${escapeXml(requestId)}</common:requestId>
<common:timestamp>${escapeXml(timestamp)}</common:timestamp>
<common:requestVersion>${NAV_REQUEST_VERSION}</common:requestVersion>
<common:headerVersion>${NAV_HEADER_VERSION}</common:headerVersion>
</common:header>
<common:user>
<common:login>${escapeXml(auth.login)}</common:login>
<common:passwordHash cryptoType="${NAV_PASSWORD_CRYPTO}">${passwordHash}</common:passwordHash>
<common:taxNumber>${escapeXml(auth.taxNumber)}</common:taxNumber>
<common:requestSignature cryptoType="${NAV_SIGNATURE_CRYPTO}">${signature}</common:requestSignature>
</common:user>
<software>
<softwareId>${escapeXml(software.softwareId)}</softwareId>
<softwareName>${escapeXml(software.softwareName)}</softwareName>
<softwareOperation>${escapeXml(software.softwareOperation)}</softwareOperation>
<softwareMainVersion>${escapeXml(software.softwareMainVersion)}</softwareMainVersion>
<softwareDevName>${escapeXml(software.softwareDevName)}</softwareDevName>
<softwareDevContact>${escapeXml(software.softwareDevContact)}</softwareDevContact>
${optional("softwareDevCountryCode", software.softwareDevCountryCode)}${optional("softwareDevTaxNumber", software.softwareDevTaxNumber)}
</software>
${body}
</${root}>`;
  return { xml, requestId, timestamp };
}

export interface DigestQuery {
  page: number;
  /** Issue-date window (max 35 days per NAV). */
  issueDate?: { from: string; to: string };
  /** NAV processing-time window in UTC (max 35 days per NAV). */
  insDate?: { from: string; to: string };
  /** Query a whole invoice chain by its base invoice number. */
  originalInvoiceNumber?: string;
  /** Optional narrowing by supplier tax number (customer-side "double value" param). */
  supplierTaxNumber?: string;
}

export const NAV_MAX_QUERY_DAYS = 35;

export function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

export async function buildQueryInvoiceDigest(
  auth: NavAuth, software: NavSoftware, query: DigestQuery, now = new Date(),
): Promise<BuiltRequest> {
  if (!Number.isInteger(query.page) || query.page < 1) throw new NavConfigError("NAV page must be >= 1");
  const modes = [query.issueDate, query.insDate, query.originalInvoiceNumber].filter(Boolean).length;
  if (modes !== 1) throw new NavConfigError("Exactly one mandatory NAV query parameter is required");
  let mandatory = "";
  if (query.issueDate) {
    assertDate(query.issueDate.from, "dateFrom");
    assertDate(query.issueDate.to, "dateTo");
    const span = daysBetween(query.issueDate.from + "T00:00:00Z", query.issueDate.to + "T00:00:00Z");
    if (span < 0 || span > NAV_MAX_QUERY_DAYS) throw new NavConfigError("NAV issue-date window must be 0–35 days");
    mandatory = `<invoiceIssueDate><dateFrom>${query.issueDate.from}</dateFrom><dateTo>${query.issueDate.to}</dateTo></invoiceIssueDate>`;
  } else if (query.insDate) {
    assertTimestamp(query.insDate.from, "dateTimeFrom");
    assertTimestamp(query.insDate.to, "dateTimeTo");
    const span = daysBetween(query.insDate.from, query.insDate.to);
    if (span < 0 || span > NAV_MAX_QUERY_DAYS) throw new NavConfigError("NAV insDate window must be 0–35 days");
    mandatory = `<insDate><dateTimeFrom>${query.insDate.from}</dateTimeFrom><dateTimeTo>${query.insDate.to}</dateTimeTo></insDate>`;
  } else {
    const original = String(query.originalInvoiceNumber).trim();
    if (!original || original.length > 50) throw new NavConfigError("originalInvoiceNumber is invalid");
    mandatory = `<originalInvoiceNumber>${escapeXml(original)}</originalInvoiceNumber>`;
  }
  let additional = "";
  if (query.supplierTaxNumber) {
    const tax = normalizeTaxNumber8(query.supplierTaxNumber);
    if (!tax) throw new NavConfigError("supplierTaxNumber must contain 8 digits");
    additional = `<additionalQueryParams><taxNumber>${tax}</taxNumber></additionalQueryParams>`;
  }
  const body = `<page>${query.page}</page>
<invoiceDirection>INBOUND</invoiceDirection>
<invoiceQueryParams><mandatoryQueryParams>${mandatory}</mandatoryQueryParams>${additional}</invoiceQueryParams>`;
  const built = await envelope("QueryInvoiceDigestRequest", auth, software, body, now);
  return { operation: "queryInvoiceDigest", ...built };
}

export interface DataQuery {
  invoiceNumber: string;
  supplierTaxNumber: string;
  batchIndex?: number | null;
}

export async function buildQueryInvoiceData(
  auth: NavAuth, software: NavSoftware, query: DataQuery, now = new Date(),
): Promise<BuiltRequest> {
  const invoiceNumber = String(query.invoiceNumber ?? "").trim();
  if (!invoiceNumber || invoiceNumber.length > 50) throw new NavConfigError("invoiceNumber is invalid");
  const supplier = normalizeTaxNumber8(query.supplierTaxNumber);
  if (!supplier) throw new NavConfigError("supplierTaxNumber must contain 8 digits");
  const batch = query.batchIndex != null && query.batchIndex >= 1 ? `<batchIndex>${Math.trunc(query.batchIndex)}</batchIndex>` : "";
  const body = `<invoiceNumberQuery><invoiceNumber>${escapeXml(invoiceNumber)}</invoiceNumber><invoiceDirection>INBOUND</invoiceDirection>${batch}<supplierTaxNumber>${supplier}</supplierTaxNumber></invoiceNumberQuery>`;
  const built = await envelope("QueryInvoiceDataRequest", auth, software, body, now);
  return { operation: "queryInvoiceData", ...built };
}

export async function buildQueryInvoiceChainDigest(
  auth: NavAuth, software: NavSoftware, query: { invoiceNumber: string; supplierTaxNumber: string; page: number }, now = new Date(),
): Promise<BuiltRequest> {
  const invoiceNumber = String(query.invoiceNumber ?? "").trim();
  if (!invoiceNumber || invoiceNumber.length > 50) throw new NavConfigError("invoiceNumber is invalid");
  const supplier = normalizeTaxNumber8(query.supplierTaxNumber);
  if (!supplier) throw new NavConfigError("supplierTaxNumber must contain 8 digits");
  if (!Number.isInteger(query.page) || query.page < 1) throw new NavConfigError("NAV page must be >= 1");
  const body = `<page>${query.page}</page>
<invoiceChainQuery><invoiceNumber>${escapeXml(invoiceNumber)}</invoiceNumber><invoiceDirection>INBOUND</invoiceDirection><taxNumber>${supplier}</taxNumber></invoiceChainQuery>`;
  const built = await envelope("QueryInvoiceChainDigestRequest", auth, software, body, now);
  return { operation: "queryInvoiceChainDigest", ...built };
}

export async function buildQueryTaxpayer(
  auth: NavAuth, software: NavSoftware, taxNumber: string, now = new Date(),
): Promise<BuiltRequest> {
  const tax = normalizeTaxNumber8(taxNumber);
  if (!tax) throw new NavConfigError("taxNumber must contain 8 digits");
  const built = await envelope("QueryTaxpayerRequest", auth, software, `<taxNumber>${tax}</taxNumber>`, now);
  return { operation: "queryTaxpayer", ...built };
}
