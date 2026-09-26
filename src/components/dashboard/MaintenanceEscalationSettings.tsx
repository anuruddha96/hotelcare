import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { BellRing, Save } from 'lucide-react';

type SettingsForm = {
  email_enabled: boolean;
  urgent_sla_hours: number;
  high_sla_hours: number;
  medium_sla_hours: number;
  low_sla_hours: number;
  l1: string;
  l2: string;
};

const DEFAULTS: SettingsForm = {
  email_enabled: true,
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
  return values.every(value => /^\S+@\S+\.\S+$/.test(value));
}

export function MaintenanceEscalationSettings() {
  const { profile } = useAuth();
  const allowed = !!profile && (
    profile.role === 'top_management' || profile.role === 'top_management_manager'
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  const scope = useMemo(() => `${profile?.organization_slug || ''}:${profile?.assigned_hotel || ''}`, [profile?.organization_slug, profile?.assigned_hotel]);

  useEffect(() => {
    if (!open || !allowed || !profile?.organization_slug || !profile.assigned_hotel) return;
    let active = true;
    setLoading(true);
    void (async () => {
      const { data, error } = await (supabase as any).from('maintenance_escalation_settings')
        .select('email_enabled,urgent_sla_hours,high_sla_hours,medium_sla_hours,low_sla_hours,l1_emails,l2_emails')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel', profile.assigned_hotel)
        .maybeSingle();
      if (!active) return;
      if (error) {
        toast.error(error.message.includes('maintenance_escalation_settings')
          ? 'Maintenance escalation settings are not deployed yet.' : error.message);
      } else if (data) {
        setForm({
          email_enabled: data.email_enabled !== false,
          urgent_sla_hours: Number(data.urgent_sla_hours || 4),
          high_sla_hours: Number(data.high_sla_hours || 12),
          medium_sla_hours: Number(data.medium_sla_hours || 24),
          low_sla_hours: Number(data.low_sla_hours || 48),
          l1: Array.isArray(data.l1_emails) ? data.l1_emails.join(', ') : '',
          l2: Array.isArray(data.l2_emails) ? data.l2_emails.join(', ') : '',
        });
      } else {
        setForm(DEFAULTS);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [open, allowed, scope, profile?.organization_slug, profile?.assigned_hotel]);

  if (!allowed) return null;

  const setHours = (field: keyof Pick<SettingsForm, 'urgent_sla_hours' | 'high_sla_hours' | 'medium_sla_hours' | 'low_sla_hours'>, value: string) => {
    const parsed = Number(value);
    setForm(current => ({ ...current, [field]: Number.isFinite(parsed) ? parsed : 1 }));
  };

  const save = async () => {
    if (!profile?.organization_slug || !profile.assigned_hotel || !profile.id || saving) return;
    const l1 = splitEmails(form.l1);
    const l2 = splitEmails(form.l2);
    if (!validEmails(l1) || !validEmails(l2)) {
      toast.error('Please correct the escalation email addresses.');
      return;
    }
    const hours = [form.urgent_sla_hours, form.high_sla_hours, form.medium_sla_hours, form.low_sla_hours];
    if (hours.some(value => !Number.isInteger(value) || value < 1 || value > 720)) {
      toast.error('SLA hours must be whole numbers between 1 and 720.');
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from('maintenance_escalation_settings').upsert({
      organization_slug: profile.organization_slug,
      hotel: profile.assigned_hotel,
      email_enabled: form.email_enabled,
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
    toast.success('Maintenance SLA and escalation settings saved.');
    setOpen(false);
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button variant="outline" size="sm"><BellRing className="mr-1 h-4 w-4" />SLA & escalation settings</Button>
    </DialogTrigger>
    <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Maintenance SLA & email escalation</DialogTitle></DialogHeader>
      {loading ? <p className="text-sm text-muted-foreground">Loading settings…</p> : <div className="space-y-5">
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={form.email_enabled}
            onChange={event => setForm(current => ({ ...current, email_enabled: event.target.checked }))} />
          <span><span className="block text-sm font-semibold">Automatic escalation emails</span>
            <span className="block text-xs text-muted-foreground">L1 is sent when the ticket exceeds its SLA. L2 is sent after one additional SLA period if the ticket is still active.</span></span>
        </label>

        <div>
          <h4 className="mb-2 text-sm font-semibold">SLA duration by priority</h4>
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
          <Label htmlFor="maintenance-l1-emails">L1 · hotel / maintenance managers</Label>
          <Input id="maintenance-l1-emails" value={form.l1} onChange={event => setForm(current => ({ ...current, l1: event.target.value }))}
            placeholder="manager@hotel.com, maintenance@hotel.com" />
          <p className="text-xs text-muted-foreground">Sent once when the original SLA deadline passes. Separate addresses with commas.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="maintenance-l2-emails">L2 · top management</Label>
          <Input id="maintenance-l2-emails" value={form.l2} onChange={event => setForm(current => ({ ...current, l2: event.target.value }))}
            placeholder="operations@company.com" />
          <p className="text-xs text-muted-foreground">Sent once if the ticket remains unresolved for the same SLA duration again. Every escalation email includes a secure direct link to the ticket.</p>
        </div>

        <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
          Example: a Medium ticket with a 24-hour SLA sends L1 at 24 hours and L2 at 48 hours if it is still active. Completed tickets are never escalated.
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving}><Save className="mr-1 h-4 w-4" />{saving ? 'Saving…' : 'Save settings'}</Button>
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}
