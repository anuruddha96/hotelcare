import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CalendarRange, CheckCircle2, Clock3, FileSignature, Loader2, TrendingUp, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { rateConsentText, ratePlanRanges } from '../../../../supabase/functions/_shared/ratePlan';
import { scheduleConsentText } from '../../../../supabase/functions/_shared/schedulePlanner';
import { RatePlanView } from './RatePlanView';
import { SchedulePlanView } from './SchedulePlanView';
import { dayLabel, hours, money, when, type ActionRequestRow, type RatePlan, type ScheduleCardPlan } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const STATUS_LABEL: Record<ActionRequestRow['status'], string> = {
  pending: 'Waiting for your approval',
  approved: 'Approved',
  applying: 'Being carried out',
  applied: 'Done',
  partially_applied: 'Partly done',
  failed: 'Not carried out',
  dismissed: 'Dismissed',
  expired: 'Expired',
};

function todayBudapest(): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * A plan Mira prepared, loaded from its saved record so it survives a reload:
 * the visual plan, the choice of nights or people, the consent sentence, and
 * afterwards the receipt of who approved what and when, plus the outcome.
 */
export default function ActionRequestCard({ requestId }: { requestId: string }) {
  const [request, setRequest] = useState<ActionRequestRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState(false);
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db.from('assistant_action_requests').select('*').eq('id', requestId).maybeSingle();
    if (error || !data) { setMissing(true); return; }
    const row = data as ActionRequestRow;
    setRequest(row);
    const today = todayBudapest();
    if (row.kind === 'rate_plan') {
      const plan = row.plan as RatePlan;
      setSelected(new Set(plan.days.filter((d) => d.deltaEur !== 0 && d.date >= today).map((d) => d.date)));
    } else {
      const plan = row.plan as ScheduleCardPlan;
      setSelected(new Set(plan.staff.filter((s) => s.proposedShifts > 0).map((s) => s.staffId)));
    }
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);

  // While it is being carried out (another tab, or a slow queue), check again.
  useEffect(() => {
    if (request?.status !== 'applying' && request?.status !== 'approved') return;
    const timer = window.setTimeout(() => void load(), 4000);
    return () => window.clearTimeout(timer);
  }, [request?.status, load]);

  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const consent = useMemo(() => {
    if (!request) return '';
    if (request.kind === 'rate_plan') {
      const plan = request.plan as RatePlan;
      const ranges = ratePlanRanges(plan.days, selected);
      return ranges.length ? rateConsentText(plan, ranges) : '';
    }
    const plan = request.plan as ScheduleCardPlan;
    const today = todayBudapest();
    const cells = plan.cells.filter((c) => selected.has(c.staffId) && c.date >= today);
    if (!cells.length) return '';
    return scheduleConsentText({
      hotelName: plan.hotelName ?? request.hotel_id,
      department: plan.department ?? 'team',
      from: plan.from,
      to: plan.to,
      shifts: cells.length,
      minutes: cells.reduce((s, c) => s + c.minutes, 0),
      people: new Set(cells.map((c) => c.staffId)).size,
      publish,
    });
  }, [request, selected, publish]);

  const decide = async (decision: 'approve' | 'dismiss') => {
    if (!request) return;
    setBusy(decision);
    const { data, error } = await supabase.functions.invoke('assistant-apply-action', {
      body: { request_id: request.id, decision, items: [...selected], options: { publish } },
    });
    setBusy(null);
    const payload = data as { ok?: boolean; error?: string; summary?: string; request?: ActionRequestRow } | null;
    let message = payload?.error;
    if (!message && error) {
      const context = (error as { context?: Response }).context;
      const body = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null;
      message = body?.error ?? 'That did not work. Try again.';
      if (body?.request) setRequest(body.request);
    }
    if (payload?.request) setRequest(payload.request);
    else await load();
    if (decision === 'dismiss') { if (!message) toast.success('Dismissed — nothing was changed.'); else toast.error(message); return; }
    if (payload?.ok) toast.success(payload.summary ?? 'Done');
    else toast.error(message ?? payload?.summary ?? 'The plan was not carried out');
  };

  if (missing) {
    return <p className="mt-3 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">This plan is no longer available.</p>;
  }
  if (!request) {
    return <div className="mt-3 grid place-items-center rounded-xl border p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const pending = request.status === 'pending';
  const isRate = request.kind === 'rate_plan';
  const ratePlan = isRate ? (request.plan as RatePlan) : null;
  const schedulePlan = !isRate ? (request.plan as ScheduleCardPlan) : null;
  const itemsCount = selected.size;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm" data-testid="mira-plan-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            {isRate ? <TrendingUp className="h-4 w-4" /> : <CalendarRange className="h-4 w-4" />}
          </span>
          <div>
            <p className="text-sm font-semibold">{isRate ? 'Rate plan' : 'Schedule plan'} · {isRate ? ratePlan!.hotelName : schedulePlan!.hotelName ?? request.hotel_id}</p>
            <p className="text-xs text-muted-foreground">
              {isRate
                ? `${dayLabel(ratePlan!.from)} – ${dayLabel(ratePlan!.to)} · data ${when(ratePlan!.dataAsOf ?? ratePlan!.generatedAt)}`
                : `${schedulePlan!.department ?? 'Team'} · ${dayLabel(schedulePlan!.from)} – ${dayLabel(schedulePlan!.to)}`}
            </p>
          </div>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <div className="space-y-4 p-4">
        {ratePlan && <RatePlanView plan={ratePlan} selected={pending ? selected : undefined} onToggle={pending ? toggle : undefined} approvedItems={request.approved_items} />}
        {schedulePlan && <SchedulePlanView plan={schedulePlan} selected={pending ? selected : undefined} onToggle={pending ? toggle : undefined} approvedItems={request.approved_items} />}

        {pending ? (
          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-start gap-2">
              <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm">{consent || (isRate ? 'Choose at least one night to change.' : 'Choose at least one person.')}</p>
            </div>
            {!isRate && (
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox checked={publish} onCheckedChange={(v) => setPublish(v === true)} />
                Also publish to staff now (otherwise it is saved as a draft you publish from the Work schedule)
              </label>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />
              I have checked the plan and agree to the sentence above.
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="gap-1.5" disabled={!reviewed || !consent || busy !== null} onClick={() => void decide('approve')}>
                {busy === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
                {busy === 'approve'
                  ? (isRate ? 'Recording approval and queuing prices…' : 'Recording approval and saving…')
                  : isRate ? `Approve ${itemsCount} night${itemsCount === 1 ? '' : 's'}` : (publish ? 'Approve & publish' : 'Approve & save draft')}
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5" disabled={busy !== null} onClick={() => void decide('dismiss')}>
                <XCircle className="h-3.5 w-3.5" /> Dismiss
              </Button>
              <span className="text-[11px] text-muted-foreground">Valid until {when(request.expires_at)}. Nothing changes before you approve.</span>
            </div>
          </div>
        ) : (
          <ConsentReceipt request={request} />
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ActionRequestRow['status'] }) {
  const tone = status === 'applied' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
    : status === 'partially_applied' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
      : status === 'failed' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
        : status === 'pending' ? 'bg-primary/15 text-primary'
          : 'bg-muted text-muted-foreground';
  return <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', tone)}>{STATUS_LABEL[status]}</span>;
}

/** The decision exactly as recorded: who, when, what they agreed to, and what happened. */
export function ConsentReceipt({ request }: { request: ActionRequestRow }) {
  if (request.status === 'expired') {
    return <p className="flex items-center gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" /> This plan expired before anyone approved it. Nothing was changed — ask Mira for a fresh one.</p>;
  }
  const dismissed = request.status === 'dismissed';
  const result = request.result ?? {};
  const ranges = Array.isArray((result as { ranges?: unknown }).ranges) ? (result as { ranges: Array<Record<string, unknown>> }).ranges : [];
  const currency = request.kind === 'rate_plan' ? (request.plan as RatePlan).currency : 'EUR';
  return (
    <div className={cn('space-y-2 rounded-xl border p-3', dismissed ? 'bg-muted/40' : 'border-emerald-300/60 bg-emerald-50/50 dark:bg-emerald-500/5')} data-testid="mira-consent-receipt">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {dismissed ? <XCircle className="h-4 w-4 text-muted-foreground" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        <span className="font-semibold">{dismissed ? 'Dismissed' : 'Approved'} by {request.decided_by_name ?? 'you'}</span>
        {request.decided_by_role && <span className="text-muted-foreground">{request.decided_by_role}</span>}
        <span className="text-muted-foreground">{when(request.decided_at)}</span>
      </div>
      {request.consent_text && (
        <blockquote className="border-l-2 border-emerald-400 pl-3 text-sm italic text-foreground/90">“{request.consent_text}”</blockquote>
      )}
      {!dismissed && (
        <div className="space-y-1 text-xs">
          {request.kind === 'rate_plan' ? ranges.map((range, index) => (
            <p key={index} className="flex flex-wrap items-center gap-1.5">
              {range.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-rose-600" />}
              <span className="font-medium">{range.fromDate === range.toDate ? dayLabel(String(range.fromDate)) : `${dayLabel(String(range.fromDate))} – ${dayLabel(String(range.toDate))}`}</span>
              <span>{Number(range.deltaEur) > 0 ? '+' : ''}{money(Number(range.deltaEur), currency)}</span>
              <span className="text-muted-foreground">{range.ok ? String(range.summary ?? 'Queued') : String(range.error ?? 'Not queued')}</span>
            </p>
          )) : (
            <p className="text-muted-foreground">
              {Number((result as { inserted?: number }).inserted ?? 0)} shift(s) saved as {(result as { published?: boolean }).published ? 'published' : 'draft'}
              {Number((result as { skipped?: number }).skipped ?? 0) ? `, ${(result as { skipped?: number }).skipped} left as already planned` : ''}.
            </p>
          )}
          {request.status === 'applying' && <p className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Being carried out…</p>}
          {request.error && request.status !== 'applied' && <p className="text-rose-700 dark:text-rose-400">{request.error}</p>}
          {request.applied_at && <p className="text-muted-foreground">Carried out {when(request.applied_at)}.</p>}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Plan code {request.plan_hash.slice(0, 10)} · requested {when(request.created_at)}
        {request.kind === 'schedule_plan' && !dismissed ? ` · ${hours((request.plan as ScheduleCardPlan).totals.minutesAdded)} planned` : ''}
      </p>
    </div>
  );
}
