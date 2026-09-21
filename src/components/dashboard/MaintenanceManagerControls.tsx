import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CheckCircle2, Clock3, History, PauseCircle, Play, RotateCcw, XCircle } from 'lucide-react';

export type ManagerMaintenanceAction = 'start' | 'hold' | 'resume' | 'resolve' | 'reopen' | 'approve' | 'reject';
export const MAINTENANCE_MANAGER_ROLES = [
  'admin', 'manager', 'top_management', 'top_management_manager',
  'housekeeping_manager', 'maintenance_manager', 'reception_manager', 'supervisor',
] as const;

export function canManageMaintenance(role: string | null | undefined): boolean {
  return !!role && (MAINTENANCE_MANAGER_ROLES as readonly string[]).includes(role);
}

/** This flag stays off until the review_maintenance_completion migration is
 * separately approved and deployed. A GitHub merge alone cannot enable it. */
export const MAINTENANCE_REVIEW_ENABLED = import.meta.env.VITE_MAINTENANCE_REVIEW_V2 === 'true';

export function maintenanceManagerActions(
  ticket: { status: 'open' | 'in_progress' | 'completed'; pending_supervisor_approval: boolean | null; on_hold: boolean | null },
  reviewEnabled = MAINTENANCE_REVIEW_ENABLED,
): ManagerMaintenanceAction[] {
  if (ticket.status === 'completed') return ['reopen'];
  if (ticket.pending_supervisor_approval) return reviewEnabled ? ['approve', 'reject'] : ['resolve'];
  const choices: ManagerMaintenanceAction[] = [];
  if (ticket.status === 'open') choices.push('start');
  if (ticket.on_hold) choices.push('resume');
  else if (ticket.status === 'in_progress') choices.push('hold');
  choices.push('resolve');
  return choices;
}

export type ManagerMaintenanceTicket = {
  id: string;
  ticket_number: string;
  room_number: string;
  status: 'open' | 'in_progress' | 'completed';
  on_hold: boolean | null;
  pending_supervisor_approval: boolean | null;
  updated_at: string;
  sla_due_date: string | null;
  resolution_text: string | null;
};
type Props = { ticket: ManagerMaintenanceTicket; language: string; onUpdated: () => void };
type HistoryEntry = { id: string; content: string; created_at: string };

const words = {
  en: {
    manage: 'Manage issue', history: 'Activity history', start: 'Start work', hold: 'Put on hold',
    resume: 'Resume', resolve: 'Resolved manually', reopen: 'Reopen issue', approve: 'Approve repair', reject: 'Request correction',
    note: 'Explain what happened', required: 'A short explanation is required.',
    noteHint: 'Record who handled the repair and what was done. This is saved in the ticket history.',
    rejectHint: 'Describe exactly what needs correcting. The worker will see this in ticket history.',
    approveHint: 'Confirm you inspected the repair. An optional note is saved in the audit trail.',
    sla: 'Reason for missed SLA', slaHint: 'The deadline has passed. Explain the delay before closing.',
    cancel: 'Cancel', confirm: 'Save update', saving: 'Saving…', saved: 'Maintenance ticket updated',
    stale: 'The ticket may have changed. Refresh the page and try again.',
    historyEmpty: 'No manager updates recorded yet.',
    completedHint: 'Manual resolution does not require an assigned maintenance worker or a completion photo.',
    reopeningHint: 'The previous resolution remains recorded in the activity history.',
  },
  hu: {
    manage: 'Hiba kezelése', history: 'Tevékenységnapló', start: 'Munka indítása', hold: 'Várakoztatás',
    resume: 'Folytatás', resolve: 'Kézzel megoldva', reopen: 'Hiba újranyitása', approve: 'Javítás jóváhagyása', reject: 'Javítás visszaküldése',
    note: 'Írja le, mi történt', required: 'Rövid magyarázat szükséges.',
    noteHint: 'Rögzítse, ki és hogyan oldotta meg a hibát. A bejegyzés megmarad a naplóban.',
    rejectHint: 'Írja le pontosan, mit kell javítani. A karbantartó a jegy előzményeiben látja az üzenetet.',
    approveHint: 'Erősítse meg a javítás ellenőrzését. A megjegyzés bekerül a naplóba.',
    sla: 'Határidő-túllépés oka', slaHint: 'A határidő lejárt. Lezárás előtt adja meg a késés okát.',
    cancel: 'Mégse', confirm: 'Módosítás mentése', saving: 'Mentés…', saved: 'Karbantartási jegy frissítve',
    stale: 'A jegy időközben módosulhatott. Frissítsen és próbálja újra.',
    historyEmpty: 'Még nincs vezetői bejegyzés.',
    completedHint: 'A kézi lezáráshoz nem szükséges kijelölt karbantartó vagy befejezési fotó.',
    reopeningHint: 'A korábbi megoldás megmarad a tevékenységnaplóban.',
  },
};

