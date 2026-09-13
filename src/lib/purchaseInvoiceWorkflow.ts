import { supabase } from '@/integrations/supabase/client';

export type ReviewStatus = 'pending_review' | 'reviewed' | 'pending_approval';
export type ApprovalStatus = 'none' | 'approved' | 'rejected';

export const WORKFLOW_LABELS: Record<string, string> = {
  pending_review: 'Pending review',
  reviewed: 'Reviewed',
  pending_approval: 'Pending approval',
  none: '—',
  approved: 'Approved',
  rejected: 'Rejected',
};

export type ApprovalControlState = {
  blocked: boolean;
  reasons: string[];
  warnings: string[];
  amountConfidence: number | null;
  amountBalanced: boolean | null;
  duplicateStatus: string;
  navStatus: string;
  navEnabled: boolean;
};

export function workflowLabel(inv: { review_status?: string | null; approval_status?: string | null }): string {
  if (inv.approval_status === 'approved') return 'Approved';
  if (inv.approval_status === 'rejected') return 'Rejected';
  return WORKFLOW_LABELS[inv.review_status || 'pending_review'] || 'Pending review';
}

/** Approved invoices are locked for everyone except controllers (who may reopen them). */
export function isLocked(inv: { approval_status?: string | null }): boolean {
  return inv?.approval_status === 'approved';
}

async function logAudit(invoiceId: string, action: string, notes?: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return;
  await supabase.from('purchase_invoice_audit_log').insert({
    invoice_id: invoiceId,
    user_id: auth.user.id,
    action,
    notes: notes ?? null,
  });
}

/**
 * Financial control gate shared by the UI and the workflow mutation itself.
 *
 * Important: legacy invoices remain approvable. Strict amount blocking only
 * applies once an invoice has been processed by Invoice Intelligence v3, so the
 * rollout does not freeze older accounting work.
 */
