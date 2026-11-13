import { useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Copy, History } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { reviewReasonLabel, type ChannexStatus } from '@/integrations/channex/api';
import type { RunAction } from './ChannexPanel';

type Props = { status: ChannexStatus; run: RunAction; busy: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const OUTBOX_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  sent: 'default', sent_with_warnings: 'secondary', pending: 'outline', sending: 'outline', dry_run: 'outline', failed: 'destructive', blocked: 'outline',
};
const STATE_LABEL: Record<string, string> = {
  received: 'Received', applied: 'In calendar', review: 'Needs review', unknown_property: 'Unknown property', dry_run: 'Dry run (not applied)', failed: 'Failed, retrying',
};

export function ChannexActivity({ status, run, busy }: Props) {
  const open = status.review_cases.filter((c) => c.status === 'open');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [since, setSince] = useState('');

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />Bookings that need a person ({open.length})</h3>
        {open.length === 0 ? <p className="text-xs text-muted-foreground">Nothing to review.</p> : open.map((c) => {
          const d = c.details as Record<string, string | null>;
          return (
            <div key={c.id} className="rounded-lg border border-amber-500/40 p-3 space-y-2">
              <p className="text-sm font-medium">{reviewReasonLabel(c.reason)}</p>
              <p className="text-xs text-muted-foreground">
                {d.ota_name ?? 'OTA'} {d.ota_reservation_code ?? ''} · {d.arrival_date ?? '?'} → {d.departure_date ?? '?'}{d.amount ? ` · ${d.amount} ${d.currency ?? ''}` : ''} · received {when(c.created_at)}
              </p>
              {status.permissions.review && (
                <div className="flex gap-2 items-end flex-wrap">
                  <Textarea className="min-h-[38px] text-xs flex-1 min-w-[220px]" placeholder="What did you change? (required)" value={notes[c.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} aria-label="Resolution note" />
                  <Button size="sm" disabled={busy !== null || (notes[c.id] ?? '').trim().length < 3} onClick={() => void run('resolve_review', { case_id: c.id, status: 'resolved', note: notes[c.id] }, 'Marked as resolved')}>Resolved</Button>
                  <Button size="sm" variant="outline" disabled={busy !== null || (notes[c.id] ?? '').trim().length < 3} onClick={() => void run('resolve_review', { case_id: c.id, status: 'dismissed', note: notes[c.id] }, 'Dismissed')}>Dismiss</Button>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold flex items-center gap-2"><ArrowDownToLine className="h-4 w-4" />Incoming OTA bookings</h3>
        {status.revisions.length === 0 ? <p className="text-xs text-muted-foreground">No bookings received through Channex yet{status.permissions.review ? '' : ' (or you do not have PMS access)'}.</p> : (
          <div className="divide-y text-xs">
            {status.revisions.map((r) => (
              <div key={r.revision_id} className="flex justify-between gap-2 py-1.5 flex-wrap">
                <span>{r.ota_name ?? 'OTA'} {r.ota_reservation_code ?? ''} · <span className="capitalize">{r.revision_status ?? '?'}</span> · {r.arrival_date ?? '?'} → {r.departure_date ?? '?'}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={r.state === 'applied' ? 'default' : r.state === 'failed' || r.state === 'unknown_property' ? 'destructive' : 'outline'}>{STATE_LABEL[r.state] ?? r.state}</Badge>
                  {r.acked_at ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="acknowledged to Channex" /> : <span className="text-muted-foreground">not acknowledged</span>}
                  <span className="text-muted-foreground">{when(r.created_at)}</span>
                </span>
                {(r.last_error || r.ack_error) && <span className="w-full text-destructive">{r.last_error ?? r.ack_error}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold flex items-center gap-2"><ArrowUpFromLine className="h-4 w-4" />Rates and availability sent</h3>
        {status.outbox.length === 0 ? <p className="text-xs text-muted-foreground">Nothing sent yet.</p> : (
          <div className="divide-y text-xs">
            {status.outbox.map((o) => (
              <div key={o.id} className="flex justify-between gap-2 py-1.5 flex-wrap">
                <span className="capitalize">{o.is_full_sync ? 'Full sync · ' : ''}{o.kind} · {o.value_count} date ranges</span>
                <span className="flex items-center gap-2">
                  <Badge variant={OUTBOX_VARIANT[o.status] ?? 'outline'}>{o.status.replaceAll('_', ' ')}</Badge>
                  <span className="text-muted-foreground">{when(o.sent_at ?? o.created_at)}</span>
                </span>
                {o.task_ids?.length ? (
                  <span className="w-full flex flex-wrap gap-2">
                    {o.task_ids.map((t) => (
                      <button key={t} type="button" title="Copy task ID for the certification form" className="inline-flex items-center gap-1 font-mono text-[11px] hover:underline"
                        onClick={() => { void navigator.clipboard?.writeText(t).then(() => toast.success('Task ID copied'), () => toast.error('Copy failed')); }}>
                        task {t}<Copy className="h-3 w-3" />
                      </button>
                    ))}
                  </span>
                ) : null}
                {(o.last_error || o.warnings?.length) && <span className="w-full text-amber-700 dark:text-amber-400 break-all">{o.last_error ?? JSON.stringify(o.warnings).slice(0, 300)}</span>}
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">“Sent” means Channex accepted the message. Use Verify on the Setup tab to confirm what Channex now holds.</p>
      </section>

      {status.permissions.manage && status.connection?.mode === 'live' && (
        <section className="space-y-2 rounded-lg border p-3">
          <h3 className="text-sm font-semibold">Recover bookings after an outage</h3>
          <p className="text-xs text-muted-foreground">Channex re-offers unacknowledged bookings for about 30 minutes. After a longer outage, fetch every booking change since the outage started. Bookings already in HotelCare are not duplicated.</p>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="space-y-1"><Label htmlFor="cx-since">Outage started</Label><Input id="cx-since" type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} /></div>
            <Button size="sm" variant="outline" disabled={busy !== null || !since} onClick={() => void run('recover_bookings', { since: new Date(since).toISOString() }, 'Recovery finished')}>Recover bookings</Button>
          </div>
        </section>
      )}

      <section className="space-y-1">
        <h3 className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4" />Audit trail</h3>
        <div className="divide-y text-xs">
          {status.audit.map((a) => (
            <div key={a.id} className="flex justify-between gap-2 py-1"><span>{a.action.replaceAll('_', ' ')}</span><span className="text-muted-foreground">{when(a.created_at)}</span></div>
          ))}
        </div>
      </section>
    </div>
  );
}
