import { describe, expect, it } from "vitest";
import {
  decideOneTimeCheckoutRetry as decide,
  type ReservedOneTimePayment,
  type StripeCheckoutState,
} from "../../supabase/functions/_shared/rdOneTimeRetryPolicy";

const row: ReservedOneTimePayment = {
  id: "payment-1", organization_slug: "rdhotels", package_key: "revenue",
  status: "pending", currency: "EUR", gross_cents: 50800,
  stripe_checkout_session_id: "cs_live_1",
};
const session: StripeCheckoutState = {
  id: "cs_live_1", status: "open", payment_status: "unpaid", mode: "payment",
  currency: "eur", amount_total: 50800,
  url: "https://checkout.stripe.com/c/pay/example",
  metadata: {
    kind: "hotelcare_one_time", organization_slug: "rdhotels",
    package_key: "revenue", payment_id: "payment-1",
  },
};
const pack = { organization: "rdhotels", packageKey: "revenue", grossCents: 50800 };

describe("safe one-time payment retries after interrupted OTP/3DS", () => {
  it("resumes exactly the same open/unpaid Stripe checkout after a failed authentication", () => {
    expect(decide(row, session, pack)).toBe("resume");
  });
  it("releases only Stripe-confirmed expired and unpaid checkouts", () => {
    expect(decide(row, { ...session, status: "expired", url: null }, pack)).toBe("expire");
  });
  it.each([
    ["completed and paid", { status: "complete", payment_status: "paid" }],
    ["completed but unpaid", { status: "complete", payment_status: "unpaid" }],
    ["still processing", { status: "open", payment_status: "paid" }],
    ["unknown session status", { status: null, payment_status: "unpaid" }],
    ["missing hosted URL", { status: "open", url: null }],
    ["non-Stripe URL", { status: "open", url: "https://evil.test/steal" }],
  ])("never creates a second payment while %s", (_name, changes) => {
    expect(decide(row, { ...session, ...changes }, pack)).toBe("hold");
  });
  it("refuses another organization's checkout, wrong amount, mismatched Stripe metadata, or subscription", () => {
    expect(decide({ ...row, organization_slug: "slnt" }, session, pack)).toBe("hold");
    expect(decide(row, { ...session, amount_total: 25400 }, pack)).toBe("hold");
    expect(decide(row, { ...session, metadata: { ...session.metadata!, payment_id: "different" } }, pack)).toBe("hold");
    expect(decide(row, { ...session, mode: "subscription" }, pack)).toBe("hold");
    expect(decide(row, { ...session, currency: "usd" }, pack)).toBe("hold");
  });
  it("never releases a paid, settled, or unlinked HotelCare reservation", () => {
    expect(decide({ ...row, status: "paid" }, { ...session, status: "expired" }, pack)).toBe("hold");
    expect(decide({ ...row, stripe_checkout_session_id: null }, { ...session, status: "expired" }, pack)).toBe("hold");
  });
});
