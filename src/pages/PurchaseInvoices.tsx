import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Camera, Upload, Receipt, BarChart3, Download, Loader2, ShieldAlert,
  CheckCircle, AlertCircle, FileText, RefreshCw, AlertTriangle,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import { useFirstRunTour, TourReplayButton, type TourStep } from '@/components/training/GuidedTour';
import { VerifyInvoiceDialog } from '@/components/purchase-invoices/VerifyInvoiceDialog';

const ALLOWED_ROLES = ['admin','top_management','control_finance','back_office','reception','front_office'];
const ANALYTICS_ROLES = ['admin','top_management','control_finance'];
const QUEUE_ROLES = ['admin','top_management','control_finance','back_office'];

const PI_TOUR: TourStep[] = [
  { titleKey: 'tour.pi.welcome.title', bodyKey: 'tour.pi.welcome.body' },
  { selector: '[data-tour="pi-tabs"]', titleKey: 'tour.pi.tabs.title', bodyKey: 'tour.pi.tabs.body' },
  { tab: 'upload', selector: '[data-tour="pi-upload"]', titleKey: 'tour.pi.upload.title', bodyKey: 'tour.pi.upload.body' },
  { tab: 'upload', selector: '[data-tour="pi-camera"]', titleKey: 'tour.pi.camera.title', bodyKey: 'tour.pi.camera.body' },
  { tab: 'upload', selector: '[data-tour="pi-file"]', titleKey: 'tour.pi.file.title', bodyKey: 'tour.pi.file.body' },
  { tab: 'upload', selector: '[data-tour="pi-tips"]', titleKey: 'tour.pi.tips.title', bodyKey: 'tour.pi.tips.body' },
  { tab: 'queue', selector: '[data-tour="pi-queue"]', titleKey: 'tour.pi.queue.title', bodyKey: 'tour.pi.queue.body' },
  { tab: 'queue', selector: '[data-tour="pi-filter"]', titleKey: 'tour.pi.filter.title', bodyKey: 'tour.pi.filter.body' },
  { tab: 'queue', selector: '[data-tour="pi-row"]', titleKey: 'tour.pi.row.title', bodyKey: 'tour.pi.row.body' },
  { tab: 'queue', selector: '[data-tour="pi-retry"]', titleKey: 'tour.pi.retry.title', bodyKey: 'tour.pi.retry.body' },
  { tab: 'analytics', selector: '[data-tour="pi-analytics"]', titleKey: 'tour.pi.analytics.title', bodyKey: 'tour.pi.analytics.body' },
  { tab: 'analytics', selector: '[data-tour="pi-kpis"]', titleKey: 'tour.pi.kpis.title', bodyKey: 'tour.pi.kpis.body' },
  { tab: 'analytics', selector: '[data-tour="pi-top"]', titleKey: 'tour.pi.top.title', bodyKey: 'tour.pi.top.body' },
  { tab: 'export', selector: '[data-tour="pi-export"]', titleKey: 'tour.pi.export.title', bodyKey: 'tour.pi.export.body' },
  { selector: '[data-tour="pi-replay"]', titleKey: 'tour.pi.replay.title', bodyKey: 'tour.pi.replay.body' },
];

const VAT_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'];
const STATUS_FILTERS = ['all','uploaded','processing','processed','verified','failed','needs_review'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];
type SortMode = 'newest'|'oldest'|'amountDesc'|'amountAsc'|'merchant';
type RangeKey = '7d'|'30d'|'90d'|'ytd'|'all';

