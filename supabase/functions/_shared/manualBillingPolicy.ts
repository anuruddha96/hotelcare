/** Monthly payments without Stripe Billing invoices. Pure date and money policies. */
export function addCalendarMonth(date: string): string {
  const source = new Date(date);
  if (Number.isNaN(source.getTime())) throw new Error("Invalid billing date");
  const day = source.getUTCDate();
  const next = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 1,
    source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds()));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next.toISOString();
}

export function settledBreakdown(subtotal: number, tax: number, gross: number) {
  if (![subtotal, tax, gross].every(Number.isSafeInteger) ||
      subtotal <= 0 || tax < 0 || subtotal + tax !== gross) {
    throw new Error("Stripe payment amounts do not reconcile");
  }
  return { net_cents: subtotal, vat_cents: tax, gross_cents: gross };
}

export function monthlyAttemptKey(paymentId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) throw new Error("Invalid payment id");
  return "hotelcare-monthly-v1-" + paymentId;
}

export function billingFingerprint(address: {
  country?: string | null; postal_code?: string | null; city?: string | null;
} | null | undefined): string {
  return [address?.country, address?.postal_code, address?.city]
    .map((value) => (value ?? "").trim().toUpperCase()).join("|");
}

/** Fail closed on any Stripe subscription still controlling these entitlements. */
export function hasLegacySubscription(
  selections: { hotel_id: string; module: string }[],
  rows: { hotel_id: string; module: string; stripe_subscription_id?: string | null; status: string }[],
): boolean {
  return selections.some((selection) => rows.some((row) =>
    row.hotel_id === selection.hotel_id &&
    (row.module === selection.module || (row.module === "revenue" && selection.module === "revenue_automation")) &&
    Boolean(row.stripe_subscription_id) && ["active", "past_due", "trialing", "incomplete"].includes(row.status)));
}
