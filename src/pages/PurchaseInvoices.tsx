import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { MainTabsBar } from '@/components/layout/MainTabsBar';
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
  CheckCircle, AlertCircle, FileText, RefreshCw, AlertTriangle, Trash2, Eye,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import { useFirstRunTour, TourReplayButton, type TourStep } from '@/components/training/GuidedTour';
import { VerifyInvoiceDialog } from '@/components/purchase-invoices/VerifyInvoiceDialog';

const ALLOWED_ROLES = ['admin','top_management','top_management_manager','control_finance','back_office','reception','front_office'];
const ANALYTICS_ROLES = ['admin','top_management','top_management_manager','control_finance'];
const QUEUE_ROLES = ['admin','top_management','top_management_manager','control_finance','back_office'];
const DELETE_ROLES = ['admin','top_management','top_management_manager'];

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
  { tab: 'export', selector: '[data-tour="pi-export-buttons"]', titleKey: 'tour.pi.export.title', bodyKey: 'tour.pi.export.body', placement: 'left' as any },
  // Final step: no selector → centered card → Done button always reachable.
  { titleKey: 'tour.pi.replay.title', bodyKey: 'tour.pi.replay.body' },
];

const VAT_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'];
const STATUS_FILTERS = ['all','uploaded','processing','processed','verified','failed','needs_review','duplicates','credit_notes'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];
type SortMode = 'newest'|'oldest'|'amountDesc'|'amountAsc'|'merchant';
type RangeKey = '7d'|'30d'|'90d'|'ytd'|'all'|'custom';
type VerifyFilter = 'all'|'verified'|'unverified';
type UploadStage = 'uploading'|'digitizing'|'extracting'|'done'|'error';
type UploadJob = {
  id: string;
  invoiceId?: string;
  name: string;
  size: number;
  status: UploadStage;
  progress: number; // 0..100
  error?: string;
  errorCode?: string;
  startedAt: number;
};
const STAGES: { key: UploadStage; label: string }[] = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'digitizing', label: 'Digitizing' },
  { key: 'extracting', label: 'Extracting' },
  { key: 'done', label: 'Ready' },
];

