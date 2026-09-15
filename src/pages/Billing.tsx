import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import {
  formatMoney,
  graceEndsAt,
  inGracePeriod,
  isSubscriptionActive,
  normaliseModule,
  promotionForModule,
  resolvedPricingFor,
  trialIsRunning,
  useBilling,
  vatCents,
  type BillingInvoice,
  type BillingModule,
} from '@/hooks/useBilling';
import { supabase } from '@/integrations/supabase/client';
import { isExecutiveRole } from '@/lib/roleAccess';
import {
  ArrowLeft,
  BarChart3,
  BedDouble,
  Bot,
  Check,
  CreditCard,
  ExternalLink,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkle,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';

const MODULE_ORDER: BillingModule[] = ['operations', 'revenue_bi', 'revenue_automation', 'maintenance'];
const MODULE_ICON: Record<BillingModule, typeof BarChart3> = {
  operations: Sparkle,
  revenue_bi: BarChart3,
  revenue_automation: Bot,
  maintenance: Wrench,
};

const fmtDate = (iso?: string | null) => {
  if (!iso) return null;
  const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return value.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};
const fmtStamp = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function Billing() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canSee = profile?.role === 'admin' || profile?.is_super_admin || isExecutiveRole(profile?.role);
  const canSwitchOrg = profile?.role === 'admin' || Boolean(profile?.is_super_admin);
  const [orgs, setOrgs] = useState<{ slug: string; name: string }[]>([]);
  const [orgSlug, setOrgSlug] = useState<string | undefined>(profile?.organization_slug ?? undefined);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[] | null>(null);

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
  const settings = summary?.settings;
  const currency = settings?.currency ?? 'EUR';
  const vatPercent = Number(settings?.vat_percent ?? 27);
  const percentLabel = `${((settings?.revenue_percent_bps ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}%`;

  const preHotel = searchParams.get('hotel');
  const preModule = searchParams.get('module');
  useEffect(() => {
    if (!preHotel || !preModule) return;
    setSelected((current) => ({ ...current, [`${preHotel}|${preModule}`]: true }));
  }, [preHotel, preModule]);

  const labelFor = (module: BillingModule) => {
    if (module === 'revenue_bi') return 'Revenue BI';
    if (module === 'revenue_automation') return 'BI + Automation';
    if (module === 'maintenance') return 'Maintenance';
    return settings?.operations_module_label ?? 'Housekeeping';
  };
  const hintFor = (module: BillingModule) => {
    if (module === 'revenue_bi') return 'Analytics, pickup and revenue intelligence';
    if (module === 'revenue_automation') return 'Revenue BI plus automated pricing';
    if (module === 'maintenance') return 'Maintenance tickets, SLA and engineering workflows';
    return 'Housekeeping boards, attendance and operational workflows';
  };
  const enabledFor = (module: BillingModule) => {
    if (module === 'maintenance') return settings?.maintenance_module_enabled !== false;
    if (module === 'operations') return Boolean(settings?.operations_module_enabled);
    return Boolean(settings?.revenue_module_enabled);
  };
  const subFor = (hotelId: string, module: BillingModule) =>
    summary?.subscriptions.find((sub) => sub.hotel_id === hotelId && normaliseModule(sub.module) === module);
  const usageFor = (hotelId: string) => summary?.revenue_usage?.find((usage) => usage.hotel_id === hotelId);

  const toggle = (hotelId: string, module: BillingModule) => {
    const key = `${hotelId}|${module}`;
    const pricing = summary ? resolvedPricingFor(summary, hotelId, module) : null;
    const isOrganizationFixed = pricing?.source === 'organization' && pricing.pricing_mode === 'fixed_monthly';

    setSelected((current) => {
      const next = { ...current };
      const turningOn = !current[key];
      const targetHotels = isOrganizationFixed && summary
        ? summary.hotels.filter((hotel) => {
            const candidate = resolvedPricingFor(summary, hotel.hotel_id, module);
            return candidate.source === 'organization'
              && candidate.pricing_mode === 'fixed_monthly'
              && candidate.price_cents === pricing?.price_cents;
          })
        : summary?.hotels.filter((hotel) => hotel.hotel_id === hotelId) ?? [];

      for (const hotel of targetHotels) {
        next[`${hotel.hotel_id}|${module}`] = turningOn;
        if (turningOn && module === 'revenue_bi') next[`${hotel.hotel_id}|revenue_automation`] = false;
        if (turningOn && module === 'revenue_automation') next[`${hotel.hotel_id}|revenue_bi`] = false;
      }
      return next;
    });
  };

  const lines = useMemo(() => {
    if (!summary) return [];
    return Object.entries(selected)
      .filter(([, on]) => on)
      .map(([key]) => {
        const [hotelId, module] = key.split('|') as [string, BillingModule];
        const hotel = summary.hotels.find((row) => row.hotel_id === hotelId);
        const pricing = resolvedPricingFor(summary, hotelId, module);
        const rooms = hotel?.rooms ?? 0;
        const total = pricing.pricing_mode === 'percent'
          ? usageFor(hotelId)?.fee_cents ?? 0
          : pricing.pricing_mode === 'fixed_monthly'
            ? pricing.price_cents
            : rooms * pricing.price_cents;
        const organizationFixed = pricing.source === 'organization' && pricing.pricing_mode === 'fixed_monthly';
        const billingKey = organizationFixed ? `organization|${module}` : key;
        return { key, billingKey, organizationFixed, hotelId, module, hotel, pricing, rooms, total };
      })
      .filter((line) => line.pricing.pricing_mode !== 'custom');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, summary]);

  const billingTotals = new Map<string, number>();
  for (const line of lines) {
    if (!billingTotals.has(line.billingKey)) billingTotals.set(line.billingKey, line.total);
  }
  const netTotal = Array.from(billingTotals.values()).reduce((sum, total) => sum + total, 0);
  const chargeCount = billingTotals.size;
  const vatTotal = vatCents(summary, netTotal);
  const grossTotal = netTotal + vatTotal;
  const trialActive = trialIsRunning(summary);
  const activeSubs = (summary?.subscriptions ?? []).filter(isSubscriptionActive);
  const activeMonthly = activeSubs.reduce((sum, sub) => sum + sub.quantity * sub.unit_amount_cents, 0);
  const allHotelsBypassed = Boolean(summary?.hotels.length) && summary!.hotels.every((hotel) => hotel.billing_bypass);
  const nextRenewal = activeSubs.map((sub) => sub.current_period_end).filter(Boolean).sort()[0] as string | undefined;

  const startCheckout = async () => {
    if (!lines.length) return;
    setBusy(true);
    const { data, error: invokeError } = await supabase.functions.invoke('billing-manage', {
      body: {
        action: 'checkout',
        organizationSlug: orgSlug,
        returnUrl: window.location.href.split('?')[0],
        selections: lines.map((line) => ({ hotel_id: line.hotelId, module: line.module })),
      },
    });
    setBusy(false);
    const payload = data as { url?: string; error?: string } | null;
    if (invokeError || payload?.error) {
      toast.error(payload?.error ?? invokeError?.message ?? 'Could not start checkout');
      return;
    }
    if (payload?.url) window.location.assign(payload.url);
    else toast.error('Checkout could not be started — please try again.');
  };

  const openPortal = async () => {
    setBusy(true);
    const { data, error: invokeError } = await supabase.functions.invoke('billing-manage', {
      body: { action: 'portal', organizationSlug: orgSlug, returnUrl: window.location.href.split('?')[0] },
    });
    setBusy(false);
    const payload = data as { url?: string; error?: string; needs_checkout?: boolean; message?: string } | null;
    if (payload?.needs_checkout) {
      toast.info(payload.message ?? 'No paid subscription yet — pick your modules to get started.');
      return;
    }
    if (invokeError || payload?.error) {
      toast.error(payload?.error ?? invokeError?.message ?? 'Billing portal unavailable');
      return;
    }
    if (payload?.url) window.location.assign(payload.url);
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
        <div className="mx-auto max-w-xl p-6">
          <Alert><AlertTitle>Not available</AlertTitle><AlertDescription>Billing is managed by your organization's leadership team.</AlertDescription></Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <Header />
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold"><CreditCard className="h-6 w-6" /> Payments</h1>
            <p className="text-sm text-muted-foreground">Choose modules per property. Organization fixed agreements are charged once across all covered properties; {vatPercent}% VAT is added on top.</p>
          </div>
        </div>

        {canSwitchOrg && orgs.length > 1 && (
          <Select value={orgSlug} onValueChange={setOrgSlug}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Choose organization" /></SelectTrigger>
            <SelectContent>{orgs.map((org) => <SelectItem key={org.slug} value={org.slug}>{org.name}</SelectItem>)}</SelectContent>
          </Select>
        )}

        <Card className={trialActive || allHotelsBypassed ? 'border-primary/40' : undefined}>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-4 pt-5">
            <div className="flex min-w-[220px] items-center gap-2">
              {allHotelsBypassed ? <ShieldCheck className="h-5 w-5 text-primary" /> : trialActive ? <Sparkles className="h-5 w-5 text-primary" /> : <ShieldCheck className="h-5 w-5 text-primary" />}
              <div>
                <p className="text-sm font-semibold">{allHotelsBypassed ? 'Billing access enabled by admin' : trialActive ? `Free trial — ends ${fmtDate(summary?.trial_ends_at)}` : activeSubs.length ? 'Subscription active' : 'No subscription yet'}</p>
                <p className="text-xs text-muted-foreground">{allHotelsBypassed ? 'Payment gating is bypassed for this organization. Operational hotel status is unchanged.' : activeSubs.length ? `${activeSubs.length} module${activeSubs.length > 1 ? 's' : ''} · ${formatMoney(activeMonthly, currency)} / month excl. VAT` : 'Select a module below to see its exact agreed price.'}</p>
              </div>
            </div>
            {nextRenewal && <div><p className="text-xs text-muted-foreground">Next charge</p><p className="text-sm font-semibold">{fmtDate(nextRenewal)}</p></div>}
            <div><p className="text-xs text-muted-foreground">Properties</p><p className="text-sm font-semibold">{summary?.hotels.length ?? 0} · {summary?.hotels.reduce((sum, hotel) => sum + hotel.rooms, 0) ?? 0} rooms</p></div>
            <Button variant="outline" size="sm" className="ml-auto" onClick={openPortal} disabled={busy}>Manage payment method</Button>
          </CardContent>
        </Card>

        {inGracePeriod(summary) && !activeSubs.length && !allHotelsBypassed && (
          <Alert className="border-primary/40"><Sparkles className="h-4 w-4" /><AlertTitle>Access stays open until {fmtDate(graceEndsAt(summary))}</AlertTitle><AlertDescription>Add payment details before the courtesy period ends to avoid interruption.</AlertDescription></Alert>
        )}
        {error && <Alert variant="destructive"><AlertTitle>Couldn't load billing</AlertTitle><AlertDescription>{error} <Button size="sm" variant="outline" onClick={reload}>Retry</Button></AlertDescription></Alert>}

        <Tabs defaultValue="modules">
          <TabsList>
            <TabsTrigger value="modules">Modules</TabsTrigger>
            <TabsTrigger value="invoices" onClick={() => { if (!invoices) void loadInvoices(); }}>Invoices</TabsTrigger>
          </TabsList>
          <TabsContent value="modules" className="mt-4">
            {loading ? <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-44 w-full" /><Skeleton className="h-44 w-full" /></div> : (
              <div className="grid gap-4 md:grid-cols-2">
                {summary?.hotels.map((hotel) => {
                  const hotelLines = lines.filter((line) => line.hotelId === hotel.hotel_id);
                  const propertyLines = hotelLines.filter((line) => !line.organizationFixed);
                  const organizationLines = hotelLines.filter((line) => line.organizationFixed);
                  const hotelNet = propertyLines.reduce((sum, line) => sum + line.total, 0);
                  return (
                    <Card key={hotel.hotel_id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="text-base">{hotel.hotel_name}</CardTitle>
                          <div className="flex gap-1.5">
                            {hotel.billing_bypass && <Badge variant="default">Billing bypass</Badge>}
                            <Badge variant="secondary" className="gap-1"><BedDouble className="h-3.5 w-3.5" /> {hotel.rooms} rooms</Badge>
                          </div>
                        </div>
                        <CardDescription className="text-xs">Hotel-specific commercial terms override the organization agreement automatically.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          {MODULE_ORDER.map((module) => {
                            const Icon = MODULE_ICON[module];
                            const pricing = resolvedPricingFor(summary, hotel.hotel_id, module);
                            const active = isSubscriptionActive(subFor(hotel.hotel_id, module));
                            const accessActive = active || Boolean(hotel.billing_bypass);
                            const custom = pricing.pricing_mode === 'custom';
                            const available = enabledFor(module);
                            const key = `${hotel.hotel_id}|${module}`;
                            const on = Boolean(selected[key]) || accessActive;
                            const promotion = pricing.source === 'standard' ? promotionForModule(settings, module) : null;
                            const priceText = pricing.pricing_mode === 'percent'
                              ? `${percentLabel} of realised revenue`
                              : pricing.pricing_mode === 'fixed_monthly'
                                ? pricing.source === 'organization'
                                  ? `${formatMoney(pricing.price_cents, currency)} organization fixed / month`
                                  : `${formatMoney(pricing.price_cents, currency)} fixed / month`
                                : custom
                                  ? 'Custom quote'
                                  : pricing.price_cents > 0
                                    ? `${formatMoney(pricing.price_cents, currency)} / room / month`
                                    : 'Not priced yet';
                            return (
                              <button
                                key={module}
                                type="button"
                                disabled={!available || Boolean(hotel.billing_bypass) || (!custom && pricing.pricing_mode !== 'percent' && pricing.price_cents <= 0)}
                                onClick={() => custom ? setQuoteFor(hotel.hotel_name) : toggle(hotel.hotel_id, module)}
                                className={`rounded-lg border p-2.5 text-left transition-colors disabled:opacity-60 ${on ? 'border-primary bg-primary/10' : 'hover:border-primary/50 hover:bg-muted/50'}`}
                              >
                                <span className="flex items-center gap-1.5 text-sm font-medium"><Icon className="h-4 w-4 shrink-0 text-primary" />{labelFor(module)}{accessActive && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">{priceText}</span>
                                {pricing.source !== 'standard' && <Badge variant="secondary" className="mt-1 text-[10px]">{pricing.source === 'hotel' ? 'Hotel agreement' : 'Organization agreement'}</Badge>}
                                {promotion?.active && pricing.pricing_mode === 'per_room' && <Badge variant="secondary" className="mt-1 text-[10px]">{promotion.label}</Badge>}
                                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/80">{hotel.billing_bypass ? 'Access enabled by admin' : active ? 'Active subscription' : hintFor(module)}</span>
                              </button>
                            );
                          })}
                        </div>
                        {propertyLines.length > 0 && <p className="text-xs text-muted-foreground">Selected net for this property: <span className="font-semibold text-foreground">{formatMoney(hotelNet, currency)}</span> / month excl. VAT</p>}
                        {organizationLines.map((line) => (
                          <p key={`org-${line.module}`} className="text-xs text-muted-foreground">
                            {labelFor(line.module)} is covered by the <span className="font-semibold text-foreground">{formatMoney(line.total, currency)}</span> organization agreement, charged once across all covered properties.
                          </p>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="invoices" className="mt-4">
            <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" /> Invoices</CardTitle><CardDescription>Invoices show net, VAT and gross separately.</CardDescription></CardHeader><CardContent className="space-y-2">
              {invoices === null ? <Skeleton className="h-20 w-full" /> : invoices.length === 0 ? <p className="text-sm text-muted-foreground">No invoices yet.</p> : invoices.map((invoice) => (
                <div key={invoice.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div><p className="text-sm font-medium">{invoice.number ?? invoice.id} · {fmtStamp(invoice.created)}</p><p className="text-xs text-muted-foreground">{formatMoney(invoice.subtotal_cents, invoice.currency)} + {formatMoney(invoice.tax_cents, invoice.currency)} VAT = <span className="font-medium text-foreground">{formatMoney(invoice.total_cents, invoice.currency)}</span>{invoice.status ? ` · ${invoice.status}` : ''}</p></div>
                  {invoice.invoice_pdf && <Button asChild size="sm" variant="outline"><a href={invoice.invoice_pdf} target="_blank" rel="noreferrer">PDF <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={openPortal} disabled={busy}>Manage payment method &amp; company details</Button>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 p-3 sm:p-4">
            <div className="text-sm"><p className="text-xs text-muted-foreground">{lines.length} property module{lines.length > 1 ? 's' : ''} selected · {chargeCount} billing line{chargeCount > 1 ? 's' : ''}</p><p><span className="text-muted-foreground">Net </span><span className="font-medium">{formatMoney(netTotal, currency)}</span><span className="text-muted-foreground"> + VAT {vatPercent}% </span><span className="font-medium">{formatMoney(vatTotal, currency)}</span></p></div>
            <Separator orientation="vertical" className="hidden h-8 sm:block" />
            <div><p className="text-xs text-muted-foreground">Total per month</p><p className="text-lg font-bold">{formatMoney(grossTotal, currency)}</p></div>
            <Button className="ml-auto" onClick={startCheckout} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{trialActive ? 'Start free trial — add card' : 'Continue to checkout'}</Button>
          </div>
        </div>
      )}

      <Dialog open={Boolean(quoteFor)} onOpenChange={(open) => !open && setQuoteFor(null)}>
        <DialogContent><DialogHeader><DialogTitle>Maintenance — custom pricing</DialogTitle><DialogDescription>Maintenance is priced individually for {quoteFor}. Contact us for a tailored quote.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setQuoteFor(null)}>Close</Button><Button onClick={() => { window.location.href = `mailto:support@hotelcare.app?subject=${encodeURIComponent(`Maintenance module quote — ${quoteFor ?? ''}`)}`; setQuoteFor(null); }}>Request a quote</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
