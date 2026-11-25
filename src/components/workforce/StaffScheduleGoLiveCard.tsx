import { useEffect, useState } from 'react';
import { CalendarClock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { invalidateStaffScheduleLive } from '@/hooks/useAccessPolicy';
import { intlLocale } from '@/lib/workforce/model';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type State = { live: boolean; changedAt: string | null; visibleDays: number | null; windowAvailable: boolean } | null;
const WINDOWS = [7, 14, 21, 31] as const;

/**
 * What staff see of the work schedule. Housekeepers and maintenance staff see
 * nothing until it is put live here (after the manager trainings), and the
 * visibility window limits how far ahead anyone sees their own shifts. HR,
 * top management and administrators only; the database refuses anyone else.
 */
export function StaffScheduleGoLiveCard() {
  const { profile } = useAuth();
  const { t, language } = useTranslation();
  const org = profile?.organization_slug ?? '';
  const [state, setState] = useState<State>(null);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!org) return;
    type Row = { staff_schedule_live?: boolean; staff_schedule_live_changed_at?: string | null; staff_visible_days?: number | null };
    const read = (columns: string) => db.from('workforce_settings').select(columns).eq('organization_slug', org).maybeSingle();
    void (async () => {
      let windowAvailable = true;
      let res: { data: Row | null; error: { message?: string } | null } = await read('staff_schedule_live,staff_schedule_live_changed_at,staff_visible_days');
      // The visibility window arrives with the work-schedule v2 database update.
      if (res.error && /staff_visible_days/.test(res.error.message ?? '')) { windowAvailable = false; res = await read('staff_schedule_live,staff_schedule_live_changed_at'); }
      if (res.error) { setMissing(true); setState({ live: false, changedAt: null, visibleDays: null, windowAvailable: false }); return; }
      setState({ live: res.data?.staff_schedule_live === true, changedAt: res.data?.staff_schedule_live_changed_at ?? null, visibleDays: res.data?.staff_visible_days ?? null, windowAvailable });
    })();
  }, [org]);

  const toggle = async (live: boolean) => {
    setSaving(true);
    const { error } = await db.rpc('set_workforce_staff_schedule_live', { _live: live });
    setSaving(false);
    if (error) { toast.error(error.message || t('wf.s.fail')); return; }
    invalidateStaffScheduleLive();
    setState((s) => (s ? { ...s, live, changedAt: new Date().toISOString() } : s));
    toast.success(t(live ? 'wf.s.liveOn' : 'wf.s.liveOff'));
  };

  const setWindow = async (value: string) => {
    const days = value === 'all' ? null : Number(value);
    setSaving(true);
    const { error } = await db.rpc('set_workforce_staff_visible_days', { _days: days });
    setSaving(false);
    if (error) { toast.error(error.message || t('wf.s.fail')); return; }
    setState((s) => (s ? { ...s, visibleDays: days } : s));
    toast.success(t('wf.s.saved'));
  };

  return (
    <>
      <Card className="xl:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {state?.live ? <Eye className="h-4 w-4 text-emerald-600" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
            {t('wf.s.liveTitle')}
          </CardTitle>
          <CardDescription>{t('wf.s.liveDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {state === null ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
            <>
              <Switch id="staff-schedule-live" checked={state.live} disabled={saving || missing} onCheckedChange={(v) => void toggle(v)} />
              <Label htmlFor="staff-schedule-live" className="text-sm">{t(state.live ? 'wf.s.liveOn' : 'wf.s.liveOff')}</Label>
              {state.changedAt && <span className="text-xs text-muted-foreground">{t('wf.s.changed').replace('{time}', new Date(state.changedAt).toLocaleString(intlLocale(language), { dateStyle: 'medium', timeStyle: 'short' }))}</span>}
              {missing && <span className="text-xs text-amber-700">{t('wf.s.missing')}</span>}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-primary" />{t('wf.s.windowTitle')}</CardTitle>
          <CardDescription>{t('wf.s.windowDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {state === null ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
            <>
              <Select value={state.visibleDays == null ? 'all' : String(state.visibleDays)} onValueChange={(v) => void setWindow(v)} disabled={saving || !state.windowAvailable}>
                <SelectTrigger className="h-9 w-[260px]" aria-label={t('wf.s.windowTitle')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('wf.s.windowAll')}</SelectItem>
                  {[...new Set<number>([...WINDOWS, ...(state.visibleDays ? [state.visibleDays] : [])])].sort((a, b) => a - b)
                    .map((n) => <SelectItem key={n} value={String(n)}>{t('wf.s.windowDays').replace('{n}', String(n))}</SelectItem>)}
                </SelectContent>
              </Select>
              {!state.windowAvailable && <span className="text-xs text-amber-700">{t('wf.s.missing')}</span>}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
