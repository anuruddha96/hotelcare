/* eslint-disable @typescript-eslint/no-explicit-any -- the NAV/reconciliation tables are not in the generated Supabase types yet */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, Info, Loader2, MessageSquarePlus, Upload, Ban, Send, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { daysSince, exportWorkbook, fetchAll, formatMoney, reconDecision, totalsByCurrency } from '@/lib/purchaseInvoiceNav';

interface Props {
  canControlNav: boolean;
  onUpload: () => void;
}

/**
 * NAV-only invoices: reported to NAV for one of our legal companies, but no
 * document exists in HotelCare after the reporting-delay window. Follow-ups
 * are created by the reconciliation writer; this panel works them.
 */
export function MissingDocumentsPanel({ canControlNav, onUpload }: Props) {
  const { profile, user } = useAuth();
  const { t, language } = useTranslation();
  const org = profile?.organization_slug ?? '';
  const locale = language === 'hu' ? 'hu-HU' : 'en-GB';
  const [rows, setRows] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState('all');
  const [search, setSearch] = useState('');
  const [noteFor, setNoteFor] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<any[]>([]);
  const [exclude, setExclude] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    const db = supabase as any;
    try {
      const [followups, co, st] = await Promise.all([
        fetchAll((from, to) => db.from('pi_missing_document_followups')
          .select('id, status, assigned_to, hotel_id, requested_from_hotel, requested_at, due_date, created_at, company_id, nav_invoice_id, pi_nav_invoices(id, invoice_number, supplier_name, supplier_tax_number, invoice_issue_date, currency, gross_amount, invoice_operation, environment)')
          .eq('organization_slug', org).in('status', ['open', 'requested', 'in_progress']).order('created_at').range(from, to)),
        db.from('invoice_buyer_companies').select('id, name, legal_name').eq('organization_slug', org).order('name'),
        canControlNav ? db.from('profiles').select('id, full_name, nickname, role').eq('organization_slug', org).order('full_name') : Promise.resolve({ data: [] }),
      ]);
      setRows(followups);
      setCompanies(co.data ?? []);
      setStaff(st.data ?? []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [org, canControlNav]);
  useEffect(() => { load(); }, [load]);

  const companyName = (id: string) => {
    const c = companies.find((x) => x.id === id);
    return c ? (c.legal_name || c.name) : '—';
  };
  const staffName = (id: string | null) => {
    const s = staff.find((x) => x.id === id);
    return s ? (s.full_name || s.nickname) : null;
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => company === 'all' || r.company_id === company)
      .filter((r) => !q || (r.pi_nav_invoices?.supplier_name || '').toLowerCase().includes(q) || (r.pi_nav_invoices?.invoice_number || '').toLowerCase().includes(q))
      .map((r) => ({ ...r, days: daysSince(r.pi_nav_invoices?.invoice_issue_date) }))
      .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
  }, [rows, company, search]);
  const totals = useMemo(() => totalsByCurrency(visible, (r) => r.pi_nav_invoices?.gross_amount, (r) => r.pi_nav_invoices?.currency), [visible]);

  const update = async (row: any, patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { error } = await (supabase as any).from('pi_missing_document_followups').update(patch).eq('id', row.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const openNotes = async (row: any) => {
    setNoteFor(row);
    setNote('');
    const { data } = await (supabase as any).from('pi_missing_document_notes').select('id, note, author_id, created_at').eq('followup_id', row.id).order('created_at');
    setNotes(data ?? []);
  };
  const addNote = async () => {
    if (!noteFor || !user || !note.trim()) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).from('pi_missing_document_notes').insert({
        followup_id: noteFor.id, organization_slug: org, author_id: user.id, note: note.trim().slice(0, 2000),
      });
      if (error) throw error;
      await openNotes(noteFor);
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const confirmExclude = async () => {
    if (!exclude) return;
    setBusy(true);
    try {
      await reconDecision('mark_nav_not_expected', { nav_invoice_id: exclude.nav_invoice_id, reason });
      toast.success(t('pi.recon.saved'));
      setExclude(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const exportRows = () => exportWorkbook([{
    name: 'Missing documents',
    rows: visible.map((r) => ({
      legal_company: companyName(r.company_id), supplier: r.pi_nav_invoices?.supplier_name, supplier_tax: r.pi_nav_invoices?.supplier_tax_number,
      invoice_number: r.pi_nav_invoices?.invoice_number, issue_date: r.pi_nav_invoices?.invoice_issue_date, currency: r.pi_nav_invoices?.currency,
      gross: r.pi_nav_invoices?.gross_amount, days_open: r.days, status: r.status, assigned_to: staffName(r.assigned_to) ?? '', property: r.hotel_id ?? '',
    })),
  }], `missing-documents-${new Date().toISOString().slice(0, 10)}`);

  return (
    <Card>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">{t('pi.missing.heading')}</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onUpload}><Upload className="h-3.5 w-3.5 mr-1" />{t('pi.missing.upload')}</Button>
            <Button size="sm" variant="outline" onClick={exportRows} disabled={!visible.length}><Download className="h-3.5 w-3.5 mr-1" />{t('pi.missing.export')}</Button>
          </div>
        </div>
        <Alert><Info className="h-4 w-4" /><AlertDescription className="text-xs">{t('pi.missing.hint')}</AlertDescription></Alert>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('pi.missing.allCompanies')}</SelectItem>
              {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_name || c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('pi.recon.search')} className="h-8 max-w-[240px]" />
          <div className="ml-auto flex flex-wrap gap-2">
            {totals.map((m) => (
              <Badge key={m.currency} variant="outline" className="text-[11px]">{m.count} · {formatMoney(m.total, m.currency, locale)}</Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {loading ? <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          : visible.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">{t('pi.missing.empty')}</p>
          : visible.map((r) => {
            const navInv = r.pi_nav_invoices ?? {};
            return (
              <div key={r.id} className="rounded-md border p-2.5 flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {navInv.supplier_name || navInv.supplier_tax_number} · {navInv.invoice_number}
                    {navInv.environment === 'test' && <Badge variant="secondary" className="ml-1.5 text-[9px]">TEST</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {companyName(r.company_id)} · {navInv.invoice_issue_date || '—'} · {formatMoney(navInv.gross_amount, navInv.currency, locale)}
                    {r.hotel_id && <> · {r.hotel_id}</>}
                    {staffName(r.assigned_to) && <> · {staffName(r.assigned_to)}</>}
                  </div>
                </div>
                <Badge variant="outline" className={(r.days ?? 0) > 30 ? 'border-destructive/50 text-destructive' : (r.days ?? 0) > 14 ? 'border-amber-500/60 text-amber-700' : ''}>
                  {t('pi.recon.daysOld').replace('{n}', String(r.days ?? '—'))}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">{t(`pi.missing.status.${r.status}`)}</Badge>
                <div className="flex flex-wrap gap-1">
                  {canControlNav && (
                    <Select value={r.assigned_to ?? 'none'} onValueChange={(v) => update(r, { assigned_to: v === 'none' ? null : v })}>
                      <SelectTrigger className="h-7 w-[150px] text-[11px]"><SelectValue placeholder={t('pi.missing.assign')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('pi.missing.unassigned')}</SelectItem>
                        {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name || s.nickname}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {canControlNav && r.status === 'open' && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy}
                      onClick={() => update(r, { status: 'requested', requested_from_hotel: r.hotel_id ?? null })}>
                      <Send className="h-3 w-3 mr-1" />{t('pi.missing.request')}
                    </Button>
                  )}
                  {(canControlNav || r.assigned_to === user?.id) && r.status !== 'in_progress' && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => update(r, { status: 'in_progress' })}>
                      <PlayCircle className="h-3 w-3 mr-1" />{t('pi.missing.inProgress')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => openNotes(r)}>
                    <MessageSquarePlus className="h-3 w-3 mr-1" />{t('pi.missing.notes')}
                  </Button>
                  {canControlNav && (
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy} onClick={() => { setExclude(r); setReason(''); }}>
                      <Ban className="h-3 w-3 mr-1" />{t('pi.missing.notRequired')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
      </CardContent>

      <Dialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-base">{t('pi.missing.notes')}</DialogTitle></DialogHeader>
          <div className="max-h-56 overflow-y-auto space-y-1.5">
            {notes.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : notes.map((n) => (
              <div key={n.id} className="rounded-md border p-2 text-xs">
                <div className="text-muted-foreground text-[10px]">{new Date(n.created_at).toLocaleString(locale)} · {staffName(n.author_id) ?? ''}</div>
                <div>{n.note}</div>
              </div>
            ))}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('pi.missing.notePlaceholder')} rows={2} className="text-sm" />
          <DialogFooter>
            <Button disabled={busy || !note.trim()} onClick={addNote}>{t('pi.missing.addNote')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!exclude} onOpenChange={(o) => !o && setExclude(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-base">{t('pi.missing.notRequired')}</DialogTitle></DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('pi.recon.reason')} rows={2} className="text-sm" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExclude(null)}>{t('pi.recon.cancel')}</Button>
            <Button disabled={busy || reason.trim().length < 3} onClick={confirmExclude}>{t('pi.recon.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
