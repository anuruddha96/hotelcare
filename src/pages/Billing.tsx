import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import {
  useBilling,
  formatMoney,
  isSubscriptionActive,
  trialIsRunning,
  normaliseModule,
  vatCents,
  type BillingInvoice,
  type BillingModule,
} from '@/hooks/useBilling';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isExecutiveRole } from '@/lib/roleAccess';
import {
  ArrowLeft,
  CreditCard,
  ShieldCheck,
  Sparkles,
  BedDouble,
  Loader2,
  Check,
  BarChart3,
  Bot,
  Wrench,
  Sparkle,
  FileText,
  ExternalLink,
} from 'lucide-react';

/** Modules offered per property, in the order they appear on the card. */
const MODULE_ORDER: BillingModule[] = ['operations', 'revenue_bi', 'revenue_automation', 'maintenance'];

const MODULE_ICON: Record<BillingModule, typeof BarChart3> = {
  operations: Sparkle,
  revenue_bi: BarChart3,
  revenue_automation: Bot,
  maintenance: Wrench,
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;
const fmtStamp = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function Billing() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canSee = profile?.role === 'admin' || profile?.is_super_admin || isExecutiveRole(profile?.role);
  const canSwitchOrg = profile?.role === 'admin' || Boolean(profile?.is_super_admin);

  const [orgs, setOrgs] = useState<{ slug: string; name: string }[]>([]);
  const [orgSlug, setOrgSlug] = useState<string | undefined>(profile?.organization_slug ?? undefined);

  useEffect(() => {
    if (!orgSlug && profile?.organization_slug) setOrgSlug(profile.organization_slug);
  }, [profile?.organization_slug, orgSlug]);

  useEffect(() => {
    if (!canSwitchOrg) return;
    supabase
      .from('organizations')
      .select('slug, name')
      .order('name')
      .then(({ data }) => setOrgs((data ?? []) as { slug: string; name: string }[]));
  }, [canSwitchOrg]);

  const { summary, loading, error, reload } = useBilling(orgSlug);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[] | null>(null);

  const settings = summary?.settings;
  const currency = settings?.currency ?? 'EUR';
  const vatPercent = Number(settings?.vat_percent ?? 27);
  const percentMode = settings?.revenue_pricing_mode !== 'per_room' && Boolean(settings?.revenue_pricing_mode);
  const percentLabel = `${((settings?.revenue_percent_bps ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}%`;

  const priceFor = (module: BillingModule) => {
    switch (module) {
      case 'revenue_bi':
        return settings?.revenue_bi_price_cents ?? 0;
      case 'revenue_automation':
        return settings?.revenue_automation_price_cents || settings?.revenue_price_cents || 0;
      case 'maintenance':
        return settings?.maintenance_pricing_mode === 'per_room' ? settings?.maintenance_price_cents ?? 0 : 0;
      default:
        return settings?.operations_price_cents ?? 0;
    }
  };
  const labelFor = (module: BillingModule) => {
    switch (module) {
      case 'revenue_bi':
        return 'Revenue BI';
      case 'revenue_automation':
        return 'BI + Automation';
      case 'maintenance':
        return 'Maintenance';
      default:
        return settings?.operations_module_label ?? 'Housekeeping';
    }
  };
  const hintFor = (module: BillingModule) => {
    switch (module) {
      case 'revenue_bi':
        return 'Analytics, pickup, competitors — no automatic price changes';
      case 'revenue_automation':
        return 'Everything in BI plus the automated pricing engine';
      case 'maintenance':
        return 'Priced individually — ask us for a quote';
      default:
        return 'Housekeeping boards, attendance, tasks';
    }
  };
  const enabledFor = (module: BillingModule) => {
    if (module === 'maintenance') return settings?.maintenance_module_enabled !== false;
    if (module === 'operations') return settings?.operations_module_enabled;
    return settings?.revenue_module_enabled;
  };
  const isQuoteOnly = (module: BillingModule) =>
    module === 'maintenance' && settings?.maintenance_pricing_mode !== 'per_room';

  const subFor = (hotelId: string, module: BillingModule) =>
    summary?.subscriptions.find(
      (s) => s.hotel_id === hotelId && normaliseModule(s.module) === module,
    );

  const usageFor = (hotelId: string) => summary?.revenue_usage?.find((u) => u.hotel_id === hotelId);

  /** Revenue tiers are one choice with two levels — picking one clears the other. */
  const toggle = (hotelId: string, module: BillingModule) => {
    const key = `${hotelId}|${module}`;
    setSelected((s) => {
      const next = { ...s, [key]: !s[key] };
      if (next[key] && module === 'revenue_bi') next[`${hotelId}|revenue_automation`] = false;
      if (next[key] && module === 'revenue_automation') next[`${hotelId}|revenue_bi`] = false;
      return next;
    });
  };

  const lines = useMemo(() => {
    if (!summary) return [];
    return Object.entries(selected)
      .filter(([, v]) => v)
      .map(([key]) => {
        const [hotel_id, module] = key.split('|') as [string, BillingModule];
        const hotel = summary.hotels.find((h) => h.hotel_id === hotel_id);
        const isPercent = module.startsWith('revenue') && percentMode;
        const unit = priceFor(module);
        const estimate = usageFor(hotel_id)?.fee_cents ?? 0;
        return {
          key,
          hotel_id,
          module,
          hotelName: hotel?.hotel_name ?? hotel_id,
          rooms: hotel?.rooms ?? 0,
          unit,
          isPercent,
          total: isPercent ? estimate : (hotel?.rooms ?? 0) * unit,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, summary]);

  const netTotal = lines.reduce((sum, l) => sum + l.total, 0);
  const vatTotal = vatCents(summary, netTotal);
  const grossTotal = netTotal + vatTotal;

  const startCheckout = async () => {
    if (!lines.length) return;
    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('billing-manage', {
      body: {
        action: 'checkout',
        organizationSlug: orgSlug,
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
    // Same-tab redirect: mobile browsers block window.open after an await.
    if (payload?.url) window.location.assign(payload.url);
    else toast.error('Checkout could not be started — please try again.');
  };

  const openPortal = async () => {
    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('billing-manage', {
      body: { action: 'portal', organizationSlug: orgSlug, returnUrl: window.location.href.split('?')[0] },
    });
    setBusy(false);
    const payload = data as { url?: string; error?: string; needs_checkout?: boolean; message?: string } | null;
    if (payload?.needs_checkout) {
      toast.info(payload.message ?? 'No paid subscription yet — pick your modules to get started.');
      return;
    }
    if (err || payload?.error) {
      toast.error(payload?.error ?? err?.message ?? 'Billing portal unavailable');
      return;
    }
    if (payload?.url) window.location.assign(payload.url);
    else toast.error('Billing portal could not be opened — please try again.');
  };

  const loadInvoices = async () => {
    const { data } = await supabase.functions.invoke('billing-manage', {
      body: { action: 'invoices', organizationSlug: orgSlug },
    });
    setInvoices(((data as { invoices?: BillingInvoice[] } | null)?.invoices ?? []) as BillingInvoice[]);
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
  const activeSubs = (summary?.subscriptions ?? []).filter(isSubscriptionActive);
  const nextRenewal = activeSubs
    .map((s) => s.current_period_end)
    .filter(Boolean)
    .sort()[0] as string | undefined;
  const activeMonthly = activeSubs.reduce((sum, s) => sum + s.quantity * s.unit_amount_cents, 0);

  return (
    <div className="min-h-screen bg-background pb-32">
      <Header />
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="h-6 w-6" /> Payments
            </h1>
            <p className="text-sm text-muted-foreground">
              Tap the modules you want per property. Prices are per room, per month; {vatPercent}% VAT is added at
              checkout.
            </p>
          </div>
        </div>

        {canSwitchOrg && orgs.length > 1 && (
          <Select value={orgSlug} onValueChange={setOrgSlug}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Choose organization" />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.slug} value={o.slug}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Status strip — trial, current spend, renewal, payment method. */}
        <Card className={trialActive ? 'border-primary/40' : undefined}>
          <CardContent className="pt-5 pb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 min-w-[220px]">
              {trialActive ? <Sparkles className="h-5 w-5 text-primary" /> : <ShieldCheck className="h-5 w-5 text-primary" />}
              <div>
                <p className="text-sm font-semibold">
                  {trialActive
                    ? `Free trial — ends ${fmtDate(summary?.trial_ends_at)}`
                    : activeSubs.length
                      ? 'Subscription active'
                      : 'No subscription yet'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {trialActive
                    ? 'Everything is unlocked and nothing is charged before that date.'
                    : activeSubs.length
                      ? `${activeSubs.length} module${activeSubs.length > 1 ? 's' : ''} · ${formatMoney(activeMonthly, currency)} / month excl. VAT`
                      : 'Pick your modules below to get started.'}
                </p>
              </div>
            </div>
            {nextRenewal && (
              <div>
                <p className="text-xs text-muted-foreground">Next charge</p>
                <p className="text-sm font-semibold">{fmtDate(nextRenewal)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Properties</p>
              <p className="text-sm font-semibold">
                {summary?.hotels.length ?? 0} · {summary?.hotels.reduce((n, h) => n + h.rooms, 0) ?? 0} rooms
              </p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto" onClick={openPortal} disabled={busy}>
              Manage payment method
            </Button>
          </CardContent>
        </Card>

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
              You can review the pricing below. Checkout becomes available once the Stripe keys are saved in Admin,
              Payments.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="modules">
          <TabsList>
            <TabsTrigger value="modules">Modules</TabsTrigger>
            <TabsTrigger value="invoices" onClick={() => { if (!invoices) loadInvoices(); }}>
              Invoices
            </TabsTrigger>
          </TabsList>

          <TabsContent value="modules" className="mt-4">
            {loading ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-44 w-full" />
                <Skeleton className="h-44 w-full" />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {summary?.hotels.map((hotel) => {
                  const hotelLines = lines.filter((l) => l.hotel_id === hotel.hotel_id);
                  const hotelNet = hotelLines.reduce((sum, l) => sum + l.total, 0);
                  return (
                    <Card key={hotel.hotel_id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="text-base">{hotel.hotel_name}</CardTitle>
                          <Badge variant="secondary" className="gap-1">
                            <BedDouble className="h-3.5 w-3.5" /> {hotel.rooms} rooms
                          </Badge>
                        </div>
                        <CardDescription className="text-xs">
                          Tap a module to add it. Revenue comes in two levels — pick one.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          {MODULE_ORDER.map((module) => {
                            const Icon = MODULE_ICON[module];
                            const available = Boolean(enabledFor(module));
                            const sub = subFor(hotel.hotel_id, module);
                            const active = isSubscriptionActive(sub);
                            const quoteOnly = isQuoteOnly(module);
                            const key = `${hotel.hotel_id}|${module}`;
                            const on = Boolean(selected[key]) || active;
                            const unit = priceFor(module);
                            const isPercent = module.startsWith('revenue') && percentMode;
                            const priceText = quoteOnly
                              ? 'Custom price'
                              : isPercent
                                ? `${percentLabel} of revenue`
                                : unit > 0
                                  ? `${formatMoney(unit, currency)} / room`
                                  : 'Not priced yet';
                            return (
                              <button
                                key={module}
                                type="button"
                                disabled={!available || (!quoteOnly && !isPercent && unit <= 0)}
                                onClick={() => (quoteOnly ? setQuoteFor(hotel.hotel_name) : toggle(hotel.hotel_id, module))}
                                className={`rounded-lg border p-2.5 text-left transition-colors disabled:opacity-50 ${
                                  on
                                    ? 'border-primary bg-primary/10'
                                    : 'hover:border-primary/50 hover:bg-muted/50'
                                }`}
                              >
                                <span className="flex items-center gap-1.5 text-sm font-medium">
                                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                                  {labelFor(module)}
                                  {active && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                                </span>
                                <span className="block text-xs text-muted-foreground mt-0.5">{priceText}</span>
                                <span className="block text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">
                                  {active ? 'Active' : hintFor(module)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {hotelLines.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {hotelLines
                              .map((l) =>
                                l.isPercent
                                  ? `${labelFor(l.module)} ${percentLabel} of revenue`
                                  : `${labelFor(l.module)} ${l.rooms} × ${formatMoney(l.unit, currency)}`,
                              )
                              .join(' · ')}{' '}
                            = <span className="font-semibold text-foreground">{formatMoney(hotelNet, currency)}</span> / month
                            excl. VAT
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="invoices" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Invoices
                </CardTitle>
                <CardDescription>
                  Every invoice shows your company name, address and tax number, plus the {vatPercent}% VAT.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {invoices === null ? (
                  <Skeleton className="h-20 w-full" />
                ) : invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No invoices yet.</p>
                ) : (
                  invoices.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium">
                          {inv.number ?? inv.id} · {fmtStamp(inv.created)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(inv.subtotal_cents, inv.currency)} + {formatMoney(inv.tax_cents, inv.currency)} VAT
                          {' = '}
                          <span className="font-medium text-foreground">
                            {formatMoney(inv.total_cents, inv.currency)}
                          </span>
                          {inv.status ? ` · ${inv.status}` : ''}
                        </p>
                      </div>
                      {inv.invoice_pdf && (
                        <Button asChild size="sm" variant="outline">
                          <a href={inv.invoice_pdf} target="_blank" rel="noreferrer">
                            PDF <ExternalLink className="h-3.5 w-3.5 ml-1" />
                          </a>
                        </Button>
                      )}
                    </div>
                  ))
                )}
                <Button variant="outline" size="sm" onClick={openPortal} disabled={busy}>
                  Manage payment method &amp; company details
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Sticky checkout bar — net, VAT and gross always visible. */}
      {lines.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="max-w-6xl mx-auto p-3 sm:p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="text-sm">
              <p className="text-muted-foreground text-xs">
                {lines.length} module{lines.length > 1 ? 's' : ''} selected
              </p>
              <p>
                <span className="text-muted-foreground">Net </span>
                <span className="font-medium">{formatMoney(netTotal, currency)}</span>
                <span className="text-muted-foreground"> + VAT {vatPercent}% </span>
                <span className="font-medium">{formatMoney(vatTotal, currency)}</span>
              </p>
            </div>
            <Separator orientation="vertical" className="h-8 hidden sm:block" />
            <div>
              <p className="text-xs text-muted-foreground">Total per month</p>
              <p className="text-lg font-bold">{formatMoney(grossTotal, currency)}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {trialActive && (
                <span className="hidden sm:block text-xs text-muted-foreground max-w-[220px]">
                  First charge on {fmtDate(summary?.trial_ends_at)} — the rest of your trial stays free.
                </span>
              )}
              <Button onClick={startCheckout} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Continue to checkout
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={Boolean(quoteFor)} onOpenChange={(o) => !o && setQuoteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Maintenance — custom pricing</DialogTitle>
            <DialogDescription>
              Maintenance is priced individually for {quoteFor}, based on your property size and how you work. Send us a
              quick request and we'll come back with a quote.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteFor(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                window.location.href = `mailto:support@hotelcare.app?subject=${encodeURIComponent(
                  `Maintenance module quote — ${quoteFor ?? ''}`,
                )}`;
                setQuoteFor(null);
              }}
            >
              Request a quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