export default function PurchaseInvoices() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('30d');
  const [activeTab, setActiveTab] = useState<string>('upload');

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) setActiveTab(String(detail.tab));
    };
    window.addEventListener('tour:navigate', handler);
    return () => window.removeEventListener('tour:navigate', handler);
  }, []);

  const canAccess = profile && ALLOWED_ROLES.includes(profile.role);
  const canSeeAnalytics = profile && ANALYTICS_ROLES.includes(profile.role);
  const canSeeQueue = profile && QUEUE_ROLES.includes(profile.role);

  useFirstRunTour('purchase_invoices_v2', PI_TOUR);

  const reload = async () => {
    const { data } = await supabase
      .from('purchase_invoices')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    setInvoices(data || []);
  };

  useEffect(() => { if (canAccess) reload(); }, [canAccess]);

  const runOcr = async (invoiceId: string): Promise<{ ok: boolean; errorCode?: string }> => {
    const { data, error } = await supabase.functions.invoke('process-purchase-invoice', {
      body: { invoiceId },
    });
    if (error) {
      const msg = (error as any)?.message || '';
      if (msg.includes('Failed to send') || msg.includes('Failed to fetch')) {
        return { ok: false, errorCode: 'processor_unavailable' };
      }
      return { ok: false, errorCode: 'unknown' };
    }
    if (data?.success === false && data?.error_code) return { ok: false, errorCode: data.error_code };
    return { ok: true };
  };

  const handleFile = async (file: File) => {
    if (!user || !profile?.organization_slug) return;
    setUploading(true);
    const tid = crypto.randomUUID();
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${profile.organization_slug}/${profile.assigned_hotel || 'unassigned'}/${tid}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('purchase-invoices').upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from('purchase_invoices').insert({
        id: tid,
        organization_slug: profile.organization_slug,
        hotel_id: profile.assigned_hotel,
        uploaded_by: user.id,
        file_path: path,
        file_mime: file.type,
        file_size_bytes: file.size,
        status: 'uploaded',
      });
      if (insErr) throw insErr;

      toast.loading(t('pi.upload.processing'), { id: tid });
      const res = await runOcr(tid);
      await reload();
      if (res.ok) {
        toast.success(t('pi.upload.success'), { id: tid });
      } else if (res.errorCode === 'processor_unavailable') {
        toast.warning(t('pi.error.processor_unavailable'), { id: tid, duration: 6000 });
      } else if (res.errorCode) {
        toast.error(t(`pi.error.${res.errorCode}`) || t('pi.upload.failed'), { id: tid });
      } else {
        toast.error(t('pi.upload.failed'), { id: tid });
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('pi.upload.failed'), { id: tid });
    } finally {
      setUploading(false);
    }
  };

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    toast.loading(t('pi.queue.retrying'), { id: `retry-${id}` });
    const res = await runOcr(id);
    await reload();
    setRetryingId(null);
    if (res.ok) toast.success(t('pi.upload.success'), { id: `retry-${id}` });
    else if (res.errorCode === 'processor_unavailable')
      toast.warning(t('pi.error.processor_unavailable'), { id: `retry-${id}` });
    else toast.error(t(`pi.error.${res.errorCode}`) || t('pi.upload.failed'), { id: `retry-${id}` });
  };

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    let list = invoices.filter(i => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'verified') return i.is_verified === true;
      if (statusFilter === 'needs_review') return i.status === 'processed' && !i.is_verified;
      return i.status === statusFilter;
    });
    if (s) list = list.filter(i =>
      (i.merchant_name || '').toLowerCase().includes(s) ||
      (i.invoice_number || '').toLowerCase().includes(s)
    );
    const sorted = [...list];
    switch (sortMode) {
      case 'oldest': sorted.sort((a,b) => (a.created_at||'').localeCompare(b.created_at||'')); break;
      case 'amountDesc': sorted.sort((a,b) => Number(b.total_amount||0) - Number(a.total_amount||0)); break;
      case 'amountAsc': sorted.sort((a,b) => Number(a.total_amount||0) - Number(b.total_amount||0)); break;
      case 'merchant': sorted.sort((a,b) => (a.merchant_name||'').localeCompare(b.merchant_name||'')); break;
      default: sorted.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
    }
    return sorted;
  }, [invoices, search, statusFilter, sortMode]);

  const rangedInvoices = useMemo(() => filterByRange(invoices, range), [invoices, range]);

  const stats = useMemo(() => computeStats(invoices, rangedInvoices), [invoices, rangedInvoices]);
  const anomalies = useMemo(() => detectAnomalies(invoices), [invoices]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!canAccess) {
    return (
      <div className="min-h-screen bg-background">
        <Header /><PMSNavigation />
        <div className="container mx-auto p-6">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>{t('pi.access.denied')}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Receipt className="h-5 w-5 sm:h-6 sm:w-6 text-primary" /> {t('pi.title')}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">{t('pi.subtitle')}</p>
          </div>
          <div data-tour="pi-replay">
            <TourReplayButton tourKey="purchase_invoices_v2" steps={PI_TOUR} />
          </div>
        </div>

        <Tabs defaultValue="upload" className="space-y-4">
          <TabsList className="flex flex-wrap" data-tour="pi-tabs">
            <TabsTrigger value="upload">
              <Camera className="h-4 w-4 mr-1.5" />{t('pi.tab.upload')}
            </TabsTrigger>
            {canSeeQueue && (
              <TabsTrigger value="queue" data-tour="pi-queue">
                <FileText className="h-4 w-4 mr-1.5" />{t('pi.tab.queue')}
              </TabsTrigger>
            )}
            {canSeeAnalytics && (
              <TabsTrigger value="analytics" data-tour="pi-analytics">
                <BarChart3 className="h-4 w-4 mr-1.5" />{t('pi.tab.analytics')}
              </TabsTrigger>
            )}
            {canSeeAnalytics && (
              <TabsTrigger value="export" data-tour="pi-export">
                <Download className="h-4 w-4 mr-1.5" />{t('pi.tab.export')}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="upload">
            <Card data-tour="pi-upload">
              <CardHeader><CardTitle className="text-base">{t('pi.upload.heading')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('pi.upload.dropHint')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="cursor-pointer" data-tour="pi-camera">
                    <input type="file" accept="image/*" capture="environment" hidden
                      disabled={uploading}
                      onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                    <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:bg-accent transition">
                      <Camera className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <div className="text-sm font-medium">{t('pi.upload.camera')}</div>
                    </div>
                  </label>
                  <label className="cursor-pointer" data-tour="pi-file">
                    <input type="file" accept="image/*,application/pdf" hidden
                      disabled={uploading}
                      onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                    <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:bg-accent transition">
                      <Upload className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <div className="text-sm font-medium">{t('pi.upload.file')}</div>
                    </div>
                  </label>
                </div>
                {uploading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t('pi.upload.processing')}
                  </div>
                )}
                <div data-tour="pi-tips" className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground pt-2 border-t">
                  <div>💡 {t('pi.upload.tip.light')}</div>
                  <div>📐 {t('pi.upload.tip.full')}</div>
                  <div>📷 {t('pi.upload.tip.flat')}</div>
                  <div>✅ {t('pi.upload.tip.clear')}</div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {canSeeQueue && (
            <TabsContent value="queue">
              <Card>
                <CardHeader className="pb-2 space-y-3">
                  <div className="flex flex-wrap gap-2 items-center">
                    <Input placeholder={t('pi.queue.search')} value={search}
                      onChange={(e) => setSearch(e.target.value)} className="flex-1 min-w-[180px]" />
                    <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                      <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="newest">{t('pi.queue.sort.newest')}</SelectItem>
                        <SelectItem value="oldest">{t('pi.queue.sort.oldest')}</SelectItem>
                        <SelectItem value="amountDesc">{t('pi.queue.sort.amountDesc')}</SelectItem>
                        <SelectItem value="amountAsc">{t('pi.queue.sort.amountAsc')}</SelectItem>
                        <SelectItem value="merchant">{t('pi.queue.sort.merchant')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div data-tour="pi-filter" className="flex flex-wrap gap-1.5">
                    {STATUS_FILTERS.map(f => (
                      <button
                        key={f}
                        onClick={() => setStatusFilter(f)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition ${
                          statusFilter === f
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-accent border-border'
                        }`}
                      >
                        {t(`pi.queue.filter.${f}`)}
                      </button>
                    ))}
                    <span className="text-xs text-muted-foreground self-center ml-auto">
                      {t('pi.queue.count').replace('{n}', String(filtered.length))}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  {filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">{t('pi.queue.empty')}</p>
                  ) : (
                    <div className="space-y-2">
                      {filtered.map((inv, idx) => (
                        <div
                          key={inv.id}
                          data-tour={idx === 0 ? 'pi-row' : undefined}
                          role="button"
                          tabIndex={0}
                          onClick={() => setVerifyId(inv.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') setVerifyId(inv.id); }}
                          className="flex items-center justify-between gap-2 p-3 border rounded-lg hover:bg-accent/30 cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{inv.merchant_name || '—'}</div>
                            <div className="text-xs text-muted-foreground">
                              {inv.invoice_date || inv.created_at?.slice(0, 10)} · {inv.invoice_number || '—'}
                            </div>
                            {inv.status === 'failed' && inv.error_details?.tips?.length > 0 && (
                              <div className="text-[10px] text-destructive mt-0.5 truncate">
                                {inv.error_details.tips[0]}
                              </div>
                            )}
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-1">
                            <div className="font-semibold">
                              {inv.total_amount ? `${Number(inv.total_amount).toLocaleString()} ${inv.currency || ''}` : '—'}
                            </div>
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              <Badge variant={inv.is_verified ? 'default' : inv.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                                {inv.is_verified ? t('pi.status.verified') : t(`pi.status.${inv.status}`)}
                              </Badge>
                              {(inv.status === 'failed' || inv.status === 'uploaded') && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  data-tour={idx === 0 ? 'pi-retry' : undefined}
                                  disabled={retryingId === inv.id}
                                  className="h-6 px-2 text-[10px]"
                                  onClick={(e) => { e.stopPropagation(); handleRetry(inv.id); }}
                                >
                                  {retryingId === inv.id
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <><RefreshCw className="h-3 w-3 mr-1" />{t('pi.queue.retry')}</>}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px]"
                                onClick={(e) => { e.stopPropagation(); setVerifyId(inv.id); }}
                              >
                                {inv.is_verified ? t('pi.upload.retake') : t('pi.upload.save')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {canSeeAnalytics && (
            <TabsContent value="analytics" className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">{t('pi.analytics.range.7d')}</SelectItem>
                    <SelectItem value="30d">{t('pi.analytics.range.30d')}</SelectItem>
                    <SelectItem value="90d">{t('pi.analytics.range.90d')}</SelectItem>
                    <SelectItem value="ytd">{t('pi.analytics.range.ytd')}</SelectItem>
                    <SelectItem value="all">{t('pi.analytics.range.all')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div data-tour="pi-kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label={t('pi.analytics.thisMonth')} value={`${stats.total.toLocaleString()} HUF`} sub={`${stats.count} ${t('pi.queue.count').replace('{n}','').trim()}`} />
                <Kpi label={t('pi.analytics.avgInvoice')} value={`${Math.round(stats.avg).toLocaleString()} HUF`} />
                <Kpi label={t('pi.analytics.totalVat')} value={`${stats.vat.toLocaleString()} HUF`} />
                <Kpi label={t('pi.analytics.successRate')} value={`${stats.successRate}%`} />
                <Kpi label={t('pi.analytics.uniqueMerchants')} value={String(stats.uniqueMerchants)} />
                <Kpi label={t('pi.analytics.topMerchant')} value={stats.top} small />
                <Kpi
                  label={t('pi.analytics.unverified')}
                  value={String(stats.unverified)}
                  icon={stats.unverified > 0
                    ? <AlertCircle className="h-6 w-6 text-orange-500/60" />
                    : <CheckCircle className="h-6 w-6 text-green-500/60" />}
                />
                <Kpi label={t('pi.analytics.lastMonth')} value={`${stats.lastMonth.toLocaleString()} HUF`} />
              </div>

              {anomalies.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-medium mb-1">{t('pi.analytics.anomalies')} ({anomalies.length})</div>
                    <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                      {anomalies.slice(0, 10).map((a, i) => (
                        <li key={i}>
                          <button className="underline hover:no-underline text-left" onClick={() => setVerifyId(a.id)}>
                            {a.kind === 'duplicate' ? t('pi.analytics.anomalies.duplicate') : t('pi.analytics.anomalies.vatMismatch')}
                            {' · '}{a.merchant || '—'} · {a.invoiceNumber || '—'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader><CardTitle className="text-base">{t('pi.analytics.dailyTrend')}</CardTitle></CardHeader>
                <CardContent style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={dailySeries(rangedInvoices)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Bar dataKey="amount" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card data-tour="pi-top">
                <CardHeader><CardTitle className="text-base">{t('pi.analytics.topMerchants')}</CardTitle></CardHeader>
                <CardContent style={{ height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={topMerchants(rangedInvoices)} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" fontSize={11} />
                      <YAxis type="category" dataKey="name" fontSize={11} width={120} />
                      <Tooltip />
                      <Bar dataKey="value" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <div className="grid lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">{t('pi.analytics.byCategory')}</CardTitle></CardHeader>
                  <CardContent style={{ height: 260 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={byCategory(rangedInvoices)} dataKey="value" nameKey="name" outerRadius={80} label>
                          {byCategory(rangedInvoices).map((_, i) => <Cell key={i} fill={VAT_COLORS[i % VAT_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">{t('pi.analytics.byPayment')}</CardTitle></CardHeader>
                  <CardContent style={{ height: 260 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={byPayment(rangedInvoices)} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} label>
                          {byPayment(rangedInvoices).map((_, i) => <Cell key={i} fill={VAT_COLORS[i % VAT_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">{t('pi.analytics.monthly')}</CardTitle></CardHeader>
                <CardContent style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={monthlyComparison(invoices)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="thisYear" stroke="hsl(var(--primary))" name="This year" />
                      <Line type="monotone" dataKey="lastYear" stroke="#94a3b8" name="Last year" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {canSeeAnalytics && (
            <TabsContent value="export">
              <Card>
                <CardContent className="p-6 flex flex-col gap-3">
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" onClick={() => exportCsv(rangedInvoices)}>
                      <Download className="h-4 w-4 mr-2" />{t('pi.export.csv')}
                    </Button>
                    <Button variant="outline" onClick={() => exportXlsx(rangedInvoices)}>
                      <Download className="h-4 w-4 mr-2" />{t('pi.export.xlsx')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('pi.analytics.range.' + range)} · {rangedInvoices.length} {t('pi.queue.count').replace('{n}','').trim()}
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
      <VerifyInvoiceDialog
        invoiceId={verifyId}
        open={!!verifyId}
        onClose={() => setVerifyId(null)}
        onSaved={() => reload()}
      />
    </div>
  );
}

function Kpi({ label, value, sub, icon, small }: { label: string; value: string; sub?: string; icon?: React.ReactNode; small?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">{label}</div>
          <div className={`${small ? 'text-sm font-semibold' : 'text-xl font-bold'} truncate`}>{value}</div>
          {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}

function filterByRange(invoices: any[], range: RangeKey): any[] {
  if (range === 'all') return invoices;
  const now = new Date();
  let start: Date;
  if (range === '7d') start = new Date(now.getTime() - 7*864e5);
  else if (range === '30d') start = new Date(now.getTime() - 30*864e5);
  else if (range === '90d') start = new Date(now.getTime() - 90*864e5);
  else start = new Date(now.getFullYear(), 0, 1);
  return invoices.filter(i => {
    const d = i.invoice_date || i.created_at;
    return d && new Date(d) >= start;
  });
}

function computeStats(all: any[], ranged: any[]) {
  const total = ranged.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const vat = ranged.reduce((s, i) => s + Number(i.total_vat_amount || 0), 0);
  const count = ranged.length;
  const avg = count ? total / count : 0;
  const merchantTotals: Record<string, number> = {};
  ranged.forEach(i => {
    const m = i.merchant_name || 'Unknown';
    merchantTotals[m] = (merchantTotals[m] || 0) + Number(i.total_amount || 0);
  });
  const top = Object.entries(merchantTotals).sort(([,a],[,b]) => b - a)[0]?.[0] || '—';
  const uniqueMerchants = new Set(ranged.map(i => i.merchant_name).filter(Boolean)).size;
  const processedOrBetter = all.filter(i => ['processed','verified'].includes(i.status) || i.is_verified).length;
  const totalAttempts = all.filter(i => i.status !== 'uploaded').length || 1;
  const successRate = Math.round((processedOrBetter / totalAttempts) * 100);
  const unverified = all.filter(i => i.status === 'processed' && !i.is_verified).length;
  // last month
  const now = new Date();
  const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const lastMonth = all
    .filter(i => i.invoice_date && new Date(i.invoice_date) >= lmStart && new Date(i.invoice_date) <= lmEnd)
    .reduce((s, i) => s + Number(i.total_amount || 0), 0);
  return { total, vat, count, avg, top, uniqueMerchants, successRate, unverified, lastMonth };
}

function detectAnomalies(invoices: any[]) {
  const out: { id: string; kind: 'duplicate'|'vat'; merchant?: string; invoiceNumber?: string }[] = [];
  const seen = new Map<string, string>();
  invoices.forEach(i => {
    if (i.merchant_name && i.invoice_number) {
      const k = `${i.merchant_name}::${i.invoice_number}`;
      if (seen.has(k)) out.push({ id: i.id, kind: 'duplicate', merchant: i.merchant_name, invoiceNumber: i.invoice_number });
      else seen.set(k, i.id);
    }
    if (i.total_amount && i.total_vat_amount != null && i.net_amount != null) {
      const sum = Number(i.net_amount) + Number(i.total_vat_amount);
      if (Math.abs(sum - Number(i.total_amount)) / Number(i.total_amount) > 0.01) {
        out.push({ id: i.id, kind: 'vat', merchant: i.merchant_name, invoiceNumber: i.invoice_number });
      }
    }
  });
  return out;
}

function dailySeries(invoices: any[]) {
  const map: Record<string, { date: string; amount: number; vat: number }> = {};
  invoices.forEach(i => {
    const d = (i.invoice_date || i.created_at)?.slice(0, 10);
    if (!d) return;
    if (!map[d]) map[d] = { date: d, amount: 0, vat: 0 };
    map[d].amount += Number(i.total_amount || 0);
    map[d].vat += Number(i.total_vat_amount || 0);
  });
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
}
function byCategory(invoices: any[]) {
  const map: Record<string, number> = {};
  invoices.forEach(i => {
    const k = i.expense_category || 'other';
    map[k] = (map[k] || 0) + Number(i.total_amount || 0);
  });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}
function byPayment(invoices: any[]) {
  const map: Record<string, number> = {};
  invoices.forEach(i => {
    const k = i.payment_method || 'unknown';
    map[k] = (map[k] || 0) + Number(i.total_amount || 0);
  });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}
function topMerchants(invoices: any[]) {
  const map: Record<string, number> = {};
  invoices.forEach(i => {
    const k = i.merchant_name || 'Unknown';
    map[k] = (map[k] || 0) + Number(i.total_amount || 0);
  });
  return Object.entries(map)
    .map(([name, value]) => ({ name: name.length > 22 ? name.slice(0, 20) + '…' : name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .reverse();
}
function monthlyComparison(invoices: any[]) {
  const now = new Date();
  const thisYear = now.getFullYear();
  const months = Array.from({ length: 12 }, (_, m) => ({
    month: new Date(thisYear, m, 1).toLocaleString('en', { month: 'short' }),
    thisYear: 0, lastYear: 0,
  }));
  invoices.forEach(i => {
    const d = i.invoice_date ? new Date(i.invoice_date) : null;
    if (!d) return;
    const y = d.getFullYear();
    const m = d.getMonth();
    if (y === thisYear) months[m].thisYear += Number(i.total_amount || 0);
    else if (y === thisYear - 1) months[m].lastYear += Number(i.total_amount || 0);
  });
  return months;
}
function exportCsv(invoices: any[]) {
  const headers = ['invoice_date','merchant_name','merchant_tax_id','invoice_number','currency','net_amount','total_vat_amount','total_amount','expense_category','payment_method','status','is_verified'];
  const rows = invoices.map(i => headers.map(h => JSON.stringify(i[h] ?? '')).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  download(new Blob([csv], { type: 'text/csv' }), `purchase-invoices-${Date.now()}.csv`);
}
function exportXlsx(invoices: any[]) {
  // simple TSV-as-xls fallback (no extra deps) — Excel opens .xls TSV transparently
  const headers = ['invoice_date','merchant_name','merchant_tax_id','invoice_number','currency','net_amount','total_vat_amount','total_amount','expense_category','payment_method','status','is_verified'];
  const rows = invoices.map(i => headers.map(h => String(i[h] ?? '').replace(/\t/g,' ')).join('\t'));
  const tsv = [headers.join('\t'), ...rows].join('\n');
  download(new Blob(['\ufeff' + tsv], { type: 'application/vnd.ms-excel' }), `purchase-invoices-${Date.now()}.xls`);
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
