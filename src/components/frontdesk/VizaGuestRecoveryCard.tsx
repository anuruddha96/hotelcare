import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, Info, Loader2, RefreshCw, Send, TriangleAlert, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GuestDetailsSection } from '@/components/frontdesk/GuestDetailsSection';
import { useTranslation } from '@/hooks/useTranslation';
import { useLocaleFormat } from '@/lib/i18n/localeFormat';
import { formatVizaArrivalError } from '@/lib/idScan/vizaArrivalError';
import {
  callVizaDesk, vizaSendNow, VIZA_REJECTED_EVENT, type VizaDeskOutage, type VizaRejectedDetail,
} from '@/lib/viza/vizaDesk';
import { vizaErrorFormField, vizaRejectionReason } from '@/lib/viza/vizaReason';

type Repair = { id: string; reservation_id: string; guest_id: string | null; guest_name: string | null; reservation_number: string | null; last_error?: string | null };
type DeskStatus = { events?: Repair[]; total?: number; outage?: VizaDeskOutage | null };
const zone = 'Europe/Budapest';

/**
 * VIZA at the reception desk, in plain words:
 * - when the VIZA server cannot be reached: reception keeps working, nothing is lost, when the next try is;
 * - guests whose data VIZA refused: one "Fix" button opens a popup with the reason, the guest form and
 *   one "Save and send" button that shows the result straight away.
 * The popup also opens by itself when a rejection arrives (instant send or the 10-minute run).
 * Authority settings and raw diagnostics stay in the leadership reports.
 */
export function VizaGuestRecoveryCard({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Repair[]>([]);
  const [total, setTotal] = useState(0);
  const [outage, setOutage] = useState<VizaDeskOutage | null>(null);
  const [fixing, setFixing] = useState<Repair | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    const data = await callVizaDesk<DeskStatus>({ action: 'desk_status', hotel_id: hotelId });
    const events = data?.events ?? [];
    setRows(events); setTotal(data?.total ?? 0); setOutage(data?.outage ?? null);
    return events;
  }, [hotelId]);

  useEffect(() => {
    let alive = true;
    seen.current = null;
    setRows([]); setTotal(0); setOutage(null); setFixing(null);
    const load = () => {
      void refresh().then((events) => {
        if (!alive) return;
        // A rejection that appeared since the last look (e.g. from the 10-minute run): open it at once.
        const fresh = seen.current ? events.find((e) => e.guest_id && !seen.current!.has(e.id)) : undefined;
        if (fresh) setFixing((current) => current ?? fresh);
        seen.current = new Set(events.map((e) => e.id));
      }).catch(() => {});
    };
    load();
    const timer = setInterval(load, 60_000);
    const onRejected = (event: Event) => {
      const detail = (event as CustomEvent<VizaRejectedDetail>).detail;
      if (!detail || detail.hotelId !== hotelId) return;
      void refresh().then((events) => {
        if (!alive) return;
        seen.current = new Set(events.map((e) => e.id));
        const target = events.find((e) => e.guest_id && detail.eventIds.includes(e.id));
        if (target) setFixing((current) => current ?? target);
      }).catch(() => {});
    };
    window.addEventListener(VIZA_REJECTED_EVENT, onRejected);
    return () => { alive = false; clearInterval(timer); window.removeEventListener(VIZA_REJECTED_EVENT, onRejected); };
  }, [refresh, hotelId]);

  if (!rows.length && !outage && !fixing) return null;
  return (
    <div className="space-y-2">
      {outage && <DeskOutageNotice outage={outage} />}
      {rows.length > 0 && (
        <section role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3" data-training="fd-viza-repairs">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><TriangleAlert className="h-4 w-4 text-destructive" aria-hidden="true" />{t('pms.stayGuest.repairTitle')} · {total}</h2>
            <Button size="sm" variant="ghost" onClick={() => void refresh().catch(() => {})}>{t('ntak.refreshReports')}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('pms.viza.fix.cardHint')}</p>
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.guest_name || '—'} · {row.reservation_number || '—'}</p>
                <p className="break-words text-xs text-destructive">{vizaRejectionReason(row.last_error, t)}</p>
              </div>
              <Button size="sm" disabled={!row.guest_id} onClick={() => setFixing(row)}>{t('pms.viza.fix.open')}</Button>
            </div>
          ))}
        </section>
      )}
      {fixing && (
        <VizaFixDialog
          key={fixing.id}
          hotelId={hotelId}
          row={fixing}
          onClose={() => setFixing(null)}
          onSent={() => { void refresh().then((events) => { seen.current = new Set(events.map((e) => e.id)); }).catch(() => {}); }}
        />
      )}
    </div>
  );
}

