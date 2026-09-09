import { useEffect, useState } from 'react';
import { AlertTriangle, BellRing, BrainCircuit, CheckCircle2, Loader2, Mail, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

const DEFAULT_EMAIL = 'anuruddha.dharmasena@gmail.com';
const MANAGER_ROLES = new Set([
  'admin', 'top_management', 'top_management_manager', 'manager',
  'housekeeping_manager', 'reception_manager', 'supervisor',
]);

type LearningProfile = {
  model_version: string | null;
  sample_count: number;
  correction_count: number;
  confidence_score: number | string;
  diagnostics: Record<string, any> | null;
  last_correction_at: string | null;
  refreshed_at: string | null;
};

type LatestPlan = {
  plan_date: string;
  status: string;
  release_revalidation_status: string | null;
  release_revalidated_at: string | null;
  release_revalidation_attempt_count: number | null;
  released_at: string | null;
  last_error: string | null;
  release_result: Record<string, any> | null;
};

function parseEmails(value: string) {
  return [...new Set(value
    .split(/[;,\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))];
}

function formatWhen(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function HousekeepingAutomationSettings() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [alertTime, setAlertTime] = useState('08:45');
  const [timezone, setTimezone] = useState('Europe/Budapest');
  const [emails, setEmails] = useState(DEFAULT_EMAIL);
  const [learning, setLearning] = useState<LearningProfile | null>(null);
  const [latestPlan, setLatestPlan] = useState<LatestPlan | null>(null);

  const canManage = !!profile?.role && (MANAGER_ROLES.has(profile.role) || profile.is_super_admin === true);

  useEffect(() => {
    if (!canManage || !profile?.assigned_hotel || !profile.organization_slug) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [settingsResult, learningResult, planResult] = await Promise.all([
        (supabase as any)
          .from('housekeeping_automation_settings')
          .select('timezone,inactivity_alert_enabled,inactivity_alert_time,alert_emails')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', profile.assigned_hotel)
          .maybeSingle(),
        (supabase as any)
          .from('housekeeping_assignment_learning_profiles')
          .select('model_version,sample_count,correction_count,confidence_score,diagnostics,last_correction_at,refreshed_at')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', profile.assigned_hotel)
          .maybeSingle(),
        (supabase as any)
          .from('next_day_housekeeping_plans')
          .select('plan_date,status,release_revalidation_status,release_revalidated_at,release_revalidation_attempt_count,released_at,last_error,release_result')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', profile.assigned_hotel)
          .order('plan_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!cancelled) {
        if (settingsResult.error) console.warn('[HousekeepingAutomationSettings] load failed', settingsResult.error);
        if (settingsResult.data) {
          setEnabled(settingsResult.data.inactivity_alert_enabled !== false);
          setAlertTime(String(settingsResult.data.inactivity_alert_time || '08:45:00').slice(0, 5));
          setTimezone(settingsResult.data.timezone || 'Europe/Budapest');
          setEmails(Array.isArray(settingsResult.data.alert_emails) && settingsResult.data.alert_emails.length ? settingsResult.data.alert_emails.join(', ') : DEFAULT_EMAIL);
        }
        if (!learningResult.error) setLearning(learningResult.data as LearningProfile | null);
        else console.warn('[HousekeepingAutomationSettings] learning status unavailable', learningResult.error);
        if (!planResult.error) setLatestPlan(planResult.data as LatestPlan | null);
        else console.warn('[HousekeepingAutomationSettings] release status unavailable', planResult.error);
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

  const confidence = Math.max(0, Math.min(95, Math.round(Number(learning?.confidence_score || 0) * 100)));
  const releaseValidation = latestPlan?.release_result?.release_revalidation;
  const releaseSkipped = Number(latestPlan?.release_result?.pms_or_staff_skipped_assignments || 0);
  const releaseChanges = Number(latestPlan?.release_result?.overnight_type_changes || 0);

  return (
    <div className="space-y-4">
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
                <p className="text-[10px] text-muted-foreground">Separate multiple addresses with commas. The same recipients receive a release-delay alert if HotelCare cannot safely revalidate Previo in the morning.</p>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BrainCircuit className="h-4 w-4 text-violet-600" /> Hotel assignment learning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading learning status…</div>
            ) : learning ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Confidence</span>
                  <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-300">{confidence}%</Badge>
                </div>
                <Progress value={confidence} className="h-2" />
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
                  <div className="rounded-lg bg-muted/40 p-2"><div className="text-lg font-bold">{learning.sample_count || 0}</div><div className="text-[10px] text-muted-foreground">Reviewed assignments</div></div>
                  <div className="rounded-lg bg-muted/40 p-2"><div className="text-lg font-bold">{learning.correction_count || 0}</div><div className="text-[10px] text-muted-foreground">Manager corrections</div></div>
                  <div className="col-span-2 rounded-lg bg-muted/40 p-2 sm:col-span-1"><div className="text-lg font-bold">{learning.diagnostics?.staff_with_preferences || 0}</div><div className="text-[10px] text-muted-foreground">Staff patterns learned</div></div>
                </div>
                <p className="text-xs text-muted-foreground">Only explicit manager corrections train this hotel profile. HotelCare does not learn from its own untouched suggestions. Learned patterns remain advisory; workload, shifts and locality safety rules still win.</p>
                <p className="text-[10px] text-muted-foreground">Last correction: {formatWhen(learning.last_correction_at)} · Model: {learning.model_version || 'manager-correction-v1'}</p>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No manager-correction pattern has been learned yet. HotelCare will begin building this hotel’s profile after managers adjust approved tomorrow plans.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> Morning release safety
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading release status…</div>
            ) : latestPlan ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{latestPlan.plan_date}</Badge>
                  <Badge variant={latestPlan.status === 'released' ? 'default' : 'secondary'}>{latestPlan.status}</Badge>
                  <Badge variant="outline" className={latestPlan.release_revalidation_status === 'passed' ? 'border-emerald-300 text-emerald-700' : latestPlan.release_revalidation_status === 'failed' ? 'border-red-300 text-red-700' : ''}>
                    PMS check: {latestPlan.release_revalidation_status || 'pending'}
                  </Badge>
                </div>
                {latestPlan.status === 'released' ? (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:bg-emerald-950/20">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div>
                      <p className="font-medium">Released after fresh server-side validation</p>
                      <p className="mt-1 text-xs text-muted-foreground">Released {formatWhen(latestPlan.released_at)} · {releaseSkipped} skipped · {releaseChanges} cleaning-type changes.</p>
                    </div>
                  </div>
                ) : latestPlan.last_error ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-sm dark:bg-amber-950/20">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div><p className="font-medium">Automatic release needs attention</p><p className="mt-1 text-xs text-muted-foreground">{latestPlan.last_error}</p></div>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">HotelCare will refresh and revalidate Previo immediately before the scheduled release. It will not publish stale automatic assignments.</div>
                )}
                {releaseValidation?.source && <p className="text-[10px] text-muted-foreground">Last validation source: {releaseValidation.source} · Attempts: {latestPlan.release_revalidation_attempt_count || 0} · Validated: {formatWhen(latestPlan.release_revalidated_at)}</p>}
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No next-day housekeeping plan exists yet for this hotel.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
