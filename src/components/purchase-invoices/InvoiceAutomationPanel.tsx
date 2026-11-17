import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BrainCircuit, Database, Loader2, Save, Upload, CheckCircle2,
  AlertTriangle, ShieldCheck, FileSpreadsheet, RefreshCw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type Settings = {
  organization_slug: string;
  amount_verifier_enabled: boolean;
  amount_auto_accept_confidence: number;
  require_amount_balance: boolean;
  duplicate_detection_enabled: boolean;
  nav_reconciliation_enabled: boolean;
  nav_auto_match_threshold: number;
  nav_amount_tolerance_huf: number;
  nav_date_tolerance_days: number;
  block_approval_on_nav_conflict: boolean;
  block_approval_on_amount_conflict: boolean;
};

type NormalizedNavRecord = {
  source_id?: string | null;
  buyer_tax_id?: string | null;
  supplier_tax_id?: string | null;
  supplier_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  performance_date?: string | null;
  due_date?: string | null;
  currency?: string | null;
  net_amount?: number | null;
  vat_amount?: number | null;
  total_amount?: number | null;
  invoice_operation?: string | null;
  raw_payload?: any;
};

const defaults = (org: string): Settings => ({
  organization_slug: org,
  amount_verifier_enabled: true,
  amount_auto_accept_confidence: 0.94,
  require_amount_balance: true,
  duplicate_detection_enabled: true,
  nav_reconciliation_enabled: false,
  nav_auto_match_threshold: 0.97,
  nav_amount_tolerance_huf: 2,
  nav_date_tolerance_days: 2,
  block_approval_on_nav_conflict: true,
  block_approval_on_amount_conflict: true,
});

function key(s: unknown) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pick(row: Record<string, any>, aliases: string[]) {
  const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [key(k), v]));
  for (const alias of aliases) {
    const value = normalized[key(alias)];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim().replace(/\u00a0/g, '').replace(/\s/g, '');
  // Hungarian exports commonly use 1 234,56 while API/JSON exports use 1234.56.
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function normalizeRow(row: Record<string, any>): NormalizedNavRecord {
  const totalHuf = pick(row, ['invoiceGrossAmountHUF', 'grossAmountHUF', 'totalAmountHUF', 'bruttoHuf']);
  const vatHuf = pick(row, ['invoiceVatAmountHUF', 'vatAmountHUF', 'afaHuf']);
  const netHuf = pick(row, ['invoiceNetAmountHUF', 'netAmountHUF', 'nettoHuf']);
  const total = totalHuf ?? pick(row, ['invoiceGrossAmount', 'grossAmount', 'totalAmount', 'invoiceAmount', 'brutto', 'gross']);
  const vat = vatHuf ?? pick(row, ['invoiceVatAmount', 'vatAmount', 'afa', 'taxAmount']);
  const net = netHuf ?? pick(row, ['invoiceNetAmount', 'netAmount', 'netto', 'taxBase']);
  return {
    source_id: pick(row, ['sourceId', 'transactionId', 'index', 'id']) ? String(pick(row, ['sourceId', 'transactionId', 'index', 'id'])) : null,
    buyer_tax_id: pick(row, ['customerTaxNumber', 'buyerTaxNumber', 'buyerTaxId', 'customerTaxId', 'customerTaxpayerId']),
    supplier_tax_id: pick(row, ['supplierTaxNumber', 'supplierTaxId', 'supplierTaxpayerId', 'sellerTaxNumber', 'vendorTaxId']),
    supplier_name: pick(row, ['supplierName', 'sellerName', 'vendorName', 'merchantName']),
    invoice_number: pick(row, ['invoiceNumber', 'invoiceNo', 'szamlaszam', 'documentNumber']),
    invoice_date: normalizeDate(pick(row, ['invoiceIssueDate', 'invoiceDate', 'issueDate', 'kiallitasDatuma'])),
    performance_date: normalizeDate(pick(row, ['invoiceDeliveryDate', 'performanceDate', 'deliveryDate', 'teljesitesDatuma'])),
    due_date: normalizeDate(pick(row, ['paymentDate', 'dueDate', 'fizetesiHatarido'])),
    currency: String(pick(row, ['currency', 'currencyCode', 'penznem']) || (totalHuf != null ? 'HUF' : 'HUF')).toUpperCase(),
    net_amount: num(net),
    vat_amount: num(vat),
    total_amount: num(total),
    invoice_operation: pick(row, ['invoiceOperation', 'operation', 'invoiceCategory']),
    raw_payload: row,
  };
}

function parseDelimited(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = ([';', '\t', ','] as const)
    .map(d => ({ d, n: (lines[0].match(new RegExp(d === '\t' ? '\\t' : `\\${d}`, 'g')) || []).length }))
    .sort((a, b) => b.n - a.n)[0]?.d || ';';

  const parseLine = (line: string) => {
    const out: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === delimiter && !quoted) {
        out.push(current.trim()); current = '';
      } else current += ch;
    }
    out.push(current.trim());
    return out;
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}

