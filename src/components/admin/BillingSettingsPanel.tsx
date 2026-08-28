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
import { Save, CreditCard, KeyRound, RefreshCw } from 'lucide-react';

interface Org { id: string; name: string; slug: string }

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
});

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
      setSettings((data as Settings) ?? BLANK(slug));
      setLoading(false);
    })();
  }, [slug]);

  const patch = (p: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...p } : s));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from('billing_settings')
      .upsert({ ...settings, organization_slug: slug }, { onConflict: 'organization_slug' });
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

  const euros = (cents: number) => (cents / 100).toString();
  const toCents = (v: string) => Math.round((parseFloat(v) || 0) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6" /> Payments &amp; pricing
        </h2>
        <p className="text-muted-foreground mt-1">
          Per-room monthly prices for each organization. All amounts are VAT-exclusive.
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
              <CardDescription>Price charged per room, per month, excluding VAT.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
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
                <div className="space-y-2">
                  <Label>Price per room / month</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={euros(settings.operations_price_cents)}
                    onChange={(e) => patch({ operations_price_cents: toCents(e.target.value) })}
                  />
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Business Intelligence — per room / month</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={euros(settings.revenue_bi_price_cents)}
                        onChange={(e) => patch({ revenue_bi_price_cents: toCents(e.target.value) })}
                      />
                      <p className="text-xs text-muted-foreground">Analytics only, no automatic price changes.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>BI + Automation — per room / month</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={euros(settings.revenue_automation_price_cents)}
                        onChange={(e) =>
                          patch({
                            revenue_automation_price_cents: toCents(e.target.value),
                            revenue_price_cents: toCents(e.target.value),
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">Includes the automated pricing engine.</p>
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
                            ? `free during the trial (would have been ${(
                                (u.waived_fee_cents ?? 0) / 100
                              ).toFixed(2)} ${settings.currency})`
                            : `${(u.fee_cents / 100).toFixed(2)} ${settings.currency}${
                                u.invoiced ? ' — on the next invoice' : ' — saved, no paid subscription yet'
                              }`}
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
              <CardDescription>Modules stay unlocked until the trial ends.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 items-end">
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
