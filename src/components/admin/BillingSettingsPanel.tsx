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
import { toast } from 'sonner';
import { Save, CreditCard, KeyRound } from 'lucide-react';

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
});

export default function BillingSettingsPanel() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [slug, setSlug] = useState<string>('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
                  <Label>Price per room / month</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={euros(settings.revenue_price_cents)}
                    onChange={(e) => patch({ revenue_price_cents: toCents(e.target.value) })}
                  />
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
