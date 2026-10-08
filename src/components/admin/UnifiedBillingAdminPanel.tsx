import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import BillingSettingsPanel, { type Settings } from './BillingSettingsPanel';

type Module = 'operations' | 'revenue_bi' | 'revenue_automation' | 'maintenance';
type PricingMode = 'inherit' | 'per_room' | 'fixed_monthly';
type Org = { id: string; name: string; slug: string };
type Hotel = { organization_id: string; hotel_id: string; hotel_name: string; is_active: boolean };
type Price = { hotel_id: string | null; module: Module; pricing_mode: PricingMode; price_cents: number };
type Access = { hotel_id: string | null; bypass_billing: boolean; reason: string | null; expires_at: string | null };
type Trial = { hotel_id: string; module: Module; enabled: boolean; starts_on: string; ends_on: string };
type Agreement = { agreement_code: string; label: string; price_cents: number; enabled: boolean };
type Coverage = { agreement_code: string; hotel_id: string; module: 'revenue_bi' | 'revenue_automation'; enabled: boolean };
type Config = { module_overrides: Price[]; access_overrides: Access[]; fixed_agreements: Agreement[]; agreement_entitlements: Coverage[]; module_trials: Trial[]; error?: string };

const MODULES: { key: Module; label: string }[] = [
  { key: 'operations', label: 'Housekeeping / Operations' },
  { key: 'revenue_bi', label: 'Revenue BI' },
  { key: 'revenue_automation', label: 'BI + Automation' },
  { key: 'maintenance', label: 'Maintenance' },
];
const defaultAgreement = (): Agreement => ({ agreement_code: 'revenue', label: 'Revenue BI portfolio package', price_cents: 0, enabled: false });
const defaultPrice = (hotel_id: string | null, module: Module): Price => ({ hotel_id, module, pricing_mode: 'inherit', price_cents: 0 });
const defaultAccess = (hotel_id: string | null): Access => ({ hotel_id, bypass_billing: false, reason: null, expires_at: null });
const defaultTrial = (hotel_id: string, module: Module): Trial => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { hotel_id, module, enabled: false, starts_on: today, ends_on: today };
};
const euros = (cents: number) => (cents / 100).toFixed(2);
const cents = (value: string) => Math.round(Number(value) * 100);

