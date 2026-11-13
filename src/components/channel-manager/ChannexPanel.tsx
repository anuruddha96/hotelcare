import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, CheckCircle2, Copy, Inbox, Link2, RefreshCw, Send, ShieldAlert, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { channexAri, channexBookings, collectTaskIds } from '@/integrations/channex/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Connection = {
  channex_property_id: string | null; environment: string; ari_enabled: boolean; bookings_enabled: boolean; kill_switch: boolean;
  last_full_sync_at: string | null; last_feed_poll_at: string | null; currency: string | null; timezone: string | null;
};
type Mapping = { kind: string; local_id: string; channex_id: string; channex_title: string | null };
type LogRow = {
  id: string; kind: string; request_type: string; ok: boolean; http_status: number | null; task_ids: string[];
  value_count: number | null; date_from: string | null; date_to: string | null; error: string | null; created_at: string; warnings: unknown;
};
type Revision = { revision_id: string; booking_id: string; status: string; ota_name: string | null; arrival_date: string | null; departure_date: string | null; acked_at: string | null; review_required: boolean; review_reason: string | null; apply_error: string | null; received_at: string };

const copy = async (text: string) => {
  try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error('Copy failed'); }
};

/** Channex (staging) control panel for a HotelCare-native hotel. */
export function ChannexPanel({ hotelId, orgSlug }: { hotelId: string; orgSlug: string }) {
  const [status, setStatus] = useState<{ key_configured: boolean; pending: number; failed: number; connection: Connection | null } | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const s = await channexAri('status', hotelId);
    if (!s.ok) setLoadError(s.error || 'Could not read Channex status');
    else setStatus(s as never);
    const [m, l, r] = await Promise.all([
      db.from('channex_mappings').select('kind, local_id, channex_id, channex_title').eq('hotel_id', hotelId).order('kind'),
      db.from('channex_sync_log').select('id, kind, request_type, ok, http_status, task_ids, value_count, date_from, date_to, error, created_at, warnings')
        .eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(40),
      db.from('channex_booking_revisions').select('revision_id, booking_id, status, ota_name, arrival_date, departure_date, acked_at, review_required, review_reason, apply_error, received_at')
        .eq('hotel_id', hotelId).order('received_at', { ascending: false }).limit(20),
    ]);
    setMappings(m.data ?? []);
    setLog(l.data ?? []);
    setRevisions(r.data ?? []);
  }, [hotelId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: (r: never) => string) => {
    setBusy(label);
    try {
      const r = await fn();
      if (r.ok) toast.success(success(r as never)); else toast.error(r.error || `${label} failed`);
    } finally {
      setBusy(null);
      await load();
    }
  };

  const conn = status?.connection ?? null;
  const live = Boolean(conn?.ari_enabled && !conn?.kill_switch);
  const setFlag = (flag: 'ari_enabled' | 'bookings_enabled' | 'kill_switch', value: boolean) =>
    run('Settings', () => channexAri('set_flags', hotelId, { [flag]: value }), () => 'Saved');

  return <Card className="border-primary/40">
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2"><Link2 className="h-4 w-4" />Channex · staging</CardTitle>
        <div className="flex gap-2">
          <Badge variant={status?.key_configured ? 'default' : 'destructive'}>{status?.key_configured ? 'API key set' : 'API key missing'}</Badge>
          <Badge variant={live ? 'default' : 'outline'}>{live ? 'Publishing ARI' : 'ARI off'}</Badge>
          <Badge variant={conn?.bookings_enabled ? 'default' : 'outline'}>{conn?.bookings_enabled ? 'Receiving bookings' : 'Bookings off'}</Badge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Sandbox only. Live hotels keep Previo until certification is complete.</p>
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      {loadError && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs">{loadError}</div>}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">1 · Connect</div>
          <p className="text-xs text-muted-foreground">Property: {conn?.channex_property_id ? <code className="text-[11px]">{conn.channex_property_id}</code> : 'not created yet'}</p>
          <p className="text-xs text-muted-foreground">{mappings.filter((m) => m.kind === 'room_type').length} room types · {mappings.filter((m) => m.kind === 'rate_plan').length} rate plans mapped</p>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={Boolean(busy)} onClick={() => void run('Bootstrap', () => channexAri('bootstrap', hotelId), (r: { steps?: string[] }) => `Channex mapping ready${r.steps?.length ? ': ' + r.steps.join(', ') : ''}`)}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy === 'Bootstrap' ? 'animate-spin' : ''}`} />Create / check mapping
          </Button>
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">2 · Switches</div>
          <label className="flex items-center justify-between gap-2 text-xs">Send rates &amp; availability<Switch checked={Boolean(conn?.ari_enabled)} disabled={!conn || Boolean(busy)} onCheckedChange={(v) => void setFlag('ari_enabled', v)} /></label>
          <label className="flex items-center justify-between gap-2 text-xs">Receive bookings<Switch checked={Boolean(conn?.bookings_enabled)} disabled={!conn || Boolean(busy)} onCheckedChange={(v) => void setFlag('bookings_enabled', v)} /></label>
          <label className="flex items-center justify-between gap-2 text-xs text-destructive"><span className="flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" />Emergency stop (kill switch)</span><Switch checked={Boolean(conn?.kill_switch)} disabled={!conn || Boolean(busy)} onCheckedChange={(v) => void setFlag('kill_switch', v)} /></label>
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">3 · Send</div>
          <p className="text-xs text-muted-foreground">{status?.pending ?? 0} waiting · {status?.failed ?? 0} failed · last full sync {conn?.last_full_sync_at ? new Date(conn.last_full_sync_at).toLocaleString() : 'never'}</p>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="gap-1.5" disabled={!live || Boolean(busy)} onClick={() => void run('Full sync', () => channexAri('full_sync', hotelId), (r) => `Full sync sent · tasks ${collectTaskIds(r).join(', ') || '—'}`)}><Upload className="h-3.5 w-3.5" />Full sync (500 days)</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!live || Boolean(busy)} onClick={() => void run('Send now', () => channexAri('push_now', hotelId), (r) => `Sent · tasks ${collectTaskIds(r).join(', ') || 'nothing waiting'}`)}><Send className="h-3.5 w-3.5" />Send waiting changes</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!conn?.bookings_enabled || Boolean(busy)} onClick={() => void run('Check bookings', () => channexBookings('poll_hotel', hotelId), (r: { processed?: number }) => `${r.processed ?? 0} booking revision(s) processed`)}><Inbox className="h-3.5 w-3.5" />Check bookings</Button>
          </div>
          <Button asChild size="sm" variant="ghost" className="gap-1.5 px-0"><Link to={`/${orgSlug}/rates-availability`}><CalendarRange className="h-3.5 w-3.5" />Open Rates &amp; availability</Link></Button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between"><h3 className="font-medium">Channex requests (task IDs for the certification form)</h3><Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /></Button></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b"><th className="py-1 pr-2">Time</th><th className="pr-2">Type</th><th className="pr-2">Values</th><th className="pr-2">Dates</th><th className="pr-2">Result</th><th>Task ID</th></tr></thead>
            <tbody>
              {log.length === 0 && <tr><td colSpan={6} className="py-3 text-muted-foreground">No requests yet.</td></tr>}
              {log.map((row) => <tr key={row.id} className="border-b border-border/50 align-top">
                <td className="py-1 pr-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                <td className="pr-2">{row.request_type === 'full_sync' ? 'Full sync · ' : ''}{row.kind.replaceAll('_', ' ')}</td>
                <td className="pr-2">{row.value_count ?? ''}</td>
                <td className="pr-2 whitespace-nowrap">{row.date_from ? `${row.date_from} → ${row.date_to}` : ''}</td>
                <td className="pr-2">{row.ok ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3" />{row.http_status}</span> : <span className="inline-flex items-center gap-1 text-destructive" title={row.error ?? ''}><XCircle className="h-3 w-3" />{row.http_status ?? 'error'}</span>}{Array.isArray(row.warnings) && row.warnings.length > 0 && <span className="ml-1 text-amber-700">{row.warnings.length} warning(s)</span>}</td>
                <td>{row.task_ids?.map((t) => <button key={t} className="inline-flex items-center gap-1 font-mono hover:underline" onClick={() => void copy(t)}>{t}<Copy className="h-3 w-3" /></button>)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="font-medium mb-1">Bookings received from Channex</h3>
        {revisions.length === 0 ? <p className="text-xs text-muted-foreground">None yet. Create a booking with the Channex "Booking CRS" app or the Booking.com test account.</p> :
          <div className="space-y-1">{revisions.map((r) => <div key={r.revision_id} className="flex items-center justify-between gap-2 flex-wrap border-b border-border/50 py-1 text-xs">
            <span><Badge variant={r.status === 'cancelled' ? 'destructive' : 'outline'} className="mr-2">{r.status}</Badge>{r.ota_name} · {r.arrival_date} → {r.departure_date} · <span className="font-mono">{r.booking_id.slice(0, 8)}</span></span>
            <span className="flex gap-2">{r.review_required && <Badge variant="destructive" title={r.review_reason ?? ''}>Needs review</Badge>}{r.apply_error && <Badge variant="destructive" title={r.apply_error}>Not saved</Badge>}{r.acked_at ? <span className="text-emerald-700">acknowledged</span> : <span className="text-amber-700">not acknowledged</span>}</span>
          </div>)}</div>}
      </div>
    </CardContent>
  </Card>;
}
