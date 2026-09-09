import { useEffect, useState } from 'react';
import { BellRing, Loader2, Mail, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

const DEFAULT_EMAIL = 'anuruddha.dharmasena@gmail.com';
const MANAGER_ROLES = new Set([
  'admin', 'top_management', 'top_management_manager', 'manager',
  'housekeeping_manager', 'reception_manager', 'supervisor',
]);

function parseEmails(value: string) {
  return [...new Set(value
    .split(/[;,\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))];
}

export function HousekeepingAutomationSettings() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [alertTime, setAlertTime] = useState('08:45');
  const [timezone, setTimezone] = useState('Europe/Budapest');
  const [emails, setEmails] = useState(DEFAULT_EMAIL);

  const canManage = !!profile?.role && (MANAGER_ROLES.has(profile.role) || profile.is_super_admin === true);

  useEffect(() => {
    if (!canManage || !profile?.assigned_hotel || !profile.organization_slug) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from('housekeeping_automation_settings')
        .select('timezone,inactivity_alert_enabled,inactivity_alert_time,alert_emails')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', profile.assigned_hotel)
        .maybeSingle();
      if (!cancelled) {
        if (error) console.warn('[HousekeepingAutomationSettings] load failed', error);
        if (data) {
          setEnabled(data.inactivity_alert_enabled !== false);
          setAlertTime(String(data.inactivity_alert_time || '08:45:00').slice(0, 5));
          setTimezone(data.timezone || 'Europe/Budapest');
          setEmails(Array.isArray(data.alert_emails) && data.alert_emails.length ? data.alert_emails.join(', ') : DEFAULT_EMAIL);
        }
        setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [canManage, profile?.assigned_hotel, profile?.organization_slug]);

  if (!canManage) return null;

  const save = async () => {
    if (!profile?.id || !profile.assigned_hotel || !profile.organization_slug || saving) return;
    const recipients = parseEmails(emails);
    const invalid = recipients.filter((email) => !/^\S+@\S+\.\S+$/.test(email));
    if (!recipients.length) {
      toast.error('Add at least one alert email address.');
      return;
    }
    if (invalid.length) {
      toast.error(`Invalid email: ${invalid[0]}`);
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(alertTime)) {
      toast.error('Choose a valid alert time.');
      return;
    }

    setSaving(true);
    const payload = {
      organization_slug: profile.organization_slug,
      hotel_id: profile.assigned_hotel,
      timezone: timezone.trim() || 'Europe/Budapest',
      inactivity_alert_enabled: enabled,
      inactivity_alert_time: `${alertTime}:00`,
      alert_emails: recipients,
      created_by: profile.id,
      updated_by: profile.id,
    };
    const { error } = await (supabase as any)
      .from('housekeeping_automation_settings')
      .upsert(payload, { onConflict: 'organization_slug,hotel_id' });
    setSaving(false);
    if (error) {
      toast.error(error.message || 'Could not save housekeeping alert settings.');
      return;
    }
    setEmails(recipients.join(', '));
    toast.success('Housekeeping morning alert settings saved.');
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4" /> Morning housekeeper activity alert
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading alert settings…</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Alert when assigned housekeepers are not active</p>
                <p className="mt-1 text-xs text-muted-foreground">HotelCare checks the staff who actually received planned rooms. Activity can be a HotelCare heartbeat, attendance check-in, or starting a room.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="hk-alert-time">Daily cutoff</Label>
                <Input id="hk-alert-time" type="time" value={alertTime} onChange={(event) => setAlertTime(event.target.value)} />
                <p className="text-[10px] text-muted-foreground">Default: 08:45</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hk-alert-timezone">Hotel timezone</Label>
                <Input id="hk-alert-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Europe/Budapest" />
                <p className="text-[10px] text-muted-foreground">IANA timezone, used for DST-safe checks.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hk-alert-emails" className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />Alert email recipients</Label>
              <Input id="hk-alert-emails" value={emails} onChange={(event) => setEmails(event.target.value)} placeholder={DEFAULT_EMAIL} />
              <p className="text-[10px] text-muted-foreground">Separate multiple addresses with commas. One grouped email is sent per hotel/day, not one email per room.</p>
            </div>

            <div className="flex justify-end">
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save alert settings
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
