import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Landmark, Loader2, Settings2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * VIZA reporting health in Reception. The THF spec requires the unsent and
 * rejected counters to be clearly visible to users; this card shows them,
 * lets managers configure the hotel's NTAK identity, and retry failures.
 */

interface VizaStatus {
  configured: boolean;
  can_manage: boolean;
  queued: number;
  settings: {
    enabled: boolean; environment: string; thf_url: string;
    adatszolgaltatasi_azonosito: string | null; szallas_nev: string | null;
    szolgaltato_adoszam: string | null; szolgaltato_nev: string | null;
    last_status_code: string | null; last_status_at: string | null;
    unsent_count: number; failed_count: number; last_error: string | null;
  } | null;
  events: Array<{ id: string; updated_at: string; arrival_state: string; departure_state: string | null; last_error: string | null; attempts: number }>;
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

export function VizaStatusCard({ hotelId, report = false }: { hotelId: string; report?: boolean }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<VizaStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ enabled: false, adatszolgaltatasi_azonosito: '', szallas_nev: '', szolgaltato_adoszam: '', szolgaltato_nev: '' });

  const refresh = useCallback(async () => {
    setFailed(false);
    try {
      const data = await callViza({ action: 'status', hotel_id: hotelId }) as unknown as VizaStatus;
      setStatus(data);
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
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const statusTone = !s?.enabled ? 'secondary'
    : s.last_status_code?.startsWith('OK') ? 'default'
    : s.last_status_code ? 'destructive' : 'outline';

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2" data-training="fd-viza-card" title={t('pms.viza.tip')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="flex items-center gap-1.5 font-semibold"><Landmark className="h-4 w-4 text-primary" /> {t('pms.viza.title')}</span>
        {!s ? (
          <span className="text-muted-foreground">{t('pms.viza.notConfigured')}</span>
        ) : (
          <>
            <Badge variant={statusTone as never} className="text-[10px]">{!s.enabled ? 'OFF' : s.last_status_code ?? '—'}</Badge>
            {!status.configured && s.enabled && <span className="text-amber-700 dark:text-amber-400">{t('pms.viza.waitingCerts')}</span>}
            <span>{t('pms.viza.queued')}: <strong>{status.queued}</strong></span>
            <span>{t('pms.viza.unsent')}: <strong>{s.last_status_at ? s.unsent_count : '—'}</strong></span>
            <span className={s.failed_count > 0 ? 'text-destructive font-semibold' : ''}>{t('pms.viza.rejected')}: <strong>{s.last_status_at ? s.failed_count : '—'}</strong></span>
            {s.last_status_at && <span className="text-muted-foreground">{t('pms.viza.lastCheck')}: {new Date(s.last_status_at).toLocaleTimeString()}</span>}
          </>
        )}
        {status.can_manage && (
          <Button type="button" size="sm" variant="ghost" className="h-7 ml-auto gap-1 text-xs" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" /> {t('pms.viza.settings')}
          </Button>
        )}
      </div>
      {s?.last_error && <p className="mt-1 text-[11px] text-destructive truncate" title={s.last_error}>{s.last_error}</p>}
      {!report && failures.length > 0 && status.can_manage && (
        <div className="mt-1.5 space-y-1">
          {failures.slice(0, 3).map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-[11px]">
              <span className="text-destructive truncate flex-1">{e.last_error ?? 'failed'} · ×{e.attempts}</span>
              <Button type="button" size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => retry(e.id)}>{t('pms.viza.retry')}</Button>
            </div>
          ))}
        </div>
      )}

      {report && <div className="mt-3 border-t pt-3 text-sm">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{t('ntak.recentActivity')}</h3>
          <Button size="sm" variant="ghost" onClick={refresh}>{t('ntak.refreshReports')}</Button></div>
        {status.events.length === 0 ? <p className="py-2 text-muted-foreground">{t('ntak.noActivity')}</p> :
          <ul className="divide-y text-xs">{status.events.map(event => <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span>{t('pms.rep.arrivals')} · {t(`ntak.vizaState.${event.arrival_state}`)}</span>
                {event.departure_state && <span>{t('pms.rep.departures')} · {t(`ntak.vizaState.${event.departure_state}`)}</span>}
                <time className="ml-auto text-muted-foreground">{new Date(event.updated_at).toLocaleString(undefined, {timeZone: 'Europe/Budapest'})}</time>
                {event.last_error && <span className="basis-full break-words text-destructive">{event.last_error}</span>}
                {status.can_manage && (event.arrival_state === 'failed' || event.departure_state === 'failed') && <Button size="sm" variant="outline" onClick={() => retry(event.id)}>{t('pms.viza.retry')}</Button>}
              </li>)}</ul>}
      </div>}
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