function xmlElementToObject(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const child of Array.from(el.children)) {
    if (child.children.length === 0) out[child.localName || child.tagName] = child.textContent?.trim() || '';
    else Object.assign(out, xmlElementToObject(child));
  }
  return out;
}

async function parseNavFile(file: File): Promise<NormalizedNavRecord[]> {
  const text = await file.text();
  const lower = file.name.toLowerCase();
  let rows: Record<string, any>[] = [];

  if (lower.endsWith('.json') || file.type.includes('json')) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed?.invoices || parsed?.records || parsed?.data || [];
    if (!Array.isArray(list)) throw new Error('The JSON file does not contain an invoice array.');
    rows = list;
  } else if (lower.endsWith('.xml') || file.type.includes('xml') || text.trim().startsWith('<')) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('The XML file could not be parsed.');
    const candidates = Array.from(doc.querySelectorAll('invoiceDigest, InvoiceDigest, invoice, Invoice'));
    rows = candidates.map(xmlElementToObject);
  } else {
    rows = parseDelimited(text);
  }

  const normalized = rows.map(normalizeRow).filter(r => r.invoice_number || r.supplier_tax_id || r.total_amount != null);
  if (!normalized.length) throw new Error('No recognizable NAV invoice rows were found. Check the export columns.');
  return normalized;
}