export function MaintenanceManagerControls({ ticket, language, onUpdated }: Props) {
  const c = language === 'hu' ? words.hu : words.en;
  const [action, setAction] = useState<ManagerMaintenanceAction | null>(null);
  const [note, setNote] = useState('');
  const [slaReason, setSlaReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const overdue = !!ticket.sla_due_date && new Date(ticket.sla_due_date).getTime() < Date.now();

  useEffect(() => {
    if (!showHistory) return;
    let active = true;
    setHistoryLoading(true);
    void (async () => {
      const { data, error } = await supabase.from('comments')
        .select('id, content, created_at').eq('ticket_id', ticket.id)
        .order('created_at', { ascending: false }).limit(100);
      if (active) {
        if (error) toast.error(error.message);
        setHistory((data || []).filter(entry =>
          entry.content.startsWith('[Manager maintenance action:') || entry.content.startsWith('[Maintenance review:')));
        setHistoryLoading(false);
      }
    })();
    return () => { active = false; };
  }, [showHistory, ticket.id]);

  const openAction = (next: ManagerMaintenanceAction) => { setNote(''); setSlaReason(''); setAction(next); };
  const requiresNote = (next: ManagerMaintenanceAction | null) =>
    ['resolve', 'hold', 'reopen', 'reject'].includes(next || '');

  const submit = async () => {
    if (!action || saving) return;
    if (requiresNote(action) && note.trim().length < 3) { toast.error(c.required); return; }
    if (action === 'resolve' && overdue && slaReason.trim().length < 3) { toast.error(c.slaHint); return; }
    setSaving(true);
    try {
      if (action === 'approve' || action === 'reject') {
        if (!MAINTENANCE_REVIEW_ENABLED) throw new Error('Maintenance review is not enabled');
        const { error } = await (supabase as any).rpc('review_maintenance_completion', {
          p_ticket_id: ticket.id,
          p_decision: action,
          p_note: note.trim(),
          p_expected_updated_at: ticket.updated_at,
        });
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).rpc('manage_maintenance_ticket', {
          p_ticket_id: ticket.id,
          p_action: action,
          p_note: note.trim(),
          p_expected_updated_at: ticket.updated_at,
          p_sla_breach_reason: slaReason.trim() || null,
        });
        if (error) throw error;
      }
      setAction(null);
      toast.success(c.saved);
      onUpdated();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message.includes('updated by another user') ? c.stale : message);
      onUpdated();
    } finally { setSaving(false); }
  };

  const labels: Record<ManagerMaintenanceAction, { label: string; icon: typeof Play }> = {
    start: { label: c.start, icon: Play }, hold: { label: c.hold, icon: PauseCircle },
    resume: { label: c.resume, icon: Play }, resolve: { label: c.resolve, icon: CheckCircle2 },
    reopen: { label: c.reopen, icon: RotateCcw }, approve: { label: c.approve, icon: CheckCircle2 },
    reject: { label: c.reject, icon: XCircle },
  };
  const options = maintenanceManagerActions(ticket);

  return (
    <div className="space-y-2 border-t pt-3" aria-label={c.manage}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{c.manage}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowHistory(true)}>
          <History className="mr-1 h-4 w-4" />{c.history}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map(id => {
          const { label, icon: Icon } = labels[id];
          return <Button key={id} type="button" size="sm" variant={id === 'resolve' || id === 'approve' ? 'default' : 'outline'}
            className="min-h-11 whitespace-normal" onClick={() => openAction(id)}>
            <Icon className="mr-1 h-4 w-4 shrink-0" />{label}
          </Button>;
        })}
      </div>
      <Dialog open={!!action} onOpenChange={open => { if (!open && !saving) setAction(null); }}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{action ? labels[action].label : c.manage}</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">{ticket.ticket_number} · {ticket.room_number}</div>
          {action === 'resolve' && <p className="text-sm text-muted-foreground">{c.completedHint}</p>}
          {action === 'reopen' && <p className="text-sm text-muted-foreground">{c.reopeningHint}</p>}
          {action === 'reject' && <p className="text-sm text-amber-700">{c.rejectHint}</p>}
          {action === 'approve' && <p className="text-sm text-muted-foreground">{c.approveHint}</p>}
          <div className="space-y-1.5">
            <Label htmlFor={`manager-note-${ticket.id}`}>{c.note}{requiresNote(action) ? ' *' : ''}</Label>
            <Textarea id={`manager-note-${ticket.id}`} rows={4} maxLength={2000} value={note} disabled={saving}
              onChange={event => setNote(event.target.value)} placeholder={action === 'reject' ? c.rejectHint : c.noteHint} />
          </div>
          {action === 'resolve' && overdue && <div className="space-y-1.5">
            <Label htmlFor={`manager-sla-${ticket.id}`}>{c.sla} *</Label>
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock3 className="h-3 w-3" />{c.slaHint}</p>
            <Textarea id={`manager-sla-${ticket.id}`} rows={2} maxLength={1000} value={slaReason}
              disabled={saving} onChange={event => setSlaReason(event.target.value)} />
          </div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setAction(null)}>{c.cancel}</Button>
            <Button type="button" disabled={saving || (requiresNote(action) && note.trim().length < 3) || (action === 'resolve' && overdue && slaReason.trim().length < 3)}
              onClick={() => void submit()}>{saving ? c.saving : c.confirm}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-h-[85dvh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{c.history}</DialogTitle></DialogHeader>
          {historyLoading ? <p className="text-sm text-muted-foreground">…</p> : history.length === 0
            ? <p className="text-sm text-muted-foreground">{c.historyEmpty}</p>
            : history.map(entry => <div key={entry.id} className="space-y-1 rounded-md border p-3">
                <Badge variant="outline">{new Date(entry.created_at).toLocaleString()}</Badge>
                <p className="whitespace-pre-wrap break-words text-sm">{entry.content}</p>
              </div>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
