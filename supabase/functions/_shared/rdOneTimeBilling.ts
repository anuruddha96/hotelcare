import type { BillingSettings } from "./billing.ts";
import type { FixedAgreement, AgreementEntitlement, ModuleOverrideRow } from "./billingOverrides.ts";

export type RdPackage = "revenue" | "housekeeping";

const RD_HOTELS = ["gozsdu-court", "memories-budapest", "mika-downtown", "ottofiori"] as const;

/** Only explicit, approved RD Hotels packages may become a one-time charge. */
export function resolveRdOneTimePackage(
  packageKey: RdPackage,
  settings: BillingSettings,
  agreements: FixedAgreement[],
  entitlements: AgreementEntitlement[],
  moduleRows: ModuleOverrideRow[],
) {
  if (settings.organization_slug !== "rdhotels" || settings.currency.toUpperCase() !== "EUR" ||
      Number(settings.vat_percent) !== 27 || settings.billing_address_country !== "HU")
    throw new Error("RD Hotels one-time payments require validated Hungarian 27% VAT settings in EUR");

  let netCents: number;
  let description: string;
  if (packageKey === "revenue") {
    const contract = agreements.find((row) => row.agreement_code === "revenue" && row.enabled);
    if (!contract || !Number.isSafeInteger(contract.price_cents) || contract.price_cents !== 40000)
      throw new Error("RD Hotels revenue package no longer matches the approved EUR 400 agreement");
    for (const hotelId of RD_HOTELS) {
      if (!entitlements.some((row) =>
        row.agreement_code === "revenue" && row.hotel_id === hotelId &&
        row.module === "revenue_bi" && row.enabled))
        throw new Error("Revenue BI coverage is incomplete; review the contract before collecting payment");
    }
    const enabledAutomation = entitlements.filter((row) =>
      row.agreement_code === "revenue" && row.module === "revenue_automation" && row.enabled);
    if (enabledAutomation.length !== 1 || enabledAutomation[0].hotel_id !== "ottofiori")
      throw new Error("Automation must be included only for Hotel Ottofiori");
    netCents = contract.price_cents;
    description = "RD Hotels — Revenue BI at four hotels and automated pricing only at Ottofiori";
  } else {
    const housekeeping = moduleRows.find((row) =>
      row.hotel_id == null && row.module === "operations" && row.pricing_mode === "fixed_monthly");
    if (!housekeeping || housekeeping.price_cents !== 20000)
      throw new Error("RD Hotels housekeeping package no longer matches the approved EUR 200 agreement");
    netCents = housekeeping.price_cents;
    description = "RD Hotels — Housekeeping at four hotels";
  }
  const vatCents = Math.round(netCents * 27 / 100);
  return { packageKey, description, netCents, vatCents, grossCents: netCents + vatCents };
}
