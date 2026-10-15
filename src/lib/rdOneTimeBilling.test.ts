import { describe, expect, it } from "vitest";
import { resolveRdOneTimePackage } from "../../supabase/functions/_shared/rdOneTimeBilling";
import type { BillingSettings } from "../../supabase/functions/_shared/billing";
import type { FixedAgreement, AgreementEntitlement, ModuleOverrideRow } from "../../supabase/functions/_shared/billingOverrides";

const settings = {
  organization_slug: "rdhotels", currency: "EUR",
  vat_percent: 27, billing_address_country: "HU",
} as BillingSettings;
const agreements: FixedAgreement[] = [
  { agreement_code: "revenue", label: "RD Hotels Revenue BI + Ottofiori Automation", price_cents: 40000, enabled: true },
];
const hotelIds = ["gozsdu-court", "memories-budapest", "mika-downtown", "ottofiori"];
const coverage: AgreementEntitlement[] = [
  ...hotelIds.map((hotel_id) => ({ agreement_code: "revenue", hotel_id, module: "revenue_bi" as const, enabled: true })),
  { agreement_code: "revenue", hotel_id: "ottofiori", module: "revenue_automation", enabled: true },
];
const prices: ModuleOverrideRow[] = [
  { hotel_id: null, module: "operations", pricing_mode: "fixed_monthly", price_cents: 20000 },
];

describe("RD Hotels one-time Stripe collection policy", () => {
  it("charges exactly EUR 508 with only Ottofiori automation in the shared contract", () => {
    expect(resolveRdOneTimePackage("revenue", settings, agreements, coverage, prices))
      .toMatchObject({ netCents: 40000, vatCents: 10800, grossCents: 50800 });
  });
  it("charges exactly EUR 254 for housekeeping", () => {
    expect(resolveRdOneTimePackage("housekeeping", settings, agreements, coverage, prices))
      .toMatchObject({ netCents: 20000, vatCents: 5400, grossCents: 25400 });
  });
  it("does not add automation to another property", () => {
    expect(() => resolveRdOneTimePackage("revenue", settings, agreements, [
      ...coverage, { agreement_code: "revenue", hotel_id: "gozsdu-court", module: "revenue_automation", enabled: true },
    ], prices)).toThrow(/Ottofiori/);
  });
  it("does not charge if contracted BI coverage is incomplete", () => {
    expect(() => resolveRdOneTimePackage("revenue", settings, agreements,
      coverage.filter(row => row.hotel_id !== "mika-downtown"), prices)).toThrow(/incomplete/);
  });
  it("fails closed if an admin price or VAT configuration changes", () => {
    expect(() => resolveRdOneTimePackage("revenue", settings,
      [{ ...agreements[0], price_cents: 39000 }], coverage, prices)).toThrow(/EUR 400/);
    expect(() => resolveRdOneTimePackage("housekeeping", settings, agreements, coverage,
      [{ ...prices[0], price_cents: 18000 }])).toThrow(/EUR 200/);
    expect(() => resolveRdOneTimePackage("revenue", { ...settings, billing_address_country: "DE" },
      agreements, coverage, prices)).toThrow(/Hungarian/);
  });
});
