/**
 * Synthetic, non-production NAV Online Számla fixtures. Shapes follow the
 * official v3.0 invoiceApi.xsd / invoiceData.xsd; the invoice-data template is
 * validated against the official XSD (see docs/PURCHASE_INVOICE_NAV_RECONCILIATION.md).
 * No real taxpayer or credential appears here.
 */
export function validTaxCore(prefix7: string): string {
  const weights = [9, 7, 3, 1, 9, 7, 3];
  const sum = weights.reduce((s, w, i) => s + w * Number(prefix7[i]), 0);
  return `${prefix7}${(10 - (sum % 10)) % 10}`;
}

export interface DigestFixture {
  invoiceNumber: string;
  invoiceOperation?: "CREATE" | "MODIFY" | "STORNO";
  invoiceIssueDate?: string;
  supplierTaxNumber: string;
  supplierName?: string;
  customerTaxNumber?: string;
  customerName?: string;
  currency?: string;
  invoiceNetAmount?: number;
  invoiceVatAmount?: number;
  invoiceDeliveryDate?: string;
  paymentDate?: string;
  paymentMethod?: string;
  transactionId?: string;
  index?: number;
  originalInvoiceNumber?: string;
  modificationIndex?: number;
  insDate?: string;
}

function el(tag: string, value: unknown): string {
  return value == null ? "" : `<${tag}>${String(value)}</${tag}>`;
}

export function digestXml(d: DigestFixture): string {
  const net = d.invoiceNetAmount ?? 100000;
  const vat = d.invoiceVatAmount ?? 27000;
  return `<invoiceDigest>${[
    el("invoiceNumber", d.invoiceNumber),
    el("invoiceOperation", d.invoiceOperation ?? "CREATE"),
    el("invoiceCategory", "NORMAL"),
    el("invoiceIssueDate", d.invoiceIssueDate ?? "2026-10-15"),
    el("supplierTaxNumber", d.supplierTaxNumber),
    el("supplierName", d.supplierName ?? "Példa Beszállító Kft."),
    el("customerTaxNumber", d.customerTaxNumber ?? "12345676"),
    el("customerName", d.customerName ?? "RD Hotel Kft."),
    el("paymentMethod", d.paymentMethod ?? "TRANSFER"),
    el("paymentDate", d.paymentDate),
    el("invoiceAppearance", "ELECTRONIC"),
    el("source", "XML"),
    el("invoiceDeliveryDate", d.invoiceDeliveryDate),
    el("currency", d.currency ?? "HUF"),
    el("invoiceNetAmount", net),
    el("invoiceNetAmountHUF", net),
    el("invoiceVatAmount", vat),
    el("invoiceVatAmountHUF", vat),
    el("transactionId", d.transactionId ?? `TX${d.invoiceNumber.replace(/[^A-Z0-9]/gi, "")}`.slice(0, 30)),
    el("index", d.index ?? 1),
    el("originalInvoiceNumber", d.originalInvoiceNumber),
    el("modificationIndex", d.modificationIndex),
    el("insDate", d.insDate ?? "2026-10-15T10:00:00.000Z"),
    el("completenessIndicator", "false"),
  ].join("")}</invoiceDigest>`;
}

export function digestResponseXml(digests: DigestFixture[], currentPage = 1, availablePage = 1): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns2:QueryInvoiceDigestResponse xmlns="http://schemas.nav.gov.hu/NTCA/1.0/common" xmlns:ns2="http://schemas.nav.gov.hu/OSA/3.0/api" xmlns:ns3="http://schemas.nav.gov.hu/OSA/3.0/base" xmlns:ns4="http://schemas.nav.gov.hu/OSA/3.0/data">
<header><requestId>HCTEST1</requestId><timestamp>2026-11-17T10:00:00.000Z</timestamp><requestVersion>3.0</requestVersion><headerVersion>1.0</headerVersion></header>
<result><funcCode>OK</funcCode></result>
<ns2:software><ns2:softwareId>HU12345676-HCARE01</ns2:softwareId><ns2:softwareName>HotelCare</ns2:softwareName><ns2:softwareOperation>ONLINE_SERVICE</ns2:softwareOperation><ns2:softwareMainVersion>1.0</ns2:softwareMainVersion><ns2:softwareDevName>Test</ns2:softwareDevName><ns2:softwareDevContact>dev@example.test</ns2:softwareDevContact></ns2:software>
<ns2:invoiceDigestResult><ns2:currentPage>${currentPage}</ns2:currentPage><ns2:availablePage>${availablePage}</ns2:availablePage>${digests.map(digestXml).join("").replace(/<(\/?)([a-zA-Z]+)>/g, "<$1ns2:$2>")}</ns2:invoiceDigestResult>
</ns2:QueryInvoiceDigestResponse>`;
}

export function errorResponseXml(errorCode: string, message = "error"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<GeneralErrorResponse xmlns="http://schemas.nav.gov.hu/OSA/3.0/api" xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common">
<common:header><common:requestId>HCTEST2</common:requestId><common:timestamp>2026-11-17T10:00:00.000Z</common:timestamp><common:requestVersion>3.0</common:requestVersion></common:header>
<common:result><common:funcCode>ERROR</common:funcCode><common:errorCode>${errorCode}</common:errorCode><common:message>${message}</common:message></common:result>
<software><softwareId>HU12345676-HCARE01</softwareId><softwareName>HotelCare</softwareName><softwareOperation>ONLINE_SERVICE</softwareOperation><softwareMainVersion>1.0</softwareMainVersion><softwareDevName>Test</softwareDevName><softwareDevContact>dev@example.test</softwareDevContact></software>
</GeneralErrorResponse>`;
}

