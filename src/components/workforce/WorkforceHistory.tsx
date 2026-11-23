import { useEffect, useMemo, useState } from 'react';
import { History, Loader2, RotateCcw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { entryKey, fetchAllRows } from '@/hooks/useWorkforce';
import { groupHistory, restoreChanges, snapshotOf, type AuditRow, type HistoryBatch, type RestoreChange } from '@/lib/workforce/history';
import { cellLabel, intlLocale, type CellLabels, type ShiftSnapshot, type WorkforceEntry, type WorkforceStaff } from '@/lib/workforce/model';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** First and last day of the month shown. */
  from: string;
  to: string;
  /** The employees shown in the grid: history and restore cover exactly these. */
  staff: WorkforceStaff[];
  entries: Map<string, WorkforceEntry>;
  cellLabels: CellLabels;
  /** Writes the restored days as drafts; returns how many could not be written. */
  onRestore: (changes: RestoreChange[]) => Promise<{ done: number; skipped: number }>;
}

/**
 * Who changed what and when, and "take the month back to before this change".
 * Reads the audit log the database keeps for every edit.
 */
export function WorkforceHistory({ open, onOpenChange, from, to, staff, entries, cellLabels, onRestore }: Props) {
  const { t, language } = useTranslation();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [plan, setPlan] = useState<{ batch: HistoryBatch; changes: RestoreChange[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null);
    fetchAllRows<AuditRow>((a, b) => db.from('workforce_audit_log')
      .select('id,actor_id,action,staff_id,work_date,before,after,created_at')
      .eq('table_name', 'workforce_entries').gte('work_date', from).lte('work_date', to)
      .order('id', { ascending: false }).range(a, b))
      .then(async (data) => {
        if (!alive) return;
        setRows(data);
        const ids = [...new Set(data.map((r) => r.actor_id).filter(Boolean) as string[])];
        if (!ids.length) return;
        const { data: people } = await db.from('profiles').select('id,full_name,nickname').in('id', ids);
        if (alive) setNames(new Map((people ?? []).map((p: { id: string; full_name: string | null; nickname: string | null }) => [p.id, p.nickname || p.full_name || ''])));
      })
      .catch(() => { if (alive) { setRows([]); toast.error(t('wf.hist.loadFail')); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, from, to]);

  const shown = useMemo(() => (rows ?? []).filter((r) => r.staff_id && staffById.has(r.staff_id)), [rows, staffById]);
  const batches = useMemo(() => groupHistory(shown), [shown]);

  const when = (iso: string) => new Date(iso).toLocaleString(intlLocale(language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest' });
  const dayText = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(intlLocale(language), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const shiftText = (shift: ShiftSnapshot | null) => (!shift || shift.kind === 'day_off' || shift.kind === 'fixed_day_off' ? t('wf.k.day_off') : cellLabel(shift, cellLabels) || t(`wf.k.${shift.kind}`));

  const prepare = (batch: HistoryBatch) => {
    const firstId = Math.min(...batch.rows.map((r) => r.id));
    const changes = restoreChanges(shown.filter((r) => r.id >= firstId), (staffId, date) => entries.get(entryKey(staffId, date)));
    if (!changes.length) { toast.info(t('wf.hist.restoreNone')); return; }
    setPlan({ batch, changes });
  };

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const { done, skipped } = await onRestore(plan.changes);
      if (done) toast.success(t('wf.hist.restored').replace('{n}', String(done)));
      if (skipped) toast.info(t('wf.hist.skipped').replace('{n}', String(skipped)));
      setPlan(null);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? t('wf.g.saveFail'));
    } finally { setBusy(false); }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><History className="h-4 w-4" />{t('wf.m.history')}</SheetTitle>
            <SheetDescription>{t('wf.hist.sub')} {t('wf.hist.scope')}.</SheetDescription>
          </SheetHeader>
          <div className="-mx-2 flex-1 space-y-2 overflow-y-auto px-2">
            {rows === null && <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            {rows !== null && !batches.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('wf.hist.empty')}</p>}
            {batches.map((batch) => {
              const sample = batch.rows.slice(0, 4);
              return (
                <div key={batch.key} className="rounded-lg border p-2.5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{(batch.actorId && names.get(batch.actorId)) || t('wf.hist.someone')}</div>
                      <div className="text-xs text-muted-foreground">
                        {when(batch.from)} · {t(batch.publishOnly ? 'wf.hist.published' : 'wf.hist.edited').replace('{n}', String(batch.rows.length))}
                      </div>
                    </div>
                    {batch.publishOnly
                      ? <Send className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      : <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={() => prepare(batch)}><RotateCcw className="mr-1 h-3.5 w-3.5" />{t('wf.hist.restore')}</Button>}
                  </div>
                  {!batch.publishOnly && (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      {sample.map((row) => {
                        const person = staffById.get(row.staff_id!);
                        return (
                          <li key={row.id} className="flex flex-wrap items-baseline gap-x-1">
                            <span className="font-medium text-foreground">{person?.nickname || person?.full_name}</span>
                            <span>· {row.work_date ? dayText(row.work_date) : ''}:</span>
                            <span className="line-through">{shiftText(row.action === 'INSERT' ? null : snapshotOf(row.before))}</span>
                            <span>→</span>
                            <span className="font-medium text-foreground">{shiftText(row.action === 'DELETE' ? null : snapshotOf(row.after))}</span>
                          </li>
                        );
                      })}
                      {batch.rows.length > sample.length && <li>{t('wf.hist.more').replace('{n}', String(batch.rows.length - sample.length))}</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!plan} onOpenChange={(o) => !o && !busy && setPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('wf.hist.restoreTitle').replace('{time}', plan ? when(plan.batch.from) : '')}</AlertDialogTitle>
            <AlertDialogDescription>{t('wf.hist.restoreBody').replace('{n}', String(plan?.changes.length ?? 0))}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
            {plan?.changes.slice(0, 12).map((c) => {
              const person = staffById.get(c.staff_id);
              return (
                <li key={`${c.staff_id}|${c.work_date}`}>
                  <span className="font-medium text-foreground">{person?.nickname || person?.full_name}</span> · {dayText(c.work_date)}: {shiftText(c.current)} → <span className="font-medium text-foreground">{shiftText(c.target)}</span>
                </li>
              );
            })}
            {plan && plan.changes.length > 12 && <li>{t('wf.hist.more').replace('{n}', String(plan.changes.length - 12))}</li>}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('wf.g.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void run(); }}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{t('wf.hist.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
