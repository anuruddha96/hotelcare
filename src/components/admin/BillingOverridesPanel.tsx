import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Hotel, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

type ModuleKey = 'operations' | 'revenue_bi' | 'revenue_automation' | 'maintenance';
type PricingMode = 'inherit' | 'per_room' | 'fixed_monthly';

type Org = { id: string; name: string; slug: string };
type HotelRow = { hotel_id: string; hotel_name: string; is_active: boolean };
type ModuleOverride = {
  hotel_id: string | null;
  module: ModuleKey;
  pricing_mode: PricingMode;
  price_cents: number;
};
type AccessOverride = {
  hotel_id: string | null;
  bypass_billing: boolean;
  reason: string | null;
  expires_at: string | null;
};
type ConfigPayload = {
  hotels: HotelRow[];
  module_overrides: ModuleOverride[];
  access_overrides: AccessOverride[];
  error?: string;
};

type Draft = Record<ModuleKey, { pricing_mode: PricingMode; price_cents: number }>;

const MODULES: { key: ModuleKey; label: string; hint: string }[] = [
  { key: 'operations', label: 'Housekeeping / Operations', hint: 'Housekeeping, attendance and operational workflows' },
  { key: 'revenue_bi', label: 'Revenue BI', hint: 'Revenue analytics without automatic price changes' },
  { key: 'revenue_automation', label: 'Revenue BI + Automation', hint: 'Revenue analytics plus automated pricing' },
  { key: 'maintenance', label: 'Maintenance', hint: 'Maintenance tickets, SLA and engineering workflows' },
];

const blankDraft = (): Draft => ({
  operations: { pricing_mode: 'inherit', price_cents: 0 },
  revenue_bi: { pricing_mode: 'inherit', price_cents: 0 },
  revenue_automation: { pricing_mode: 'inherit', price_cents: 0 },
  maintenance: { pricing_mode: 'inherit', price_cents: 0 },
});

const draftForScope = (rows: ModuleOverride[], hotelId: string | null): Draft => {
  const next = blankDraft();
  for (const row of rows.filter((item) => item.hotel_id === hotelId)) {
    next[row.module] = { pricing_mode: row.pricing_mode, price_cents: row.price_cents };
  }
  return next;
};

const accessForScope = (rows: AccessOverride[], hotelId: string | null) =>
  rows.find((row) => row.hotel_id === hotelId) ?? {
    hotel_id: hotelId,
    bypass_billing: false,
    reason: null,
    expires_at: null,
  };

const euros = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, '');
const toCents = (value: string) => Math.max(0, Math.round((Number.parseFloat(value) || 0) * 100));

