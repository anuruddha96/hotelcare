import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import type { RevenueUsage } from '@/hooks/useBilling';
import { toast } from 'sonner';
import { Save, CreditCard, KeyRound, RefreshCw, Sparkles } from 'lucide-react';

interface Org { id: string; name: string; slug: string }

type PromoModule = 'operations' | 'revenue_bi' | 'revenue_automation';

interface Settings {
  organization_slug: string;
  currency: string;
  revenue_price_cents: number;
  revenue_module_enabled: boolean;
  operations_price_cents: number;
  operations_module_enabled: boolean;
  operations_module_label: string;
  trial_enabled: boolean;
  trial_months: number;
  trial_start: string;
  stripe_publishable_key: string | null;
  payments_enabled: boolean;
  revenue_pricing_mode: 'per_room' | 'percent';
  revenue_percent_bps: number;
  revenue_percent_min_cents: number;
  revenue_percent_cap_cents: number;
  revenue_bi_price_cents: number;
  revenue_automation_price_cents: number;
  maintenance_module_enabled: boolean;
  maintenance_pricing_mode: 'custom' | 'per_room';
  maintenance_price_cents: number;
  vat_percent: number;
  billing_company_name: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_address_city: string | null;
  billing_address_postal_code: string | null;
  billing_address_country: string | null;
  billing_tax_id: string | null;
  standard_revenue_bi_price_cents: number;
  standard_revenue_automation_price_cents: number;
  standard_operations_price_cents: number;
  /** Legacy promotion columns are now scoped to Housekeeping / Operations only. */
  early_bird_enabled: boolean;
  early_bird_label: string;
  early_bird_note: string;
  early_bird_ends_at: string | null;
  revenue_bi_promo_enabled: boolean;
  revenue_bi_promo_label: string | null;
  revenue_bi_promo_note: string | null;
  revenue_bi_promo_ends_at: string | null;
  revenue_automation_promo_enabled: boolean;
  revenue_automation_promo_label: string | null;
  revenue_automation_promo_note: string | null;
  revenue_automation_promo_ends_at: string | null;
  grace_days: number;
}

const BLANK = (slug: string): Settings => ({
  organization_slug: slug,
  currency: 'EUR',
  revenue_price_cents: 1500,
  revenue_module_enabled: false,
  operations_price_cents: 600,
  operations_module_enabled: true,
  operations_module_label: 'Housekeeping',
  trial_enabled: true,
  trial_months: 1,
  trial_start: new Date().toISOString().slice(0, 10),
  stripe_publishable_key: '',
  payments_enabled: true,
  revenue_pricing_mode: 'per_room',
  revenue_percent_bps: 100,
  revenue_percent_min_cents: 0,
  revenue_percent_cap_cents: 0,
  revenue_bi_price_cents: 1500,
  revenue_automation_price_cents: 2200,
  maintenance_module_enabled: true,
  maintenance_pricing_mode: 'custom',
  maintenance_price_cents: 0,
  vat_percent: 27,
  billing_company_name: '',
  billing_address_line1: '',
  billing_address_line2: '',
  billing_address_city: '',
  billing_address_postal_code: '',
  billing_address_country: 'HU',
  billing_tax_id: '',
  standard_revenue_bi_price_cents: 1900,
  standard_revenue_automation_price_cents: 2900,
  standard_operations_price_cents: 800,
  early_bird_enabled: false,
  early_bird_label: 'Promotion',
  early_bird_note: 'Founding-partner pricing.',
  early_bird_ends_at: null,
  revenue_bi_promo_enabled: false,
  revenue_bi_promo_label: null,
  revenue_bi_promo_note: null,
  revenue_bi_promo_ends_at: null,
  revenue_automation_promo_enabled: false,
  revenue_automation_promo_label: null,
  revenue_automation_promo_note: null,
  revenue_automation_promo_ends_at: null,
  grace_days: 14,
});