export interface InvoiceDataFixture {
  invoiceNumber?: string;
  issueDate?: string;
  supplierTax?: [string, string, string];
  customerTax?: [string, string, string];
  deliveryDate?: string;
  currency?: string;
  exchangeRate?: number;
  /** [vatPercentage | special, net, vat] */
  vatLines?: Array<{ rate: string; net: number; vat: number }>;
  reference?: { originalInvoiceNumber: string; modificationIndex: number };
}

function vatRateXml(rate: string): string {
  if (rate === "AAM") return "<vatExemption><case>AAM</case><reason>Alanyi adómentes</reason></vatExemption>";
  if (rate === "KBAET") return "<vatExemption><case>KBAET</case><reason>Közösségen belüli értékesítés</reason></vatExemption>";
  if (rate === "EUFAD37") return "<vatOutOfScope><case>EUFAD37</case><reason>EU szolgáltatás</reason></vatOutOfScope>";
  if (rate === "REVERSE") return "<vatDomesticReverseCharge>true</vatDomesticReverseCharge>";
  return `<vatPercentage>${rate}</vatPercentage>`;
}

/** InvoiceData document (data namespace) — schema-valid against invoiceData.xsd. */
export function invoiceDataXml(f: InvoiceDataFixture = {}): string {
  const lines = f.vatLines ?? [{ rate: "0.27", net: 100000, vat: 27000 }, { rate: "0.05", net: 20000, vat: 1000 }];
  const net = lines.reduce((s, l) => s + l.net, 0);
  const vat = lines.reduce((s, l) => s + l.vat, 0);
  const [st, sv, sc] = f.supplierTax ?? ["10773381", "2", "44"];
  const [ct, cv, cc] = f.customerTax ?? ["12345676", "2", "42"];
  const currency = f.currency ?? "HUF";
  const rate = f.exchangeRate ?? 1;
  const huf = (v: number) => Math.round(v * rate * 100) / 100;
  const lineXml = lines.map((l, i) => `<line><lineNumber>${i + 1}</lineNumber><lineExpressionIndicator>true</lineExpressionIndicator><lineDescription>Tétel ${i + 1}</lineDescription><quantity>1</quantity><unitOfMeasure>PIECE</unitOfMeasure><unitPrice>${l.net}</unitPrice><lineAmountsNormal><lineNetAmountData><lineNetAmount>${l.net}</lineNetAmount><lineNetAmountHUF>${huf(l.net)}</lineNetAmountHUF></lineNetAmountData><lineVatRate>${vatRateXml(l.rate)}</lineVatRate><lineVatData><lineVatAmount>${l.vat}</lineVatAmount><lineVatAmountHUF>${huf(l.vat)}</lineVatAmountHUF></lineVatData><lineGrossAmountData><lineGrossAmountNormal>${l.net + l.vat}</lineGrossAmountNormal><lineGrossAmountNormalHUF>${huf(l.net + l.vat)}</lineGrossAmountNormalHUF></lineGrossAmountData></lineAmountsNormal></line>`).join("");
  const summaryXml = lines.map((l) => `<summaryByVatRate><vatRate>${vatRateXml(l.rate)}</vatRate><vatRateNetData><vatRateNetAmount>${l.net}</vatRateNetAmount><vatRateNetAmountHUF>${huf(l.net)}</vatRateNetAmountHUF></vatRateNetData><vatRateVatData><vatRateVatAmount>${l.vat}</vatRateVatAmount><vatRateVatAmountHUF>${huf(l.vat)}</vatRateVatAmountHUF></vatRateVatData></summaryByVatRate>`).join("");
  const reference = f.reference
    ? `<invoiceReference><originalInvoiceNumber>${f.reference.originalInvoiceNumber}</originalInvoiceNumber><modifyWithoutMaster>false</modifyWithoutMaster><modificationIndex>${f.reference.modificationIndex}</modificationIndex></invoiceReference>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<InvoiceData xmlns="http://schemas.nav.gov.hu/OSA/3.0/data" xmlns:base="http://schemas.nav.gov.hu/OSA/3.0/base" xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common">
<invoiceNumber>${f.invoiceNumber ?? "SZ-2026/0042"}</invoiceNumber>
<invoiceIssueDate>${f.issueDate ?? "2026-11-03"}</invoiceIssueDate>
<completenessIndicator>false</completenessIndicator>
<invoiceMain><invoice>${reference}
<invoiceHead>
<supplierInfo><supplierTaxNumber><base:taxpayerId>${st}</base:taxpayerId><base:vatCode>${sv}</base:vatCode><base:countyCode>${sc}</base:countyCode></supplierTaxNumber><supplierName>Példa Beszállító Kft.</supplierName><supplierAddress><base:simpleAddress><base:countryCode>HU</base:countryCode><base:postalCode>1051</base:postalCode><base:city>Budapest</base:city><base:additionalAddressDetail>Fő utca 1.</base:additionalAddressDetail></base:simpleAddress></supplierAddress><supplierBankAccountNumber>11111111-22222222-33333333</supplierBankAccountNumber></supplierInfo>
<customerInfo><customerVatStatus>DOMESTIC</customerVatStatus><customerVatData><customerTaxNumber><base:taxpayerId>${ct}</base:taxpayerId><base:vatCode>${cv}</base:vatCode><base:countyCode>${cc}</base:countyCode></customerTaxNumber></customerVatData><customerName>RD Hotel Kft.</customerName><customerAddress><base:simpleAddress><base:countryCode>HU</base:countryCode><base:postalCode>1061</base:postalCode><base:city>Budapest</base:city><base:additionalAddressDetail>Király utca 2.</base:additionalAddressDetail></base:simpleAddress></customerAddress></customerInfo>
<invoiceDetail><invoiceCategory>NORMAL</invoiceCategory><invoiceDeliveryDate>${f.deliveryDate ?? "2026-11-02"}</invoiceDeliveryDate><currencyCode>${currency}</currencyCode><exchangeRate>${rate}</exchangeRate><paymentMethod>TRANSFER</paymentMethod><paymentDate>2026-11-18</paymentDate><invoiceAppearance>ELECTRONIC</invoiceAppearance></invoiceDetail>
</invoiceHead>
<invoiceLines><mergedItemIndicator>false</mergedItemIndicator>${lineXml}</invoiceLines>
<invoiceSummary><summaryNormal>${summaryXml}<invoiceNetAmount>${net}</invoiceNetAmount><invoiceNetAmountHUF>${huf(net)}</invoiceNetAmountHUF><invoiceVatAmount>${vat}</invoiceVatAmount><invoiceVatAmountHUF>${huf(vat)}</invoiceVatAmountHUF></summaryNormal><summaryGrossData><invoiceGrossAmount>${net + vat}</invoiceGrossAmount><invoiceGrossAmountHUF>${huf(net + vat)}</invoiceGrossAmountHUF></summaryGrossData></invoiceSummary>
</invoice></invoiceMain>
</InvoiceData>`;
}

