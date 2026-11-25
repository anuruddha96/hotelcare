/**
 * Recover Stripe Checkout only when the Stripe session and the reservation
 * provably refer to the same unpaid one-time HotelCare payment.
 * This policy never considers an unsuccessful 3-D Secure attempt to be paid.
 */
export interface ReservedOneTimePayment {
  id: string;
  organization_slug: string;
  package_key: string;
  status: string;
  currency: string;
  gross_cents: number;
  stripe_checkout_session_id: string | null;
}
export interface StripeCheckoutState {
  id: string;
  status: string | null;
  payment_status: string;
  mode: string;
  amount_total: number | null;
  currency: string | null;
  url: string | null;
  metadata: Record<string, string> | null;
}

export type CheckoutRetryDecision = "resume" | "expire" | "hold";

export function decideOneTimeCheckoutRetry(
  row: ReservedOneTimePayment,
  session: StripeCheckoutState,
  expected: { organization: string; packageKey: string; grossCents: number },
): CheckoutRetryDecision {
  // Never reuse/expire a session if its ownership, amount or kind is unclear.
  if (row.status !== "pending" || row.organization_slug !== expected.organization ||
      row.package_key !== expected.packageKey || Number(row.gross_cents) !== expected.grossCents ||
      row.currency.toUpperCase() !== "EUR" ||
      row.stripe_checkout_session_id !== session.id ||
      session.metadata?.payment_id !== row.id ||
      session.metadata?.organization_slug !== row.organization_slug ||
      session.metadata?.package_key !== row.package_key ||
      session.metadata?.kind !== "hotelcare_one_time" ||
      session.mode !== "payment" ||
      session.currency?.toUpperCase() !== row.currency.toUpperCase() ||
      session.amount_total !== expected.grossCents) return "hold";

  // Stripe can still take payment on an open Checkout after failed 3DS.
  // Reuse exactly the existing URL instead of reserving another payment.
  if (session.status === "open" && session.payment_status === "unpaid" &&
      typeof session.url === "string" && /^https:\/\/checkout\.stripe\.com\//.test(session.url))
    return "resume";
  // Release ONLY a Stripe-confirmed expired, unpaid session.
  if (session.status === "expired" && session.payment_status === "unpaid")
    return "expire";
  // Completed/paid/processing sessions require webhook reconciliation.
  return "hold";
}
