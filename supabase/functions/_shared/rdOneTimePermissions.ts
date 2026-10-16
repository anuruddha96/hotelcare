/** 
 * RD Hotels one-time payment authority. This authorizes starting checkout only:
 * it does NOT confer billing-admin permissions (invoices, subscriptions, settings).
 * Both the Payments UI and billing-manage backend use this same policy.
 */
export type PaymentPrincipal = {
  role?: string | null;
  organizationSlug?: string | null;
  isSuperAdmin?: boolean | null;
};

const RD_PAYMENT_ROLES = new Set(["admin", "top_management", "top_management_manager"]);

export function canCollectRdOneTimePayment(
  principal: PaymentPrincipal | null | undefined,
  organizationSlug: string | null | undefined,
): boolean {
  if (!principal || organizationSlug !== "rdhotels") return false;
  if (principal.isSuperAdmin) return true;
  return principal.organizationSlug === "rdhotels" &&
    RD_PAYMENT_ROLES.has(principal.role ?? "");
}
