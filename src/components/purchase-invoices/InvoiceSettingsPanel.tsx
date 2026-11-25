import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useFinanceAccess, type FinanceProfile } from '@/hooks/useFinanceAccess';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Building2, Tags, Layers, Users, PlugZap, SlidersHorizontal, FileSpreadsheet, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { NavConnectionsPanel } from './NavConnectionsPanel';
import { ModuleRolloutPanel } from './ModuleRolloutPanel';
import { HistoricalImportPanel } from './HistoricalImportPanel';

const FIN_PROFILES: FinanceProfile[] = ['none','uploader','reviewer','controller','chief_controller','management_read'];
const PROFILE_HINT: Record<string, string> = {
  none: 'No finance access',
  uploader: 'Uploads invoices only',
  reviewer: 'Reviews extracted data and submits for approval',
  controller: 'Approves or rejects invoices in scope',
  chief_controller: 'Approves everything and manages finance access',
  management_read: 'Read-only management analytics',
};

export function InvoiceSettingsPanel() {
  const { profile } = useAuth();
  const { canManageFinance } = useFinanceAccess();
  const org = profile?.organization_slug ?? '';

  const [companies, setCompanies] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [costCentres, setCostCentres] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [access, setAccess] = useState<Record<string, any>>({});
  const [hotels, setHotels] = useState<Array<{ hotel_id: string; hotel_name: string }>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!org) return;
    setLoading(true);
    const [c, cat, cc, st, fa] = await Promise.all([
      supabase.from('invoice_buyer_companies').select('*, invoice_company_properties(hotel_id)').eq('organization_slug', org).order('name'),
      supabase.from('purchase_invoice_categories').select('*').eq('organization_slug', org).order('sort_order'),
      supabase.from('invoice_cost_centres').select('*').eq('organization_slug', org).order('sort_order'),
      supabase.from('profiles').select('id, full_name, nickname, role, job_title, assigned_hotel').eq('organization_slug', org).order('full_name'),
      supabase.from('finance_access').select('*').eq('organization_slug', org),
    ]);
    setCompanies(c.data ?? []);
    setCategories(cat.data ?? []);
    setCostCentres(cc.data ?? []);
    setStaff(st.data ?? []);
    setAccess(Object.fromEntries((fa.data ?? []).map(r => [r.user_id, r])));
    const { data: orgRow } = await supabase.from('organizations').select('id').eq('slug', org).maybeSingle();
    if (orgRow?.id) {
      const { data: hc } = await supabase.from('hotel_configurations').select('hotel_id, hotel_name')
        .eq('organization_id', orgRow.id).eq('is_active', true).order('hotel_name');
      setHotels((hc ?? []) as Array<{ hotel_id: string; hotel_name: string }>);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [org]);

  const [newCompany, setNewCompany] = useState({ name: '', tax_id: '' });
  const addCompany = async () => {
    if (!newCompany.name.trim()) return toast.error('Legal name is required');
    const { error } = await supabase.from('invoice_buyer_companies').insert({
      organization_slug: org,
      name: newCompany.name.trim(),
      legal_name: newCompany.name.trim(),
      tax_id: newCompany.tax_id.trim() || null,
    });
    if (error) return toast.error(error.message);
    setNewCompany({ name: '', tax_id: '' });
    toast.success('Legal entity added');
    load();
  };

  const [newCc, setNewCc] = useState({ code: '', label: '' });
  const addCostCentre = async () => {
    if (!newCc.code.trim() || !newCc.label.trim()) return toast.error('Code and label are required');
    const { error } = await supabase.from('invoice_cost_centres').insert({
      organization_slug: org, code: newCc.code.trim().toLowerCase(), label: newCc.label.trim(),
    });
    if (error) return toast.error(error.message);
    setNewCc({ code: '', label: '' });
    toast.success('Cost centre added');
    load();
  };

  const [newCat, setNewCat] = useState({ code: '', label: '' });
  const addCategory = async () => {
    if (!newCat.code.trim() || !newCat.label.trim()) return toast.error('Code and label are required');
    const { error } = await supabase.from('purchase_invoice_categories').insert({
      organization_slug: org, code: newCat.code.trim().toLowerCase(), label: newCat.label.trim(),
    });
    if (error) return toast.error(error.message);
    setNewCat({ code: '', label: '' });
    toast.success('Category added');
    load();
  };

  const toggleActive = async (table: 'invoice_cost_centres' | 'purchase_invoice_categories' | 'invoice_buyer_companies', id: string, value: boolean) => {
    const { error } = await supabase.from(table).update({ is_active: value }).eq('id', id);
    if (error) return toast.error(error.message);
    load();
  };

  const setFinanceProfile = async (userId: string, value: FinanceProfile) => {
    const existing = access[userId];
    if (existing) {
      const { error } = await supabase.from('finance_access').update({ profile: value }).eq('id', existing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from('finance_access').insert({
        user_id: userId, organization_slug: org, profile: value,
      });
      if (error) return toast.error(error.message);
    }
    toast.success('Finance access updated');
    load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <Tabs defaultValue="entities" className="space-y-4">
      <TabsList className="flex flex-wrap">
        <TabsTrigger value="entities"><Building2 className="h-4 w-4 mr-1.5" />Legal entities</TabsTrigger>
        <TabsTrigger value="categories"><Tags className="h-4 w-4 mr-1.5" />Expense categories</TabsTrigger>
        <TabsTrigger value="costcentres"><Layers className="h-4 w-4 mr-1.5" />Cost centres</TabsTrigger>
        {canManageFinance && <TabsTrigger value="access"><Users className="h-4 w-4 mr-1.5" />Finance access</TabsTrigger>}
        <TabsTrigger value="nav"><PlugZap className="h-4 w-4 mr-1.5" />NAV</TabsTrigger>
        {canManageFinance && <TabsTrigger value="rollout"><SlidersHorizontal className="h-4 w-4 mr-1.5" />Module rollout</TabsTrigger>}
        {canManageFinance && <TabsTrigger value="import"><FileSpreadsheet className="h-4 w-4 mr-1.5" />Historical import</TabsTrigger>}
      </TabsList>

      <TabsContent value="entities">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Legal entities (buyer companies)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Invoices are grouped by the company that is billed. Tax numbers are normalized, so the same
              company can never be created twice.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Legal name" value={newCompany.name}
                onChange={(e) => setNewCompany(s => ({ ...s, name: e.target.value }))} className="max-w-[260px]" />
              <Input placeholder="Tax number (adószám)" value={newCompany.tax_id}
                onChange={(e) => setNewCompany(s => ({ ...s, tax_id: e.target.value }))} className="max-w-[200px]" />
              <Button onClick={addCompany}><Plus className="h-4 w-4 mr-1" />Add entity</Button>
            </div>
            <div className="space-y-2">
              {companies.map(c => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.legal_name || c.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {c.tax_id || 'no tax number'}
                      {c.normalized_tax_id && <> · normalized {c.normalized_tax_id}</>}
                      {(c.invoice_company_properties ?? []).length > 0 && (
                        <> · {(c.invoice_company_properties ?? []).map((p: any) => p.hotel_id).join(', ')}</>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!c.is_active && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Switch checked={!!c.is_active} onCheckedChange={(v) => toggleActive('invoice_buyer_companies', c.id, v)} />
                  </div>
                  {editing === c.id && (
                    <EntityEditor company={c} hotels={hotels} costCentres={costCentres} categories={categories}
                      onDone={() => { setEditing(null); load(); }} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="categories">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Expense categories</CardTitle>
            <p className="text-xs text-muted-foreground">The AI can only choose from this list; anything else becomes “Uncategorized”.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="code" value={newCat.code} onChange={(e) => setNewCat(s => ({ ...s, code: e.target.value }))} className="max-w-[180px]" />
              <Input placeholder="Label" value={newCat.label} onChange={(e) => setNewCat(s => ({ ...s, label: e.target.value }))} className="max-w-[240px]" />
              <Button onClick={addCategory}><Plus className="h-4 w-4 mr-1" />Add category</Button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {categories.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div className="min-w-0">
                    <div className="text-sm truncate">{c.label}</div>
                    <div className="text-[10px] text-muted-foreground">{c.code}</div>
                  </div>
                  <Switch checked={!!c.is_active} onCheckedChange={(v) => toggleActive('purchase_invoice_categories', c.id, v)} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="costcentres">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cost centres</CardTitle>
            <p className="text-xs text-muted-foreground">Departments an invoice can be booked to, used across controlling reports.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="code" value={newCc.code} onChange={(e) => setNewCc(s => ({ ...s, code: e.target.value }))} className="max-w-[180px]" />
              <Input placeholder="Label" value={newCc.label} onChange={(e) => setNewCc(s => ({ ...s, label: e.target.value }))} className="max-w-[240px]" />
              <Button onClick={addCostCentre}><Plus className="h-4 w-4 mr-1" />Add cost centre</Button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {costCentres.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div className="min-w-0">
                    <div className="text-sm truncate">{c.label}</div>
                    <div className="text-[10px] text-muted-foreground">{c.code}{c.hotel_id ? ` · ${c.hotel_id}` : ''}</div>
                  </div>
                  <Switch checked={!!c.is_active} onCheckedChange={(v) => toggleActive('invoice_cost_centres', c.id, v)} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {canManageFinance && (
        <TabsContent value="access">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Finance access</CardTitle>
              <p className="text-xs text-muted-foreground">
                Finance profiles add invoice permissions on top of a user's normal role. Only controllers
                and chief controllers can approve invoices — being a system admin is not enough.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {staff.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{s.full_name || s.nickname || s.id}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {s.role}{s.job_title ? ` · ${s.job_title}` : ''}{s.assigned_hotel ? ` · ${s.assigned_hotel}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 w-[190px]">
                    <Select
                      value={(access[s.id]?.profile as string) ?? 'none'}
                      onValueChange={(v) => setFinanceProfile(s.id, v as FinanceProfile)}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FIN_PROFILES.map(p => (
                          <SelectItem key={p} value={p} className="text-xs">
                            {p.replace('_', ' ')} — {PROFILE_HINT[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      )}

      <TabsContent value="nav"><NavConnectionsPanel /></TabsContent>
      {canManageFinance && <TabsContent value="rollout"><ModuleRolloutPanel /></TabsContent>}
      {canManageFinance && <TabsContent value="import"><HistoricalImportPanel /></TabsContent>}
    </Tabs>
  );
}

interface CompanyRow {
  id: string;
  organization_slug: string;
  name: string;
  legal_name?: string | null;
  tax_id?: string | null;
  registered_address?: string | null;
  default_cost_centre_id?: string | null;
  default_category_id?: string | null;
  invoice_company_properties?: Array<{ hotel_id: string }>;
}
interface OptionRow { id: string; label: string; is_active?: boolean | null }

/** Legal company details used by OCR matching, NAV and defaults (admin-only writes, enforced by RLS). */
function EntityEditor({ company, hotels, costCentres, categories, onDone }: {
  company: CompanyRow; hotels: Array<{ hotel_id: string; hotel_name: string }>; costCentres: OptionRow[]; categories: OptionRow[]; onDone: () => void;
}) {
  const [form, setForm] = useState({
    legal_name: company.legal_name || company.name || '',
    tax_id: company.tax_id || '',
    registered_address: company.registered_address || '',
    default_cost_centre_id: company.default_cost_centre_id || 'none',
    default_category_id: company.default_category_id || 'none',
  });
  const initialHotels: string[] = (company.invoice_company_properties ?? []).map((p) => p.hotel_id);
  const [selected, setSelected] = useState<string[]>(initialHotels);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.legal_name.trim()) return toast.error('Legal name is required');
    setSaving(true);
    try {
      const { error } = await supabase.from('invoice_buyer_companies').update({
        legal_name: form.legal_name.trim(),
        name: form.legal_name.trim(),
        tax_id: form.tax_id.trim() || null,
        registered_address: form.registered_address.trim() || null,
        default_cost_centre_id: form.default_cost_centre_id === 'none' ? null : form.default_cost_centre_id,
        default_category_id: form.default_category_id === 'none' ? null : form.default_category_id,
      } as never).eq('id', company.id);
      if (error) throw error;
      const add = selected.filter((h) => !initialHotels.includes(h));
      const remove = initialHotels.filter((h) => !selected.includes(h));
      if (add.length) {
        const { error: e1 } = await supabase.from('invoice_company_properties')
          .insert(add.map((hotel_id) => ({ company_id: company.id, organization_slug: company.organization_slug, hotel_id })));
        if (e1) throw e1;
      }
      if (remove.length) {
        const { error: e2 } = await supabase.from('invoice_company_properties').delete().eq('company_id', company.id).in('hotel_id', remove);
        if (e2) throw e2;
      }
      toast.success('Legal entity saved');
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="basis-full mt-2 rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <Input placeholder="Legal name" value={form.legal_name} onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value }))} />
        <Input placeholder="Tax number (12345678-1-42)" value={form.tax_id} onChange={(e) => setForm((f) => ({ ...f, tax_id: e.target.value }))} />
        <Input className="sm:col-span-2" placeholder="Registered address" value={form.registered_address}
          onChange={(e) => setForm((f) => ({ ...f, registered_address: e.target.value }))} />
        <Select value={form.default_cost_centre_id} onValueChange={(v) => setForm((f) => ({ ...f, default_cost_centre_id: v }))}>
          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Default cost centre" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Default cost centre: —</SelectItem>
            {costCentres.filter((c) => c.is_active).map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={form.default_category_id} onValueChange={(v) => setForm((f) => ({ ...f, default_category_id: v }))}>
          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Default category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Default category: —</SelectItem>
            {categories.filter((c) => c.is_active).map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {hotels.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Properties of this legal company (the company printed on an invoice always wins)</div>
          <div className="flex flex-wrap gap-3">
            {hotels.map((h) => (
              <label key={h.hotel_id} className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={selected.includes(h.hotel_id)}
                  onCheckedChange={(v) => setSelected((s) => (v === true ? [...s, h.hotel_id] : s.filter((x) => x !== h.hotel_id)))} />
                {h.hotel_name}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving}>{saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save</Button>
      </div>
    </div>
  );
}
