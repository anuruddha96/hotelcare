import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { NtakClosureDialog } from './NtakClosureDialog';
import { ACCOMMODATION_CLASSES, callNtak, fmtHuf, UNIT_TYPES, type NtakMessage, type NtakSettings, type NtakStatus, type NtakUnitRow } from './ntakApi';

const STATE_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  accepted: 'default', verified: 'default', warnings: 'secondary', sent: 'outline', queued: 'outline', retry: 'outline', sending: 'outline',
  errors: 'destructive', rejected: 'destructive', failed: 'destructive', blocked: 'destructive', resend_required: 'destructive', superseded: 'outline',
};

type Form = Record<string, string | boolean>;

function toForm(s: NtakSettings | null): Form {
  const v = (x: unknown) => (x === null || x === undefined ? '' : String(x));
  return {
    enabled: !!s?.enabled, environment: s?.environment ?? 'test', endpoint_url: v(s?.endpoint_url), software_id: v(s?.software_id),
    software_version: s?.software_version ?? 'v1.0.0', registration_number: v(s?.registration_number), provider_tax_number: v(s?.provider_tax_number),
    accommodation_name: v(s?.accommodation_name), provider_name: v(s?.provider_name), unit_scope: s?.unit_scope ?? 'all',
    data_reporting_id: v(s?.data_reporting_id), registered_room_count: v(s?.registered_room_count), registered_bed_count: v(s?.registered_bed_count),
    accommodation_class: s?.accommodation_class ?? 'hotel_4', region: s?.region ?? 'budapest', ifa_type: s?.ifa_type ?? 'SZAZALEKOS',
    ifa_rate: v(s?.ifa_rate ?? 4), ifa_vat: v(s?.ifa_vat ?? 0), accommodation_vat: v(s?.accommodation_vat ?? 5), closure_mode: s?.closure_mode ?? 'manual',
    auto_close_time: (s?.auto_close_time ?? '05:00').slice(0, 5), first_closure_date: v(s?.first_closure_date), allow_backdating: !!s?.allow_backdating, backdating_min_date: v(s?.backdating_min_date), software_change_date: v(s?.software_change_date),
    signature_profile: s?.signature_profile ?? 'rsa-sha384', unknown_country_code: s?.unknown_country_code ?? 'EGYEBKULFOLDI',
    ledger_config: JSON.stringify(s?.ledger_config ?? {}, null, 2),
  };
}

