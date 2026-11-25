/* eslint-disable @typescript-eslint/no-explicit-any -- the NAV/reconciliation tables are not in the generated Supabase types yet */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { invalidatePurchaseInvoiceAccess } from '@/hooks/usePurchaseInvoiceAccess';

const ROLE_OPTIONS = ['admin', 'top_management', 'top_management_manager', 'control_finance', 'back_office', 'back_office_manager',
  'control_manager', 'manager', 'reception', 'front_office'];

const DEFAULTS = {
  module_enabled: false,
  allowed_roles: ['admin', 'top_management', 'top_management_manager', 'control_finance', 'back_office'],
  auto_reconcile: true, auto_apply_gap_fill: true,
  amount_tolerance_huf: 1, amount_tolerance_foreign: 0.01, date_tolerance_days: 3, reporting_delay_days: 5,
  sync_interval_minutes: 120, backfill_days: 45,
  block_approval_on_exceptions: true, require_separate_approver: false, require_nav_match_for_approval: false,
  daily_summary_enabled: false, notification_recipient_ids: [] as string[],
  reconciliation_start_date: null as string | null, default_cost_centre_id: null as string | null, default_category_id: null as string | null,
};
type Settings = typeof DEFAULTS;

/** Organization-level rollout, reconciliation and approval rules (RLS: finance admins write). */
export function ModuleRolloutPanel({ onSaved }: { onSaved?: () => void } = {}) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const org = profile?.organization_slug ?? '';
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [staff, setStaff] = useState<any[]>([]);
  const [costCentres, setCostCentres] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      const db = supabase as any;
      const [s, st, cc, cat] = await Promise.all([
        db.from('pi_module_settings').select('*').eq('organization_slug', org).maybeSingle(),
        db.from('profiles').select('id, full_name, nickname, role, email').eq('organization_slug', org).order('full_name'),
        db.from('invoice_cost_centres').select('id, label, code').eq('organization_slug', org).eq('is_active', true).order('sort_order'),
        db.from('purchase_invoice_categories').select('id, label, code').eq('organization_slug', org).eq('is_active', true).order('sort_order'),
      ]);
      if (cancelled) return;
      if (s.data) setSettings({ ...DEFAULTS, ...Object.fromEntries(Object.entries(s.data).filter(([k]) => k in DEFAULTS)) } as Settings);
      setStaff(st.data ?? []);
      setCostCentres(cc.data ?? []);
      setCategories(cat.data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [org]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const num = (key: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, (e.target.value === '' ? 0 : Number(e.target.value)) as never);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('pi_module_settings').upsert({
        organization_slug: org, ...settings, reconciliation_start_date: settings.reconciliation_start_date || null, updated_by: profile?.id ?? null,
      }, { onConflict: 'organization_slug' });
      if (error) throw error;
      invalidatePurchaseInvoiceAccess();
      toast.success(t('pi.rollout.saved'));
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const toggle = (key: keyof Settings, label: string) => (
    <label className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm">
      <span>{label}</span>
      <Switch checked={!!settings[key]} onCheckedChange={(v) => set(key, v as never)} />
    </label>
  );
  const field = (key: keyof Settings, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input className="h-8" value={String(settings[key] ?? '')} onChange={num(key)} type="number" {...props} />
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('pi.rollout.heading')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {toggle('module_enabled', t('pi.rollout.enabled'))}
          <div>
            <div className="text-xs font-medium mb-1">{t('pi.rollout.roles')}</div>
            <div className="flex flex-wrap gap-3">
              {ROLE_OPTIONS.map((role) => (
                <label key={role} className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={settings.allowed_roles.includes(role)}
                    onCheckedChange={(v) => set('allowed_roles', v === true ? [...settings.allowed_roles, role] : settings.allowed_roles.filter((r) => r !== role))} />
                  {role}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{t('pi.rollout.rolesHint')}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('pi.rollout.tolerances')}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {field('amount_tolerance_huf', t('pi.rollout.amountHuf'), { min: 0, max: 100, step: 1 })}
          {field('amount_tolerance_foreign', t('pi.rollout.amountForeign'), { min: 0, max: 5, step: 0.01 })}
          {field('date_tolerance_days', t('pi.rollout.dateDays'), { min: 0, max: 31 })}
          {field('reporting_delay_days', t('pi.rollout.reportingDelay'), { min: 0, max: 60 })}
          {field('sync_interval_minutes', t('pi.rollout.syncInterval'), { min: 30, max: 1440, step: 30 })}
          {field('backfill_days', t('pi.rollout.backfill'), { min: 7, max: 120 })}
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">{t('pi.rollout.startDate')}</Label>
            <Input type="date" className="h-8 w-[180px]" value={settings.reconciliation_start_date ?? ''}
              onChange={(e) => set('reconciliation_start_date', e.target.value || null)} />
            <p className="text-[11px] text-muted-foreground">{t('pi.rollout.startDateHint')}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('pi.rollout.rules')}</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-2">
          {toggle('block_approval_on_exceptions', t('pi.rollout.blockExceptions'))}
          {toggle('require_separate_approver', t('pi.rollout.separateApprover'))}
          {toggle('require_nav_match_for_approval', t('pi.rollout.requireNavMatch'))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('pi.rollout.automation')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-2 gap-2">
            {toggle('auto_reconcile', t('pi.rollout.autoReconcile'))}
            {toggle('auto_apply_gap_fill', t('pi.rollout.autoGapFill'))}
            {toggle('daily_summary_enabled', t('pi.rollout.dailySummary'))}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('pi.rollout.defaultCostCentre')}</Label>
              <Select value={settings.default_cost_centre_id ?? 'none'} onValueChange={(v) => set('default_cost_centre_id', v === 'none' ? null : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {costCentres.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('pi.rollout.defaultCategory')}</Label>
              <Select value={settings.default_category_id ?? 'none'} onValueChange={(v) => set('default_category_id', v === 'none' ? null : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {settings.daily_summary_enabled && (
            <div>
              <div className="text-xs font-medium mb-1">{t('pi.rollout.recipients')}</div>
              <div className="max-h-48 overflow-y-auto grid sm:grid-cols-2 gap-1.5">
                {staff.filter((s) => s.email).map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 text-xs">
                    <Checkbox checked={settings.notification_recipient_ids.includes(s.id)}
                      onCheckedChange={(v) => set('notification_recipient_ids', v === true
                        ? [...settings.notification_recipient_ids, s.id]
                        : settings.notification_recipient_ids.filter((x) => x !== s.id))} />
                    <span className="truncate">{s.full_name || s.nickname} · {s.role}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}{t('pi.rollout.save')}
        </Button>
      </div>
    </div>
  );
}
