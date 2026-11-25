import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { CheckCircle2, Clock, Copy, Info, Landmark, Loader2, RefreshCw, Settings2, TriangleAlert, WifiOff } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useLocaleFormat } from '@/lib/i18n/localeFormat';

/**
 * VIZA reporting health in Reception. The THF spec requires the unsent and
 * rejected counters to be clearly visible to users; this card shows them,
 * lets managers configure the hotel's NTAK identity, and retry failures.
 */

interface VizaQueueFailure {
  id: string;
  reservation_id: string;
  last_error: string;
  attempts: number;
  updated_at: string;
  reservation?: { reservation_number: string | null; guest: { first_name: string | null; last_name: string | null } | null } | null;
}

interface VizaStatus {
  configured: boolean;
  can_manage: boolean;
  queued: number;
  settings: {
    enabled: boolean; environment: string; thf_url: string;
    adatszolgaltatasi_azonosito: string | null; szallas_nev: string | null;
    szolgaltato_adoszam: string | null; szolgaltato_nev: string | null;
    last_status_code: string | null; last_status_at: string | null;
    unsent_count: number; failed_count: number; last_error: string | null; updated_at?: string | null;
  } | null;
  events: Array<{
    id: string; updated_at: string; arrival_state: string; departure_state: string | null; last_error: string | null; attempts: number;
    guest_name?: string | null; needs_correction?: boolean; next_attempt_at?: string | null;
    reservation_number?: string | null; erkezes_ideje?: string | null; tavozas_ideje?: string | null;
    arrival_fogadas_azonosito?: string | null; departure_fogadas_azonosito?: string | null;
  }>;
}

async function callViza(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('viza-thf', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx?.json) {
      const parsed = await ctx.json().catch(() => null) as { error?: string } | null;
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw new Error(error.message || 'Request failed');
  }
  if (data?.ok === false) throw new Error(String(data.error ?? 'Request failed'));
  return data as Record<string, unknown>;
}