export function InvoiceAutomationPanel() {
  const { profile } = useAuth();
  const org = profile?.organization_slug ?? '';
  const db = supabase as any;
  const [settings, setSettings] = useState<Settings>(defaults(org));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runs, setRuns] = useState<any[]>([]);
  const [records, setRecords] = useState<NormalizedNavRecord[]>([]);
  const [fileName, setFileName] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [completePeriod, setCompletePeriod] = useState(false);
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');

  const load = async () => {
    if (!org) return;
    setLoading(true);
    const [{ data: s }, { data: r }] = await Promise.all([
      db.from('invoice_automation_settings').select('*').eq('organization_slug', org).maybeSingle(),
      db.from('purchase_invoice_reconciliation_runs').select('*').eq('organization_slug', org).order('started_at', { ascending: false }).limit(10),
    ]);
    setSettings({ ...defaults(org), ...(s || {}), organization_slug: org });
    setRuns(r || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [org]);

  const save = async () => {
    if (!org) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await db.from('invoice_automation_settings').upsert({
        ...settings,
        organization_slug: org,
        updated_by: auth?.user?.id ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_slug' });
      if (error) throw error;
      toast.success('Invoice automation settings saved');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save settings');
    } finally { setSaving(false); }
  };

  const onNavFile = async (file: File) => {
    setResult(null);
    try {
      const parsed = await parseNavFile(file);
      setRecords(parsed);
      setFileName(file.name);
      const dates = parsed.map(x => x.invoice_date).filter(Boolean).sort() as string[];
      if (dates.length) {
        setPeriodFrom(dates[0]);
        setPeriodTo(dates[dates.length - 1]);
      }
      toast.success(`${parsed.length} NAV invoice rows recognized`);
    } catch (e: any) {
      setRecords([]); setFileName('');
      toast.error(e?.message || 'Could not read NAV export');
    }
  };

  const reconcile = async () => {
    if (!records.length) return;
    if (completePeriod && (!periodFrom || !periodTo)) return toast.error('Choose the complete NAV period.');
    setReconciling(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('reconcile-purchase-invoices-nav', {
        body: {
          records,
          source: `nav_export:${fileName || 'manual'}`,
          ...(completePeriod ? { completePeriod: { from: periodFrom, to: periodTo } } : {}),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Reconciliation failed');
      setResult(data);
      toast.success(`NAV reconciliation complete: ${data.summary?.exact_matches || 0} exact matches`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'NAV reconciliation failed');
    } finally { setReconciling(false); }
  };

  const preview = useMemo(() => records.slice(0, 5), [records]);

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <Tabs defaultValue="ai" className="space-y-4">
      <TabsList className="flex flex-wrap">
        <TabsTrigger value="ai"><BrainCircuit className="h-4 w-4 mr-1.5" />AI controls</TabsTrigger>
        <TabsTrigger value="nav"><Database className="h-4 w-4 mr-1.5" />NAV reconciliation</TabsTrigger>
      </TabsList>

      <TabsContent value="ai" className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><BrainCircuit className="h-4 w-4 text-primary" />Invoice Intelligence controls</CardTitle>
            <p className="text-xs text-muted-foreground">The OCR model extracts; deterministic money controls decide whether the result is safe enough to move forward.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <SettingToggle label="Independent amount verifier" hint="Run a second focused document read only when the first amount is ambiguous or fails arithmetic." checked={settings.amount_verifier_enabled} onChange={v => setSettings(s => ({ ...s, amount_verifier_enabled: v }))} />
            <SettingToggle label="Require gross = net + VAT" hint="Blocks approval when the extracted accounting total cannot be reconciled within currency tolerance." checked={settings.require_amount_balance} onChange={v => setSettings(s => ({ ...s, require_amount_balance: v }))} />
            <SettingToggle label="Block unsafe amount approvals" hint="Controllers cannot approve a v3 OCR invoice until its amount passes the configured financial controls." checked={settings.block_approval_on_amount_conflict} onChange={v => setSettings(s => ({ ...s, block_approval_on_amount_conflict: v }))} />
            <SettingToggle label="Duplicate controls" hint="Exact file hash plus supplier tax ID + invoice number checks remain active before approval." checked={settings.duplicate_detection_enabled} onChange={v => setSettings(s => ({ ...s, duplicate_detection_enabled: v }))} />
            <div className="grid sm:grid-cols-2 gap-3 border-t pt-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Safe amount confidence</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" min="80" max="100" step="1" value={Math.round(settings.amount_auto_accept_confidence * 100)}
                    onChange={e => setSettings(s => ({ ...s, amount_auto_accept_confidence: Math.max(.8, Math.min(1, Number(e.target.value || 94) / 100)) }))} />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-[10px] text-muted-foreground">Recommended: 94–97% for finance.</p>
              </div>
              <div className="rounded-md border p-3 bg-muted/20 text-xs space-y-1.5">
                <div className="font-medium flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" />Control sequence</div>
                <div>1. OCR extracts all visible totals</div><div>2. Arithmetic ranks the correct gross/payable value</div><div>3. Second pass checks ambiguous totals</div><div>4. Duplicate + NAV controls gate approval</div>
              </div>
            </div>
            <Button onClick={save} disabled={saving}><Save className="h-4 w-4 mr-1.5" />{saving ? 'Saving…' : 'Save controls'}</Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="nav" className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4 text-primary" />NAV reconciliation</CardTitle>
            <p className="text-xs text-muted-foreground">Import a NAV invoice export and HotelCare matches it automatically using tax ID, invoice number, amount, VAT and date — no spreadsheet VLOOKUP work.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <SettingToggle label="Enable NAV control" hint="Show NAV match state in the invoice workflow." checked={settings.nav_reconciliation_enabled} onChange={v => setSettings(s => ({ ...s, nav_reconciliation_enabled: v }))} />
              <SettingToggle label="Block NAV conflicts" hint="Prevent approval when a complete NAV reconciliation shows a conflict or missing NAV record." checked={settings.block_approval_on_nav_conflict} onChange={v => setSettings(s => ({ ...s, block_approval_on_nav_conflict: v }))} />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <NumberSetting label="Auto-match confidence %" value={Math.round(settings.nav_auto_match_threshold * 100)} min={80} max={100} onChange={v => setSettings(s => ({ ...s, nav_auto_match_threshold: v / 100 }))} />
              <NumberSetting label="Amount tolerance (HUF)" value={settings.nav_amount_tolerance_huf} min={0} max={1000} onChange={v => setSettings(s => ({ ...s, nav_amount_tolerance_huf: v }))} />
              <NumberSetting label="Date tolerance (days)" value={settings.nav_date_tolerance_days} min={0} max={30} onChange={v => setSettings(s => ({ ...s, nav_date_tolerance_days: v }))} />
            </div>
            <Button variant="outline" onClick={save} disabled={saving}><Save className="h-4 w-4 mr-1.5" />Save NAV controls</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-primary" />Reconcile a NAV export</CardTitle>
            <p className="text-xs text-muted-foreground">CSV, JSON and XML are accepted. The original row is retained in the reconciliation audit data.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block cursor-pointer rounded-xl border-2 border-dashed p-5 text-center hover:bg-accent/40 transition">
              <input type="file" hidden accept=".csv,.json,.xml,text/csv,application/json,text/xml,application/xml"
                onChange={e => { const f = e.target.files?.[0]; if (f) onNavFile(f); e.currentTarget.value = ''; }} />
              <Upload className="h-7 w-7 mx-auto text-primary mb-1" />
              <div className="text-sm font-medium">Choose NAV export</div>
              <div className="text-[11px] text-muted-foreground">CSV · JSON · XML</div>
            </label>

            {records.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm"><strong>{fileName}</strong> · {records.length.toLocaleString()} records</div>
                  <Badge variant="outline" className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3 mr-1" />Parsed</Badge>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50"><tr><th className="text-left p-2">Supplier</th><th className="text-left p-2">Invoice</th><th className="text-left p-2">Date</th><th className="text-right p-2">Gross</th></tr></thead>
                    <tbody>{preview.map((r, i) => <tr key={i} className="border-t"><td className="p-2 max-w-[220px] truncate">{r.supplier_name || r.supplier_tax_id || '—'}</td><td className="p-2">{r.invoice_number || '—'}</td><td className="p-2">{r.invoice_date || '—'}</td><td className="p-2 text-right tabular-nums">{r.total_amount?.toLocaleString() ?? '—'} {r.currency}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div><Label className="text-sm">This export is complete for a period</Label><p className="text-[10px] text-muted-foreground">Enable only when the NAV file contains every purchase invoice for the period. Then HotelCare can safely identify “missing in NAV”.</p></div>
                    <Switch checked={completePeriod} onCheckedChange={setCompletePeriod} />
                  </div>
                  {completePeriod && <div className="grid grid-cols-2 gap-2"><Input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} /><Input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} /></div>}
                </div>
                <Button onClick={reconcile} disabled={reconciling || !settings.nav_reconciliation_enabled}>
                  {reconciling ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                  {reconciling ? 'Reconciling…' : `Reconcile ${records.length.toLocaleString()} records`}
                </Button>
                {!settings.nav_reconciliation_enabled && <p className="text-[10px] text-amber-700 dark:text-amber-400">Enable NAV control and save settings before running reconciliation.</p>}
              </div>
            )}

            {result?.summary && <ReconciliationResult summary={result.summary} exceptions={result.exceptions || []} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent reconciliation runs</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {runs.length === 0 ? <p className="text-sm text-muted-foreground py-3">No NAV reconciliation runs yet.</p> : runs.map(run => (
              <div key={run.id} className="rounded-md border p-2.5 flex items-center justify-between gap-2">
                <div><div className="text-sm font-medium">{new Date(run.started_at).toLocaleString()}</div><div className="text-[10px] text-muted-foreground">{run.records_received} NAV records · source {run.source}</div></div>
                <div className="text-right text-[11px]"><div className="text-emerald-700 dark:text-emerald-400">{run.exact_matches} exact</div><div className="text-muted-foreground">{run.conflicts} conflicts · {run.missing_in_hotelcare} missing</div></div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="rounded-md border bg-muted/20 p-3 text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Direct NAV API next:</strong> the matching engine is already separated from data acquisition. A NAV Online Számla technical user can therefore feed the same reconciliation engine automatically. Credentials and signature keys must live only in Supabase Edge Function secrets — never in this browser UI.
        </div>
      </TabsContent>
    </Tabs>
  );
}

function SettingToggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="flex items-start justify-between gap-3 rounded-md border p-3"><div><div className="text-sm font-medium">{label}</div><div className="text-[10px] text-muted-foreground max-w-2xl">{hint}</div></div><Switch checked={checked} onCheckedChange={onChange} /></div>;
}

function NumberSetting({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label><Input type="number" value={value} min={min} max={max} onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value || 0))))} /></div>;
}

function ReconciliationResult({ summary, exceptions }: { summary: any; exceptions: any[] }) {
  return <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
    <div className="font-medium text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />Reconciliation result</div>
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <ResultMetric label="Exact" value={summary.exact_matches} good />
      <ResultMetric label="Probable" value={summary.probable_matches} />
      <ResultMetric label="Conflicts" value={summary.conflicts} bad />
      <ResultMetric label="Missing in HotelCare" value={summary.missing_in_hotelcare} bad />
      <ResultMetric label="Missing in NAV" value={summary.missing_in_nav} bad />
    </div>
    {exceptions.length > 0 && <div className="space-y-1 max-h-48 overflow-y-auto border-t pt-2">{exceptions.slice(0, 30).map((x, i) => <div key={i} className="text-[11px] flex items-center gap-2"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" /><span className="font-medium truncate max-w-[180px]">{x.supplier_name || x.supplier_tax_id || 'Unknown'}</span><span>{x.invoice_number || '—'}</span><Badge variant="outline" className="text-[9px] ml-auto">{String(x.status).replaceAll('_', ' ')}</Badge></div>)}</div>}
  </div>;
}

function ResultMetric({ label, value, good, bad }: { label: string; value: number; good?: boolean; bad?: boolean }) {
  return <div className="rounded-md border bg-background p-2"><div className="text-[10px] text-muted-foreground">{label}</div><div className={`text-lg font-bold ${good ? 'text-emerald-600' : bad && value > 0 ? 'text-destructive' : ''}`}>{Number(value || 0).toLocaleString()}</div></div>;
}
