import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AlertTriangle, Building2, CheckCircle2, FileText, Loader2, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Company {
  id?: string;
  legal_name: string; tax_number: string; zip: string; city: string; street_address: string;
  billing_email: string; bank_name: string; bank_account: string; reply_to_email: string;
  invoice_prefix: string; language: string; environment: 'test' | 'live';
  connection_mode: 'own_account' | 'delegated';
  credential: string; username: string; password: string;
  enabled?: boolean; credentials_set?: boolean;
}
const freshCompany = (): Company => ({
  legal_name: '', tax_number: '', zip: '', city: '', street_address: '', billing_email: '',
  bank_name: '', bank_account: '', reply_to_email: '', invoice_prefix: '', language: 'hu',
  environment: 'test', connection_mode: 'own_account', credential: '', username: '', password: '',
});
const languageChoices = [
  ['hu','Hungarian'], ['en','English'], ['de','German'], ['fr','French'], ['it','Italian'],
  ['ro','Romanian'], ['sk','Slovak'], ['hr','Croatian'], ['es','Spanish'], ['cz','Czech'], ['pl','Polish'],
];
async function adminCall(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('invoice-issuers-admin', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const remote = context && typeof context.json === 'function'
      ? await context.json().catch(() => null) as { error?: string } | null : null;
    throw new Error(remote?.error || error.message);
  }
  if (!data || data.ok !== true) throw new Error(String(data?.error || 'Unable to load invoice settings'));
  return data as Record<string, unknown>;
}
const textInput = (
  label: string, value: string, change: (v: string) => void, required = false,
  placeholder = '', type = 'text',
) => <div className="space-y-1.5 min-w-0">
  <Label className="text-xs">{label}{required ? ' *' : ''}</Label>
  <Input value={value} type={type} placeholder={placeholder} className="h-9"
    onChange={e => change(e.target.value)} required={required} autoComplete="off" />
</div>;