export default function BillingOverridesPanel() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [slug, setSlug] = useState('');
  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [selectedHotel, setSelectedHotel] = useState<string>('');
  const [moduleRows, setModuleRows] = useState<ModuleOverride[]>([]);
  const [accessRows, setAccessRows] = useState<AccessOverride[]>([]);
  const [orgDraft, setOrgDraft] = useState<Draft>(blankDraft());
  const [hotelDraft, setHotelDraft] = useState<Draft>(blankDraft());
  const [orgAccess, setOrgAccess] = useState<AccessOverride>(accessForScope([], null));
  const [hotelAccess, setHotelAccess] = useState<AccessOverride>(accessForScope([], null));
  const [currency, setCurrency] = useState('EUR');
  const [vatPercent, setVatPercent] = useState(27);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from('organizations')
      .select('id, name, slug')
      .order('name')
      .then(({ data }) => {
        const rows = (data ?? []) as Org[];
        setOrgs(rows);
        if (rows.length) setSlug((current) => current || rows[0].slug);
      });
  }, []);

  const load = async (organizationSlug: string) => {
    if (!organizationSlug) return;
    setLoading(true);
    const [{ data, error }, { data: billingSettings }] = await Promise.all([
      supabase.functions.invoke('billing-admin-config', {
        body: { action: 'load', organizationSlug },
      }),
      supabase
        .from('billing_settings')
        .select('currency, vat_percent')
        .eq('organization_slug', organizationSlug)
        .maybeSingle(),
    ]);
    const payload = data as ConfigPayload | null;
    if (error || payload?.error) {
      toast.error(payload?.error ?? error?.message ?? 'Could not load commercial overrides');
      setLoading(false);
      return;
    }
    const nextHotels = payload?.hotels ?? [];
    const nextModules = payload?.module_overrides ?? [];
    const nextAccess = payload?.access_overrides ?? [];
    setHotels(nextHotels);
    setModuleRows(nextModules);
    setAccessRows(nextAccess);
    setOrgDraft(draftForScope(nextModules, null));
    setOrgAccess(accessForScope(nextAccess, null));
    setCurrency(String(billingSettings?.currency ?? 'EUR'));
    setVatPercent(Number(billingSettings?.vat_percent ?? 27));
    const firstHotel = nextHotels[0]?.hotel_id ?? '';
    setSelectedHotel((current) => (nextHotels.some((h) => h.hotel_id === current) ? current : firstHotel));
    setLoading(false);
  };

  useEffect(() => {
    void load(slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!selectedHotel) {
      setHotelDraft(blankDraft());
      setHotelAccess(accessForScope([], null));
      return;
    }
    setHotelDraft(draftForScope(moduleRows, selectedHotel));
    setHotelAccess(accessForScope(accessRows, selectedHotel));
  }, [selectedHotel, moduleRows, accessRows]);

  const selectedHotelRow = hotels.find((hotel) => hotel.hotel_id === selectedHotel);
  const grossPreview = useMemo(() => {
    const fixed = MODULES
      .map(({ key }) => orgDraft[key])
      .filter((row) => row.pricing_mode === 'fixed_monthly')
      .reduce((sum, row) => sum + row.price_cents, 0);
    return fixed + Math.round((fixed * vatPercent) / 100);
  }, [orgDraft, vatPercent]);

  const patchDraft = (
    setter: React.Dispatch<React.SetStateAction<Draft>>,
    module: ModuleKey,
    patch: Partial<Draft[ModuleKey]>,
  ) => setter((current) => ({ ...current, [module]: { ...current[module], ...patch } }));

  const save = async () => {
    if (!slug) return;
    const validate = (draft: Draft) =>
      MODULES.every(({ key }) => draft[key].pricing_mode === 'inherit' || draft[key].price_cents > 0);
    if (!validate(orgDraft) || !validate(hotelDraft)) {
      toast.error('Every explicit per-room or fixed monthly price must be above zero.');
      return;
    }

    const moduleOverrides: ModuleOverride[] = MODULES.map(({ key }) => ({
      hotel_id: null,
      module: key,
      ...orgDraft[key],
    }));
    if (selectedHotel) {
      moduleOverrides.push(
        ...MODULES.map(({ key }) => ({
          hotel_id: selectedHotel,
          module: key,
          ...hotelDraft[key],
        })),
      );
    }

    const accessOverrides: AccessOverride[] = [
      { ...orgAccess, hotel_id: null },
      ...(selectedHotel ? [{ ...hotelAccess, hotel_id: selectedHotel }] : []),
    ];

    setSaving(true);
    const { data, error } = await supabase.functions.invoke('billing-admin-config', {
      body: { action: 'save', organizationSlug: slug, moduleOverrides, accessOverrides },
    });
    setSaving(false);
    const payload = data as ConfigPayload | null;
    if (error || payload?.error) {
      toast.error(payload?.error ?? error?.message ?? 'Could not save commercial overrides');
      return;
    }
    toast.success('Module pricing and billing access saved');
    await load(slug);
  };

  const pricingEditor = (
    title: string,
    subtitle: string,
    draft: Draft,
    setter: React.Dispatch<React.SetStateAction<Draft>>,
  ) => (
    <div className="space-y-3 rounded-xl border p-4">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {MODULES.map(({ key, label, hint }) => {
          const row = draft[key];
          const fixedGross = row.price_cents + Math.round((row.price_cents * vatPercent) / 100);
          return (
            <div key={key} className="grid gap-2 rounded-lg bg-muted/30 p-3 lg:grid-cols-[1.3fr_190px_160px] lg:items-end">
              <div>
                <Label>{label}</Label>
                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Charging basis</Label>
                <Select
                  value={row.pricing_mode}
                  onValueChange={(value) => patchDraft(setter, key, { pricing_mode: value as PricingMode })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Use standard setup</SelectItem>
                    <SelectItem value="per_room">Custom per room / month</SelectItem>
                    <SelectItem value="fixed_monthly">Fixed monthly fee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Net price ({currency})</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={row.pricing_mode === 'inherit'}
                  value={euros(row.price_cents)}
                  onChange={(event) => patchDraft(setter, key, { price_cents: toCents(event.target.value) })}
                />
                {row.pricing_mode === 'fixed_monthly' && row.price_cents > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    + {vatPercent}% VAT = {(fixedGross / 100).toFixed(2)} {currency} gross / month
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5" /> Commercial overrides &amp; access
        </CardTitle>
        <CardDescription>
          Set negotiated module prices and bypass payment gating without changing a hotel's operational active state.
          Hotel-level pricing overrides the organization price; “Use standard setup” falls back to the normal pricing above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] space-y-2">
            <Label>Organization</Label>
            <Select value={slug} onValueChange={setSlug}>
              <SelectTrigger><SelectValue placeholder="Choose organization" /></SelectTrigger>
              <SelectContent>
                {orgs.map((org) => <SelectItem key={org.id} value={org.slug}>{org.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {grossPreview > 0 && (
            <Badge variant="secondary">
              Fixed organization modules preview: {(grossPreview / 100).toFixed(2)} {currency} gross incl. {vatPercent}% VAT
            </Badge>
          )}
        </div>

        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <>
            {pricingEditor(
              'Organization pricing',
              'Default negotiated price for this organization. Example: 200 EUR net + 27% VAT = 254 EUR gross.',
              orgDraft,
              setOrgDraft,
            )}

            <div className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Building2 className="mt-0.5 h-4 w-4" />
                  <div>
                    <p className="font-semibold">Organization billing access bypass</p>
                    <p className="text-xs text-muted-foreground">
                      Keeps all operationally active hotels accessible even without a trial or paid subscription.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={orgAccess.bypass_billing}
                  onCheckedChange={(value) => setOrgAccess((current) => ({ ...current, bypass_billing: value }))}
                />
              </div>
              {orgAccess.bypass_billing && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Reason / agreement note</Label>
                    <Input
                      value={orgAccess.reason ?? ''}
                      onChange={(event) => setOrgAccess((current) => ({ ...current, reason: event.target.value || null }))}
                      placeholder="e.g. RD Hotels negotiated agreement"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Expires at (optional)</Label>
                    <Input
                      type="datetime-local"
                      value={orgAccess.expires_at?.slice(0, 16) ?? ''}
                      onChange={(event) => setOrgAccess((current) => ({ ...current, expires_at: event.target.value || null }))}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[280px] flex-1 space-y-2">
                  <Label className="flex items-center gap-1.5"><Hotel className="h-4 w-4" /> Hotel override</Label>
                  <Select value={selectedHotel} onValueChange={setSelectedHotel}>
                    <SelectTrigger><SelectValue placeholder="Choose hotel" /></SelectTrigger>
                    <SelectContent>
                      {hotels.map((hotel) => (
                        <SelectItem key={hotel.hotel_id} value={hotel.hotel_id}>
                          {hotel.hotel_name}{hotel.is_active ? '' : ' — operationally inactive'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedHotelRow && (
                  <Badge variant={selectedHotelRow.is_active ? 'secondary' : 'outline'}>
                    Operational status: {selectedHotelRow.is_active ? 'active' : 'inactive'}
                  </Badge>
                )}
              </div>

              {selectedHotel && pricingEditor(
                selectedHotelRow?.hotel_name ?? 'Hotel pricing',
                'Only explicit rows override the organization agreement for this hotel.',
                hotelDraft,
                setHotelDraft,
              )}

              {selectedHotel && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/30 p-3">
                  <div>
                    <p className="font-medium">Bypass payment gate for this hotel</p>
                    <p className="text-xs text-muted-foreground">
                      Billing access only. This never changes the hotel's operational active/inactive state.
                    </p>
                  </div>
                  <Switch
                    checked={hotelAccess.bypass_billing}
                    onCheckedChange={(value) => setHotelAccess((current) => ({ ...current, bypass_billing: value }))}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                <Save className="mr-2 h-4 w-4" /> {saving ? 'Saving…' : 'Save commercial overrides'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