const promoMeta = (module: PromoModule) => {
  if (module === 'operations') {
    return {
      title: 'Housekeeping',
      enabled: 'early_bird_enabled' as const,
      label: 'early_bird_label' as const,
      note: 'early_bird_note' as const,
      ends: 'early_bird_ends_at' as const,
      price: 'operations_price_cents' as const,
      standard: 'standard_operations_price_cents' as const,
    };
  }
  if (module === 'revenue_bi') {
    return {
      title: 'Business Intelligence',
      enabled: 'revenue_bi_promo_enabled' as const,
      label: 'revenue_bi_promo_label' as const,
      note: 'revenue_bi_promo_note' as const,
      ends: 'revenue_bi_promo_ends_at' as const,
      price: 'revenue_bi_price_cents' as const,
      standard: 'standard_revenue_bi_price_cents' as const,
    };
  }
  return {
    title: 'BI + Automation',
    enabled: 'revenue_automation_promo_enabled' as const,
    label: 'revenue_automation_promo_label' as const,
    note: 'revenue_automation_promo_note' as const,
    ends: 'revenue_automation_promo_ends_at' as const,
    price: 'revenue_automation_price_cents' as const,
    standard: 'standard_revenue_automation_price_cents' as const,
  };
};

export default function BillingSettingsPanel() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [slug, setSlug] = useState<string>('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState<RevenueUsage[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('organizations').select('id, name, slug').order('name');
      setOrgs((data ?? []) as Org[]);
      if (data?.length) setSlug(data[0].slug);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('billing_settings')
        .select('*')
        .eq('organization_slug', slug)
        .maybeSingle();
      setSettings(data ? ({ ...BLANK(slug), ...data, organization_slug: slug } as Settings) : BLANK(slug));
      setLoading(false);
    })();
  }, [slug]);

  const patch = (p: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...p } : s));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    // Keep this as a variable so additive promotion columns remain structurally
    // compatible while generated Supabase types catch up to the migration.
    const payload = { ...settings, organization_slug: slug };
    const { error } = await supabase
      .from('billing_settings')
      .upsert(payload, { onConflict: 'organization_slug' });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success('Billing settings saved');
  };

  // Last month's revenue share is settled automatically by the backend; here we
  // only read back what it computed so the admin can check the figures.
  useEffect(() => {
    if (!slug || settings?.revenue_pricing_mode !== 'percent') {
      setUsage([]);
      return;
    }
    let cancelled = false;
    setUsageLoading(true);
    (async () => {
      const { data } = await supabase.functions.invoke('billing-manage', {
        body: { action: 'summary', organizationSlug: slug },
      });
      if (cancelled) return;
      setUsage(((data as { revenue_usage?: RevenueUsage[] } | null)?.revenue_usage ?? []) as RevenueUsage[]);
      setUsageLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, settings?.revenue_pricing_mode]);

  const euros = (cents: number) => ((Number(cents) || 0) / 100).toString();
  const toCents = (v: string) => Math.round((parseFloat(v) || 0) * 100);

  const discountPct = (module: PromoModule) => {
    if (!settings) return 0;
    const meta = promoMeta(module);
    const standard = Number(settings[meta.standard]) || 0;
    const price = Number(settings[meta.price]) || 0;
    if (standard <= 0 || price >= standard) return 0;
    return Math.round((1 - price / standard) * 10000) / 100;
  };

  const setDiscountPct = (module: PromoModule, value: string) => {
    if (!settings) return;
    const meta = promoMeta(module);
    const standard = Number(settings[meta.standard]) || 0;
    if (standard <= 0) return;
    const pct = Math.min(100, Math.max(0, parseFloat(value) || 0));
    const cents = Math.round(standard * (1 - pct / 100));
    if (module === 'revenue_automation') {
      patch({ revenue_automation_price_cents: cents, revenue_price_cents: cents });
    } else if (module === 'revenue_bi') {
      patch({ revenue_bi_price_cents: cents });
    } else {
      patch({ operations_price_cents: cents });
    }
  };

  const setSixMonths = (module: PromoModule) => {
    const meta = promoMeta(module);
    const end = new Date();
    end.setMonth(end.getMonth() + 6);
    patch({ [meta.ends]: end.toISOString().slice(0, 10) } as Partial<Settings>);
  };

  const promoExpired = (module: PromoModule) => {
    if (!settings) return false;
    const meta = promoMeta(module);
    const end = settings[meta.ends] as string | null;
    return Boolean(end && new Date(`${end}T23:59:59`).getTime() < Date.now());
  };

  const renderPromo = (module: PromoModule) => {
    if (!settings) return null;
    const meta = promoMeta(module);
    const enabled = Boolean(settings[meta.enabled]);
    const standard = Number(settings[meta.standard]) || 0;
    const price = Number(settings[meta.price]) || 0;
    const expired = promoExpired(module);
    return (
      <div className="rounded-lg border p-4 space-y-4" key={module}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{meta.title}</p>
            <p className="text-xs text-muted-foreground">This promotion applies only to {meta.title}.</p>
          </div>
          <div className="flex items-center gap-2">
            {expired && enabled && <Badge variant="outline">Expired</Badge>}
            <Switch
              checked={enabled}
              onCheckedChange={(v) => patch({ [meta.enabled]: v } as Partial<Settings>)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Discount (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.5"
              disabled={standard <= 0}
              value={String(discountPct(module))}
              onChange={(e) => setDiscountPct(module, e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Calculated from the standard price. Changing this updates only this module's promotional price.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Promotion name</Label>
            <Input
              value={(settings[meta.label] as string | null) ?? ''}
              onChange={(e) => patch({ [meta.label]: e.target.value } as Partial<Settings>)}
              placeholder="e.g. First 6 months 50% OFF"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Promotion note</Label>
            <Input
              value={(settings[meta.note] as string | null) ?? ''}
              onChange={(e) => patch({ [meta.note]: e.target.value } as Partial<Settings>)}
              placeholder="Optional customer-facing explanation"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Promotion ends (optional)</Label>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSixMonths(module)}>
                Set +6 months
              </Button>
            </div>
            <Input
              type="date"
              value={(settings[meta.ends] as string | null) ?? ''}
              onChange={(e) => patch({ [meta.ends]: e.target.value || null } as Partial<Settings>)}
            />
          </div>
        </div>

        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {standard > 0 ? (
            <>
              During promotion: <span className="font-medium text-foreground">{euros(price)} {settings.currency}</span>
              {' · '}Standard: <span className="font-medium text-foreground">{euros(standard)} {settings.currency}</span>
              {enabled && settings[meta.ends] && (
                <> · After expiry the billed price automatically returns to the standard price.</>
              )}
            </>
          ) : (
            <>Set a standard price first to configure a percentage discount.</>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6" /> Payments &amp; pricing
        </h2>
        <p className="text-muted-foreground mt-1">
          Per-room monthly prices and module-specific promotions for each organization. All amounts are VAT-exclusive.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={slug} onValueChange={setSlug}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Choose organization" />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.slug}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {loading || !settings ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Module pricing</CardTitle>
              <CardDescription>
                Configure the price shown and charged while a promotion is active, plus the standard price used after expiry.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold">Operations module</Label>
                    <Switch
                      checked={settings.operations_module_enabled}
                      onCheckedChange={(v) => patch({ operations_module_enabled: v })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Label shown to customers</Label>
                    <Input
                      value={settings.operations_module_label}
                      onChange={(e) => patch({ operations_module_label: e.target.value })}
                      placeholder="Housekeeping"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Current / promo price</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={euros(settings.operations_price_cents)}
                        onChange={(e) => patch({ operations_price_cents: toCents(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Standard price</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={euros(settings.standard_operations_price_cents)}
                        onChange={(e) => patch({ standard_operations_price_cents: toCents(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold">Revenue Management</Label>
                    <Switch
                      checked={settings.revenue_module_enabled}
                      onCheckedChange={(v) => patch({ revenue_module_enabled: v })}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Turn this on once the organization is allowed to buy the revenue module.
                  </p>
                  <div className="space-y-2">
                    <Label>How it is charged</Label>
                    <Select
                      value={settings.revenue_pricing_mode}
                      onValueChange={(v) => patch({ revenue_pricing_mode: v as Settings['revenue_pricing_mode'] })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_room">Fixed price per room / month</SelectItem>
                        <SelectItem value="percent">Share of realised room revenue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {settings.revenue_pricing_mode === 'per_room' ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Business Intelligence — current / promo</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={euros(settings.revenue_bi_price_cents)}
                            onChange={(e) => patch({ revenue_bi_price_cents: toCents(e.target.value) })}
                          />
                          <p className="text-xs text-muted-foreground">Analytics only, no automatic price changes.</p>
                        </div>
                        <div className="space-y-2">
                          <Label>BI + Automation — current / promo</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={euros(settings.revenue_automation_price_cents)}
                            onChange={(e) => {
                              const cents = toCents(e.target.value);
                              patch({ revenue_automation_price_cents: cents, revenue_price_cents: cents });
                            }}
                          />
                          <p className="text-xs text-muted-foreground">Includes the automated pricing engine.</p>
                        </div>
                        <div className="space-y-2">
                          <Label>Standard BI price</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={euros(settings.standard_revenue_bi_price_cents)}
                            onChange={(e) => patch({ standard_revenue_bi_price_cents: toCents(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Standard BI + Automation price</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={euros(settings.standard_revenue_automation_price_cents)}
                            onChange={(e) => patch({ standard_revenue_automation_price_cents: toCents(e.target.value) })}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>Percentage of realised room revenue</Label>
                        <Input
                          type="number"
                          step="0.05"
                          min={0}
                          value={(settings.revenue_percent_bps / 100).toString()}
                          onChange={(e) =>
                            patch({ revenue_percent_bps: Math.round((parseFloat(e.target.value) || 0) * 100) })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Charged each month from the previous calendar month's realised room revenue, taken
                          automatically from the synced property data. 1 = 1%.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Minimum / month</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={euros(settings.revenue_percent_min_cents)}
                            onChange={(e) => patch({ revenue_percent_min_cents: toCents(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Cap / month (0 = none)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={euros(settings.revenue_percent_cap_cents)}
                            onChange={(e) => patch({ revenue_percent_cap_cents: toCents(e.target.value) })}
                          />
                        </div>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                        <p className="text-xs font-medium flex items-center gap-1.5">
                          <RefreshCw className={`h-3.5 w-3.5 ${usageLoading ? 'animate-spin' : ''}`} />
                          Last full month — settled automatically
                        </p>
                        {usageLoading && <p className="text-xs text-muted-foreground">Calculating…</p>}
                        {!usageLoading && usage.length === 0 && (
                          <p className="text-xs text-muted-foreground">No property revenue recorded yet.</p>
                        )}
                        {usage.map((u) => (
                          <p key={u.hotel_id} className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{u.hotel_name ?? u.hotel_id}</span>{' '}
                            {u.period_start.slice(0, 7)}: {(u.revenue_cents / 100).toFixed(0)} {settings.currency} realised →{' '}
                            {u.trial_waived
                              ? `free during the trial (would have been ${((u.waived_fee_cents ?? 0) / 100).toFixed(2)} ${settings.currency})`
                              : `${(u.fee_cents / 100).toFixed(2)} ${settings.currency}${u.invoiced ? ' — on the next invoice' : ' — saved, no paid subscription yet'}`}
                          </p>
                        ))}
                        <p className="text-[11px] text-muted-foreground">
                          Recalculated every time this page or the Payments page opens, and once a month automatically. Trial
                          months are never charged.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <Input
                  value={settings.currency}
                  onChange={(e) => patch({ currency: e.target.value.toUpperCase() })}
                  maxLength={3}
                  className="max-w-[120px]"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5" /> Module promotions
              </CardTitle>
              <CardDescription>
                Each module has its own promotion name, discount and end date. A Housekeeping offer never changes BI or Automation pricing.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              {renderPromo('operations')}
              {renderPromo('revenue_bi')}
              {renderPromo('revenue_automation')}
            </CardContent>
            {settings.revenue_pricing_mode === 'percent' && (
              <div className="px-6 pb-5 text-xs text-muted-foreground">
                Revenue promotions are saved, but percentage-based Revenue billing does not use per-room discounts.
              </div>
            )}
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Maintenance module</CardTitle>
              <CardDescription>Sold on request unless a per-room price is agreed.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 items-end">
              <div className="flex items-center gap-3">
                <Switch
                  checked={settings.maintenance_module_enabled}
                  onCheckedChange={(v) => patch({ maintenance_module_enabled: v })}
                />
                <Label>Offer maintenance</Label>
              </div>
              <div className="space-y-2">
                <Label>Pricing</Label>
                <Select
                  value={settings.maintenance_pricing_mode}
                  onValueChange={(v) => patch({ maintenance_pricing_mode: v as Settings['maintenance_pricing_mode'] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Custom / on request</SelectItem>
                    <SelectItem value="per_room">Fixed price per room / month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Agreed price per room / month</Label>
                <Input
                  type="number"
                  step="0.01"
                  disabled={settings.maintenance_pricing_mode !== 'per_room'}
                  value={euros(settings.maintenance_price_cents)}
                  onChange={(e) => patch({ maintenance_price_cents: toCents(e.target.value) })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">VAT &amp; invoice details</CardTitle>
              <CardDescription>
                VAT is added on top of every quoted price at checkout and printed on the Stripe invoice. Company name,
                address and tax number are also collected at checkout; anything entered here is used as the default.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>VAT rate (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={String(settings.vat_percent ?? 27)}
                  onChange={(e) => patch({ vat_percent: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Company name</Label>
                <Input
                  value={settings.billing_company_name ?? ''}
                  onChange={(e) => patch({ billing_company_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Tax number</Label>
                <Input
                  value={settings.billing_tax_id ?? ''}
                  onChange={(e) => patch({ billing_tax_id: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Address line 1</Label>
                <Input
                  value={settings.billing_address_line1 ?? ''}
                  onChange={(e) => patch({ billing_address_line1: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={settings.billing_address_city ?? ''}
                  onChange={(e) => patch({ billing_address_city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Postal code / country</Label>
                <div className="flex gap-2">
                  <Input
                    value={settings.billing_address_postal_code ?? ''}
                    onChange={(e) => patch({ billing_address_postal_code: e.target.value })}
                  />
                  <Input
                    className="max-w-[90px]"
                    maxLength={2}
                    value={settings.billing_address_country ?? ''}
                    onChange={(e) => patch({ billing_address_country: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Free trial</CardTitle>
              <CardDescription>Modules stay unlocked until the trial ends, followed by the configured grace period.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4 items-end">
              <div className="flex items-center gap-3">
                <Switch checked={settings.trial_enabled} onCheckedChange={(v) => patch({ trial_enabled: v })} />
                <Label>Trial active</Label>
              </div>
              <div className="space-y-2">
                <Label>Length (months)</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings.trial_months}
                  onChange={(e) => patch({ trial_months: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={settings.trial_start?.slice(0, 10) ?? ''}
                  onChange={(e) => patch({ trial_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Grace period after trial (days)</Label>
                <Input
                  type="number"
                  min={0}
                  value={String(settings.grace_days ?? 14)}
                  onChange={(e) => patch({ grace_days: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <KeyRound className="h-5 w-5" /> Stripe keys
              </CardTitle>
              <CardDescription>
                The secret key and webhook secret are stored securely on the server, never in the database. The
                publishable key below is safe to save here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Publishable key</Label>
                <Input
                  value={settings.stripe_publishable_key ?? ''}
                  onChange={(e) => patch({ stripe_publishable_key: e.target.value })}
                  placeholder="pk_live_..."
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={settings.payments_enabled} onCheckedChange={(v) => patch({ payments_enabled: v })} />
                <Label>Show the Payments page to this organization</Label>
              </div>
              <Badge variant="secondary">
                Secret key: set in project secrets as STRIPE_SECRET_KEY
              </Badge>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