export default function InvoicingSettings() {
  const { profile, user } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { hotels } = useTenant();
  const { hotelId } = useOperationalHotel();
  const canManage = Boolean(profile?.is_super_admin || ['admin', 'top_management', 'top_management_manager'].includes(profile?.role || ''));
  const [selectedHotel, setSelectedHotel] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [form, setForm] = useState<Company>(freshCompany);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [failed, setFailed] = useState('');

  useEffect(() => {
    if (hotelId && hotels.some(h => h.hotel_id === hotelId)) setSelectedHotel(hotelId);
    else if (!selectedHotel && hotels.length) setSelectedHotel(hotels[0].hotel_id);
  }, [hotelId, hotels, selectedHotel]);

  const load = useCallback(async () => {
    if (!selectedHotel || !canManage) { setLoading(false); return; }
    setLoading(true); setFailed('');
    try {
      const data = await adminCall({ action: 'list', hotel_id: selectedHotel });
      setCompanies((data.companies || []) as Company[]);
      setLinkedId((data.assigned_issuer_id as string) || null);
    } catch (e) { setFailed((e as Error).message); } finally { setLoading(false); }
  }, [selectedHotel, canManage]);
  useEffect(() => { void load(); }, [load]);

  const update = (name: keyof Company, value: string) => setForm(f => ({ ...f, [name]: value }));
  const selectCompany = (company: Company) =>
    setForm({ ...company, credential: '', username: '', password: '' });

  const action = async (name: string, payload: Record<string, unknown>, message: string) => {
    if (!selectedHotel || busy) return;
    setBusy(name);
    try {
      const result = await adminCall({ action: name, hotel_id: selectedHotel, ...payload });
      toast.success(message);
      if (name === 'save') {
        const saved = result.company as Company;
        selectCompany(saved);
      }
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(''); }
  };

  const save = () => {
    if (!form.legal_name || !form.tax_number || !form.billing_email || !form.zip || !form.city || !form.street_address) {
      toast.error('Please complete the mandatory company and registered-address fields.');
      return;
    }
    if (!window.confirm('Save company settings? Invoicing will remain disabled until explicitly enabled again.')) return;
    void action('save', { company: form }, 'Company settings saved securely. Invoicing is disabled until approved.');
  };
  const toggle = (company: Company) => {
    if (!company.id) return;
    if (company.enabled) {
      if (window.confirm('Disable issuing new invoices for this legal company? Existing invoices remain available.')) {
        void action('disable', { issuer_id: company.id }, 'Invoice company disabled.');
      }
      return;
    }
    const warning = company.environment === 'live'
      ? 'LIVE invoices are legally issued and may be sent to NAV. Verify the legal entity, registered tax number, company account, NAV connectivity, tax rules and delegated permissions before you continue.'
      : 'HotelCare cannot switch Számlázz.hu to test mode by itself. Confirm that this provider account is actually in Tesztüzem before enabling; otherwise real invoices could be issued.';
    if (!window.confirm(warning)) return;
    void action('enable', { issuer_id: company.id, confirm: true,
      nav_confirmed: company.environment === 'live',
      delegation_approved: company.connection_mode === 'delegated',
    }, company.environment === 'live' ? 'Live issuing enabled.' : 'Test issuing enabled.');
  };
  const assign = (company: Company) => {
    if (!company.id || !selectedHotel) return;
    if (!window.confirm('Use ' + company.legal_name + ' to issue ALL new guest invoices for ' + selectedHotel + '? The existing invoice history remains with its original company.')) return;
    void action('assign', { issuer_id: company.id }, 'Hotel invoicing company assigned.');
  };

  if (!user) return <Navigate to={'/' + (organizationSlug || 'rdhotels') + '/auth'} replace />;
  if (!canManage) return <main className="p-8">Only organization administrators can configure legal invoicing companies.</main>;
  return <div className="min-h-screen bg-background">
    <Header />
    <PMSNavigation />
    <main className="mx-auto max-w-6xl px-3 sm:px-6 py-6 space-y-5" data-training="invoice-company-admin">
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Building2 className="h-6 w-6 text-primary"/> Invoicing companies</h1>
          <p className="text-sm text-muted-foreground mt-1">Set up every legal entity once, then assign the correct issuer to each hotel. Private keys are encrypted on the server.</p>
        </div>
        <Button variant="outline" onClick={() => setForm(freshCompany())} className="gap-1.5"><Plus className="h-4 w-4"/> Add legal company</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 text-xs">
        <div className="rounded-xl border p-3"><strong>1. Register</strong><p className="mt-1 text-muted-foreground">Company details, tax ID, billing address and bank information</p></div>
        <div className="rounded-xl border p-3"><strong>2. Connect</strong><p className="mt-1 text-muted-foreground">Own Számla Agent key or approved delegated user's credentials</p></div>
        <div className="rounded-xl border p-3"><strong>3. Activate</strong><p className="mt-1 text-muted-foreground">Assign the hotel, verify TEST or LIVE, then enable issuance</p></div>
      </div>
      {failed && <p role="alert" className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{failed}</p>}
      <div className="grid gap-5 lg:grid-cols-[320px_1fr] items-start">
        <div className="space-y-3">
          <Card><CardHeader className="pb-3"><CardTitle className="text-base">Property assignment</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label className="text-xs">Hotel</Label>
                <Select value={selectedHotel || undefined} onValueChange={setSelectedHotel}>
                  <SelectTrigger><SelectValue placeholder="Select a hotel"/></SelectTrigger>
                  <SelectContent>{hotels.map(h => <SelectItem key={h.id} value={h.hotel_id}>{h.hotel_name}</SelectItem>)}</SelectContent>
                </Select></div>
              {linkedId
                ? <p className="text-sm flex items-start gap-2"><CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0"/> Assigned: <strong>{companies.find(c => c.id === linkedId)?.legal_name || 'Unknown company'}</strong></p>
                : <p className="text-sm text-muted-foreground">No legal issuer assigned. This hotel's guest invoicing is blocked.</p>}
              {linkedId && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => {
                if (window.confirm('Unassign this hotel? New guest invoices will be blocked.')) void action('unassign', {}, 'Hotel issuer unassigned.');
              }}>Unassign hotel</Button>}
            </CardContent></Card>
          <Card><CardHeader className="pb-3"><CardTitle className="text-base">Saved legal companies {loading && <Loader2 className="inline h-4 w-4 animate-spin"/>}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!loading && companies.length === 0 && <p className="text-sm text-muted-foreground">Add your first company to get started.</p>}
              {companies.map(c => <div key={c.id} className={'rounded-lg border p-3 space-y-2 ' + (form.id === c.id ? 'border-primary' : '')}>
                <button type="button" className="text-left w-full" onClick={() => selectCompany(c)}>
                  <p className="text-sm font-medium">{c.legal_name}</p>
                  <p className="text-xs text-muted-foreground">{c.tax_number}</p>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    <Badge variant={c.environment === 'live' ? 'default' : 'secondary'}>{c.environment === 'live' ? 'LIVE' : 'TEST'}</Badge>
                    <Badge variant="outline">{c.enabled ? 'Issuing enabled' : 'Disabled'}</Badge>
                    {linkedId === c.id && <Badge variant="secondary">This hotel</Badge>}
                  </div>
                </button>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!!busy || !c.id || linkedId === c.id} onClick={() => assign(c)}>Assign hotel</Button>
                  <Button size="sm" variant={c.enabled ? 'destructive' : 'outline'} disabled={!!busy || !c.credentials_set}
                    onClick={() => toggle(c)}>{c.enabled ? 'Disable' : 'Enable'}</Button>
                </div>
              </div>)}
            </CardContent></Card>
        </div>
        <Card><CardHeader><CardTitle className="text-lg">{form.id ? 'Edit company' : 'New company'}</CardTitle>
          <p className="text-xs text-muted-foreground">Editing a connected company pauses invoice issuance until an administrator reviews and enables it again. The official seller identity printed on invoices comes from the connected Számlázz.hu account; editing these HotelCare fields does not update that provider account.</p></CardHeader>
          <CardContent className="space-y-5">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Legal business details</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {textInput('Registered company name', form.legal_name, v => update('legal_name',v), true, 'Example Hotel Kft.')}
                {textInput('Hungarian tax number (adószám)', form.tax_number, v => update('tax_number',v), true, '12345678-1-42')}
                {textInput('Postal code', form.zip, v => update('zip',v), true, '1075')}
                {textInput('City', form.city, v => update('city',v), true, 'Budapest')}
                <div className="sm:col-span-2">{textInput('Street and building', form.street_address, v => update('street_address',v), true, 'Street 12.')}</div>
                {textInput('Company contact email', form.billing_email, v => update('billing_email',v), true, '', 'email')}
                {textInput('Invoice reply-to email', form.reply_to_email, v => update('reply_to_email',v), false, '', 'email')}
                {textInput('Bank name', form.bank_name, v => update('bank_name',v))}
                {textInput('Bank account / IBAN', form.bank_account, v => update('bank_account',v))}
                {textInput('Invoice prefix (max 5 characters)', form.invoice_prefix, v => update('invoice_prefix',v.toUpperCase()), false, 'HTL')}
                <div className="space-y-1.5"><Label className="text-xs">Default invoice language</Label>
                  <Select value={form.language} onValueChange={v => update('language',v)}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>{languageChoices.map(([v,label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
                  </Select></div>
              </div>
            </section>
            <section className="space-y-3 border-t pt-4">
              <h2 className="text-sm font-semibold">Számlázz.hu connection</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Account type</Label>
                  <Select value={form.connection_mode} onValueChange={v => setForm(f => ({...f,connection_mode:v as Company['connection_mode'], credential:'',username:'',password:''}))}>
                    <SelectTrigger><SelectValue/></SelectTrigger><SelectContent>
                      <SelectItem value="own_account">Company's own Agent key</SelectItem>
                      <SelectItem value="delegated">Approved delegated invoicing</SelectItem>
                    </SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="text-xs">Invoice environment</Label>
                  <Select value={form.environment} onValueChange={v => update('environment',v)}>
                    <SelectTrigger><SelectValue/></SelectTrigger><SelectContent>
                      <SelectItem value="test">TEST (Tesztüzem)</SelectItem>
                      <SelectItem value="live">LIVE (real invoices)</SelectItem>
                    </SelectContent></Select></div>
              </div>
              {form.connection_mode === 'own_account'
                ? <>{textInput('Számla Agent API key', form.credential, v => update('credential',v), false,
                    form.credentials_set ? 'Key already saved — enter to replace' : 'Paste key from Számlázz.hu', 'password')}
                    <p className="text-xs text-muted-foreground">Generate the Agent key from the company's Számlázz.hu dashboard. It is only shown while you enter it, then stored encrypted.</p></>
                : <><div className="rounded-md border p-3 text-xs space-y-1">
                    <p className="font-semibold">Delegated invoice issuer</p>
                    <p>First establish the company-to-company mandate and have the supplier approve it. Use a dedicated login belonging to exactly one supplier account. For automated API onboarding, request the special API licence from Számlázz.hu.</p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {textInput('Dedicated delegated user email', form.username, v => update('username',v), false, 'invoice-agent@example.hu', 'email')}
                    {textInput('Dedicated delegated user password', form.password, v => update('password',v), false,
                      form.credentials_set ? 'Stored — enter to replace' : '', 'password')}
                  </div></>}
              {form.credentials_set && <p className="text-xs text-emerald-700 flex items-center gap-1"><ShieldCheck className="h-4 w-4"/> Credentials saved. They are never returned to the browser.</p>}
              {form.environment === 'live' && <div role="alert" className="rounded-lg border border-amber-400/50 p-3 text-xs flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600"/> Real invoices require correct legal details, NAV Online Számla connection, accounting-approved VAT and the correct provider account.
              </div>}
            </section>
            <div className="flex flex-wrap justify-between gap-2 border-t pt-4 items-center">
              <p className="text-xs text-muted-foreground">Saving does not issue any invoice.</p>
              <Button disabled={!!busy || !selectedHotel} onClick={save}>
                {busy === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Save company settings
              </Button>
            </div>
          </CardContent></Card>
      </div>
      <Card><CardContent className="py-4 flex flex-wrap gap-3 items-center justify-between">
        <div><p className="font-medium flex items-center gap-2"><FileText className="h-4 w-4"/> Guest invoicing</p>
          <p className="text-xs text-muted-foreground">After the company is enabled and assigned to a property, open a test reservation to create a proforma or invoice, review the PDF and check the provider record.</p>
        </div>
        <Button variant="outline" asChild><Link to={'/' + (organizationSlug || 'rdhotels') + '/reception'}>Open reception</Link></Button>
      </CardContent></Card>
    </main>
  </div>;
}