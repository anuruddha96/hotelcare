import { useEffect, useState } from 'react';
import { CLOSURE_CORRECTION_REASONS } from '../../../supabase/functions/_shared/ntak/codes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { callNtak, fmtHuf, type ChecklistItem, type ClosurePreview } from './ntakApi';

/**
 * Trial closure + send (spec 8.3): shows exactly what will be reported and
 * every problem found before anything leaves HotelCare. Errors block sending.
 */
export function NtakClosureDialog({ hotelId, day: initialDay, open, onOpenChange, onQueued }: {
  hotelId: string; day: string; open: boolean; onOpenChange: (o: boolean) => void; onQueued?: () => void;
}) {
  const { t } = useTranslation();
  const [day, setDay] = useState(initialDay);
  const [closed, setClosed] = useState(false);
  const [protocolId, setProtocolId] = useState('');
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [preview, setPreview] = useState<ClosurePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showXml, setShowXml] = useState(false);

  useEffect(() => { if (open) { setDay(initialDay); setPreview(null); setProtocolId(''); setReason(''); setCustomReason(false); setOverrideReason(''); setClosed(false); } }, [open, initialDay]);

  const check = async () => {
    setLoading(true);
    try {
      setPreview(await callNtak<ClosurePreview>({ action: 'preview_closure', hotel_id: hotelId, day, closed, protocol_id: protocolId || null, reason: reason || null }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) void check(); }, [open, day, closed, protocolId, reason]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (override = false) => {
    setSending(true);
    try {
      await callNtak({ action: 'close_day', hotel_id: hotelId, day, closed, protocol_id: protocolId || null, reason: reason || null, override, override_reason: override ? overrideReason.trim() : null });
      toast.success(t('ntak.queuedOk'));
      onQueued?.();
      onOpenChange(false);
    } catch (err) {
      const details = (err as { details?: { checklist?: ChecklistItem[] } }).details;
      if (details?.checklist && preview) setPreview({ ...preview, checklist: details.checklist });
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const errors = preview?.checklist.filter((c) => c.level === 'error' && !(c.code === 'correction' && reason.trim() && protocolId.length <= 25)) ?? [];
  const warnings = preview?.checklist.filter((c) => c.level === 'warning') ?? [];
  const correction = preview?.classification === 'MODOSITO';
  const needsReason = correction && !reason.trim();
  const canOverride = !!preview?.can_manage && (errors.length > 0 || warnings.length > 0) &&
    errors.every(e => ['extreme', 'age', 'country', 'ifa', 'vat', 'negative', 'category'].includes(e.code));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!sending) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('ntak.trial')}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">{t('ntak.day')}</Label>
              <Input type="date" className="h-9 w-44" value={day} max={initialDay} onChange={(e) => setDay(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <Checkbox checked={closed} onCheckedChange={(c) => setClosed(!!c)} /> {t('ntak.closedAccommodation')}
            </label>
            {preview && <Badge variant={correction ? 'secondary' : 'outline'} className="mb-2">{preview.classification}</Badge>}
          </div>

          {correction && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5 space-y-2">
              <p className="text-xs font-medium">{t('ntak.correction')}</p>
              <div className="grid sm:grid-cols-2 gap-2">
                <Input className="h-8" maxLength={25} placeholder={t('ntak.protocolId')} value={protocolId} onChange={(e) => setProtocolId(e.target.value)} />
                <select aria-label={t('ntak.reason')} className="h-8 rounded-md border bg-background px-2 text-xs" value={customReason ? '__custom' : reason}
                  onChange={(e) => { setCustomReason(e.target.value === '__custom'); setReason(e.target.value === '__custom' ? '' : e.target.value); }}>
                  <option value="">{t('ntak.reason')}</option>
                  {CLOSURE_CORRECTION_REASONS.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
                  <option value="__custom">{t('ntak.otherCorrectionReason')}</option>
                </select>
                {customReason && <Input className="h-8 sm:col-span-2" maxLength={100} placeholder={t('ntak.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />}
              </div>
            </div>
          )}

          {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('ntak.check')}…</div>}

          {preview && !loading && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {([
                  ['ntak.totals.roomNights', String(preview.totals.roomNights)],
                  ['ntak.totals.guests', String(preview.totals.guests)],
                  ['ntak.totals.accommodationFee', fmtHuf(preview.totals.accommodationFee)],
                  ['ntak.totals.ifa', fmtHuf(preview.totals.ifa)],
                  ['ntak.totals.charges', fmtHuf(preview.totals.charges)],
                  ['ntak.totals.payments', fmtHuf(preview.totals.payments)],
                ] as const).map(([key, value]) => (
                  <div key={key} className="rounded-md border bg-muted/30 px-2.5 py-1.5">
                    <div className="text-[11px] text-muted-foreground">{t(key)}</div>
                    <div className="font-semibold tabular-nums">{value}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('ntak.rooms')}: <span className="font-mono">{[preview.closure.rooms.total, preview.closure.rooms.ooo, preview.closure.rooms.oos, preview.closure.rooms.rented, preview.closure.rooms.available].join(' / ')}</span>
              </p>

              {errors.length === 0 && warnings.length === 0 && (
                <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> {t('ntak.noIssues')}</p>
              )}
              {errors.length > 0 && <IssueList title={t('ntak.errors')} items={errors} tone="error" />}
              {warnings.length > 0 && <IssueList title={t('ntak.warnings')} items={warnings} tone="warning" />}

              {canOverride && <div className="rounded border border-amber-500 p-2 space-y-2">
                <Label htmlFor="ntak-override-reason">{t('ntak.overrideReason')}</Label>
                <Input id="ntak-override-reason" maxLength={500} value={overrideReason} onChange={e => setOverrideReason(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t(preview.environment === 'test' ? 'ntak.overrideTest' : 'ntak.overrideProduction')}</p>
                <Button type="button" variant="destructive" disabled={sending || loading || needsReason || (preview.environment !== 'test' && !overrideReason.trim())} onClick={() => void send(true)}>{t('ntak.sendAnyway')}</Button>
              </div>}
              <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setShowXml((v) => !v)}>{t('ntak.showXml')}</button>
              {showXml && <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-[10px] whitespace-pre-wrap break-all">{preview.xml}</pre>}
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button type="button" variant="outline" disabled={loading || sending} onClick={check}>{t('ntak.check')}</Button>
          <Button type="button" disabled={!preview || loading || sending || errors.length > 0 || needsReason} onClick={() => void send()} className="gap-1.5">
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}{t('ntak.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IssueList({ title, items, tone }: { title: string; items: ChecklistItem[]; tone: 'error' | 'warning' }) {
  const Icon = tone === 'error' ? XCircle : AlertTriangle;
  return (
    <div className={`rounded-md border p-2 ${tone === 'error' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'}`}>
      <p className={`flex items-center gap-1.5 text-xs font-semibold ${tone === 'error' ? 'text-destructive' : 'text-amber-800 dark:text-amber-300'}`}><Icon className="h-3.5 w-3.5" /> {title} ({items.length})</p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {items.slice(0, 60).map((i, idx) => <li key={idx}>• {i.message}</li>)}
      </ul>
    </div>
  );
}