export function NtakPanel({ hotelId, open, onOpenChange, onChanged }: { hotelId: string; open: boolean; onOpenChange: (o: boolean) => void; onChanged?: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<NtakStatus | null>(null);
  const [form, setForm] = useState<Form>(toForm(null));
  const [units, setUnits] = useState<NtakUnitRow[]>([]);
  const [types, setTypes] = useState<NtakStatus['room_types']>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [selfTest, setSelfTest] = useState<{ check: string; ok: boolean; detail?: string }[] | null>(null);
  const [closureDay, setClosureDay] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const data = await callNtak<NtakStatus>({ action: 'status', hotel_id: hotelId });
      setStatus(data);
      setForm(toForm(data.settings));
      setUnits(data.units);
      setTypes(data.room_types);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  useEffect(() => { if (open) void refresh(); }, [open, hotelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, body: Record<string, unknown>, after?: (r: Record<string, unknown>) => void) => {
    setBusy(label);
    try {
      const r = await callNtak<Record<string, unknown>>({ hotel_id: hotelId, ...body });
      after?.(r);
      await refresh();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = () => {
    let ledger: unknown;
    try { ledger = JSON.parse(String(form.ledger_config || '{}')); } catch { toast.error('Advanced mapping is not valid JSON'); return; }
    const num = (k: string) => (form[k] === '' ? null : Number(form[k]));
    void run('settings', {
      action: 'save_settings',
      settings: {
        ...form, ledger_config: ledger, registered_room_count: num('registered_room_count'), registered_bed_count: num('registered_bed_count'),
        ifa_rate: Number(form.ifa_rate || 0), ifa_vat: Number(form.ifa_vat), accommodation_vat: Number(form.accommodation_vat),
        registration_number: String(form.registration_number).toUpperCase().trim(), data_reporting_id: String(form.data_reporting_id).toUpperCase().trim(),
      },
    }, () => toast.success(t('ntak.saved')));
  };

  const s = status?.settings ?? null;
  const field = (key: string, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <Label className="text-xs">{t(label)}</Label>
      <Input className="h-8" value={String(form[key] ?? '')} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </div>
  );
  const select = (key: string, label: string, options: readonly (string | [string, string])[]) => (
    <div>
      <Label className="text-xs">{t(label)}</Label>
      <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={String(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
        {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
      </select>
    </div>
  );

  const downloadCsr = () => {
    if (!s?.pending_csr_pem) return;
    const url = URL.createObjectURL(new Blob([s.pending_csr_pem], { type: 'application/pkcs10' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${s.registration_number ?? 'ntak'}.csr` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('ntak.manage')}</DialogTitle></DialogHeader>
        {!status ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <Tabs defaultValue="overview">
            <TabsList className="flex-wrap h-auto">
              {['overview', 'settings', 'units', 'closures', 'messages'].map((k) => <TabsTrigger key={k} value={k}>{t(`ntak.tab.${k}`)}</TabsTrigger>)}
            </TabsList>

            <TabsContent value="overview" className="space-y-3 text-sm">
              {status.configuration_problems.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs">
                  <p className="font-semibold">{t('ntak.configProblems')}</p>
                  <ul>{status.configuration_problems.map((p) => <li key={p}>• {p}</li>)}</ul>
                </div>
              )}
              {s?.sending_blocked_reason && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  <div className="flex-1"><p className="font-semibold text-destructive">{t('ntak.blocked')}</p><p>{s.sending_blocked_reason}</p></div>
                  <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => run('clear', { action: 'clear_block' })}>{t('ntak.clearBlock')}</Button>
                </div>
              )}

              <section className="rounded-md border p-3 space-y-2">
                <p className="font-semibold">{t('ntak.cert')}</p>
                {s?.cert_not_after
                  ? <p className="text-xs">CN={s.cert_subject?.CN ?? '?'} · {t('ntak.certValidUntil')} <strong>{s.cert_not_after.slice(0, 10)}</strong></p>
                  : <p className="text-xs text-muted-foreground">{t('ntak.certMissing')}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!!busy || !s?.registration_number} onClick={() => run('csr', { action: 'generate_csr' })}>
                    {busy === 'csr' && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}{t('ntak.generateCsr')}
                  </Button>
                  {s?.has_pending_csr && <Button size="sm" variant="outline" className="gap-1" onClick={downloadCsr}><Download className="h-3.5 w-3.5" /> {t('ntak.downloadCsr')}</Button>}
                </div>
                {s?.has_pending_csr && <p className="text-xs text-muted-foreground">{t('ntak.csrHint')}</p>}
                <Label className="text-xs">{t('ntak.certPem')}</Label>
                <Textarea className="font-mono text-[10px] h-20" value={certPem} onChange={(e) => setCertPem(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
                <Label className="text-xs">{t('ntak.keyPem')}</Label>
                <Textarea className="font-mono text-[10px] h-14" value={keyPem} onChange={(e) => setKeyPem(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
                <Button size="sm" disabled={!!busy || !certPem.trim()} onClick={() => run('cert', { action: 'upload_certificate', certificate_pem: certPem, private_key_pem: keyPem || null }, (r) => {
                  setCertPem(''); setKeyPem('');
                  toast.success(t('ntak.saved'));
                  for (const w of (r.warnings as string[] | undefined) ?? []) toast.warning(w);
                })}>{t('ntak.uploadCert')}</Button>
              </section>

              <section className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('self', { action: 'self_test' }, (r) => setSelfTest(r.checks as never))}>{t('ntak.selfTest')}</Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('start', { action: 'query_start_date' })}>{t('ntak.startDate')}</Button>
                <Button size="sm" variant="outline" disabled={!!busy || !s?.enabled} onClick={() => run('sync', { action: 'initial_booking_sync' }, (r) => toast.success(`${r.bookings} bookings queued`))}>{t('ntak.initialSync')}</Button>
                <Button size="sm" variant="outline" disabled={!!busy || !s?.enabled} onClick={() => run('run', { action: 'run_now' })}>{t('ntak.runNow')}</Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('verify', { action: 'verify_now' })}>{t('ntak.verifyNow')}</Button>
                {busy && <Loader2 className="h-4 w-4 animate-spin self-center" />}
              </section>
              {s?.data_start_date && <p className="text-xs">{t('ntak.startDateValue')}: <strong>{s.data_start_date}</strong></p>}
              {s?.last_ok_at && <p className="text-xs text-muted-foreground">{t('ntak.lastOk')}: {new Date(s.last_ok_at).toLocaleString()}</p>}
              {s?.last_error && <p className="text-xs text-destructive">{s.last_error}</p>}
              {selfTest && (
                <ul className="text-xs space-y-0.5">
                  {selfTest.map((c) => <li key={c.check} className="flex items-start gap-1.5">{c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}<span>{c.check}{c.detail ? ` — ${c.detail}` : ''}</span></li>)}
                </ul>
              )}
              {status.booking_problems.length > 0 && (
                <div className="text-xs"><p className="font-semibold">{t('ntak.bookingProblems')}</p>
                  <ul>{status.booking_problems.map((b) => <li key={b.booking_no}>• {b.booking_no}: {b.last_problem}</li>)}</ul></div>
              )}
              {status.pending_events.length > 0 && (
                <div className="text-xs"><p className="font-semibold">{t('ntak.pendingEvents')}</p>
                  <ul>{status.pending_events.map((e) => <li key={e.id}>• {e.kind}{e.is_correction ? ' (correction)' : ''} · {new Date(e.occurred_at).toLocaleString()} · {e.state}: {e.last_error ?? ''}</li>)}</ul></div>
              )}
            </TabsContent>

            <TabsContent value="settings" className="space-y-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={!!form.enabled} onCheckedChange={(c) => setForm({ ...form, enabled: !!c })} /> {t('ntak.f.enabled')}
              </label>
              <div className="grid sm:grid-cols-3 gap-2.5">
                {select('environment', 'ntak.f.environment', [['test', t('ntak.test')], ['production', t('ntak.production')]])}
                {field('endpoint_url', 'ntak.f.endpoint', { placeholder: 'https://…' })}
                {field('software_id', 'ntak.f.softwareId', { maxLength: 15 })}
                {field('software_version', 'ntak.f.softwareVersion', { maxLength: 10 })}
                {field('registration_number', 'ntak.f.registrationNumber', { maxLength: 10, placeholder: 'SZ12345678' })}
                {field('provider_tax_number', 'ntak.f.taxNumber', { placeholder: '12345678-1-12' })}
                {field('accommodation_name', 'ntak.f.accommodationName')}
                {field('provider_name', 'ntak.f.providerName')}
                {select('unit_scope', 'ntak.f.unitScope', [['all', t('ntak.f.scopeAll')], ['profiled_only', t('ntak.f.scopeProfiled')]])}
                {field('data_reporting_id', 'ntak.f.dataReportingId', { maxLength: 8 })}
                {field('registered_room_count', 'ntak.f.registeredRooms', { type: 'number' })}
                {field('registered_bed_count', 'ntak.f.registeredBeds', { type: 'number' })}
                {select('accommodation_class', 'ntak.f.accommodationClass', ACCOMMODATION_CLASSES)}
                {select('region', 'ntak.f.region', ['budapest', 'countryside'])}
                {select('ifa_type', 'ntak.f.ifaType', ['SZAZALEKOS', 'TETELES', 'NINCS'])}
                {field('ifa_rate', 'ntak.f.ifaRate', { type: 'number', step: '0.01' })}
                {select('ifa_vat', 'ntak.f.ifaVat', ['0', '5', '18', '27'])}
                {select('accommodation_vat', 'ntak.f.accommodationVat', ['0', '5', '18', '27'])}
                {select('closure_mode', 'ntak.f.closureMode', [['manual', t('ntak.f.closureManual')], ['auto', t('ntak.f.closureAuto')]])}
                {field('auto_close_time', 'ntak.f.autoCloseTime', { type: 'time' })}
                {field('first_closure_date', 'ntak.f.firstClosureDate', { type: 'date' })}
                {field('backdating_min_date', 'ntak.f.backdatingMinDate', { type: 'date' })}
                {field('software_change_date', 'ntak.f.softwareChangeDate', { type: 'date' })}
                {select('signature_profile', 'ntak.f.signatureProfile', ['rsa-sha384', 'rsa-sha256', 'rsa-sha512'])}
                {select('unknown_country_code', 'ntak.f.unknownCountry', ['EGYEBKULFOLDI', 'EGYEB'])}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={!!form.allow_backdating} onCheckedChange={(v) => setForm({ ...form, allow_backdating: !!v })} /> {t('ntak.f.allowBackdating')}
              </label>
              <p className="text-xs text-muted-foreground">{t('ntak.f.backdatingHint')}</p>
              <div>
                <Label className="text-xs">{t('ntak.f.ledgerConfig')}</Label>
                <Textarea className="font-mono text-[11px] h-32" value={String(form.ledger_config)} onChange={(e) => setForm({ ...form, ledger_config: e.target.value })} />
              </div>
              <Button size="sm" disabled={!!busy} onClick={saveSettings}>{busy === 'settings' && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}{t('common.save')}</Button>
            </TabsContent>

            <TabsContent value="units" className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Button size="sm" variant="outline" disabled={!!busy || s?.unit_scope === 'profiled_only'} onClick={() => run('seed', { action: 'seed_units' }, (r) => toast.success(`+${r.created}`))}>{t('ntak.seedUnits')}</Button>
                <span className="text-xs text-muted-foreground">{units.filter((u) => u.active).length} / {s?.registered_room_count ?? '?'}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-muted-foreground">
                    {['ntak.building', 'ntak.roomNumber', 'ntak.unitType', 'ntak.singleBeds', 'ntak.doubleBeds', 'ntak.extraBeds', 'ntak.active'].map((k) => <th key={k} className="px-1 py-1 font-medium">{t(k)}</th>)}
                  </tr></thead>
                  <tbody>
                    {units.map((u, i) => {
                      const set = (patch: Partial<NtakUnitRow>) => setUnits(units.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      return (
                        <tr key={u.room_id} className="border-t">
                          <td className="px-1 py-0.5"><Input className="h-7 w-24" value={u.building} maxLength={50} onChange={(e) => set({ building: e.target.value })} /></td>
                          <td className="px-1 py-0.5"><Input className="h-7 w-20" value={u.room_number} maxLength={50} onChange={(e) => set({ room_number: e.target.value })} /></td>
                          <td className="px-1 py-0.5">
                            <select className="h-7 rounded border border-input bg-background px-1" value={u.unit_type} onChange={(e) => set({ unit_type: e.target.value })}>
                              {UNIT_TYPES.map((x) => <option key={x}>{x}</option>)}
                            </select>
                          </td>
                          {(['single_beds', 'double_beds', 'extra_beds'] as const).map((k) => (
                            <td key={k} className="px-1 py-0.5"><Input type="number" min={0} className="h-7 w-16" value={u[k]} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<NtakUnitRow>)} /></td>
                          ))}
                          <td className="px-1 py-0.5"><Checkbox checked={u.active} onCheckedChange={(c) => set({ active: !!c })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Button size="sm" disabled={!!busy || !units.length} onClick={() => run('units', { action: 'save_units', units }, () => toast.success(t('ntak.saved')))}>{t('common.save')}</Button>

              <p className="text-sm font-semibold pt-2">{t('ntak.roomTypes')}</p>
              <table className="w-full text-xs">
                <tbody>
                  {types.map((rt, i) => {
                    const ntak = rt.ntak ?? { unit_type: 'STANDARD', capacity: 2, active: form.unit_scope !== 'profiled_only' };
                    const set = (patch: Partial<typeof ntak>) => setTypes(types.map((x, j) => (j === i ? { ...x, ntak: { ...ntak, ...patch } } : x)));
                    return (
                      <tr key={rt.id} className="border-t">
                        <td className="px-1 py-0.5">{rt.name}</td>
                        <td className="px-1 py-0.5">
                          <select className="h-7 rounded border border-input bg-background px-1" value={ntak.unit_type} onChange={(e) => set({ unit_type: e.target.value })}>
                            {UNIT_TYPES.map((x) => <option key={x}>{x}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-0.5 flex items-center gap-1">{t('ntak.capacity')}<Input type="number" min={1} max={99} className="h-7 w-16" value={ntak.capacity} onChange={(e) => set({ capacity: Number(e.target.value) })} /></td>
                        <td className="px-1 py-0.5"><label className="flex items-center gap-1"><Checkbox checked={ntak.active} onCheckedChange={(c) => set({ active: !!c })} /><span>{t('ntak.f.typeReported')}</span></label></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Button size="sm" variant="outline" disabled={!!busy || !types.length} onClick={() => run('types', {
                action: 'save_room_types', room_types: types.map((rt) => ({ room_type_id: rt.id, unit_type: rt.ntak?.unit_type ?? 'STANDARD', capacity: rt.ntak?.capacity ?? 2, active: rt.ntak?.active ?? (form.unit_scope !== 'profiled_only') })),
              }, () => toast.success(t('ntak.saved')))}>{t('common.save')}</Button>
            </TabsContent>

            <TabsContent value="closures" className="space-y-3 text-sm">
              {status.missing_closures.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs">
                  <p className="font-semibold">{t('ntak.missing')} ({status.missing_closures.length})</p>
                  <div className="mt-1 flex flex-wrap gap-1">{status.missing_closures.map((d) => <Button key={d} size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setClosureDay(d)}>{d}</Button>)}</div>
                </div>
              )}
              <Button size="sm" onClick={() => setClosureDay(addDay(status.today, -1))}>{t('ntak.closeDay')}</Button>
              <table className="w-full text-xs">
                <tbody>
                  {status.closures.map((c) => (
                    <tr key={c.closed_day} className="border-t align-top">
                      <td className="py-1 pr-2 font-mono">{c.closed_day}</td>
                      <td className="py-1 pr-2"><Badge variant={STATE_TONE[c.state] ?? 'outline'} className="text-[10px]">{t(`ntak.state.${c.state}`)}</Badge> <span className="text-muted-foreground">{c.classification}</span></td>
                      <td className="py-1 pr-2">{c.totals ? `${c.totals.roomNights} · ${fmtHuf(c.totals.accommodationFee)}` : ''}</td>
                      <td className="py-1 pr-2">{c.needs_correction && <span className="text-destructive">{t('ntak.needsCorrection')}</span>}</td>
                      <td className="py-1"><Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setClosureDay(c.closed_day)}>{t('ntak.check')}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabsContent>

            <TabsContent value="messages" className="space-y-1 text-xs">
              {status.messages.length === 0 && <p className="text-muted-foreground">{t('ntak.noMessages')}</p>}
              {status.messages.map((m) => <MessageRow key={m.id} m={m} expanded={expanded === m.id} onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                onResend={m.kind !== 'closure' && ['rejected', 'failed', 'verified'].includes(m.state) ? () => run('resend', { action: 'resend_message', message_id: m.id }) : undefined} />)}
            </TabsContent>
          </Tabs>
        )}
        {closureDay && (
          <NtakClosureDialog hotelId={hotelId} day={closureDay} open={!!closureDay} onOpenChange={(o) => { if (!o) setClosureDay(null); }} onQueued={() => { void refresh(); onChanged?.(); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function addDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function MessageRow({ m, expanded, onToggle, onResend }: { m: NtakMessage; expanded: boolean; onToggle: () => void; onResend?: () => void }) {
  const { t } = useTranslation();
  const issues = [...m.errors.map((i) => ({ ...i, level: 'error' })), ...m.warnings.map((i) => ({ ...i, level: 'warning' }))];
  return (
    <div className="rounded border px-2 py-1">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={onToggle}>
        <Badge variant={STATE_TONE[m.state] ?? 'outline'} className="text-[10px]">{m.state}</Badge>
        {m.ntak_status && <span className="font-mono">{m.ntak_status}</span>}
        <span className="font-medium">{t(`ntak.kind.${m.kind}`)}</span>
        <span className="text-muted-foreground truncate max-w-[14rem]">{m.ref}</span>
        {m.errors.length > 0 && <span className="text-destructive">✕ {m.errors.length}</span>}
        {m.warnings.length > 0 && <span className="text-amber-700">⚠ {m.warnings.length}</span>}
        <span className="ml-auto text-muted-foreground">{new Date(m.sent_at ?? m.created_at).toLocaleString()}</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {m.last_error && <p className="text-destructive">{m.last_error}</p>}
          {m.processing_id && <p className="text-muted-foreground font-mono">feldolgozasAzonosito: {m.processing_id}</p>}
          {issues.map((i, idx) => (
            <div key={idx} className={i.level === 'error' ? 'text-destructive' : 'text-amber-800 dark:text-amber-300'}>
              <span className="font-mono">{i.key}</span> · {i.field}{i.value ? ` = ${i.value}` : ''}: {i.message}{i.hint ? ` — ${i.hint}` : ''}
            </div>
          ))}
          {onResend && <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={onResend}>{t('ntak.resend')}</Button>}
        </div>
      )}
    </div>
  );
}
