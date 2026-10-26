import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, BrainCircuit, CheckCircle2, Clock, Database, DollarSign,
  Receipt, ShieldCheck, TrendingUp,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Props = {
  invoices: any[];
  allInvoices: any[];
  organizationSlug: string;
  onOpenInvoice: (id: string) => void;
};

type ExceptionRow = {
  id: string;
  severity: 1 | 2 | 3;
  title: string;
  reason: string;
  merchant: string;
  invoiceNumber: string;
  value: number;
  currency: string;
};

const fmt = (value: number, digits = 0) => Number(value || 0).toLocaleString(undefined, {
  maximumFractionDigits: digits,
  minimumFractionDigits: digits,
});

const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 100) : 0;

function median(values: number[]) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function daysBetween(from: any, to: any) {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, (b - a) / 864e5);
}

function isAmountBalanced(inv: any) {
  if (inv?.amount_balance_delta == null) return null;
  const total = Math.abs(Number(inv.total_amount || 0));
  const currency = String(inv.currency || 'HUF').toUpperCase();
  const tolerance = currency === 'HUF' ? Math.max(2, total * 0.0002) : Math.max(0.03, total * 0.0002);
  return Math.abs(Number(inv.amount_balance_delta)) <= tolerance;
}

function severityClass(severity: 1 | 2 | 3) {
  if (severity === 3) return 'border-destructive/40 bg-destructive/5';
  if (severity === 2) return 'border-amber-500/40 bg-amber-500/5';
  return 'border-border bg-background';
}

