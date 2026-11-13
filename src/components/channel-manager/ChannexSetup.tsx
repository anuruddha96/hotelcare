import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, ExternalLink, Power, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { ChannexStatus } from '@/integrations/channex/api';
import type { RunAction } from './ChannexPanel';

type Props = { status: ChannexStatus; run: RunAction; busy: string | null };

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <section className="rounded-lg border p-3 space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> : <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />}
        <span>{n}. {title}</span>
      </h3>
      <div className="pl-6 space-y-2 text-sm">{children}</div>
    </section>
  );
}

export function ChannexSetup({ status, run, busy }: Props) {
  const conn = status.connection;
  const perms = status.permissions;
  const off = !conn || conn.mode === 'off';

  // 1. connection settings
  const [environment, setEnvironment] = useState(conn?.environment ?? 'staging');
  const [currency, setCurrency] = useState(conn?.currency ?? 'EUR');
  const [occupancy, setOccupancy] = useState(String(conn?.primary_occupancy ?? 2));
  const [sandbox, setSandbox] = useState(conn?.is_sandbox_hotel ?? false);
  useEffect(() => {
    setEnvironment(conn?.environment ?? 'staging'); setCurrency(conn?.currency ?? 'EUR');
    setOccupancy(String(conn?.primary_occupancy ?? 2)); setSandbox(conn?.is_sandbox_hotel ?? false);
  }, [conn?.environment, conn?.currency, conn?.primary_occupancy, conn?.is_sandbox_hotel]);

  // 3. property
  const [title, setTitle] = useState(status.hotel_name ?? '');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('Budapest');
  const [linkId, setLinkId] = useState('');

  // 4. room types
  const mapped = useMemo(() => {
    const m = new Map<string, { room?: string; rate?: string }>();
    for (const x of status.mappings) {
      const e = m.get(x.local_id) ?? {};
      if (x.kind === 'room_type') e.room = x.channex_id; else e.rate = x.channex_id;
      m.set(x.local_id, e);
    }
    return m;
  }, [status.mappings]);
  const sellable = status.room_types.filter((r) => r.is_sellable && r.num_rooms > 0);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setSelected(sellable.map((r) => r.id)); }, [status.room_types.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const allMapped = sellable.length > 0 && sellable.every((r) => mapped.get(r.id)?.room && mapped.get(r.id)?.rate);
  const [syncReport, setSyncReport] = useState<{ room_type: string; ok: boolean; room?: string; rate_plan?: string; error?: string }[] | null>(null);

  // 6. go live
  const [confirm, setConfirm] = useState('');
  const [verify, setVerify] = useState<{ availability: { checked: number; mismatch_count: number }; rates: { checked: number; mismatch_count: number } } | null>(null);
  const keyReady = conn ? status.keys[conn.environment] : status.keys[environment as 'staging' | 'production'];
  const extranet = (conn?.environment ?? environment) === 'production' ? 'https://app.channex.io' : 'https://staging.channex.io';

  return (
    <div className="space-y-3">
      <Step n={1} title="Connection settings" done={Boolean(conn)}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="cx-env">Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as 'staging' | 'production')} disabled={!off || !perms.manage}>
              <SelectTrigger id="cx-env"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="staging">Staging (test)</SelectItem>
                <SelectItem value="production" disabled={!perms.owner}>Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cx-cur">Currency</Label>
            <Select value={currency} onValueChange={setCurrency} disabled={!off || !perms.manage || Boolean(conn?.channex_property_id)}>
              <SelectTrigger id="cx-cur"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="EUR">EUR</SelectItem><SelectItem value="HUF">HUF</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cx-occ">Priced occupancy</Label>
            <Input id="cx-occ" type="number" min={1} max={20} value={occupancy} onChange={(e) => setOccupancy(e.target.value)} disabled={!off || !perms.manage} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cx-sbx">Sandbox / test hotel</Label>
            <div className="flex items-center gap-2 h-10">
              <Switch id="cx-sbx" checked={sandbox} onCheckedChange={setSandbox} disabled={!off || !perms.owner} />
              <span className="text-xs text-muted-foreground">Only test hotels can go live on staging</span>
            </div>
          </div>
        </div>
        {perms.manage && off && (
          <Button size="sm" disabled={busy !== null} onClick={() => void run('save_connection', { environment, currency, primary_occupancy: Number(occupancy), is_sandbox_hotel: sandbox }, 'Connection settings saved')}>
            {conn ? 'Save settings' : 'Create connection'}
          </Button>
        )}
        {!off && <p className="text-xs text-muted-foreground">Switch the connection off to change these settings.</p>}
      </Step>

      {conn && (
        <>
          <Step n={2} title="Channex API access" done={keyReady}>
            <p className="text-xs text-muted-foreground">
              {keyReady
                ? `The ${conn.environment} API key is stored as a server secret. It is never shown in the browser.`
                : `Ask a HotelCare administrator to add the ${conn.environment === 'production' ? 'CHANNEX_PRODUCTION_API_KEY' : 'CHANNEX_STAGING_API_KEY'} secret to the Supabase edge functions.`}
            </p>
            {perms.manage && <Button size="sm" variant="outline" disabled={!keyReady || busy !== null} onClick={async () => {
              const r = await run<{ ok: boolean; message?: string; latency_ms?: number }>('health');
              if (r?.ok) toast.success(`Channex reachable (${r.latency_ms} ms)`); else if (r) toast.error(r.message ?? 'Channex not reachable');
            }}>Test connection</Button>}
          </Step>

          <Step n={3} title="Channex property" done={Boolean(conn.channex_property_id)}>
            {conn.channex_property_id ? (
              <p className="text-xs">Linked property <code className="text-[11px]">{conn.channex_property_id}</code> · {conn.currency} · Europe/Budapest</p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1"><Label htmlFor="cx-title">Property name</Label><Input id="cx-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="cx-email">Reservations e-mail</Label><Input id="cx-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="cx-city">City</Label><Input id="cx-city" value={city} onChange={(e) => setCity(e.target.value)} /></div>
                </div>
                {perms.manage && <Button size="sm" disabled={!keyReady || busy !== null || title.trim().length < 2} onClick={() => void run('create_property', { title, email, city }, 'Channex property created')}>Create property in Channex</Button>}
                {perms.super_admin && (
                  <div className="flex gap-2 items-end pt-2 border-t">
                    <div className="space-y-1 flex-1"><Label htmlFor="cx-link">Or link an existing property UUID (super admin)</Label><Input id="cx-link" value={linkId} onChange={(e) => setLinkId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></div>
                    <Button size="sm" variant="outline" disabled={busy !== null || linkId.length !== 36} onClick={() => void run('link_property', { channex_property_id: linkId }, 'Property linked')}>Link</Button>
                  </div>
                )}
              </>
            )}
          </Step>

          <Step n={4} title="Room types and rate plans" done={allMapped}>
            {sellable.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sellable room types found for this hotel. Set them up in Revenue settings first.</p>
            ) : (
              <div className="divide-y rounded-md border">
                {sellable.map((r) => {
                  const m = mapped.get(r.id);
                  return (
                    <label key={r.id} className="flex items-center justify-between gap-2 p-2 text-sm cursor-pointer">
                      <span className="flex items-center gap-2">
                        <Checkbox checked={selected.includes(r.id)} onCheckedChange={(v) => setSelected((s) => v ? [...s, r.id] : s.filter((x) => x !== r.id))} disabled={!perms.manage} />
                        {r.name} <span className="text-xs text-muted-foreground">· {r.num_rooms} rooms</span>
                      </span>
                      <Badge variant={m?.room && m?.rate ? 'default' : 'outline'}>{m?.room && m?.rate ? 'Mapped' : m?.room ? 'Rate plan missing' : 'Not mapped'}</Badge>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Creates one Channex room type and one per-room “Standard” rate plan per HotelCare room type, or reuses existing ones with the same name. Safe to repeat.</p>
            {perms.manage && <Button size="sm" disabled={!conn.channex_property_id || selected.length === 0 || busy !== null} onClick={async () => {
              const r = await run<{ report: typeof syncReport }>('sync_content', { room_type_ids: selected }, 'Room types synced');
              if (r) setSyncReport(r.report);
            }}>Sync to Channex</Button>}
            {syncReport && <ul className="text-xs space-y-0.5">{syncReport.map((l) => <li key={l.room_type} className={l.ok ? '' : 'text-destructive'}>{l.room_type}: {l.ok ? `room ${l.room}, rate plan ${l.rate_plan}` : l.error}</li>)}</ul>}
          </Step>

          <Step n={5} title="Instant booking notifications (webhook)" done={Boolean(conn.channex_webhook_id)}>
            <p className="text-xs text-muted-foreground">Channex notifies HotelCare the moment a booking arrives. A 5-minute check runs as a backup either way.</p>
            {perms.manage && <Button size="sm" variant="outline" disabled={!conn.channex_property_id || busy !== null} onClick={() => void run('register_webhook', {}, 'Webhook registered')}>{conn.channex_webhook_id ? 'Re-register webhook' : 'Register webhook'}</Button>}
          </Step>

          <Step n={6} title="Connect the OTAs in Channex" done={false}>
            <p className="text-xs text-muted-foreground">
              Booking.com, Expedia, Airbnb and Szallas.hu are connected and mapped inside the Channex extranet with the hotel’s own OTA credentials. Keep each channel inactive until room and rate mapping is checked, then activate it.
            </p>
            <a className="text-xs inline-flex items-center gap-1 text-primary underline" href={extranet} target="_blank" rel="noreferrer">Open Channex extranet <ExternalLink className="h-3 w-3" /></a>
          </Step>

          <Step n={7} title="Dry run, then live" done={conn.mode === 'live'}>
            <div className="flex flex-wrap gap-2">
              {perms.manage && <Button size="sm" variant={conn.mode === 'off' ? 'default' : 'outline'} disabled={busy !== null || conn.mode === 'off'} onClick={() => void run('set_mode', { mode: 'off' }, 'Connection switched off')}>Off</Button>}
              {perms.manage && <Button size="sm" variant={conn.mode === 'dry_run' ? 'default' : 'outline'} disabled={busy !== null || conn.mode === 'dry_run'} onClick={() => void run('set_mode', { mode: 'dry_run' }, 'Dry run: messages are recorded, nothing is sent')}>Dry run</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Dry run records exactly what would be sent and stores incoming bookings without applying them. Review it in Activity.</p>
            {perms.owner && conn.mode !== 'live' && (
              <div className="flex gap-2 items-end">
                <div className="space-y-1"><Label htmlFor="cx-golive">Type GO LIVE to confirm</Label><Input id="cx-golive" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-40" /></div>
                <Button size="sm" disabled={busy !== null || confirm !== 'GO LIVE'} onClick={async () => { const r = await run('set_mode', { mode: 'live', confirm }, 'Connection is live'); if (r) setConfirm(''); }}>
                  <ShieldCheck className="h-4 w-4 mr-1" />Go live
                </Button>
              </div>
            )}
            {conn.mode !== 'off' && perms.manage && (
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('full_sync', {}, 'Full sync queued (500 days)')}>Full sync</Button>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={async () => { const r = await run<typeof verify>('verify_ari', { days: 30 }); if (r) setVerify(r); }}>Verify next 30 days</Button>
                <Button size="sm" variant={conn.kill_switch ? 'default' : 'destructive'} disabled={busy !== null} onClick={() => void run('kill_switch', { on: !conn.kill_switch }, conn.kill_switch ? 'Publishing resumed; full sync queued' : 'Kill switch on: nothing is sent to OTAs')}>
                  <Power className="h-4 w-4 mr-1" />{conn.kill_switch ? 'Release kill switch' : 'Kill switch'}
                </Button>
              </div>
            )}
            {verify && (
              <p className="text-xs" role="status">
                Readback: availability {verify.availability.checked - verify.availability.mismatch_count}/{verify.availability.checked} match,
                rates {verify.rates.checked - verify.rates.mismatch_count}/{verify.rates.checked} match.
                {verify.availability.mismatch_count + verify.rates.mismatch_count > 0 && ' Recent changes can take a minute to appear in Channex; check again before acting.'}
              </p>
            )}
          </Step>
        </>
      )}
    </div>
  );
}