export async function getApprovalControlState(invoiceId: string): Promise<ApprovalControlState> {
  const db = supabase as any;
  const { data: invoice, error } = await db
    .from('purchase_invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) throw new Error('Invoice not found.');

  const { data: settings } = await db
    .from('invoice_automation_settings')
    .select('*')
    .eq('organization_slug', invoice.organization_slug)
    .maybeSingle();

  const amountThreshold = Number(settings?.amount_auto_accept_confidence ?? 0.94);
  const requireAmountBalance = settings?.require_amount_balance ?? true;
  const blockAmount = settings?.block_approval_on_amount_conflict ?? true;
  const navEnabled = settings?.nav_reconciliation_enabled ?? false;
  const blockNav = settings?.block_approval_on_nav_conflict ?? true;

  const amountConfidence = invoice.amount_confidence == null ? null : Number(invoice.amount_confidence);
  const delta = invoice.amount_balance_delta == null ? null : Math.abs(Number(invoice.amount_balance_delta));
  const currency = String(invoice.currency || 'HUF').toUpperCase();
  const total = Math.abs(Number(invoice.total_amount || 0));
  const balanceTolerance = currency === 'HUF' ? Math.max(2, total * 0.0002) : Math.max(0.03, total * 0.0002);
  const amountBalanced = delta == null ? null : delta <= balanceTolerance;
  const isV3 = String(invoice.ocr_version || '').includes('invoice-intelligence-v3');

  const duplicateStatus = String(invoice.duplicate_status || 'none');
  const navStatus = String(invoice.nav_match_status || 'not_checked');
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (['exact', 'suspected', 'confirmed'].includes(duplicateStatus)) {
    reasons.push(duplicateStatus === 'exact'
      ? 'The same source document was already uploaded.'
      : 'This invoice is still flagged as a possible duplicate.');
  }

  if (blockAmount && isV3) {
    if (amountConfidence == null || amountConfidence < amountThreshold) {
      reasons.push(`Amount confidence is below the ${(amountThreshold * 100).toFixed(0)}% approval threshold.`);
    }
    if (requireAmountBalance && amountBalanced === false) {
      reasons.push('Gross amount does not reconcile with the extracted net/VAT control totals.');
    }
    if (invoice.total_amount == null) reasons.push('The final accounting total is missing.');
  } else if (amountConfidence != null && amountConfidence < amountThreshold) {
    warnings.push(`Low amount confidence: ${(amountConfidence * 100).toFixed(0)}%.`);
  }

  if (navEnabled) {
    if (blockNav && navStatus === 'conflict') reasons.push('NAV has a conflicting amount, VAT or invoice identity.');
    if (blockNav && navStatus === 'missing_in_nav') reasons.push('This invoice is missing from the complete NAV reconciliation period.');
    if (navStatus === 'probable') warnings.push('NAV match is probable, but not strong enough for automatic reconciliation.');
    if (navStatus === 'not_checked') warnings.push('NAV reconciliation has not been run for this invoice yet.');
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    warnings,
    amountConfidence,
    amountBalanced,
    duplicateStatus,
    navStatus,
    navEnabled,
  };
}

async function assertApprovalControls(invoiceId: string) {
  const state = await getApprovalControlState(invoiceId);
  if (state.blocked) {
    throw new Error(`Approval blocked: ${state.reasons.join(' ')}`);
  }
  return state;
}

export async function submitForApproval(invoiceId: string, reviewerNotes?: string) {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from('purchase_invoices').update({
    review_status: 'pending_approval',
    reviewed_by: auth?.user?.id ?? null,
    reviewed_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    reviewer_notes: reviewerNotes ?? null,
    approval_status: 'none',
    rejection_reason: null,
  }).eq('id', invoiceId);
  if (error) throw error;
  await logAudit(invoiceId, 'submitted_for_approval', reviewerNotes);
}

export async function approveInvoice(invoiceId: string) {
  const controls = await assertApprovalControls(invoiceId);
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from('purchase_invoices').update({
    approval_status: 'approved',
    approved_by: auth?.user?.id ?? null,
    approved_at: new Date().toISOString(),
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    needs_review: false,
  }).eq('id', invoiceId);
  if (error) throw error;
  await logAudit(invoiceId, 'approved', controls.warnings.length ? controls.warnings.join(' ') : undefined);
}

export async function rejectInvoice(invoiceId: string, reason: string) {
  if (!reason.trim()) throw new Error('A rejection reason is required.');
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from('purchase_invoices').update({
    approval_status: 'rejected',
    rejected_by: auth?.user?.id ?? null,
    rejected_at: new Date().toISOString(),
    rejection_reason: reason.trim(),
    review_status: 'pending_review',
  }).eq('id', invoiceId);
  if (error) throw error;
  await logAudit(invoiceId, 'rejected', reason.trim());
}

/** Return for correction — back to the reviewer without a formal rejection. */
export async function returnForCorrection(invoiceId: string, reason: string) {
  const { error } = await supabase.from('purchase_invoices').update({
    review_status: 'pending_review',
    approval_status: 'none',
    reviewer_notes: reason || null,
  }).eq('id', invoiceId);
  if (error) throw error;
  await logAudit(invoiceId, 'returned_for_correction', reason);
}

export async function reopenInvoice(invoiceId: string, reason: string) {
  if (!reason.trim()) throw new Error('A reason is required to reopen an approved invoice.');
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from('purchase_invoices').update({
    approval_status: 'none',
    approved_by: null,
    approved_at: null,
    review_status: 'pending_review',
    reopened_by: auth?.user?.id ?? null,
    reopened_at: new Date().toISOString(),
    reopen_reason: reason.trim(),
  }).eq('id', invoiceId);
  if (error) throw error;
  await logAudit(invoiceId, 'reopened', reason.trim());
}

export async function resolveDuplicate(
  invoiceId: string,
  decision: 'confirmed' | 'not_duplicate' | 'credit_note',
) {
  const patch =
    decision === 'not_duplicate'
      ? { duplicate_status: 'none', duplicate_of: null }
      : decision === 'credit_note'
        ? { duplicate_status: 'credit_note', is_credit_note: true }
        : { duplicate_status: 'confirmed' };
  const { error } = await supabase.from('purchase_invoices').update(patch).eq('id', invoiceId);
  if (error) throw error;
  await logAudit(invoiceId, 'duplicate_' + decision);
}

export async function fetchAuditTrail(invoiceId: string) {
  const { data } = await supabase
    .from('purchase_invoice_audit_log')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false })
    .limit(200);
  return data ?? [];
}
