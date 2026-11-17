/* eslint-disable @typescript-eslint/no-explicit-any -- the NAV/reconciliation tables are not in the generated Supabase types yet */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { invokeFn, mapImportColumns, readSpreadsheet } from '@/lib/purchaseInvoiceNav';

const CURRENCIES = ['HUF', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', 'PLN', 'RON'];

/** Optional import of an existing purchase-invoice register (server validates and de-duplicates). */
export function HistoricalImportPanel() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const org = profile?.organization_slug ?? '';
  const [companies, setCompanies] = useState<any[]>([]);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState('none');
  const [company, setCompany] = useState('none');
  const [preview, setPreview] = useState<{ counts: Record<string, number>; rows: Array<{ row: number; status: string; errors: string[] }> } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);

  useEffect(() => {
    if (!org) return;
    (supabase as any).from('invoice_buyer_companies').select('id, name, legal_name, tax_id').eq('organization_slug', org).eq('is_active', true).order('name')
      .then(({ data }: any) => setCompanies(data ?? []));
  }, [org]);

  const onFile = async (file: File) => {
    try {
      const raw = await readSpreadsheet(file);
      const { mapping: m, mapped } = mapImportColumns(raw);
      setFileName(file.name);
      setRows(mapped);
      setMapping(m);
      setPreview(null);
    } catch (e: any) {
      toast.error(e?.message || 'The file could not be read');
    }
  };

  const call = async (action: 'preview' | 'import') => {
    setBusy(action);
    try {
      const body = {
        action, rows,
        ...(currency !== 'none' ? { default_currency: currency } : {}),
        ...(company !== 'none' ? { company_id: company } : {}),
      };
      const result = await invokeFn<any>('pi-history-import', body);
      if (action === 'preview') setPreview(result);
      else {
        toast.success(t('pi.import.result').replace('{n}', String(result.inserted ?? 0)));
        setPreview(null);
        setRows([]);
        setFileName('');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-primary" />{t('pi.import.heading')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('pi.import.hint')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="inline-flex items-center gap-2 cursor-pointer rounded-md border border-dashed px-3 py-2 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" />{fileName || t('pi.import.file')}
          <input type="file" hidden accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
        </label>
        {rows.length > 0 && (
          <>
            <div className="text-xs">
              <span className="font-medium">{t('pi.import.columns')}:</span>{' '}
              {Object.keys(mapping).length ? Object.entries(mapping).map(([field, header]) => (
                <Badge key={field} variant="outline" className="mr-1 mb-1 text-[10px]">{field} ← {header}</Badge>
              )) : t('pi.import.none')}
              <span className="text-muted-foreground"> · {rows.length} rows</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('pi.import.defaultCurrency')}</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('pi.import.company')}</Label>
                <Select value={company} onValueChange={setCompany}>
                  <SelectTrigger className="h-8 w-[260px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_name || c.name}{c.tax_id ? ` · ${c.tax_id}` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call('preview')}>
                {busy === 'preview' && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}{t('pi.import.preview')}
              </Button>
              <Button size="sm" disabled={!!busy || !preview || !(preview.counts.ok > 0)} onClick={() => call('import')}>
                {busy === 'import' && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}{t('pi.import.run')} {preview?.counts.ok ? `(${preview.counts.ok})` : ''}
              </Button>
            </div>
          </>
        )}
        {preview && (
          <div className="space-y-2">
            <div className="text-xs font-medium">{t('pi.import.counts')}</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(preview.counts).map(([k, v]) => <Badge key={k} variant={k === 'error' ? 'destructive' : 'outline'} className="text-[10px]">{k}: {v}</Badge>)}
            </div>
            {preview.rows.length > 0 && (
              <div className="max-h-56 overflow-y-auto text-[11px] space-y-0.5 border rounded-md p-2">
                {preview.rows.map((r) => (
                  <div key={r.row}><span className="font-mono">#{r.row}</span> {r.status}{r.errors.length ? ` — ${r.errors.join('; ')}` : ''}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
