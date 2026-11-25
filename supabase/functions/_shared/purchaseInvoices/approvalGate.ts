/**
 * Approval preconditions. This TypeScript copy drives the UI; the database
 * trigger `pi_guard_invoice_update` enforces the same rules server-side so
 * hidden buttons are never the only control.
 */
import { BLOCKING_RECON_STATUSES } from "./reconciliation.ts";

export interface ApprovalInvoice {
  id: string;
  approval_status: string | null;
  review_status: string | null;
  nav_match_status: string | null;
  duplicate_status: string | null;
  validation_status: string | null;
  open_conflicts: number;
  uploaded_by: string | null;
  reviewed_by: string | null;
}

export interface ApprovalContext {
  approverId: string;
  canApprove: boolean;
  inScope: boolean;
  requireSeparateApprover: boolean;
  blockOnExceptions: boolean;
  requireNavMatch: boolean;
}

export type ApprovalBlocker =
  | "not_controller"
  | "out_of_scope"
  | "already_approved"
  | "not_submitted"
  | "self_approval"
  | "nav_exception"
  | "duplicate_suspected"
  | "open_conflicts"
  | "validation_errors"
  | "nav_match_required";

export const APPROVAL_BLOCKER_LABELS: Record<ApprovalBlocker, string> = {
  not_controller: "Only controllers can approve invoices.",
  out_of_scope: "This invoice is outside your legal-company or property scope.",
  already_approved: "The invoice is already approved.",
  not_submitted: "Submit the invoice for approval first.",
  self_approval: "Separation of duties: the uploader or reviewer cannot approve.",
  nav_exception: "Resolve the NAV reconciliation exception first.",
  duplicate_suspected: "Resolve the suspected duplicate first.",
  open_conflicts: "Resolve the document vs NAV field conflicts first.",
  validation_errors: "Fix the failed arithmetic/date checks first.",
  nav_match_required: "A confirmed NAV match is required before approval.",
};

const NAV_CONFIRMED = new Set(["exact_match", "probable_match", "manual_resolution", "not_expected"]);

export function approvalBlockers(invoice: ApprovalInvoice, ctx: ApprovalContext): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = [];
  if (!ctx.canApprove) blockers.push("not_controller");
  if (!ctx.inScope) blockers.push("out_of_scope");
  if (invoice.approval_status === "approved") blockers.push("already_approved");
  if (invoice.review_status !== "pending_approval") blockers.push("not_submitted");
  if (ctx.requireSeparateApprover && (invoice.uploaded_by === ctx.approverId || invoice.reviewed_by === ctx.approverId)) {
    blockers.push("self_approval");
  }
  if (ctx.blockOnExceptions) {
    if (invoice.nav_match_status && BLOCKING_RECON_STATUSES.has(invoice.nav_match_status)) blockers.push("nav_exception");
    if (invoice.duplicate_status === "suspected" || invoice.duplicate_status === "confirmed") blockers.push("duplicate_suspected");
    if (invoice.open_conflicts > 0) blockers.push("open_conflicts");
    if (invoice.validation_status === "error") blockers.push("validation_errors");
  }
  if (ctx.requireNavMatch && !NAV_CONFIRMED.has(invoice.nav_match_status ?? "")) blockers.push("nav_match_required");
  return blockers;
}
