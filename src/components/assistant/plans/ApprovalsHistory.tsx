import { useEffect, useState } from 'react';
import { CalendarRange, ChevronLeft, Loader2, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import ActionRequestCard from './ActionRequestCard';
import { when, type ActionRequestRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Row = Pick<ActionRequestRow, 'id' | 'kind' | 'title' | 'status' | 'decided_by_name' | 'decided_at' | 'created_at' | 'summary'>;

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Waiting', tone: 'bg-primary/15 text-primary' },
  approved: { label: 'Approved', tone: 'bg-emerald-100 text-emerald-800' },
  applying: { label: 'In progress', tone: 'bg-emerald-100 text-emerald-800' },
  applied: { label: 'Done', tone: 'bg-emerald-100 text-emerald-800' },
  partially_applied: { label: 'Partly done', tone: 'bg-amber-100 text-amber-800' },
  failed: { label: 'Not carried out', tone: 'bg-rose-100 text-rose-700' },
  dismissed: { label: 'Dismissed', tone: 'bg-muted text-muted-foreground' },
  expired: { label: 'Expired', tone: 'bg-muted text-muted-foreground' },
};

/**
 * Every plan Mira prepared for this person (and, for top management, for the
 * organization): open one to see the plan, the recorded consent and the result.
 */
export default function ApprovalsHistory() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    void db.from('assistant_action_requests')
      .select('id,kind,title,status,decided_by_name,decided_at,created_at,summary')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }: { data: Row[] | null; error: unknown }) => {
        if (error) { setUnavailable(true); setRows([]); return; }
        setRows(data ?? []);
      });
  }, []);

  if (openId) {
    return (
      <div className="space-y-2">
        <Button size="sm" variant="ghost" className="gap-1" onClick={() => setOpenId(null)}><ChevronLeft className="h-4 w-4" /> All approvals</Button>
        <ActionRequestCard requestId={openId} />
      </div>
    );
  }
  if (rows === null) return <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (unavailable) return <p className="py-6 text-center text-sm text-muted-foreground">Approvals are not available yet.</p>;
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No plans yet. Ask Mira to update prices or build a schedule.</p>;

  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => {
        const status = STATUS[row.status] ?? STATUS.pending;
        return (
          <li key={row.id}>
            <button type="button" onClick={() => setOpenId(row.id)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/40">
              <span className="mt-0.5 text-muted-foreground">{row.kind === 'rate_plan' ? <TrendingUp className="h-4 w-4" /> : <CalendarRange className="h-4 w-4" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{row.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {row.decided_at ? `${row.status === 'dismissed' ? 'Dismissed' : 'Approved'} by ${row.decided_by_name ?? '—'} · ${when(row.decided_at)}` : `Prepared ${when(row.created_at)}`}
                  {row.summary ? ` · ${row.summary}` : ''}
                </span>
              </span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', status.tone)}>{status.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