export function invoiceDataResponseXml(base64: string, compressed: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<QueryInvoiceDataResponse xmlns="http://schemas.nav.gov.hu/OSA/3.0/api" xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common">
<common:header><common:requestId>HCTEST3</common:requestId><common:timestamp>2026-11-17T10:00:00.000Z</common:timestamp><common:requestVersion>3.0</common:requestVersion></common:header>
<common:result><common:funcCode>OK</common:funcCode></common:result>
<software><softwareId>HU12345676-HCARE01</softwareId><softwareName>HotelCare</softwareName><softwareOperation>ONLINE_SERVICE</softwareOperation><softwareMainVersion>1.0</softwareMainVersion><softwareDevName>Test</softwareDevName><softwareDevContact>dev@example.test</softwareDevContact></software>
<invoiceDataResult><invoiceData>${base64}</invoiceData><auditData><insdate>2026-11-03T09:00:00.000Z</insdate><insCusUser>abcdef123456789</insCusUser><source>XML</source><transactionId>TX1</transactionId><index>1</index><originalRequestVersion>3.0</originalRequestVersion></auditData><compressedContentIndicator>${compressed}</compressedContentIndicator></invoiceDataResult>
</QueryInvoiceDataResponse>`;
}

export function emptyDataResponseXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<QueryInvoiceDataResponse xmlns="http://schemas.nav.gov.hu/OSA/3.0/api" xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common">
<common:header><common:requestId>HCTEST4</common:requestId><common:timestamp>2026-11-17T10:00:00.000Z</common:timestamp><common:requestVersion>3.0</common:requestVersion></common:header>
<common:result><common:funcCode>OK</common:funcCode></common:result>
<software><softwareId>HU12345676-HCARE01</softwareId><softwareName>HotelCare</softwareName><softwareOperation>ONLINE_SERVICE</softwareOperation><softwareMainVersion>1.0</softwareMainVersion><softwareDevName>Test</softwareDevName><softwareDevContact>dev@example.test</softwareDevContact></software>
</QueryInvoiceDataResponse>`;
}

export const TEST_SOFTWARE = {
  softwareId: "HU12345676-HCARE01",
  softwareName: "HotelCare",
  softwareOperation: "ONLINE_SERVICE" as const,
  softwareMainVersion: "1.0",
  softwareDevName: "HotelCare Test",
  softwareDevContact: "dev@example.test",
  softwareDevCountryCode: "HU",
  softwareDevTaxNumber: "12345676",
};

export const TEST_AUTH = {
  login: "abcdef123456789",
  password: "Secret&Pass<1>",
  signingKey: "ce-8f5e-215119fa7dd621DLMRHRLH2S",
  taxNumber: "12345676",
};