/** Reception's short version of the outage message (case 2.6). */
function DeskOutageNotice({ outage }: { outage: VizaDeskOutage }) {
  const { t } = useTranslation();
  const { formatTime } = useLocaleFormat(zone);
  const nextTry = outage.next_try_at && Date.parse(outage.next_try_at) > Date.now() - 60_000 ? outage.next_try_at : null;
  return (
    <section role="status" className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-training="fd-viza-desk-outage">
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold">{t('pms.viza.outageTitle')}</p>
        <p className="flex items-start gap-1.5"><CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('pms.viza.outageDesk')}</p>
        <p className="flex items-start gap-1.5"><Clock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {outage.waiting > 0 ? t('pms.viza.outageQueued').replace('{count}', String(outage.waiting)) : t('pms.viza.outageNothingQueued')}
        </p>
        {nextTry && <p className="flex items-start gap-1.5 font-medium"><RefreshCw className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('pms.viza.outageNextTryAt').replace('{time}', formatTime(nextTry))}</p>}
        <p className="flex items-start gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {outage.support_notified_at ? t('pms.viza.supportNotified').replace('{time}', formatTime(outage.support_notified_at)) : t('pms.viza.outageAction')}
        </p>
      </div>
    </section>
  );
}

type FixState = 'edit' | 'sending' | 'accepted' | 'rejected' | 'unreachable' | 'queued' | 'failed';

/** The correction popup: reason in plain words, the guest form (saved automatically), one "Save and send". */
function VizaFixDialog({ hotelId, row, onClose, onSent }: { hotelId: string; row: Repair; onClose: () => void; onSent: () => void }) {
  const { t } = useTranslation();
  const { formatTime } = useLocaleFormat(zone);
  const [saving, setSaving] = useState(false);
  const [sendAfterSave, setSendAfterSave] = useState(false);
  const [state, setState] = useState<FixState>('edit');
  const [lastError, setLastError] = useState<string | null>(row.last_error ?? null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nextTry, setNextTry] = useState<string | null>(null);
  const [focus] = useState(() => {
    const field = vizaErrorFormField(row.last_error);
    return field ? { field, attempt: Date.now() } : null;
  });

  const send = useCallback(async () => {
    setState('sending'); setMessage(null);
    try {
      await callVizaDesk({ action: 'desk_retry', hotel_id: hotelId, event_id: row.id });
      const res = await vizaSendNow({ hotelId, eventId: row.id, phase: 'arrival' });
      const result = res.results[0];
      if (result?.outcome === 'accepted') { setReceipt(result.receipt); setState('accepted'); toast.success(t('pms.viza.instant.acceptedArrival'), { description: row.guest_name ?? undefined }); }
      else if (result?.outcome === 'rejected') { setLastError(result.error); setState('rejected'); }
      else if (res.unreachable) { setNextTry(res.next_try_at ?? null); setState('unreachable'); }
      else setState('queued');
      onSent();
    } catch (err) {
      const raw = (err as Error).message;
      setMessage(formatVizaArrivalError(raw, t) ?? t('pms.stayGuest.repairRetryFailed'));
      setState('failed');
    }
  }, [hotelId, row.id, row.guest_name, onSent, t]);

  // "Save and send" while the form is still saving: send as soon as the save is done.
  useEffect(() => {
    if (sendAfterSave && !saving) { setSendAfterSave(false); void send(); }
  }, [sendAfterSave, saving, send]);

  const busy = state === 'sending' || sendAfterSave;
  const done = state === 'accepted' || state === 'unreachable' || state === 'queued';
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy && !saving) onClose(); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-0.75rem)] max-w-xl overflow-y-auto rounded-2xl" data-training="fd-viza-fix-dialog">
        <DialogHeader>
          <DialogTitle>{t('pms.viza.fix.title')}</DialogTitle>
          <DialogDescription>{row.guest_name || '—'} · {row.reservation_number || '—'}</DialogDescription>
        </DialogHeader>

        {state === 'accepted' ? (
          <div role="status" className="flex items-start gap-2.5 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div><p className="font-semibold">{t('pms.viza.fix.accepted')}</p>{receipt && <p className="mt-0.5 text-xs">{t('pms.viza.receipt')}: {receipt}</p>}</div>
          </div>
        ) : state === 'unreachable' || state === 'queued' ? (
          <div role="status" className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{state === 'unreachable' && nextTry ? t('pms.viza.instant.unreachableHint').replace('{time}', formatTime(nextTry)) : t('pms.viza.instant.pending')}</p>
          </div>
        ) : (
          <>
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="flex items-start gap-2 font-medium text-destructive"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{vizaRejectionReason(lastError, t)}</p>
              {state === 'rejected' && <p className="mt-1 text-xs text-destructive">{t('pms.viza.fix.stillRejected')}</p>}
              {lastError && <p className="mt-1.5 break-words text-xs text-muted-foreground">{t('pms.viza.fix.thfAnswer')}: {lastError}</p>}
            </div>
            {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
            {row.guest_id && (
              <GuestDetailsSection
                vizaReservationId={row.reservation_id}
                guestId={row.guest_id}
                autoSave
                onSavePendingChange={setSaving}
                focusProblem={focus}
              />
            )}
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {done ? (
            <Button onClick={onClose}>{t('pms.viza.fix.done')}</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={onClose}>{t('pms.viza.fix.later')}</Button>
              <Button disabled={busy} onClick={() => (saving ? setSendAfterSave(true) : void send())} className="gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                {t(busy ? 'pms.viza.fix.sending' : 'pms.viza.fix.saveAndSend')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
