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
import { Loader2, Plus, Building2, Tags, Layers, Users } from 'lucide-react';
import { toast } from 'sonner';

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
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5">
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
                    <Switch checked={!!c.is_active} onCheckedChange={(v) => toggleActive('invoice_buyer_companies', c.id, v)} />
                  </div>
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
    </Tabs>
  );
}
