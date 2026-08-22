import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import {
  useBilling,
  formatMoney,
  isSubscriptionActive,
  trialIsRunning,
  type BillingModule,
} from '@/hooks/useBilling';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isExecutiveRole } from '@/lib/roleAccess';
import { ArrowLeft, CreditCard, ShieldCheck, Sparkles, BedDouble, Loader2 } from 'lucide-react';

const MODULES: BillingModule[] = ['operations', 'revenue'];

export default function Billing() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canSee = profile?.role === 'admin' || profile?.is_super_admin || isExecutiveRole(profile?.role);

  const { summary, loading, error, reload } = useBilling(profile?.organization_slug);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const settings = summary?.settings;
  const currency = settings?.currency ?? 'EUR';

  const priceFor = (module: BillingModule) =>
    module === 'revenue' ? settings?.revenue_price_cents ?? 0 : settings?.operations_price_cents ?? 0;
  const labelFor = (module: BillingModule) =>
    module === 'revenue' ? 'Revenue Management' : settings?.operations_module_label ?? 'Operations';
  const enabledFor = (module: BillingModule) =>
    module === 'revenue' ? settings?.revenue_module_enabled : settings?.operations_module_enabled;

  const subFor = (hotelId: string, module: BillingModule) =>
    summary?.subscriptions.find((s) => s.hotel_id === hotelId && s.module === module);

  const lines = useMemo(() => {
    if (!summary) return [];
    return Object.entries(selected)
      .filter(([, v]) => v)
      .map(([key]) => {
        const [hotel_id, module] = key.split('|') as [string, BillingModule];
        const hotel = summary.hotels.find((h) => h.hotel_id === hotel_id);
        const unit = priceFor(module);
        return {
          key,
          hotel_id,
          module,
          hotelName: hotel?.hotel_name ?? hotel_id,
          rooms: hotel?.rooms ?? 0,
          unit,
          total: (hotel?.rooms ?? 0) * unit,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, summary]);

  const monthlyTotal = lines.reduce((sum, l) => sum + l.total, 0);

  const startCheckout = async () => {
    if (!lines.length) return;
    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('billing-manage', {
      body: {
        action: 'checkout',
        organizationSlug: profile?.organization_slug,
        returnUrl: window.location.href.split('?')[0],
        selections: lines.map((l) => ({ hotel_id: l.hotel_id, module: l.module })),
      },
    });
    setBusy(false);
    const payload = data as { url?: string; error?: string } | null;
    if (err || payload?.error) {
      toast.error(payload?.error ?? err?.message ?? 'Could not start checkout');
      return;
    }
    if (payload?.url) window.open(payload.url, '_blank');
  };

  const openPortal = async () => {
    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('billing-manage', {
      body: {
        action: 'portal',
        organizationSlug: profile?.organization_slug,
        returnUrl: window.location.href.split('?')[0],
      },
    });
    setBusy(false);
    const payload = data as { url?: string; error?: string } | null;
    if (err || payload?.error) {
      toast.error(payload?.error ?? err?.message ?? 'Billing portal unavailable');
      return;
    }
    if (payload?.url) window.open(payload.url, '_blank');
  };

  if (!canSee) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="p-6 max-w-xl mx-auto">
          <Alert>
            <AlertTitle>Not available</AlertTitle>
            <AlertDescription>Billing is managed by your organization's leadership team.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const trialActive = trialIsRunning(summary);
  const trialEnds = summary?.trial_ends_at ? new Date(summary.trial_ends_at) : null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="h-6 w-6" /> Payments
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose the modules you want per property. Billed monthly, per room, VAT excluded.
            </p>
          </div>
        </div>

        {trialActive && trialEnds && (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>You're on a free trial</AlertTitle>
            <AlertDescription>
              Everything stays unlocked until{' '}
              <strong>{trialEnds.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</strong>. Set
              up your subscription any time before then and nothing will be interrupted.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't load billing</AlertTitle>
            <AlertDescription className="flex items-center gap-3">
              {error}
              <Button size="sm" variant="outline" onClick={reload}>Retry</Button>
            </AlertDescription>
          </Alert>
        )}

        {settings && settings.stripe_secret_configured === false && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Card payments not connected yet</AlertTitle>
            <AlertDescription>
              You can already review the pricing below. Checkout becomes available once the Stripe keys are saved in
              Admin, Payments.
            </AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {summary?.hotels.map((hotel) => (
              <Card key={hotel.hotel_id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <CardTitle className="text-lg">{hotel.hotel_name}</CardTitle>
                    <Badge variant="secondary" className="gap-1">
                      <BedDouble className="h-3.5 w-3.5" /> {hotel.rooms} rooms
                    </Badge>
                  </div>
                  <CardDescription>Prices are per room, per month, excluding VAT.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {MODULES.map((module) => {
                    const unit = priceFor(module);
                    const sub = subFor(hotel.hotel_id, module);
                    const active = isSubscriptionActive(sub);
                    const available = Boolean(enabledFor(module)) && unit > 0;
                    const key = `${hotel.hotel_id}|${module}`;
                    return (
                      <div
                        key={module}
                        className="flex items-start justify-between gap-4 rounded-lg border p-3"
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id={key}
                            className="mt-1"
                            disabled={!available || active}
                            checked={Boolean(selected[key])}
                            onCheckedChange={(v) => setSelected((s) => ({ ...s, [key]: Boolean(v) }))}
                          />
                          <div>
                            <label htmlFor={key} className="font-medium cursor-pointer">
                              {labelFor(module)}
                            </label>
                            <p className="text-sm text-muted-foreground">
                              {available
                                ? `${formatMoney(unit, currency)} × ${hotel.rooms} rooms = ${formatMoney(unit * hotel.rooms, currency)} / month`
                                : 'Not available for your organization yet'}
                            </p>
                          </div>
                        </div>
                        {active ? (
                          <Badge className="shrink-0">Active</Badge>
                        ) : available ? (
                          <span className="text-sm font-semibold shrink-0">
                            {formatMoney(unit * hotel.rooms, currency)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}

            <Card className="sticky bottom-2">
              <CardContent className="pt-6 space-y-3">
                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Select the modules you need above to see your monthly total.
                  </p>
                ) : (
                  <>
                    {lines.map((l) => (
                      <div key={l.key} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {labelFor(l.module)} — {l.hotelName} ({l.rooms} rooms)
                        </span>
                        <span>{formatMoney(l.total, currency)}</span>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between font-semibold">
                      <span>Monthly total (excl. VAT)</span>
                      <span>{formatMoney(monthlyTotal, currency)}</span>
                    </div>
                  </>
                )}
                <div className="flex gap-2 justify-end pt-1">
                  <Button variant="outline" onClick={openPortal} disabled={busy}>
                    Manage subscription
                  </Button>
                  <Button onClick={startCheckout} disabled={busy || lines.length === 0}>
                    {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Continue to checkout
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
