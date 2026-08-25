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
  await logAudit(invoiceId, 'approved');
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
