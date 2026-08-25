import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, XCircle, RotateCcw, Undo2, History } from 'lucide-react';
import { toast } from 'sonner';
import { useFinanceAccess } from '@/hooks/useFinanceAccess';
import {
  submitForApproval, approveInvoice, rejectInvoice, returnForCorrection,
  reopenInvoice, fetchAuditTrail, workflowLabel,
} from '@/lib/purchaseInvoiceWorkflow';

interface Props {
  invoice: any;
  onChanged: () => void;
}

export function InvoiceWorkflowPanel({ invoice, onChanged }: Props) {
  const { canReview, canApprove } = useFinanceAccess();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState(invoice?.reviewer_notes ?? '');
  const [trail, setTrail] = useState<any[]>([]);
  const [showTrail, setShowTrail] = useState(false);

  useEffect(() => { setNotes(invoice?.reviewer_notes ?? ''); }, [invoice?.id]);
  useEffect(() => {
    if (!showTrail || !invoice?.id) return;
    fetchAuditTrail(invoice.id).then(setTrail);
  }, [showTrail, invoice?.id]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onChanged(); }
    catch (e: any) { toast.error(e?.message || 'Action failed'); }
    finally { setBusy(false); }
  };

  const approved = invoice?.approval_status === 'approved';
  const rejected = invoice?.approval_status === 'rejected';
  const pending = invoice?.review_status === 'pending_approval' && !approved;

  return (
    <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Workflow</span>
        <Badge
          variant={approved ? 'default' : rejected ? 'destructive' : 'outline'}
          className={approved ? 'bg-emerald-600 hover:bg-emerald-600' : pending ? 'border-amber-500/60 text-amber-700 dark:text-amber-400' : ''}
        >
          {workflowLabel(invoice || {})}
        </Badge>
        <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => setShowTrail(v => !v)}>
          <History className="h-3.5 w-3.5 mr-1" />{showTrail ? 'Hide history' : 'History'}
        </Button>
      </div>

      {rejected && invoice?.rejection_reason && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <strong>Rejected:</strong> {invoice.rejection_reason}
        </div>
      )}
      {approved && (
        <p className="text-xs text-muted-foreground">
          Approved data is locked and flows into management analytics. Only controlling can reopen it.
        </p>
      )}

      {!approved && canReview && (
        <div className="space-y-2">
          <Textarea
            rows={2}
            placeholder="Reviewer notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="text-sm"
          />
          {invoice?.review_status !== 'pending_approval' && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => submitForApproval(invoice.id, notes), 'Submitted for approval')}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Submit for approval
            </Button>
          )}
        </div>
      )}

      {pending && canApprove && (
        <div className="space-y-2">
          <Textarea
            rows={2}
            placeholder="Reason (required to reject or return)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={busy}
              onClick={() => run(() => approveInvoice(invoice.id), 'Invoice approved')}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() => run(() => rejectInvoice(invoice.id, reason), 'Invoice rejected')}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !reason.trim()}
              onClick={() => run(() => returnForCorrection(invoice.id, reason), 'Returned for correction')}
            >
              <Undo2 className="h-3.5 w-3.5 mr-1" />Return for correction
            </Button>
          </div>
        </div>
      )}

      {approved && canApprove && (
        <div className="space-y-2">
          <Textarea
            rows={2}
            placeholder="Reason for reopening (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !reason.trim()}
            onClick={() => run(() => reopenInvoice(invoice.id, reason), 'Invoice reopened')}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />Reopen for correction
          </Button>
        </div>
      )}

      {showTrail && (
        <div className="max-h-48 overflow-y-auto space-y-1 border-t pt-2">
          {trail.length === 0 ? (
            <p className="text-xs text-muted-foreground">No history yet.</p>
          ) : trail.map(e => (
            <div key={e.id} className="text-[11px] flex gap-2">
              <span className="text-muted-foreground tabular-nums shrink-0">
                {new Date(e.created_at).toLocaleString()}
              </span>
              <span className="font-medium">{e.action}</span>
              {e.field && <span className="text-muted-foreground truncate">{e.field}: {e.old_value ?? '—'} → {e.new_value ?? '—'}</span>}
              {e.notes && <span className="text-muted-foreground truncate">· {e.notes}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