export default function UnifiedBillingAdminPanel() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [scope, setScope] = useState('');
  const [loadedSlug, setLoadedSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [prices, setPrices] = useState<Price[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [dirty, setDirty] = useState(false);

  const [slug, hotelId] = scope.split('|');
  const selectedHotel = hotelId && hotelId !== '__all__' ? hotelId : null;
  const org = orgs.find((o) => o.slug === slug);
  const visibleHotels = useMemo(
    () => hotels.filter((h) => h.organization_id === org?.id).sort((a,b) => a.hotel_name.localeCompare(b.hotel_name)),
    [hotels, org?.id],
  );
  const onSettingsDraft = useCallback((next: Settings | null) => {
    setSettingsDraft(next);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [a, b] = await Promise.all([
        supabase.from('organizations').select('id,name,slug').order('name'),
        supabase.from('hotel_configurations').select('hotel_id,hotel_name,organization_id,is_active').order('hotel_name'),
      ]);
      if (!alive) return;
      if (a.error || b.error) { toast.error(a.error?.message ?? b.error?.message); setLoading(false); return; }
      const organizations = (a.data ?? []) as Org[];
      setOrgs(organizations);
      setHotels((b.data ?? []) as Hotel[]);
      if (organizations.length) setScope((old) => old || `${organizations[0].slug}|__all__`);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoadedSlug('');
    setSettingsDraft(null);
    setLoading(true);
    supabase.functions.invoke('billing-admin-config', { body: { action: 'load', organizationSlug: slug } })
      .then(({ data, error }) => {
        if (!alive) return;
        const payload = data as Config | null;
        if (error || payload?.error) { toast.error(payload?.error ?? error?.message ?? 'Could not load billing configuration'); setLoading(false); return; }
        setPrices(payload?.module_overrides ?? []);
        setAccess(payload?.access_overrides ?? []);
        setTrials(payload?.module_trials ?? []);
        setAgreements(payload?.fixed_agreements ?? []);
        setCoverage(payload?.agreement_entitlements ?? []);
        setLoadedSlug(slug);
        setDirty(false);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [slug]);

  const selectedPrice = (module: Module, hotel: string | null) =>
    prices.find((p) => p.hotel_id === hotel && p.module === module) ?? defaultPrice(hotel, module);
  const setPrice = (hotel: string | null, module: Module, patch: Partial<Price>) => {
    const existing = selectedPrice(module, hotel);
    setPrices((rows) => [...rows.filter((p) => !(p.hotel_id === hotel && p.module === module)), { ...existing, ...patch }]);
    setDirty(true);
  };
  const selectedAccess = access.find((a) => a.hotel_id === selectedHotel) ?? defaultAccess(selectedHotel);
  const patchAccess = (patch: Partial<Access>) => {
    setAccess((rows) => [...rows.filter((a) => a.hotel_id !== selectedHotel), { ...selectedAccess, ...patch }]);
    setDirty(true);
  };
  const agreement = agreements.find((a) => a.agreement_code === 'revenue') ?? defaultAgreement();
  const patchAgreement = (patch: Partial<Agreement>) => {
    setAgreements((rows) => [...rows.filter((a) => a.agreement_code !== 'revenue'), { ...agreement, ...patch }]);
    setDirty(true);
  };
  const covered = (hotel: string, module: Coverage['module']) =>
    Boolean(coverage.find((row) => row.agreement_code === 'revenue' && row.hotel_id === hotel && row.module === module)?.enabled);
  const setCovered = (hotel: string, module: Coverage['module'], enabled: boolean) => {
    setCoverage((rows) => [
      ...rows.filter((row) => !(row.agreement_code === 'revenue' && row.hotel_id === hotel && row.module === module)),
      { agreement_code: 'revenue', hotel_id: hotel, module, enabled },
    ]);
    setDirty(true);
  };
  const selectedTrial = (module: Module) =>
    trials.find((row) => row.hotel_id === selectedHotel && row.module === module) ?? defaultTrial(selectedHotel ?? '',module);
  const patchTrial = (module: Module, patch: Partial<Trial>) => {
    if (!selectedHotel) return;
    const existing = selectedTrial(module);
    setTrials((rows) => [...rows.filter((t) => !(t.hotel_id === selectedHotel && t.module === module)), { ...existing, ...patch }]);
    setDirty(true);
  };

  const save = async () => {
    if (!slug || loadedSlug !== slug || !settingsDraft || settingsDraft.organization_slug !== slug) {
      toast.error('Wait until all payment settings finish loading.'); return;
    }
    if (!Number.isFinite(agreement.price_cents) || agreement.price_cents < 0 || (agreement.enabled && !agreement.price_cents)) {
      toast.error('A selected fixed agreement needs a positive amount.'); return;
    }
    if (prices.some((row) => !Number.isFinite(row.price_cents) || row.price_cents < 0 || (row.pricing_mode !== 'inherit' && row.price_cents <= 0))) {
      toast.error('Enter a valid amount for each custom module price.'); return;
    }
    if (trials.some((row) => row.enabled && (!row.starts_on || !row.ends_on || row.ends_on < row.starts_on))) {
      toast.error('Trial end dates must not be before their start dates.'); return;
    }
    if ((settingsDraft.operations_promotion_starts_on && settingsDraft.operations_promotion_ends_on && settingsDraft.operations_promotion_starts_on > settingsDraft.operations_promotion_ends_on) ||
        (settingsDraft.revenue_promotion_starts_on && settingsDraft.revenue_promotion_ends_on && settingsDraft.revenue_promotion_starts_on > settingsDraft.revenue_promotion_ends_on)) {
      toast.error('Promotion end dates must not precede their start dates.'); return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('billing-admin-config', {
      body: { action: 'save_all', organizationSlug: slug, settings: settingsDraft,
        moduleOverrides: prices, accessOverrides: access, fixedAgreements: [agreement],
        agreementEntitlements: coverage, moduleTrials: trials },
    });
    setSaving(false);
    const payload = data as Config | null;
    if (error || payload?.error) { toast.error(payload?.error ?? error?.message ?? 'Save failed; no billing changes were committed.'); return; }
    setPrices(payload?.module_overrides ?? []);
    setAccess(payload?.access_overrides ?? []);
    setTrials(payload?.module_trials ?? []);
    setAgreements(payload?.fixed_agreements ?? []);
    setCoverage(payload?.agreement_entitlements ?? []);
    setDirty(false);
    toast.success('Payment settings and agreements saved together.');
  };

  const priceEditor = (hotel: string | null, title: string) => (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{hotel ? 'Overrides only this property; Inherit uses the organization-wide rule.' : 'Default negotiated prices for all properties unless explicitly overridden.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {MODULES.map(({key,label}) => {
          const row = selectedPrice(key,hotel);
          return <div key={key} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_220px_145px] md:items-center">
            <Label>{label}</Label>
            <Select value={row.pricing_mode} onValueChange={(value) => setPrice(hotel,key,{pricing_mode:value as PricingMode})}>
              <SelectTrigger aria-label={`${label} pricing mode`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="inherit">Inherit standard rate</SelectItem><SelectItem value="per_room">Custom €/room/month</SelectItem><SelectItem value="fixed_monthly">Custom fixed €/month</SelectItem></SelectContent>
            </Select>
            <div className="space-y-1"><Label className="text-xs">Net EUR / month</Label>
              <Input type="number" min={0} step=".01" disabled={row.pricing_mode==='inherit'} value={euros(row.price_cents)}
                onChange={(e) => setPrice(hotel,key,{price_cents:cents(e.target.value)})} />
            </div>
          </div>;
        })}
      </CardContent>
    </Card>
  );

  return <div className="space-y-6 pb-24">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-2xl font-bold flex items-center gap-2"><CreditCard className="h-6 w-6" /> Payments &amp; pricing</h2>
        <p className="text-sm text-muted-foreground">One venue selector, one save. All amounts are net of VAT.</p></div>
      <Button onClick={save} disabled={saving || loading || !settingsDraft || settingsDraft.organization_slug !== slug}>
        <Save className="mr-2 h-4 w-4" /> {saving ? 'Saving…' : 'Save all payment settings'}
      </Button>
    </div>
    <Card><CardContent className="space-y-2 pt-5">
      <Label>Organization / property</Label>
      <Select value={scope} onValueChange={(value) => { if (dirty && !window.confirm('Switch venues without saving the current pricing edits?')) return; setScope(value); }}>
        <SelectTrigger className="max-w-xl"><SelectValue placeholder="Select a property" /></SelectTrigger>
        <SelectContent>{orgs.flatMap((o) => [
          <SelectItem key={o.slug+'|__all__'} value={o.slug+'|__all__'}>{o.name} — All properties (organization agreement)</SelectItem>,
          ...hotels.filter((h) => h.organization_id === o.id).map((h) => (
            <SelectItem key={o.slug+'|'+h.hotel_id} value={o.slug+'|'+h.hotel_id}>{o.name} — {h.hotel_name}</SelectItem>
          )),
        ])}</SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Change this one selector to view the venue's module prices, trial periods, and billing access. Organization defaults and the shared agreement remain visible.</p>
    </CardContent></Card>
    {(loading || loadedSlug !== slug) ? <Skeleton className="h-80 w-full" /> : <>
      <Card><CardHeader><CardTitle className="text-lg">Shared fixed monthly contract</CardTitle>
        <CardDescription>One organization-level revenue fee can include BI at multiple venues and BI + Automation at specific venues. It is billed only once per subscription checkout.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-center">
            <div className="space-y-1.5"><Label>Contract name</Label><Input value={agreement.label} onChange={(e)=>patchAgreement({label:e.target.value})}/></div>
            <div className="space-y-1.5"><Label>Fixed net EUR / month</Label><Input type="number" step=".01" min={0} value={euros(agreement.price_cents)} onChange={(e)=>patchAgreement({price_cents:cents(e.target.value)})}/></div>
            <label className="flex items-center gap-2"><Switch checked={agreement.enabled} onCheckedChange={(enabled)=>patchAgreement({enabled})}/> Enable agreement</label>
          </div>
          <p className="text-sm font-medium">Included coverage by hotel and module</p>
          <div className="space-y-2">{visibleHotels.map((hotel) =>
            <div key={hotel.hotel_id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
              <span className="text-sm font-medium">{hotel.hotel_name}</span>
              {(['revenue_bi','revenue_automation'] as const).map((module) =>
                <label key={module} className="flex items-center gap-2 text-xs">
                  <Switch checked={covered(hotel.hotel_id,module)} onCheckedChange={(enabled)=>setCovered(hotel.hotel_id,module,enabled)}/>
                  {module==='revenue_bi' ? 'Revenue BI' : 'BI + Automation'}
                </label>)}
            </div>)}</div>
          <p className="text-xs text-muted-foreground">Example: €400 net can cover BI at all RD venues plus Automation at Ottofiori. Existing Housekeeping (€200) remains separate. This editor does not retroactively update Stripe subscriptions or invoices.</p>
        </CardContent></Card>
      {priceEditor(null, 'Organization pricing defaults')}
      {selectedHotel && priceEditor(selectedHotel, `${visibleHotels.find((h)=>h.hotel_id===selectedHotel)?.hotel_name ?? 'Venue'} — module overrides`)}
      <Card><CardHeader><CardTitle className="text-lg">{selectedHotel ? 'Property billing access & trials' : 'Organization billing access'}</CardTitle>
        <CardDescription>Billing bypass never changes the hotel's operational active status or PMS settings. Individual trials grant access without creating a payment.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Switch checked={selectedAccess.bypass_billing} onCheckedChange={(bypass_billing)=>patchAccess({bypass_billing})}/>
            <Label>Bypass payment requirement {selectedHotel ? 'for this property' : 'for the entire organization'}</Label>
          </div>
          {selectedAccess.bypass_billing && <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1"><Label>Reason</Label><Input value={selectedAccess.reason ?? ''} onChange={(e)=>patchAccess({reason:e.target.value||null})}/></div>
            <div className="space-y-1"><Label>Access expiry (optional)</Label><Input type="datetime-local" value={selectedAccess.expires_at?.slice(0,16) ?? ''} onChange={(e)=>patchAccess({expires_at:e.target.value||null})}/></div>
          </div>}
          {selectedHotel && <div className="space-y-3"><p className="font-semibold">Independent trial dates for this property</p>
            {MODULES.map(({key,label}) => {
              const trial = selectedTrial(key);
              return <div key={key} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_auto_160px_160px] md:items-center">
                <Label>{label}</Label>
                <Switch checked={trial.enabled} onCheckedChange={(enabled)=>patchTrial(key,{enabled})}/>
                <div className="space-y-1"><Label className="text-xs">Trial starts</Label><Input type="date" aria-label={label+' trial starts'} value={trial.starts_on} onChange={(e)=>patchTrial(key,{starts_on:e.target.value})}/></div>
                <div className="space-y-1"><Label className="text-xs">Trial ends</Label><Input type="date" aria-label={label+' trial ends'} value={trial.ends_on} onChange={(e)=>patchTrial(key,{ends_on:e.target.value})}/></div>
              </div>;
            })}
          </div>}
        </CardContent>
      </Card>
      <BillingSettingsPanel embedded organizationSlug={slug} onDraftChange={onSettingsDraft}/>
      <p className="text-xs text-muted-foreground">Changes save together with the single button above. Existing Stripe subscriptions are not repriced automatically.</p>
    </>}
  </div>;
}