const zone = 'Europe/Budapest';
const knownFlags = new Set(['VIZA-OFFLINE', 'KM-OFFLINE', 'OUTOFKEYS', 'RA-OFFLINE', 'CERT-WARNING', 'CERT-EXPIRED', 'CERT-RENEWED', 'RESTART-THF', 'DATA-REJECTED']);
type ListKind = 'NEMBEKULDOTT' | 'HIBAS';
type MessageList = { eredmenyKod?: string | null; fault?: string | null; items: Record<string, string>[] };
type MessageLists = Record<ListKind, MessageList>;
const listKinds: ListKind[] = ['NEMBEKULDOTT', 'HIBAS'];
const standardColumns = ['uzenetAzonosito', 'adatszolgaltatasiAzonosito', 'hibaUzenet'];
function columnsFor(items: Record<string, string>[]) {
  return [...new Set([...standardColumns, ...items.flatMap(item => Object.keys(item))])];
}
function csvCell(value: string) {
  // Prevent spreadsheet formula execution when opening authority-provided text.
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function exportRows(lists: MessageLists) {
  const columns = columnsFor(listKinds.flatMap(kind => lists[kind].items));
  return [
    ['List', 'Result', 'Fault', ...columns],
    ...listKinds.flatMap(kind => {
      const list = lists[kind];
      const items: Record<string, string>[] = list.items.length ? list.items : [{}];
      return items.map(item => [kind, list.eredmenyKod ?? '', list.fault ?? '', ...columns.map(key => item[key] ?? '')]);
    }),
  ];
}
function ThfListsDialog({ hotelId, open, onOpenChange }: { hotelId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const locale = useLocaleFormat(zone);
  const [lists, setLists] = useState<MessageLists | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLists(null); setError(''); setLoading(true);
    void callViza({ action: 'unsent_list', hotel_id: hotelId }).then(data => {
      if (active) setLists(data.lists as MessageLists);
    }).catch((err: Error) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [hotelId, open, revision]);
  const copy = async () => {
    if (!lists) return;
    try { await navigator.clipboard.writeText(exportRows(lists).map(row => row.join('\t')).join('\n')); toast.success(t('pms.viza.copied')); }
    catch { toast.error(t('pms.viza.copyFailed')); }
  };
  const download = () => {
    if (!lists) return;
    const stamp = locale.formatFileTimestamp(new Date());
    const url = URL.createObjectURL(new Blob(['\uFEFF', exportRows(lists).map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'viza-thf-lists-' + hotelId + '-' + stamp + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const headings = [t('pms.viza.messageId'), t('pms.viza.listNtakId'), t('pms.viza.errorMessage')];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-3xl max-h-[85dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{t('pms.viza.messageLists')}</DialogTitle><DialogDescription>{t('pms.viza.listSupport')}</DialogDescription></DialogHeader>
      {loading && <Loader2 className="h-5 w-5 animate-spin" aria-label={t('pms.fd.refresh')} />}
      {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
      {lists && listKinds.map(kind => {
        const list = lists[kind];
        const columns = columnsFor(list.items);
        return <section key={kind} className="space-y-2 min-w-0">
          <h3 className="font-semibold text-sm">{t('pms.viza.list.' + kind)} ({kind})</h3>
          <p className="text-xs">{t('pms.viza.resultCode')}: {list.eredmenyKod ?? '—'}</p>
          {list.fault && <p role="alert" className="text-xs text-destructive break-words">{list.fault}</p>}
          {!list.items.length ? <p className="text-xs text-muted-foreground">{t('pms.viza.noMessages')}</p> :
            <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead><tr>{columns.map((key, i) => <th className="p-2" key={key}>{headings[i] ?? key}</th>)}</tr></thead>
              <tbody>{list.items.map((item, index) => <tr key={index} className="border-t">{columns.map(key => <td className="p-2 break-words" key={key}>{item[key] ?? '—'}</td>)}</tr>)}</tbody></table></div>}
        </section>;
      })}
      <DialogFooter className="gap-2">
        <Button variant="outline" disabled={loading} onClick={() => setRevision(n => n + 1)}>{t('pms.fd.refresh')}</Button>
        <Button variant="outline" disabled={!lists || loading} onClick={() => void copy()}>{t('pms.viza.copyText')}</Button>
        <Button disabled={!lists || loading} onClick={download}>{t('pms.viza.downloadCsv')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
function Receipt({ id }: { id: string }) {
  const { t } = useTranslation();
  const copy = async () => {
    try { await navigator.clipboard.writeText(id); toast.success(t('pms.viza.copied')); }
    catch { toast.error(t('pms.viza.copyFailed')); }
  };
  return <span className="inline-flex items-center gap-1 text-muted-foreground" title={id}>{t('pms.viza.receipt')}: {id.length > 8 ? id.slice(0, 8) + '…' : id}<Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label={t('pms.viza.copyReceipt')} onClick={() => void copy()}><Copy className="h-3 w-3" /></Button></span>;
}

export function VizaStatusCard({ hotelId, report = false }: { hotelId: string; report?: boolean }) {
  const { t } = useTranslation();
  const { formatRecentTime: budapestTime, formatTime } = useLocaleFormat(zone);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<VizaStatus | null>(null);
  const [queueFailures, setQueueFailures] = useState<VizaQueueFailure[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ enabled: false, adatszolgaltatasi_azonosito: '', szallas_nev: '', szolgaltato_adoszam: '', szolgaltato_nev: '' });

  const refresh = useCallback(async () => {
    setFailed(false);
    try {
      const data = await callViza({ action: 'status', hotel_id: hotelId }) as unknown as VizaStatus;
      setStatus(data);
      // An enqueue failure can occur before there is any VIZA guest event to
      // retry. Fetch the durable per-reservation failure log separately.
      const failureClient = supabase as unknown as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { is: (column: string, value: null) => { order: (column: string, options: { ascending: boolean }) => { limit: (count: number) => Promise<{ data: VizaQueueFailure[] | null; error: unknown }> } } } } } };
      const { data: failureRows, error: failureError } = await failureClient
        .from('viza_trigger_failures')
        .select('id,reservation_id,last_error,attempts,updated_at,reservation:reservations!viza_trigger_failures_reservation_id_fkey(reservation_number,guest:guests!reservations_guest_id_fkey(first_name,last_name))')
        .eq('hotel_id', hotelId).is('resolved_at', null)
        .order('updated_at', { ascending: false }).limit(5);
      setQueueFailures(!failureError ? failureRows ?? [] : []);
      const s = data.settings;
      if (s) {
        setForm({
          enabled: s.enabled,
          adatszolgaltatasi_azonosito: s.adatszolgaltatasi_azonosito ?? '',
          szallas_nev: s.szallas_nev ?? '',
          szolgaltato_adoszam: s.szolgaltato_adoszam ?? '',
          szolgaltato_nev: s.szolgaltato_nev ?? '',
        });
      }
    } catch {
      setFailed(true);
      setQueueFailures([]);
      setStatus(null); // no access or function unavailable: show nothing
    }
  }, [hotelId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!status || (!status.settings && !status.can_manage)) {
    if (!report) return null;
    return <section className="rounded-lg border bg-card p-4 space-y-2">
      <h2 className="font-semibold">{t('pms.viza.title')}</h2>
      {failed ? <div role="alert" className="flex items-center gap-3 text-sm">{t('pms.rep.loadFailed')} <Button variant="outline" size="sm" onClick={refresh}>{t('pms.viza.retry')}</Button></div>
        : status ? <p className="text-sm text-muted-foreground">{t('pms.viza.notConfigured')}</p> : <Loader2 aria-label={t('pms.viza.title')} className="h-5 w-5 animate-spin" />}
    </section>;
  }
  const s = status.settings;
  const failures = status.events.filter((e) => e.arrival_state === 'failed' || e.departure_state === 'failed');

  const save = async () => {
    setSaving(true);
    try {
      await callViza({ action: 'save_settings', hotel_id: hotelId, settings: { ...form, environment: s?.environment, thf_url: s?.thf_url } });
      toast.success(t('pms.viza.saved'));
      setSettingsOpen(false);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const retry = async (eventId: string) => {
    try {
      await callViza({ action: 'retry', hotel_id: hotelId, event_id: eventId });
      toast.success(t('pms.viza.queuedAgain'));
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const retryQueueFailure = async (failureId: string) => {
    try {
      const { error } = await (supabase.rpc as CallableFunction)(
        'pms_retry_viza_trigger_failure', { _failure_id: failureId },
      );
      if (error) throw error;
      toast.success(t('pms.viza.queueRetrySuccess'));
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const [code, ...flags] = (s?.last_status_code ?? '').split('|').map(value => value.trim()).filter(Boolean);
  const unreachable = !!(s?.enabled && s.last_error);
  // The worker runs every 10 minutes; the last failed attempt is the settings row's updated_at.
  // Show the next try only while it is still ahead (or just due), never a time long past.
  const lastAttemptMs = unreachable && s?.updated_at ? Date.parse(s.updated_at) : NaN;
  const nextTry = Number.isFinite(lastAttemptMs) && lastAttemptMs + 10 * 60_000 > Date.now() - 60_000
    ? new Date(lastAttemptMs + 10 * 60_000) : null;
  const warning = !!s?.enabled && !unreachable && code === 'WARNING';
  const statusTone = !s?.enabled ? 'secondary' : unreachable ? 'destructive'
    : code === 'OK' ? 'default' : warning ? 'outline' : code ? 'destructive' : 'outline';

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2" data-training="fd-viza-card" title={t('pms.viza.tip')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="flex items-center gap-1.5 font-semibold"><Landmark className="h-4 w-4 text-primary" /> {t('pms.viza.title')}</span>
        {!s ? (
          <span className="text-muted-foreground">{t('pms.viza.notConfigured')}</span>
        ) : (
          <>
            <Badge variant={statusTone} className={`text-[10px] ${warning ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : ''}`}>{!s.enabled ? t('labels.state.disabled') : unreachable ? t('pms.viza.notReachable') : code || '—'}</Badge>
            {!status.configured && s.enabled && <span className="text-amber-700 dark:text-amber-400">{t('pms.viza.waitingCerts')}</span>}
            <span>{t('pms.viza.queued')}: <strong>{status.queued}</strong></span>
            <span>{t('pms.viza.unsent')}: <strong>{s.last_status_at ? s.unsent_count : '—'}</strong></span>
            <span className={s.failed_count > 0 ? 'text-destructive font-semibold' : ''}>{t('pms.viza.rejected')}: <strong>{s.last_status_at ? s.failed_count : '—'}</strong></span>
            <span className="text-muted-foreground">{t('pms.viza.lastSuccessfulCheck')}: {s.last_status_at ? budapestTime(s.last_status_at) : '—'}</span>
            {unreachable && <span className="text-destructive">{t('pms.viza.lastAttempt')}: {s.updated_at ? budapestTime(s.updated_at) : '—'} – {t('ntak.vizaState.failed')}</span>}
          </>
        )}
        {report && status.can_manage && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setListsOpen(true)}>{t('pms.viza.messageLists')}</Button>}
        {status.can_manage && (
          <Button type="button" size="sm" variant="ghost" className="h-7 ml-auto gap-1 text-xs" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" /> {t('pms.viza.settings')}
          </Button>
        )}
      </div>
      {s?.enabled && (flags.length > 0 || code === 'WARNING' || code === 'ERROR') && <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {flags.map((flag, index) => <p key={flag + index}>{knownFlags.has(flag) ? t('pms.viza.flag.' + flag) : flag}</p>)}
        {(code === 'WARNING' || code === 'ERROR') && <p className="font-medium">{t('pms.viza.notifyOperator')}</p>}
      </div>}
      {/* The THF cannot be reached (validation case 2.6). Plain words first: the desk keeps working,
          nothing is lost, when the next automatic try is and what to do; the raw error stays visible
          underneath for support. While the THF is down the worker sends nothing, so queued reports keep
          no back-off and go out at the first run after the connection is back. */}
      {s?.enabled && s.last_error && (
        <div role="alert" className="mt-1.5 flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-training="fd-viza-unreachable">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold">{t('pms.viza.outageTitle')}</p>
            <p className="flex items-start gap-1.5"><CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('pms.viza.outageDesk')}</p>
            <p className="flex items-start gap-1.5"><Clock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {status.queued > 0 ? t('pms.viza.outageQueued').replace('{count}', String(status.queued)) : t('pms.viza.outageNothingQueued')}
            </p>
            {nextTry && <p className="flex items-start gap-1.5 font-medium"><RefreshCw className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('pms.viza.outageNextTryAt').replace('{time}', formatTime(nextTry))}</p>}
            <p className="flex items-start gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('pms.viza.outageAction')}</p>
            <p className="mt-1.5 break-words border-t border-amber-200 pt-1.5 text-[11px] opacity-80 dark:border-amber-800">
              <span className="font-medium">{t('pms.viza.technicalDetails')}:</span> {s.last_error}
            </p>
          </div>
        </div>
      )}
      {s?.enabled && queueFailures.length > 0 && (
        <div className="mt-1.5 space-y-1" data-training="fd-viza-queue-failures" role="alert">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
            <TriangleAlert className="h-3.5 w-3.5" /> {t('pms.viza.queueFailed')}
          </p>
          {queueFailures.map((failure) => (
            <div key={failure.id} className="flex items-center gap-2 rounded-md border border-destructive/30 px-2 py-1 text-[11px]">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t('pms.viza.queueReservation')} {[failure.reservation?.reservation_number, failure.reservation?.guest ? [failure.reservation.guest.first_name, failure.reservation.guest.last_name].filter(Boolean).join(' ') : null].filter(Boolean).join(' · ') || '—'}</p>
                <p className="break-words text-destructive">{failure.last_error}</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-[11px]"
                onClick={() => void retryQueueFailure(failure.id)}>
                {t('pms.viza.retryQueue')}
              </Button>
            </div>
          ))}
        </div>
      )}
      {/* Guests whose report failed: shown to everyone at the desk, with what to do next. */}
      {!report && failures.length > 0 && (
        <div className="mt-1.5 space-y-1" data-training="fd-viza-failures">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-destructive"><TriangleAlert className="h-3.5 w-3.5" /> {t('pms.viza.guestProblems')}</p>
          {failures.slice(0, 5).map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-md border border-destructive/30 px-2 py-1 text-[11px]">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.guest_name || '—'}</p>
                <p className="truncate text-destructive" title={e.last_error ?? ''}>{e.last_error ?? t('ntak.vizaState.failed')}</p>
                <p className="text-muted-foreground">
                  {e.needs_correction ? t('pms.viza.needsFix')
                    : e.next_attempt_at ? `${t('pms.viza.nextTry')}: ${budapestTime(e.next_attempt_at)}` : ''}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-[11px]" onClick={() => retry(e.id)}>{t('pms.viza.sendAgain')}</Button>
            </div>
          ))}
        </div>
      )}

      {report && <div className="mt-3 border-t pt-3 text-sm">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{t('ntak.recentActivity')}</h3>
          <Button size="sm" variant="ghost" onClick={refresh}>{t('ntak.refreshReports')}</Button></div>
        {status.events.length === 0 ? <p className="py-2 text-muted-foreground">{t('ntak.noActivity')}</p> :
          <ul className="divide-y text-xs">{status.events.map(event => <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="font-medium">{[event.reservation_number, event.guest_name].filter(Boolean).join(' · ') || '—'}</span>
                <time className="ml-auto text-muted-foreground" dateTime={event.updated_at}>{budapestTime(event.updated_at)}</time>
                <div className="basis-full flex flex-wrap items-center gap-x-2">
                  <span>{t('pms.rep.arrivals')} · {t(`ntak.vizaState.${event.arrival_state}`)}{event.erkezes_ideje && ' · ' + budapestTime(event.erkezes_ideje)}</span>
                  {event.arrival_state === 'sent' && event.arrival_fogadas_azonosito && <Receipt id={event.arrival_fogadas_azonosito} />}
                </div>
                {event.departure_state && <div className="basis-full flex flex-wrap items-center gap-x-2">
                  <span>{t('pms.rep.departures')} · {t(`ntak.vizaState.${event.departure_state}`)}{event.tavozas_ideje && ' · ' + budapestTime(event.tavozas_ideje)}</span>
                  {event.departure_state === 'sent' && event.departure_fogadas_azonosito && <Receipt id={event.departure_fogadas_azonosito} />}
                </div>}
                {event.last_error && <span className="basis-full break-words text-destructive">{event.last_error}</span>}
                {event.needs_correction && <span className="basis-full text-muted-foreground">{t('pms.viza.needsFix')}</span>}
                {(event.arrival_state === 'failed' || event.departure_state === 'failed') && <Button size="sm" variant="outline" onClick={() => retry(event.id)}>{t('pms.viza.sendAgain')}</Button>}
              </li>)}</ul>}
      </div>}
      {report && status.can_manage && <ThfListsDialog key={hotelId} hotelId={hotelId} open={listsOpen} onOpenChange={setListsOpen} />}
      <Dialog open={settingsOpen} onOpenChange={(o) => { if (!saving) setSettingsOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('pms.viza.settings')}</DialogTitle></DialogHeader>
          <div className="space-y-2.5">
            <div>
              <Label className="text-xs">{t('pms.viza.ntakId')}</Label>
              <Input className="h-9 font-mono" maxLength={8} value={form.adatszolgaltatasi_azonosito}
                onChange={(e) => setForm({ ...form, adatszolgaltatasi_azonosito: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label className="text-xs">{t('pms.viza.accomName')}</Label>
              <Input className="h-9" maxLength={200} value={form.szallas_nev} onChange={(e) => setForm({ ...form, szallas_nev: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">{t('pms.viza.providerName')}</Label>
              <Input className="h-9" maxLength={200} value={form.szolgaltato_nev} onChange={(e) => setForm({ ...form, szolgaltato_nev: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">{t('pms.viza.providerTax')}</Label>
              <Input className="h-9 font-mono" placeholder="12345678-1-12" value={form.szolgaltato_adoszam} onChange={(e) => setForm({ ...form, szolgaltato_adoszam: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.enabled} onCheckedChange={(c) => setForm({ ...form, enabled: !!c })} /> {t('pms.viza.enable')}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setSettingsOpen(false)}>{t('common.cancel')}</Button>
            <Button type="button" disabled={saving} onClick={save} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}{t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