export default function PurchaseInvoices() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [search, setSearch] = useState('');
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('30d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [verifyFilter, setVerifyFilter] = useState<VerifyFilter>('all');
  const [merchantFilter, setMerchantFilter] = useState<string>('all');
  const [minAmount, setMinAmount] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('upload');
  // Keep errored jobs visible so the user can preview/fix or dismiss them.
  const visibleJobs = uploadJobs.filter(j => j.status !== 'done');
  const dismissJob = (id: string) => setUploadJobs(prev => prev.filter(j => j.id !== id));


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
  const canDelete = profile && DELETE_ROLES.includes(profile.role);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useFirstRunTour('purchase_invoices_v2', PI_TOUR);

  const reload = async () => {
    // Fetch ALL invoices in 1000-row pages so the queue is not capped (previously
    // hard-coded to .limit(500) which stopped pagination at ~14 pages × 50/page).
    const PAGE = 1000;
    const all: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('purchase_invoices')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    setInvoices(all);
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
    const tid = crypto.randomUUID();
    const job: UploadJob = {
      id: tid, invoiceId: tid, name: file.name, size: file.size,
      status: 'uploading', progress: 10, startedAt: Date.now(),
    };
    setUploadJobs(prev => [job, ...prev].slice(0, 12));
    const patch = (p: Partial<UploadJob>) =>
      setUploadJobs(prev => prev.map(j => j.id === tid ? { ...j, ...p } : j));

    // Fire-and-forget — the user can switch tabs immediately. The job survives
    // tab switches because state lives on the PurchaseInvoices component.
    (async () => {
      try {
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `${profile.organization_slug}/${profile.assigned_hotel || 'unassigned'}/${tid}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from('purchase-invoices').upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        patch({ progress: 40, status: 'digitizing' });

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
        patch({ progress: 70, status: 'extracting' });

        const res = await runOcr(tid);
        await reload();
        if (res.ok) {
          patch({ status: 'done', progress: 100 });
          toast.success(t('pi.upload.autoOpening') || 'Ready to review — please verify');
          // Auto-open the verify dialog so the user can review the extracted
          // data against the original document and explicitly save/verify.
          // The processing card stays visible until the user dismisses it or
          // verifies the invoice — no auto-dismiss.
          setVerifyId(tid);
        } else {
          const code = res.errorCode || 'unknown';
          patch({ status: 'error', progress: 100, error: code, errorCode: code });
          if (code === 'processor_unavailable') toast.warning(t('pi.error.processor_unavailable'));
          else toast.error(t(`pi.error.${code}`) || t('pi.upload.failed'));
        }
      } catch (e: any) {
        console.error(e);
        patch({ status: 'error', progress: 100, error: e?.message });
        toast.error(e?.message || t('pi.upload.failed'));
      }
    })();
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

  const handleDelete = async (inv: any) => {
    if (!inv?.id) return;
    setDeletingId(inv.id);
    try {
      // Best-effort storage cleanup first
      if (inv.file_path) {
        await supabase.storage.from('purchase-invoices').remove([inv.file_path]);
      }
      const { error } = await supabase.from('purchase_invoices').delete().eq('id', inv.id);
      if (error) throw error;
      setInvoices(prev => prev.filter(x => x.id !== inv.id));
      setUploadJobs(prev => prev.filter(j => j.invoiceId !== inv.id));
      if (verifyId === inv.id) setVerifyId(null);
      toast.success('Invoice deleted');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to delete');
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  };

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    let list = invoices.filter(i => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'verified') return i.is_verified === true;
      if (statusFilter === 'needs_review') return i.status === 'processed' && !i.is_verified;
      if (statusFilter === 'duplicates') return i.duplicate_status === 'suspected' || i.duplicate_status === 'credit_note';
      if (statusFilter === 'credit_notes') return i.is_credit_note === true;
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
      <div className="container mx-auto px-3 sm:px-6 pt-3"><MainTabsBar current="purchase-invoices" /></div>
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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

          <TabsContent value="upload" className="space-y-4">
            <Card data-tour="pi-upload">
              <CardHeader><CardTitle className="text-base">{t('pi.upload.heading')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('pi.upload.dropHint')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="cursor-pointer" data-tour="pi-camera">
                    <input type="file" accept="image/*" capture="environment" hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0]; if (f) handleFile(f);
                        e.currentTarget.value = '';
                      }} />
                    <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:bg-accent transition">
                      <Camera className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <div className="text-sm font-medium">{t('pi.upload.camera')}</div>
                    </div>
                  </label>
                  <label className="cursor-pointer" data-tour="pi-file">
                    <input type="file" accept="image/*,application/pdf" hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0]; if (f) handleFile(f);
                        e.currentTarget.value = '';
                      }} />
                    <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:bg-accent transition">
                      <Upload className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <div className="text-sm font-medium">{t('pi.upload.file')}</div>
                    </div>
                  </label>
                </div>
                {visibleJobs.length > 0 && (
                  <div className="space-y-1.5">
                    {visibleJobs.map(j => (
                      <UploadJobRow
                        key={j.id}
                        job={j}
                        onPreview={j.invoiceId ? () => setVerifyId(j.invoiceId!) : undefined}
                        onDismiss={() => dismissJob(j.id)}
                      />
                    ))}
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

            {/* Recent uploads — last 10 invoices + jump to queue */}
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Recent uploads</CardTitle>
                {canSeeQueue && (
                  <Button size="sm" variant="ghost" onClick={() => setActiveTab('queue')}>
                    View all invoices →
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">No invoices uploaded yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {invoices.slice(0, 10).map(inv => (
                      <button
                        key={inv.id}
                        onClick={() => canSeeQueue ? setVerifyId(inv.id) : null}
                        className="w-full flex items-center justify-between gap-2 p-2 rounded-md border hover:bg-accent/30 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{inv.merchant_name || '—'}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {inv.invoice_date || inv.created_at?.slice(0, 10)} · {inv.invoice_number || '—'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold">
                            {inv.total_amount ? `${Number(inv.total_amount).toLocaleString()} ${inv.currency || ''}` : '—'}
                          </div>
                          <Badge variant={inv.is_verified ? 'default' : inv.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                            {inv.is_verified ? t('pi.status.verified') : t(`pi.status.${inv.status}`)}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
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
                            <div className="font-medium truncate flex items-center gap-1.5">
                              {inv.merchant_name || '—'}
                              {inv.is_credit_note && (
                                <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-700 dark:text-amber-400">CREDIT</Badge>
                              )}
                              {inv.duplicate_status === 'suspected' && (
                                <Badge variant="outline" className="text-[9px] border-destructive/50 text-destructive">DUPLICATE?</Badge>
                              )}
                              {inv.duplicate_status === 'credit_note' && (
                                <Badge variant="outline" className="text-[9px] border-blue-500/50 text-blue-600">MATCHED CREDIT</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {inv.invoice_date || inv.created_at?.slice(0, 10)} · {inv.invoice_number || '—'}
                              {inv.buyer_name && <> · <span className="text-foreground/70">{inv.buyer_name}</span></>}
                            </div>
                            {inv.duplicate_of && (
                              <button
                                className="text-[10px] text-primary hover:underline mt-0.5"
                                onClick={(e) => { e.stopPropagation(); setVerifyId(inv.duplicate_of); }}
                              >
                                View original →
                              </button>
                            )}
                            {inv.status === 'failed' && inv.error_details?.tips?.length > 0 && (
                              <div className="text-[10px] text-destructive mt-0.5 truncate">
                                {inv.error_details.tips[0]}
                              </div>
                            )}
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-1">
                            <div className={`font-semibold tabular-nums ${Number(inv.total_amount) < 0 ? 'text-amber-600' : ''}`}>
                              {inv.total_amount != null ? `${Number(inv.total_amount).toLocaleString()} ${inv.currency || ''}` : '—'}
                            </div>
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              {inv.is_verified ? (
                                <Badge variant="default" className="text-[10px] bg-emerald-600 hover:bg-emerald-600">
                                  {t('pi.status.verified')}
                                </Badge>
                              ) : inv.status === 'failed' ? (
                                <Badge variant="destructive" className="text-[10px]">{t('pi.status.failed')}</Badge>
                              ) : inv.status === 'processing' || inv.status === 'uploaded' ? (
                                <Badge variant="secondary" className="text-[10px]">{t(`pi.status.${inv.status}`)}</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700 dark:text-amber-400">
                                  {t('pi.status.unverified') || 'Unverified'}
                                </Badge>
                              )}
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
                                variant={inv.is_verified ? 'outline' : 'default'}
                                className="h-6 px-2 text-[10px]"
                                onClick={(e) => { e.stopPropagation(); setVerifyId(inv.id); }}
                              >
                                {inv.is_verified ? t('pi.upload.retake') : (t('pi.upload.openReview') || 'Review & verify')}
                              </Button>
                              {canDelete && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  disabled={deletingId === inv.id}
                                  title="Delete invoice"
                                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(inv); }}
                                >
                                  {deletingId === inv.id
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <Trash2 className="h-3 w-3" />}
                                </Button>
                              )}
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

              {/* By Company breakdown — invoices vs credit notes per buyer company */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">By Company</CardTitle>
                  <p className="text-xs text-muted-foreground">Totals per hotel company (buyer), split between standard invoices and credit notes.</p>
                </CardHeader>
                <CardContent>
                  {byCompany(rangedInvoices).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No buyer companies detected yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {byCompany(rangedInvoices).map(c => {
                        const net = c.invoicesTotal + c.creditTotal; // creditTotal is negative
                        const max = Math.max(...byCompany(rangedInvoices).map(x => x.invoicesTotal), 1);
                        return (
                          <div key={c.name} className="rounded-lg border p-3 bg-card">
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate">{c.name}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {c.invoicesCount} invoices · {c.creditCount} credit notes
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-semibold tabular-nums text-sm">{net.toLocaleString()} HUF</div>
                                <div className="text-[10px] text-muted-foreground">net</div>
                              </div>
                            </div>
                            <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                              <div className="h-full bg-primary" style={{ width: `${(c.invoicesTotal / max) * 100}%` }} />
                              <div className="h-full bg-amber-500" style={{ width: `${(Math.abs(c.creditTotal) / max) * 100}%` }} />
                            </div>
                            <div className="flex items-center justify-between text-[11px] mt-1.5">
                              <span className="text-primary tabular-nums">+ {c.invoicesTotal.toLocaleString()}</span>
                              <span className="text-amber-600 tabular-nums">{c.creditTotal.toLocaleString()}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
                  <div data-tour="pi-export-buttons" className="flex gap-2 flex-wrap">
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
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.merchant_name || 'Untitled'} · {deleteTarget?.invoice_number || '—'}
              <br />
              This permanently removes the invoice, its line items, the uploaded file, and excludes it from analytics. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!deletingId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); handleDelete(deleteTarget); }}
            >
              {deletingId ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
function byCompany(invoices: any[]) {
  const map: Record<string, { name: string; invoicesTotal: number; creditTotal: number; invoicesCount: number; creditCount: number }> = {};
  invoices.forEach(i => {
    const name = (i.buyer_name && String(i.buyer_name).trim()) || 'Unassigned';
    if (!map[name]) map[name] = { name, invoicesTotal: 0, creditTotal: 0, invoicesCount: 0, creditCount: 0 };
    const amt = Number(i.total_amount || 0);
    if (i.is_credit_note || amt < 0) {
      map[name].creditTotal += amt; // negative
      map[name].creditCount += 1;
    } else {
      map[name].invoicesTotal += amt;
      map[name].invoicesCount += 1;
    }
  });
  return Object.values(map).sort((a, b) => b.invoicesTotal - a.invoicesTotal);
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

function UploadJobRow({ job, onPreview, onDismiss }: { job: UploadJob; onPreview?: () => void; onDismiss?: () => void }) {
  const { t } = useTranslation();
  const isErr = job.status === 'error';
  const isDone = job.status === 'done';
  const currentIdx = isErr ? STAGES.findIndex(s => s.key === 'extracting')
    : STAGES.findIndex(s => s.key === job.status);

  // Rotating "AI is working" tagline while processing.
  const taglines = [
    t('pi.upload.ai.tagline1') || 'Uploading your invoice…',
    t('pi.upload.ai.tagline2') || 'Digitizing the document…',
    t('pi.upload.ai.tagline3') || 'AI is reading the fields — sit back & relax ☕',
    t('pi.upload.ai.tagline4') || 'Almost there ✨',
  ];
  const [taglineIdx, setTaglineIdx] = useState(0);
  useEffect(() => {
    if (isDone || isErr) return;
    const id = setInterval(() => setTaglineIdx(i => (i + 1) % taglines.length), 2200);
    return () => clearInterval(id);
  }, [isDone, isErr, taglines.length]);

  // Map status to a tagline anchor so it doesn't feel random.
  const statusTagline =
    job.status === 'uploading' ? taglines[0]
    : job.status === 'digitizing' ? taglines[1]
    : job.status === 'extracting' ? taglines[(taglineIdx % 2) + 2] // alternate 3/4
    : taglines[taglineIdx];

  return (
    <div className={`relative overflow-hidden rounded-2xl border p-3 sm:p-4 transition-all animate-fade-in ${
      isErr ? 'bg-destructive/5 border-destructive/40'
      : isDone ? 'bg-emerald-500/5 border-emerald-500/40'
      : 'bg-gradient-to-br from-primary/10 via-card to-purple-500/5 border-primary/30 shadow-lg shadow-primary/5'
    }`}>
      {/* Animated sheen across the card while working */}
      {!isDone && !isErr && (
        <div
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-primary/10 to-transparent"
          style={{ animation: 'pi-sheen 2.8s ease-in-out infinite' }}
        />
      )}
      <style>{`
        @keyframes pi-sheen { 0% { transform: translateX(0) } 100% { transform: translateX(450%) } }
        @keyframes pi-shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
      `}</style>

      <div className="relative flex items-start gap-3">
        {/* Animated AI icon */}
        <div className="relative h-11 w-11 shrink-0">
          {!isDone && !isErr && (
            <>
              <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary via-purple-500 to-pink-500 animate-spin [animation-duration:3s] opacity-80" />
              <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping [animation-duration:1.6s]" />
            </>
          )}
          <div className={`absolute inset-[3px] rounded-full flex items-center justify-center ${
            isErr ? 'bg-destructive/15' : isDone ? 'bg-emerald-500/15' : 'bg-background'
          }`}>
            {isErr ? <AlertCircle className="h-5 w-5 text-destructive" />
              : isDone ? <CheckCircle className="h-5 w-5 text-emerald-600" />
              : (
                <span className="relative">
                  <span className="absolute -inset-1 rounded-full bg-primary/30 blur-md animate-pulse" />
                  <span className="relative text-base">✨</span>
                </span>
              )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold truncate">{job.name}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">{Math.round(job.progress)}%</div>
          </div>

          {/* Rotating tagline */}
          <div
            key={statusTagline}
            className={`text-[12px] mt-0.5 animate-fade-in ${
              isErr ? 'text-destructive'
              : isDone ? 'text-emerald-700 dark:text-emerald-400 font-medium'
              : 'text-foreground/80'
            }`}
          >
            {isErr ? (job.error || 'Failed') : isDone ? (t('pi.upload.ai.ready') || 'Ready to review') : statusTagline}
          </div>

          {/* Progress bar with shimmer */}
          <div className="mt-2.5 h-2 w-full rounded-full bg-muted/70 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                isErr ? 'bg-destructive'
                : isDone ? 'bg-emerald-500'
                : 'bg-gradient-to-r from-primary via-purple-500 to-primary'
              }`}
              style={{
                width: `${job.progress}%`,
                backgroundSize: '200% 100%',
                animation: !isDone && !isErr ? 'pi-shimmer 2s linear infinite' : undefined,
              }}
            />
          </div>

          {/* Step pills */}
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {STAGES.map((s, i) => {
              const done = i < currentIdx || isDone;
              const active = i === currentIdx && !isDone && !isErr;
              const errored = isErr && i >= currentIdx;
              return (
                <div
                  key={s.key}
                  className={`relative flex items-center justify-center gap-1 px-1.5 py-1 rounded-full text-[10px] font-medium border transition-all ${
                    errored ? 'bg-destructive/10 border-destructive/40 text-destructive'
                    : done ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                    : active ? 'bg-primary/10 border-primary/50 text-primary'
                    : 'bg-muted/50 border-border text-muted-foreground/70'
                  }`}
                >
                  {done && !errored ? (
                    <CheckCircle className="h-3 w-3 shrink-0 animate-scale-in" />
                  ) : active ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${errored ? 'bg-destructive' : 'bg-muted-foreground/40'}`} />
                  )}
                  <span className="truncate">{s.label}</span>
                </div>
              );
            })}
          </div>

          {(isErr || isDone || onPreview) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isErr && (
                <div className="text-[11px] text-destructive flex-1 min-w-0">
                  {job.errorCode === 'ERR_NOT_INVOICE'
                    ? 'We could not detect invoice fields. Open the document to review and fill in details manually.'
                    : job.errorCode === 'processor_unavailable'
                    ? 'OCR service is temporarily unavailable. Open to edit manually or try again.'
                    : 'Processing failed. Open to review the document and edit details.'}
                </div>
              )}
              {onPreview && (
                <Button size="sm" variant={isDone || isErr ? 'default' : 'outline'} className="h-7 text-xs" onClick={onPreview}>
                  <Eye className="h-3 w-3 mr-1" />{t('pi.upload.openReview') || 'Review & verify'}
                </Button>
              )}
              {onDismiss && (isErr || isDone) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDismiss}>
                  Dismiss
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


