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
import { toast } from 'sonner';
import {
  Camera, Upload, Receipt, BarChart3, Download, Loader2, ShieldAlert,
  CheckCircle, AlertCircle, FileText,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import { useFirstRunTour, TourReplayButton, type TourStep } from '@/components/training/GuidedTour';
import { VerifyInvoiceDialog } from '@/components/purchase-invoices/VerifyInvoiceDialog';

const ALLOWED_ROLES = ['admin','top_management','control_finance','back_office','reception','front_office'];
const ANALYTICS_ROLES = ['admin','top_management','control_finance'];
const QUEUE_ROLES = ['admin','top_management','control_finance','back_office'];

const PI_TOUR: TourStep[] = [
  { titleKey: 'tour.pi.welcome.title', bodyKey: 'tour.pi.welcome.body' },
  { selector: '[data-tour="pi-upload"]', titleKey: 'tour.pi.upload.title', bodyKey: 'tour.pi.upload.body' },
  { selector: '[data-tour="pi-queue"]', titleKey: 'tour.pi.queue.title', bodyKey: 'tour.pi.queue.body' },
  { selector: '[data-tour="pi-analytics"]', titleKey: 'tour.pi.analytics.title', bodyKey: 'tour.pi.analytics.body' },
];

const VAT_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'];

export default function PurchaseInvoices() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [verifyId, setVerifyId] = useState<string | null>(null);

  const canAccess = profile && ALLOWED_ROLES.includes(profile.role);
  const canSeeAnalytics = profile && ANALYTICS_ROLES.includes(profile.role);
  const canSeeQueue = profile && QUEUE_ROLES.includes(profile.role);

  useFirstRunTour('purchase_invoices_v1', PI_TOUR);

  const reload = async () => {
    const { data } = await supabase
      .from('purchase_invoices')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    setInvoices(data || []);
  };

  useEffect(() => { if (canAccess) reload(); }, [canAccess]);

  const handleFile = async (file: File) => {
    if (!user || !profile?.organization_slug) return;
    setUploading(true);
    try {
      const id = crypto.randomUUID();
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${profile.organization_slug}/${profile.assigned_hotel || 'unassigned'}/${id}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('purchase-invoices').upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from('purchase_invoices').insert({
        id,
        organization_slug: profile.organization_slug,
        hotel_id: profile.assigned_hotel,
        uploaded_by: user.id,
        file_path: path,
        file_mime: file.type,
        file_size_bytes: file.size,
        status: 'uploaded',
      });
      if (insErr) throw insErr;

      toast.loading(t('pi.upload.processing'), { id });
      const { data, error } = await supabase.functions.invoke('process-purchase-invoice', {
        body: { invoiceId: id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.success === false && data?.error_code) {
        toast.error(t(`pi.error.${data.error_code}`), { id });
      } else {
        toast.success(t('pi.upload.success'), { id });
      }
      await reload();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('pi.upload.failed'));
    } finally {
      setUploading(false);
    }
  };

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return invoices;
    return invoices.filter(i =>
      (i.merchant_name || '').toLowerCase().includes(s) ||
      (i.invoice_number || '').toLowerCase().includes(s)
    );
  }, [invoices, search]);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const tm = invoices.filter(i => i.invoice_date && new Date(i.invoice_date) >= thisMonth);
    const lm = invoices.filter(i => i.invoice_date && new Date(i.invoice_date) >= lastMonth && new Date(i.invoice_date) <= lastMonthEnd);
    const sum = (a: any[]) => a.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const merchantTotals: Record<string, number> = {};
    tm.forEach(i => {
      const m = i.merchant_name || 'Unknown';
      merchantTotals[m] = (merchantTotals[m] || 0) + Number(i.total_amount || 0);
    });
    const top = Object.entries(merchantTotals).sort(([,a],[,b]) => b - a)[0]?.[0] || '—';
    const unverified = invoices.filter(i => i.status === 'processed' && !i.is_verified).length;
    return { tm: sum(tm), lm: sum(lm), tmCount: tm.length, top, unverified };
  }, [invoices]);

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
          <TourReplayButton tourKey="purchase_invoices_v1" steps={PI_TOUR} />
        </div>

        <Tabs defaultValue="upload" className="space-y-4">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="upload" data-tour="pi-upload">
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
              <TabsTrigger value="export">
                <Download className="h-4 w-4 mr-1.5" />{t('pi.tab.export')}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="upload">
            <Card>
              <CardHeader><CardTitle className="text-base">{t('pi.upload.heading')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('pi.upload.dropHint')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" capture="environment" hidden
                      disabled={uploading}
                      onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                    <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:bg-accent transition">
                      <Camera className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <div className="text-sm font-medium">{t('pi.upload.camera')}</div>
                    </div>
                  </label>
                  <label className="cursor-pointer">
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground pt-2 border-t">
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
                <CardHeader className="pb-2">
                  <Input placeholder={t('pi.queue.search')} value={search}
                    onChange={(e) => setSearch(e.target.value)} />
                </CardHeader>
                <CardContent>
                  {filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">{t('pi.queue.empty')}</p>
                  ) : (
                    <div className="space-y-2">
                      {filtered.map(inv => (
                        <div key={inv.id} className="flex items-center justify-between gap-2 p-3 border rounded-lg hover:bg-accent/30">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{inv.merchant_name || '—'}</div>
                            <div className="text-xs text-muted-foreground">
                              {inv.invoice_date || inv.created_at?.slice(0, 10)} · {inv.invoice_number || '—'}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-semibold">
                              {inv.total_amount ? `${Number(inv.total_amount).toLocaleString()} ${inv.currency}` : '—'}
                            </div>
                            <Badge variant={inv.is_verified ? 'default' : inv.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                              {inv.is_verified ? t('pi.status.verified') : t(`pi.status.${inv.status}`)}
                            </Badge>
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
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card><CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{t('pi.analytics.thisMonth')}</div>
                  <div className="text-xl font-bold">{stats.tm.toLocaleString()} HUF</div>
                  <div className="text-xs text-muted-foreground">{stats.tmCount} invoices</div>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{t('pi.analytics.lastMonth')}</div>
                  <div className="text-xl font-bold">{stats.lm.toLocaleString()} HUF</div>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{t('pi.analytics.topMerchant')}</div>
                  <div className="text-sm font-semibold truncate">{stats.top}</div>
                </CardContent></Card>
                <Card><CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{t('pi.analytics.unverified')}</div>
                    <div className="text-xl font-bold">{stats.unverified}</div>
                  </div>
                  {stats.unverified > 0
                    ? <AlertCircle className="h-6 w-6 text-orange-500/60" />
                    : <CheckCircle className="h-6 w-6 text-green-500/60" />}
                </CardContent></Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">{t('pi.analytics.dailyTrend')}</CardTitle></CardHeader>
                <CardContent style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={dailySeries(invoices)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Bar dataKey="amount" fill="hsl(var(--primary))" />
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
                        <Pie data={byCategory(invoices)} dataKey="value" nameKey="name" outerRadius={80} label>
                          {byCategory(invoices).map((_, i) => <Cell key={i} fill={VAT_COLORS[i % VAT_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">{t('pi.analytics.byVat')}</CardTitle></CardHeader>
                  <CardContent style={{ height: 260 }}>
                    <ResponsiveContainer>
                      <LineChart data={dailySeries(invoices)}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" fontSize={11} />
                        <YAxis fontSize={11} />
                        <Tooltip />
                        <Line type="monotone" dataKey="vat" stroke="hsl(var(--primary))" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          )}

          {canSeeAnalytics && (
            <TabsContent value="export">
              <Card>
                <CardContent className="p-6 flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={() => exportCsv(invoices)}>
                    <Download className="h-4 w-4 mr-2" />{t('pi.export.csv')}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
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
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
}
function byCategory(invoices: any[]) {
  const map: Record<string, number> = {};
  invoices.forEach(i => {
    const k = i.expense_category || 'other';
    map[k] = (map[k] || 0) + Number(i.total_amount || 0);
  });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}
function exportCsv(invoices: any[]) {
  const headers = ['invoice_date','merchant_name','invoice_number','currency','net_amount','total_vat_amount','total_amount','expense_category','status'];
  const rows = invoices.map(i => headers.map(h => JSON.stringify(i[h] ?? '')).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `purchase-invoices-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}