export function InvoiceIntelligenceAnalytics({ invoices, allInvoices, organizationSlug, onOpenInvoice }: Props) {
  const db = supabase as any;
  const [navRecords, setNavRecords] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [vatLines, setVatLines] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null);

  useEffect(() => {
    if (!organizationSlug) return;
    let cancelled = false;
    (async () => {
      const [{ data: nav }, { data: reconRuns }, { data: automation }] = await Promise.all([
        db.from('purchase_invoice_nav_records').select('id, matched_invoice_id, match_status, match_score, total_amount, vat_amount, currency, supplier_name, invoice_number, invoice_date').eq('organization_slug', organizationSlug).order('imported_at', { ascending: false }).limit(5000),
        db.from('purchase_invoice_reconciliation_runs').select('*').eq('organization_slug', organizationSlug).order('started_at', { ascending: false }).limit(20),
        db.from('invoice_automation_settings').select('*').eq('organization_slug', organizationSlug).maybeSingle(),
      ]);
      if (cancelled) return;
      setNavRecords(nav || []);
      setRuns(reconRuns || []);
      setSettings(automation || null);
    })();
    return () => { cancelled = true; };
  }, [organizationSlug]);

  useEffect(() => {
    let cancelled = false;
    const ids = invoices.map(i => i.id).filter(Boolean).slice(0, 5000);
    if (!ids.length) { setVatLines([]); return; }
    (async () => {
      const rows: any[] = [];
      for (let i = 0; i < ids.length; i += 400) {
        const { data } = await db
          .from('purchase_invoice_vat_lines')
          .select('invoice_id, vat_kind, vat_rate, vat_base, vat_amount')
          .in('invoice_id', ids.slice(i, i + 400));
        if (data) rows.push(...data);
      }
      if (!cancelled) setVatLines(rows);
    })();
    return () => { cancelled = true; };
  }, [invoices]);

  const intelligence = useMemo(() => {
    const usable = invoices.filter(i => i.status !== 'failed' && i.status !== 'uploaded' && i.status !== 'processing');
    const v3 = usable.filter(i => String(i.ocr_version || '').includes('invoice-intelligence-v3'));
    const threshold = Number(settings?.amount_auto_accept_confidence ?? 0.94);
    const navEnabled = settings?.nav_reconciliation_enabled === true;

    const amountConfidenceRows = v3.filter(i => i.amount_confidence != null);
    const avgAmountConfidence = amountConfidenceRows.length
      ? amountConfidenceRows.reduce((s, i) => s + Number(i.amount_confidence), 0) / amountConfidenceRows.length
      : 0;
    const lowConfidence = v3.filter(i => i.amount_confidence == null || Number(i.amount_confidence) < threshold);
    const balanceConflicts = v3.filter(i => isAmountBalanced(i) === false);
    const secondPass = v3.filter(i => !!i.amount_verification?.verifier);
    const corrected = v3.filter(i => {
      if (i.source_total_amount == null || i.total_amount == null) return false;
      const total = Math.abs(Number(i.total_amount));
      const currency = String(i.currency || 'HUF').toUpperCase();
      const tolerance = currency === 'HUF' ? Math.max(2, total * 0.0002) : Math.max(0.03, total * 0.0002);
      return Math.abs(Number(i.source_total_amount) - Number(i.total_amount)) > tolerance;
    });
    const correctedHufDelta = corrected
      .filter(i => String(i.currency || 'HUF').toUpperCase() === 'HUF')
      .reduce((s, i) => s + Math.abs(Number(i.source_total_amount || 0) - Number(i.total_amount || 0)), 0);

    const checkedNav = usable.filter(i => !['not_checked', '', null, undefined].includes(i.nav_match_status));
    const navMatched = checkedNav.filter(i => i.nav_match_status === 'matched');
    const navProbable = checkedNav.filter(i => i.nav_match_status === 'probable');
    const navConflict = checkedNav.filter(i => i.nav_match_status === 'conflict');
    const missingInNav = checkedNav.filter(i => i.nav_match_status === 'missing_in_nav');

    const duplicateOpen = usable.filter(i => ['exact', 'suspected', 'confirmed'].includes(String(i.duplicate_status || '')));
    const safe = v3.filter(i => {
      const amountOk = i.amount_confidence != null && Number(i.amount_confidence) >= threshold && isAmountBalanced(i) !== false;
      const dupOk = !['exact', 'suspected', 'confirmed'].includes(String(i.duplicate_status || ''));
      const navOk = !navEnabled || i.nav_match_status === 'matched';
      return amountOk && dupOk && navOk;
    });

    const huf = usable.filter(i => String(i.currency || 'HUF').toUpperCase() === 'HUF');
    const foreign = usable.filter(i => String(i.currency || 'HUF').toUpperCase() !== 'HUF');
    const hufSpend = huf.reduce((s, i) => s + Number(i.total_amount || 0), 0);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dueCandidates = huf.filter(i => Number(i.total_amount || 0) > 0 && i.approval_status !== 'rejected' && i.due_date);
    const overdue = dueCandidates.filter(i => new Date(i.due_date).getTime() < today);
    const due7 = dueCandidates.filter(i => {
      const d = new Date(i.due_date).getTime();
      return d >= today && d <= today + 7 * 864e5;
    });
    const due30 = dueCandidates.filter(i => {
      const d = new Date(i.due_date).getTime();
      return d >= today && d <= today + 30 * 864e5;
    });
    const overdueValue = overdue.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const due7Value = due7.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const due30Value = due30.reduce((s, i) => s + Number(i.total_amount || 0), 0);

    const verificationDays = usable.map(i => daysBetween(i.created_at, i.verified_at)).filter((x): x is number => x != null);
    const approvalDays = usable.map(i => daysBetween(i.submitted_at, i.approved_at)).filter((x): x is number => x != null);

    const supplierMap = new Map<string, { name: string; count: number; total: number; values: number[]; max: number }>();
    huf.forEach(i => {
      const name = i.merchant_name || 'Unknown supplier';
      const value = Number(i.total_amount || 0);
      const row = supplierMap.get(name) || { name, count: 0, total: 0, values: [], max: 0 };
      row.count += 1; row.total += value; row.values.push(value); row.max = Math.max(row.max, value);
      supplierMap.set(name, row);
    });
    const suppliers = [...supplierMap.values()].sort((a, b) => b.total - a.total);
    const top5Spend = suppliers.slice(0, 5).reduce((s, x) => s + x.total, 0);

    const allSupplierHistory = new Map<string, number[]>();
    allInvoices.filter(i => String(i.currency || 'HUF').toUpperCase() === 'HUF' && Number(i.total_amount || 0) > 0).forEach(i => {
      const name = i.merchant_name || 'Unknown supplier';
      allSupplierHistory.set(name, [...(allSupplierHistory.get(name) || []), Number(i.total_amount)]);
    });

    const exceptions: ExceptionRow[] = [];
    for (const i of usable) {
      const reasons: { severity: 1 | 2 | 3; text: string }[] = [];
      if (i.status === 'failed') reasons.push({ severity: 3, text: 'OCR processing failed' });
      if (['exact', 'confirmed'].includes(String(i.duplicate_status || ''))) reasons.push({ severity: 3, text: 'Duplicate document/invoice' });
      else if (i.duplicate_status === 'suspected') reasons.push({ severity: 2, text: 'Possible duplicate' });
      if (i.nav_match_status === 'conflict') reasons.push({ severity: 3, text: 'NAV amount / VAT / identity conflict' });
      if (i.nav_match_status === 'missing_in_nav') reasons.push({ severity: 3, text: 'Missing in complete NAV period' });
      if (i.nav_match_status === 'probable') reasons.push({ severity: 2, text: 'NAV match needs confirmation' });
      if (String(i.ocr_version || '').includes('invoice-intelligence-v3')) {
        if (i.amount_confidence == null || Number(i.amount_confidence) < threshold) reasons.push({ severity: 2, text: 'Low amount confidence' });
        if (isAmountBalanced(i) === false) reasons.push({ severity: 3, text: 'Gross ≠ net + VAT control' });
      }
      const history = allSupplierHistory.get(i.merchant_name || 'Unknown supplier') || [];
      if (history.length >= 4 && Number(i.total_amount || 0) > Math.max(5000, median(history) * 2.5)) {
        reasons.push({ severity: 1, text: `Unusually high vs supplier median (${fmt(median(history))} HUF)` });
      }
      if (reasons.length) {
        const max = reasons.reduce((m, r) => Math.max(m, r.severity), 1) as 1 | 2 | 3;
        exceptions.push({
          id: i.id,
          severity: max,
          title: reasons.map(r => r.text).join(' · '),
          reason: reasons[0].text,
          merchant: i.merchant_name || 'Unknown supplier',
          invoiceNumber: i.invoice_number || '—',
          value: Number(i.total_amount || 0),
          currency: i.currency || 'HUF',
        });
      }
    }
    exceptions.sort((a, b) => b.severity - a.severity || Math.abs(b.value) - Math.abs(a.value));

    return {
      usable, v3, threshold, navEnabled, avgAmountConfidence, lowConfidence, balanceConflicts,
      secondPass, corrected, correctedHufDelta, checkedNav, navMatched, navProbable, navConflict,
      missingInNav, duplicateOpen, safe, hufSpend, foreign, overdueValue, due7Value, due30Value,
      overdue, verificationMedian: median(verificationDays), approvalMedian: median(approvalDays),
      suppliers, top5Spend, exceptions,
    };
  }, [invoices, allInvoices, settings]);

  const vat = useMemo(() => {
    const byRate = new Map<string, { label: string; base: number; vat: number; count: number }>();
    vatLines.forEach(v => {
      const rate = Number(v.vat_rate ?? 0);
      const label = v.vat_kind === 'aam_exempt' ? 'AAM' : v.vat_kind === 'kba_reverse' ? 'Reverse charge' : `${fmt(rate, rate % 1 ? 1 : 0)}%`;
      const row = byRate.get(label) || { label, base: 0, vat: 0, count: 0 };
      row.base += Number(v.vat_base || 0); row.vat += Number(v.vat_amount || 0); row.count += 1;
      byRate.set(label, row);
    });
    return [...byRate.values()].sort((a, b) => Math.abs(b.base) - Math.abs(a.base));
  }, [vatLines]);

  const latestRun = runs[0] || null;
  const navMissingHotelCare = navRecords.filter(r => r.match_status === 'missing_in_hotelcare');
  const navMissingHotelCareHuf = navMissingHotelCare.filter(r => String(r.currency || 'HUF').toUpperCase() === 'HUF').reduce((s, r) => s + Number(r.total_amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">Finance Intelligence</h2>
            <Badge variant="outline" className="text-[10px]">decision layer</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            OCR reliability, NAV reconciliation, approval controls, supplier risk and due-date exposure for the selected analytics period.
          </p>
        </div>
        {latestRun && (
          <div className="text-right text-[10px] text-muted-foreground">
            Latest NAV run<br /><span className="font-medium text-foreground">{new Date(latestRun.started_at).toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <Metric label="Auto-safe" value={`${pct(intelligence.safe.length, intelligence.v3.length)}%`} sub={`${intelligence.safe.length}/${intelligence.v3.length || 0} v3 invoices`} icon={<ShieldCheck className="h-5 w-5 text-emerald-600" />} />
        <Metric label="Amount confidence" value={`${Math.round(intelligence.avgAmountConfidence * 100)}%`} sub={`${intelligence.lowConfidence.length} below threshold`} icon={<BrainCircuit className="h-5 w-5 text-primary" />} />
        <Metric label="AI corrected totals" value={String(intelligence.corrected.length)} sub={`${fmt(intelligence.correctedHufDelta)} HUF absolute delta`} icon={<CheckCircle2 className="h-5 w-5 text-primary" />} />
        <Metric label="NAV exact match" value={`${pct(intelligence.navMatched.length, intelligence.checkedNav.length)}%`} sub={`${intelligence.navConflict.length} conflicts · ${intelligence.navProbable.length} probable`} icon={<Database className="h-5 w-5 text-primary" />} />
        <Metric label="Control exceptions" value={String(intelligence.exceptions.length)} sub={`${intelligence.balanceConflicts.length} amount balance · ${intelligence.duplicateOpen.length} duplicate`} icon={<AlertTriangle className="h-5 w-5 text-amber-500" />} />
        <Metric label="HUF controlled spend" value={`${fmt(intelligence.hufSpend)} HUF`} sub={intelligence.foreign.length ? `${intelligence.foreign.length} foreign-currency invoices excluded` : 'single-currency period'} icon={<DollarSign className="h-5 w-5 text-primary" />} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-primary" />NAV control</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <ControlRow label="Exact matches" value={intelligence.navMatched.length} good />
            <ControlRow label="Probable matches" value={intelligence.navProbable.length} />
            <ControlRow label="Conflicts" value={intelligence.navConflict.length} bad />
            <ControlRow label="Missing in NAV" value={intelligence.missingInNav.length} bad />
            <ControlRow label="NAV records missing in HotelCare" value={navMissingHotelCare.length} bad />
            {navMissingHotelCare.length > 0 && <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-muted-foreground">Potential unuploaded supplier invoices: <strong className="text-foreground">{fmt(navMissingHotelCareHuf)} HUF</strong> from the loaded NAV dataset.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-primary" />Due-date exposure</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <ControlRow label="Past due date" value={`${fmt(intelligence.overdueValue)} HUF`} bad={intelligence.overdueValue > 0} />
            <ControlRow label="Due next 7 days" value={`${fmt(intelligence.due7Value)} HUF`} />
            <ControlRow label="Due next 30 days" value={`${fmt(intelligence.due30Value)} HUF`} />
            <p className="text-[10px] text-muted-foreground pt-1">This is invoice due-date exposure, not a bank-payment confirmation. A future bank-reconciliation connector should close that loop.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />Process efficiency</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <ControlRow label="Independent verifier used" value={`${pct(intelligence.secondPass.length, intelligence.v3.length)}%`} />
            <ControlRow label="Manual review flag" value={`${pct(intelligence.usable.filter(i => i.needs_review).length, intelligence.usable.length)}%`} />
            <ControlRow label="Median upload → verify" value={intelligence.verificationMedian ? `${fmt(intelligence.verificationMedian, 1)} days` : '—'} />
            <ControlRow label="Median submit → approval" value={intelligence.approvalMedian ? `${fmt(intelligence.approvalMedian, 1)} days` : '—'} />
            <ControlRow label="Top 5 supplier concentration" value={`${pct(intelligence.top5Spend, intelligence.hufSpend)}%`} />
          </CardContent>
        </Card>
      </div>

      <div className="grid xl:grid-cols-[3fr_2fr] gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Decision exceptions</CardTitle>
            <p className="text-[10px] text-muted-foreground">Highest-risk items first. Open an invoice to resolve the exact control that prevents clean automation.</p>
          </CardHeader>
          <CardContent>
            {intelligence.exceptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground"><CheckCircle2 className="h-6 w-6 mx-auto mb-1 text-emerald-600" />No control exceptions in this period.</div>
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {intelligence.exceptions.slice(0, 60).map(x => (
                  <button key={`${x.id}-${x.title}`} onClick={() => onOpenInvoice(x.id)} className={`w-full text-left rounded-md border p-2.5 hover:bg-accent/40 transition ${severityClass(x.severity)}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{x.merchant} · {x.invoiceNumber}</div>
                        <div className="text-[10px] text-muted-foreground line-clamp-2">{x.title}</div>
                      </div>
                      <div className="text-xs font-semibold tabular-nums shrink-0">{fmt(x.value)} {x.currency}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" />VAT control mix</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {vat.length === 0 ? <p className="text-xs text-muted-foreground py-4">No VAT lines available in the selected period.</p> : vat.slice(0, 10).map(v => (
              <div key={v.label} className="rounded-md border p-2">
                <div className="flex items-center justify-between gap-2 text-xs"><span className="font-medium">{v.label}</span><span className="font-semibold tabular-nums">{fmt(v.vat)} VAT</span></div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{v.count} VAT lines</span><span>{fmt(v.base)} taxable base</span></div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">VAT values follow the invoice currencies stored on each document. The analytics deliberately does not invent FX conversions.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Supplier intelligence</CardTitle>
          <p className="text-[10px] text-muted-foreground">Concentration and invoice-size patterns help controlling spot contract drift, unusual purchasing and suppliers worth renegotiating.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[620px]">
              <thead className="text-muted-foreground"><tr className="border-b"><th className="text-left p-2">Supplier</th><th className="text-right p-2">Invoices</th><th className="text-right p-2">Spend</th><th className="text-right p-2">Avg invoice</th><th className="text-right p-2">Largest</th><th className="text-right p-2">Share</th></tr></thead>
              <tbody>{intelligence.suppliers.slice(0, 15).map(s => (
                <tr key={s.name} className="border-b last:border-0"><td className="p-2 font-medium max-w-[250px] truncate">{s.name}</td><td className="p-2 text-right">{s.count}</td><td className="p-2 text-right tabular-nums">{fmt(s.total)} HUF</td><td className="p-2 text-right tabular-nums">{fmt(s.total / Math.max(1, s.count))} HUF</td><td className="p-2 text-right tabular-nums">{fmt(s.max)} HUF</td><td className="p-2 text-right">{pct(s.total, intelligence.hufSpend)}%</td></tr>
              ))}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: React.ReactNode }) {
  return <Card><CardContent className="p-3 flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div><div className="text-lg font-bold truncate">{value}</div><div className="text-[10px] text-muted-foreground line-clamp-2">{sub}</div></div>{icon}</CardContent></Card>;
}

function ControlRow({ label, value, good, bad }: { label: string; value: number | string; good?: boolean; bad?: boolean }) {
  const n = typeof value === 'number' ? value : 0;
  return <div className="flex items-center justify-between gap-2 border-b last:border-0 pb-1.5 last:pb-0"><span className="text-muted-foreground">{label}</span><span className={`font-semibold tabular-nums ${good ? 'text-emerald-700 dark:text-emerald-400' : bad && n !== 0 ? 'text-destructive' : ''}`}>{typeof value === 'number' ? value.toLocaleString() : value}</span></div>;
}
