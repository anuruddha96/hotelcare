import { describe, expect, it } from "vitest";
import {
  addCalendarMonth, billingFingerprint, hasLegacySubscription,
  monthlyAttemptKey, settledBreakdown,
} from "../../supabase/functions/_shared/manualBillingPolicy";

describe("payment-only monthly billing policy", () => {
  it("rolls January 31 to February 28 without skipping a month", () => {
    expect(addCalendarMonth("2027-01-31T10:00:00.000Z"))
      .toBe("2027-02-28T10:00:00.000Z");
  });
  it("clamps the leap-year February boundary correctly", () => {
    expect(addCalendarMonth("2028-01-31T10:00:00.000Z"))
      .toBe("2028-02-29T10:00:00.000Z");
  });
  it("handles year rollover", () => {
    expect(addCalendarMonth("2026-12-15T12:00:00.000Z"))
      .toBe("2027-01-15T12:00:00.000Z");
  });
  it("requires net plus VAT to equal the actual Stripe charge", () => {
    expect(settledBreakdown(40000, 10800, 50800))
      .toEqual({ net_cents: 40000, vat_cents: 10800, gross_cents: 50800 });
    expect(settledBreakdown(40000, 0, 40000).gross_cents).toBe(40000);
    expect(() => settledBreakdown(40000, 10799, 50800)).toThrow(/reconcile/);
    expect(() => settledBreakdown(-100, 0, -100)).toThrow();
  });
  it("uses a stable per-payment idempotency key", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(monthlyAttemptKey(id)).toBe(monthlyAttemptKey(id));
    expect(monthlyAttemptKey(id)).toContain(id);
    expect(() => monthlyAttemptKey("not-an-id")).toThrow();
  });
  it("requires review when the customer billing location changes", () => {
    expect(billingFingerprint({ country: "hu", postal_code: "1081", city: "Budapest" }))
      .toBe("HU|1081|BUDAPEST");
    expect(billingFingerprint({ country: "AT", postal_code: "1081", city: "Budapest" }))
      .not.toBe("HU|1081|BUDAPEST");
  });
  it("never double-collects a venue module still linked to Stripe Billing", () => {
    const selections = [{ hotel_id: "ot", module: "revenue_automation" }];
    expect(hasLegacySubscription(selections, [{
      hotel_id: "ot", module: "revenue_automation",
      stripe_subscription_id: "sub_legacy", status: "active",
    }])).toBe(true);
    expect(hasLegacySubscription(selections, [{
      hotel_id: "ot", module: "operations", stripe_subscription_id: "sub_legacy", status: "active",
    }])).toBe(false);
    expect(hasLegacySubscription(selections, [{
      hotel_id: "ot", module: "revenue_automation", stripe_subscription_id: null, status: "active",
    }])).toBe(false);
  });
});
