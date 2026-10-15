import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { BellRing, Save } from 'lucide-react';

type SettingsForm = {
  email_enabled: boolean;
  notify_on_creation: boolean;
  selectedRecipients: string[];
  creation: string;
  urgent_sla_hours: number;
  high_sla_hours: number;
  medium_sla_hours: number;
  low_sla_hours: number;
  l1: string;
  l2: string;
};

const DEFAULTS: SettingsForm = {
  email_enabled: true,
  notify_on_creation: true,
  selectedRecipients: [],
  creation: '',
  urgent_sla_hours: 4,
  high_sla_hours: 12,
  medium_sla_hours: 24,
  low_sla_hours: 48,
  l1: '',
  l2: '',
};

function splitEmails(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map(v => v.trim().toLowerCase()).filter(Boolean))];
}

function validEmails(values: string[]): boolean {
  return values.every(value => /^\S+@\S+\.\S+$/.test(value)
    && !/\.(?:local|test|invalid|example)$/i.test(value.split('@')[1] || ''));
}

type Recipient = { id: string; full_name: string; email: string | null;
  role: string; assigned_hotel: string | null; can_email: boolean };

export function MaintenanceEscalationSettings() {
  const { profile } = useAuth();
  const { hotels } = useTenant();
  const allowed = !!profile && (
    profile.role === 'top_management' || profile.role === 'top_management_manager'
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loadError, setLoadError] = useState('');
  const [selectedHotel, setSelectedHotel] = useState('');
  const hotelOptions = useMemo(() => hotels
    .filter(h => h.is_active && h.hotel_id !== 'all' && (
      profile?.role === 'top_management'
      || h.hotel_id === profile?.assigned_hotel || h.hotel_name === profile?.assigned_hotel
    )), [hotels, profile?.role, profile?.assigned_hotel]);
  const hotelId = selectedHotel || hotelOptions[0]?.hotel_id || profile?.assigned_hotel || '';
  const scope = useMemo(() => `${profile?.organization_slug || ''}:${hotelId}`,
    [profile?.organization_slug, hotelId]);

  useEffect(() => {
    if (!open || !allowed || !profile?.organization_slug || !hotelId) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    setRecipients([]);
    void (async () => {
      try {
        const [settingResult, candidateResult] = await Promise.all([
          (supabase as any).from('maintenance_escalation_settings')
            .select('email_enabled,notify_on_creation,creation_emails,creation_recipient_ids,urgent_sla_hours,high_sla_hours,medium_sla_hours,low_sla_hours,l1_emails,l2_emails')
            .eq('organization_slug', profile.organization_slug)
            .eq('hotel', hotelId).maybeSingle(),
          (supabase as any).rpc('get_maintenance_creation_candidates', { p_hotel: hotelId }),
        ]);
        if (settingResult.error || candidateResult.error)
          throw settingResult.error || candidateResult.error;
        if (!active) return;
        const staff = (candidateResult.data || []) as Recipient[];
        setRecipients(staff);
        const data = settingResult.data;
        setForm(data ? {
          email_enabled: data.email_enabled !== false,
          notify_on_creation: data.notify_on_creation !== false,
          selectedRecipients: (data.creation_recipient_ids || []).filter((id: string) =>
            staff.some(person => person.id === id && person.can_email)),
          creation: Array.isArray(data.creation_emails) ? data.creation_emails.join(', ') : '',
          urgent_sla_hours: Number(data.urgent_sla_hours ?? 4),
          high_sla_hours: Number(data.high_sla_hours ?? 12),
          medium_sla_hours: Number(data.medium_sla_hours ?? 24),
          low_sla_hours: Number(data.low_sla_hours ?? 48),
          l1: Array.isArray(data.l1_emails) ? data.l1_emails.join(', ') : '',
          l2: Array.isArray(data.l2_emails) ? data.l2_emails.join(', ') : '',
        } : { ...DEFAULTS });
      } catch (error: any) {
        if (!active) return;
        setLoadError(error?.message || 'Unable to load email recipients.');
        setRecipients([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [open, allowed, scope]);

  if (!allowed) return null;

  const setHours = (field: keyof Pick<SettingsForm, 'urgent_sla_hours' | 'high_sla_hours' | 'medium_sla_hours' | 'low_sla_hours'>, value: string) => {
    const parsed = Number(value);
    setForm(current => ({ ...current, [field]: Number.isFinite(parsed) ? parsed : 1 }));
  };

  const save = async () => {
    if (!profile?.organization_slug || !hotelId || !profile.id || saving || loading || loadError) return;
    const creation = splitEmails(form.creation);
    const selectedIds = form.selectedRecipients.filter(id =>
      recipients.some(person => person.id === id && person.can_email));
    const l1 = splitEmails(form.l1);
    const l2 = splitEmails(form.l2);
    if (!validEmails(creation) || !validEmails(l1) || !validEmails(l2)) {
      toast.error('Please correct the escalation email addresses.');
      return;
    }
    const hours = [form.urgent_sla_hours, form.high_sla_hours, form.medium_sla_hours, form.low_sla_hours];
    if (hours.some(value => !Number.isInteger(value) || value < 1 || value > 720)) {
      toast.error('Repair deadline hours must be whole numbers between 1 and 720.');
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from('maintenance_escalation_settings').upsert({
      organization_slug: profile.organization_slug,
      hotel: hotelId,
      email_enabled: form.email_enabled,
      notify_on_creation: form.notify_on_creation,
      notify_property_staff: false, // Legacy mass-notify option stays disabled
      creation_recipient_ids: selectedIds,
      creation_emails: creation,
      urgent_sla_hours: form.urgent_sla_hours,
      high_sla_hours: form.high_sla_hours,
      medium_sla_hours: form.medium_sla_hours,
      low_sla_hours: form.low_sla_hours,
      l1_emails: l1,
      l2_emails: l2,
      updated_by: profile.id,
    }, { onConflict: 'organization_slug,hotel' });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Maintenance notifications and repair deadlines saved.');
    setOpen(false);
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button variant="outline" size="sm"><BellRing className="mr-1 h-4 w-4" />Repair deadlines & emails</Button>
    </DialogTrigger>
    <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Maintenance notifications & repair deadlines</DialogTitle></DialogHeader>
      {loading ? <p className="text-sm text-muted-foreground">Loading settings…</p> : <div className="space-y-5">
        {profile?.role === 'top_management' && hotelOptions.length > 1 &&
          <div className="space-y-2">
            <Label>Property</Label>
            <Select value={hotelId} onValueChange={setSelectedHotel}>
              <SelectTrigger><SelectValue placeholder="Select a hotel" /></SelectTrigger>
              <SelectContent>{hotelOptions.map(h =>
                <SelectItem key={h.hotel_id} value={h.hotel_id}>{h.hotel_name}</SelectItem>
              )}</SelectContent>
            </Select>
          </div>}
        {loadError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {loadError} Please retry opening the settings.
        </div>}
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={form.email_enabled}
            onChange={event => setForm(current => ({ ...current, email_enabled: event.target.checked }))} />
          <span><span className="block text-sm font-semibold">Automatic maintenance emails</span>
            <span className="block text-xs text-muted-foreground">Only recipients explicitly selected by top management receive a new-issue email. L1 and L2 reminder lists are configured separately.</span></span>
        </label>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="text-sm font-semibold">At creation · Notify immediately</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.notify_on_creation}
              onChange={event => setForm(current => ({ ...current, notify_on_creation: event.target.checked }))} />
            Send an email when a maintenance issue is reported
          </label>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Choose individual hotel recipients</Label>
              <Badge variant="outline">{form.selectedRecipients.length} selected</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose only the managers or reception staff who should receive new issues.
              No users are selected automatically.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border bg-white p-2">
              {recipients.length === 0 && <p className="p-2 text-sm text-muted-foreground">
                No eligible hotel staff accounts found. You can add a direct email address below.
              </p>}
              {recipients.map(person => <label key={person.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/60 ${!person.can_email ? 'opacity-60' : ''}`}>
                <input type="checkbox" className="mt-1 h-4 w-4" disabled={!person.can_email || !form.notify_on_creation}
                  checked={form.selectedRecipients.includes(person.id)}
                  onChange={event => setForm(current => ({
                    ...current,
                    selectedRecipients: event.target.checked
                      ? [...current.selectedRecipients, person.id]
                      : current.selectedRecipients.filter(id => id !== person.id),
                  }))} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{person.full_name}</span>
                  <span className="block break-all text-xs text-muted-foreground">
                    {person.role.replace(/_/g, ' ')} · {person.email || 'No email'}
                  </span>
                  {!person.can_email && <span className="text-xs text-amber-700">
                    Email is missing or not deliverable. Cannot select.
                  </span>}
                </span>
              </label>)}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="maintenance-creation-emails">Additional approved email addresses (optional)</Label>
            <Input id="maintenance-creation-emails" value={form.creation}
              disabled={!form.notify_on_creation}
              onChange={event => setForm(current => ({ ...current, creation: event.target.value }))}
              placeholder="reception@hotel.com, manager@hotel.com" />
            <p className="text-xs text-muted-foreground">Only addresses entered by top management are added. Separate with commas; placeholder .local addresses are not accepted.</p>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold">Repair deadline by priority</h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ['urgent_sla_hours', 'Urgent'], ['high_sla_hours', 'High'], ['medium_sla_hours', 'Medium'], ['low_sla_hours', 'Low'],
            ] as const).map(([field, label]) => <div key={field} className="space-y-1">
              <Label htmlFor={field}>{label}</Label>
              <div className="flex items-center gap-1"><Input id={field} type="number" min={1} max={720} step={1} value={form[field]}
                onChange={event => setHours(field, event.target.value)} /><span className="text-xs text-muted-foreground">h</span></div>
            </div>)}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="maintenance-l1-emails">L1 · first overdue reminder</Label>
          <Input id="maintenance-l1-emails" value={form.l1} onChange={event => setForm(current => ({ ...current, l1: event.target.value }))}
            placeholder="manager@hotel.com, maintenance@hotel.com" />
          <p className="text-xs text-muted-foreground">Sent if the issue remains open after the repair deadline. Separate email addresses with commas.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="maintenance-l2-emails">L2 · final overdue reminder</Label>
          <Input id="maintenance-l2-emails" value={form.l2} onChange={event => setForm(current => ({ ...current, l2: event.target.value }))}
            placeholder="operations@company.com" />
          <p className="text-xs text-muted-foreground">Sent once when the issue remains open after another full repair-deadline period. Each email includes a secure link to the ticket.</p>
        </div>

        <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
          Example: If you select one manager and the reception email, only those two recipients will receive new issue notifications. A Medium ticket with a 24-hour deadline can send L1 at 24 hours and L2 at 48 hours if it remains open.
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || loading || !!loadError}><Save className="mr-1 h-4 w-4" />{saving ? 'Saving…' : 'Save settings'}</Button>
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}
